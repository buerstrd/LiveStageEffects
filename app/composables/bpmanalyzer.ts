import { computed, onUnmounted, watch } from 'vue'
import { createBpmOctaveLock } from './bpmoctavelock'
import { videoManager } from '~/composables/videomanager'

export type RealtimeBpmStatus =
  | 'idle'
  | 'waiting'
  | 'analyzing'
  | 'paused'
  | 'filtering'
  | 'non-music'
  | 'unavailable'

export type RealtimeBpmSource = 'model' | 'spectrum' | 'manual' | null
export type RealtimeBeatModelStatus = 'idle' | 'loading' | 'ready' | 'error'

interface ManualBpmCommand {
  bpm: number
  locked: boolean
  token: number
}

interface RealtimeBpmSample {
  time: number
  full: number
  low: number
}

interface TempoEstimate {
  bpm: number
  confidence: number
  referenceTime: number
}

interface ModelBeatClock {
  anchor: number
  period: number
  lastPulseIndex: number
  generation: number
}

interface BeatGridReading {
  observedAt: number
  bpm: number
  anchor: number
}

const REALTIME_SAMPLE_INTERVAL_MS = 25
const REALTIME_ESTIMATE_INTERVAL_MS = 450
const REALTIME_SIGNAL_RATE = 50
const REALTIME_HISTORY_SECONDS = 7
const REALTIME_MIN_HISTORY_SECONDS = 3.5
const REALTIME_VALUE_TIMEOUT_MS = 4000
const BEAT_MODEL_VALUE_TIMEOUT_MS = 1500
const MODEL_BPM_MIN_CONFIDENCE = 0.68
const MODEL_BPM_HISTORY_SIZE = 7
const MODEL_BPM_SNAP_THRESHOLD = 15
const BEAT_GRID_STABLE_DURATION_MS = 5000
const BEAT_GRID_READING_WINDOW_MS = 6500
const BEAT_GRID_STABLE_SPREAD_BPM = 6
const BEAT_GRID_MIN_READINGS = 6
const BEAT_GRID_LARGE_ERROR_RATIO = 0.1
const BEAT_GRID_LARGE_ERROR_MIN_BPM = 10
const BEAT_GRID_LARGE_ERROR_COUNT = 3
const SPECTRUM_BPM_MIN_CONFIDENCE = 0.5
const MANUAL_BPM_STEP_LIMIT = 2
const MANUAL_MIN_BPM = 5
const MANUAL_MAX_BPM = 3840
const MIN_BPM = 55
const MAX_BPM = 200
const BPM_STEP = 0.5
const HARMONIC_WEIGHTS = [1, 0.45, 0.24]

let audioContext: AudioContext | null = null
let analyserNode: AnalyserNode | null = null
let mediaElementSource: MediaElementAudioSourceNode | null = null
let connectedVideoElement: HTMLVideoElement | null = null
let frequencyData: Uint8Array<ArrayBuffer> | null = null
let previousFrequencyData: Uint8Array<ArrayBuffer> | null = null

interface BeatWorkerMessage {
  type: 'ready' | 'state' | 'beat' | 'error'
  bpm?: number | null
  confidence?: number
  position?: number
  predicted?: boolean
  silent?: boolean
  hops?: number
  beats?: number
  audioTime?: number
  musicScore?: number
  isMusic?: boolean | null
  message?: string
  generation?: number
}

let beatWorker: Worker | null = null
let beatWorkerReady = false
let beatWorkerFailed = false
let beatWorkerError = ''
let beatWorkerMessageHandler: ((message: BeatWorkerMessage) => void) | null = null
let beatWorkletNode: AudioWorkletNode | null = null
let beatWorkletSink: GainNode | null = null
let beatWorkletVideo: HTMLVideoElement | null = null
let beatWorkletPromise: Promise<void> | null = null
let beatWorkletUnavailable = false
let beatGeneration = 0

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value))
}

const getAudioContextConstructor = () => {
  if (typeof window === 'undefined') return null

  return window.AudioContext
    || (window as typeof window & {
      webkitAudioContext?: typeof AudioContext
    }).webkitAudioContext
    || null
}

const ensureAnalyser = (video: HTMLVideoElement) => {
  const AudioContextConstructor = getAudioContextConstructor()
  if (!AudioContextConstructor) {
    throw new Error('当前浏览器不支持实时音频分析')
  }

  if (!audioContext || audioContext.state === 'closed') {
    try {
      audioContext = new AudioContextConstructor({ sampleRate: 44100 })
    } catch {
      audioContext = new AudioContextConstructor()
    }
    analyserNode = audioContext.createAnalyser()
    analyserNode.fftSize = 2048
    analyserNode.minDecibels = -90
    analyserNode.maxDecibels = -10
    analyserNode.smoothingTimeConstant = 0.55
    analyserNode.connect(audioContext.destination)
    mediaElementSource = null
    connectedVideoElement = null
  }

  if (!analyserNode) {
    throw new Error('无法创建实时音频分析器')
  }

  if (connectedVideoElement !== video) {
    mediaElementSource?.disconnect()
    beatWorkletNode?.disconnect()
    beatWorkletSink?.disconnect()
    beatWorkletNode = null
    beatWorkletSink = null
    beatWorkletVideo = null
    beatWorkletPromise = null
    mediaElementSource = audioContext.createMediaElementSource(video)
    mediaElementSource.connect(analyserNode)
    connectedVideoElement = video
    frequencyData = new Uint8Array(analyserNode.frequencyBinCount)
    previousFrequencyData = new Uint8Array(analyserNode.frequencyBinCount)
  }

  if (!frequencyData || frequencyData.length !== analyserNode.frequencyBinCount) {
    frequencyData = new Uint8Array(analyserNode.frequencyBinCount)
    previousFrequencyData = new Uint8Array(analyserNode.frequencyBinCount)
  }

  if (audioContext.state === 'suspended') {
    void audioContext.resume().catch(() => {})
  }

  void ensureBeatWorklet(video)

  return analyserNode
}

const ensureBeatWorker = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (beatWorker) return

  beatWorkerError = ''
  const workerUrl = new URL('workers/beattracker/worker.js', document.baseURI).href
  beatWorker = new Worker(workerUrl, {
    type: 'module',
    name: 'beattracker'
  })
  beatWorker.onmessage = (event: MessageEvent<BeatWorkerMessage>) => {
    const message = event.data
    if (message?.type === 'ready') {
      beatWorkerReady = true
      beatWorkerFailed = false
      beatWorkerError = ''
    }
    beatWorkerMessageHandler?.(message)
  }
  beatWorker.onerror = (event) => {
    beatWorkerReady = false
    beatWorkerFailed = true
    beatWorkerError = event.message || '节拍识别模型运行失败'
    beatWorkerMessageHandler?.({
      type: 'error',
      message: beatWorkerError
    })
  }
  beatWorker.postMessage({ type: 'init' })
}

const ensureBeatWorklet = (video: HTMLVideoElement) => {
  if (beatWorkletNode && beatWorkletVideo === video) return beatWorkletPromise
  if (beatWorkletUnavailable) return null
  if (beatWorkletPromise) return beatWorkletPromise
  if (
    typeof window === 'undefined'
    || typeof document === 'undefined'
    || !audioContext
    || !mediaElementSource
  ) {
    return null
  }
  if (!audioContext.audioWorklet) {
    beatWorkletUnavailable = true
    beatWorkerFailed = true
    beatWorkerError = '当前浏览器不支持实时音频采集'
    beatWorkerMessageHandler?.({
      type: 'error',
      message: beatWorkerError
    })
    return null
  }

  beatWorkletPromise = audioContext.audioWorklet
    .addModule(new URL('bpm/beattracker-worklet.js', document.baseURI).href)
    .then(() => {
      if (!audioContext || !mediaElementSource) return

      const workletNode = new AudioWorkletNode(
        audioContext,
        'beattracker-hop-collector'
      )
      const sink = audioContext.createGain()
      sink.gain.value = 0
      workletNode.connect(sink)
      sink.connect(audioContext.destination)
      mediaElementSource.connect(workletNode)

      workletNode.port.onmessage = (event) => {
        const hop = event.data?.hop
        if (!(hop instanceof Float32Array) || !beatWorkerReady || !beatWorker) return

        beatWorker.postMessage(
          {
            type: 'hop',
            hop: hop.buffer,
            audioTime: event.data?.time,
            generation: beatGeneration
          },
          [hop.buffer]
        )
      }

      beatWorkletNode = workletNode
      beatWorkletSink = sink
      beatWorkletVideo = video
      ensureBeatWorker()
    })
    .catch((error: unknown) => {
      beatWorkerReady = false
      beatWorkerFailed = true
      beatWorkerError = error instanceof Error ? error.message : '无法启动音频采集'
      beatWorkerMessageHandler?.({
        type: 'error',
        message: beatWorkerError
      })
    })

  return beatWorkletPromise
}

const normalizeSignal = (signal: Float32Array) => {
  let mean = 0
  for (const value of signal) mean += value
  mean /= signal.length

  let variance = 0
  for (const value of signal) {
    const delta = value - mean
    variance += delta * delta
  }
  const deviation = Math.sqrt(variance / signal.length)
  if (deviation < 1e-5) return false

  let maxValue = 0
  for (let index = 0; index < signal.length; index++) {
    const value = Math.max(0, ((signal[index] ?? 0) - mean) / deviation)
    signal[index] = value
    maxValue = Math.max(maxValue, value)
  }

  return maxValue >= 0.25
}

const buildRegularSignals = (
  samples: RealtimeBpmSample[],
  startTime: number,
  endTime: number
) => {
  const duration = endTime - startTime
  const frameCount = Math.floor(duration * REALTIME_SIGNAL_RATE)
  if (frameCount < REALTIME_MIN_HISTORY_SECONDS * REALTIME_SIGNAL_RATE) {
    return null
  }

  const fullSignal = new Float32Array(frameCount)
  const lowSignal = new Float32Array(frameCount)
  let sampleIndex = 0

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const targetTime = startTime + frameIndex / REALTIME_SIGNAL_RATE
    while (
      sampleIndex + 1 < samples.length &&
      (samples[sampleIndex + 1]?.time ?? 0) < targetTime
    ) {
      sampleIndex++
    }

    const before = samples[sampleIndex]
    const after = samples[Math.min(samples.length - 1, sampleIndex + 1)]
    if (!before || !after) continue

    const span = Math.max(1e-6, after.time - before.time)
    const mix = clamp((targetTime - before.time) / span, 0, 1)
    fullSignal[frameIndex] = before.full + (after.full - before.full) * mix
    lowSignal[frameIndex] = before.low + (after.low - before.low) * mix
  }

  if (!normalizeSignal(fullSignal)) return null
  const hasLowSignal = normalizeSignal(lowSignal)

  return {
    fullSignal,
    lowSignal: hasLowSignal ? lowSignal : new Float32Array(frameCount)
  }
}

const scoreTempo = (
  signal: Float32Array,
  bpm: number,
  windowValues: Float32Array
) => {
  let score = 0

  for (let harmonicIndex = 0; harmonicIndex < HARMONIC_WEIGHTS.length; harmonicIndex++) {
    const harmonic = harmonicIndex + 1
    const frequency = (bpm * harmonic) / 60
    if (frequency >= REALTIME_SIGNAL_RATE / 2) break

    const angleStep = (Math.PI * 2 * frequency) / REALTIME_SIGNAL_RATE
    const stepCosine = Math.cos(angleStep)
    const stepSine = Math.sin(angleStep)
    let cosine = 1
    let sine = 0
    let cosineSum = 0
    let sineSum = 0

    for (let index = 0; index < signal.length; index++) {
      const value = (signal[index] ?? 0) * (windowValues[index] ?? 1)
      cosineSum += value * cosine
      sineSum += value * sine

      const nextCosine = cosine * stepCosine - sine * stepSine
      sine = cosine * stepSine + sine * stepCosine
      cosine = nextCosine
    }

    const magnitude = Math.sqrt(cosineSum * cosineSum + sineSum * sineSum)
    score += magnitude * (HARMONIC_WEIGHTS[harmonicIndex] ?? 0)
  }

  return score
}

const estimateBeatReferenceTime = (
  signal: Float32Array,
  bpm: number,
  signalStartTime: number
) => {
  const beatPeriodFrames = (REALTIME_SIGNAL_RATE * 60) / bpm
  let cosineSum = 0
  let sineSum = 0
  let weightSum = 0

  for (let index = 0; index < signal.length; index++) {
    const weight = Math.max(0, signal[index] ?? 0)
    if (weight <= 0) continue

    const phase = (index / beatPeriodFrames) * Math.PI * 2
    cosineSum += weight * Math.cos(phase)
    sineSum += weight * Math.sin(phase)
    weightSum += weight
  }

  if (weightSum <= 0) return signalStartTime

  const phase = Math.atan2(sineSum, cosineSum)
  const normalizedPhase = ((phase / (Math.PI * 2)) % 1 + 1) % 1
  return signalStartTime + normalizedPhase * (60 / bpm)
}

const estimateTempo = (
  samples: RealtimeBpmSample[],
  now: number
): TempoEstimate | null => {
  if (samples.length < 80) return null

  const firstSampleTime = samples[0]?.time ?? now
  const startTime = Math.max(firstSampleTime, now - REALTIME_HISTORY_SECONDS)
  const signals = buildRegularSignals(samples, startTime, now)
  if (!signals) return null

  const frameCount = signals.fullSignal.length
  const windowValues = new Float32Array(frameCount)
  for (let index = 0; index < frameCount; index++) {
    windowValues[index] = 0.5 - 0.5 * Math.cos(
      (Math.PI * 2 * index) / Math.max(1, frameCount - 1)
    )
  }

  const candidateCount = Math.floor((MAX_BPM - MIN_BPM) / BPM_STEP) + 1
  const fullScores = new Float64Array(candidateCount)
  const lowScores = new Float64Array(candidateCount)
  const combinedScores = new Float64Array(candidateCount)
  let bestIndex = 0
  let bestScore = -1

  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
    const bpm = MIN_BPM + candidateIndex * BPM_STEP
    const fullScore = scoreTempo(signals.fullSignal, bpm, windowValues)
    const lowScore = scoreTempo(signals.lowSignal, bpm, windowValues)
    const tempoPrior = Math.exp(
      -0.5 * Math.pow(Math.log(bpm / 120) / 0.5, 2)
    )
    const score = (fullScore * 0.68 + lowScore * 1.18) * tempoPrior

    fullScores[candidateIndex] = fullScore
    lowScores[candidateIndex] = lowScore
    combinedScores[candidateIndex] = score
    if (score > bestScore) {
      bestScore = score
      bestIndex = candidateIndex
    }
  }

  if (bestScore <= 1e-9) return null

  let selectedIndex = bestIndex
  const halfTempo = (MIN_BPM + bestIndex * BPM_STEP) / 2
  if (halfTempo >= MIN_BPM) {
    const halfIndex = Math.round((halfTempo - MIN_BPM) / BPM_STEP)
    const halfFullScore = fullScores[halfIndex] ?? 0
    const halfLowScore = lowScores[halfIndex] ?? 0
    const selectedFullScore = fullScores[bestIndex] ?? 0
    const selectedLowScore = lowScores[bestIndex] ?? 0

    if (
      selectedLowScore > 1e-9 &&
      halfLowScore >= selectedLowScore * 0.52 &&
      halfFullScore >= selectedFullScore * 0.22
    ) {
      selectedIndex = halfIndex
    }
  }

  let secondBestScore = 0
  const selectedBpm = MIN_BPM + selectedIndex * BPM_STEP
  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
    const bpm = MIN_BPM + candidateIndex * BPM_STEP
    if (Math.abs(bpm - selectedBpm) < 8) continue
    secondBestScore = Math.max(
      secondBestScore,
      combinedScores[candidateIndex] ?? 0
    )
  }

  const selectedScore = combinedScores[selectedIndex] ?? bestScore
  const contrast = selectedScore / Math.max(secondBestScore, selectedScore * 0.08, 1e-10)
  const confidence = clamp((contrast - 1) / 2.6, 0.05, 0.99)

  const previousScore = combinedScores[Math.max(0, selectedIndex - 1)] ?? selectedScore
  const nextScore = combinedScores[Math.min(candidateCount - 1, selectedIndex + 1)] ?? selectedScore
  const denominator = previousScore - 2 * selectedScore + nextScore
  const refinement = Math.abs(denominator) > 1e-10
    ? clamp(0.5 * (previousScore - nextScore) / denominator, -0.5, 0.5)
    : 0

  const estimatedBpm = clamp(
    MIN_BPM + (selectedIndex + refinement) * BPM_STEP,
    MIN_BPM,
    MAX_BPM
  )

  return {
    bpm: estimatedBpm,
    confidence,
    referenceTime: estimateBeatReferenceTime(
      signals.fullSignal,
      estimatedBpm,
      startTime
    )
  }
}

export const useRealtimeBpm = () => {
  const bpm = useState<number | null>('realtime_bpm_value', () => null)
  const status = useState<RealtimeBpmStatus>('realtime_bpm_status', () => 'idle')
  const source = useState<RealtimeBpmSource>('realtime_bpm_source', () => null)
  const beatGridPeriod = useState<number | null>(
    'realtime_bpm_beat_grid_period',
    () => null
  )
  const beatGridAnchor = useState<number | null>(
    'realtime_bpm_beat_grid_anchor',
    () => null
  )
  const modelStatus = useState<RealtimeBeatModelStatus>(
    'realtime_bpm_model_status',
    () => 'idle'
  )
  const modelError = useState<string>('realtime_bpm_model_error', () => '')
  const modelHops = useState<number>('realtime_bpm_model_hops', () => 0)
  const modelBeats = useState<number>('realtime_bpm_model_beats', () => 0)
  const modelSilent = useState<boolean>('realtime_bpm_model_silent', () => false)
  const musicScore = useState<number>('realtime_bpm_music_score', () => 0)
  const musicDetected = useState<boolean | null>(
    'realtime_bpm_music_detected',
    () => null
  )
  const beatPulse = useState<number>('realtime_bpm_beat_pulse', () => 0)
  const manualBpmCommand = useState<ManualBpmCommand | null>(
    'realtime_bpm_manual_command',
    () => null
  )
  const manualBpmCommandToken = useState<number>(
    'realtime_bpm_manual_command_token',
    () => 0
  )
  const manualBpmBase = useState<number | null>(
    'realtime_bpm_manual_base',
    () => null
  )
  const manualBpmStep = useState<number>(
    'realtime_bpm_manual_step',
    () => 0
  )
  const beatGridResetToken = useState<number>(
    'realtime_bpm_beat_grid_reset_token',
    () => 0
  )
  const manualBpmResetAvailable = computed(() => {
    return manualBpmStep.value !== 0
  })
  const manualBpmCanHalve = computed(() => {
    const baseBpm = manualBpmBase.value ?? bpm.value
    if (baseBpm === null) return false
    if (manualBpmStep.value <= -MANUAL_BPM_STEP_LIMIT) return false

    const nextBpm = baseBpm * Math.pow(
      2,
      manualBpmStep.value - 1
    )
    return nextBpm >= MANUAL_MIN_BPM && nextBpm <= MANUAL_MAX_BPM
  })
  const manualBpmCanDouble = computed(() => {
    const baseBpm = manualBpmBase.value ?? bpm.value
    if (baseBpm === null) return false
    if (manualBpmStep.value >= MANUAL_BPM_STEP_LIMIT) return false

    const nextBpm = baseBpm * Math.pow(
      2,
      manualBpmStep.value + 1
    )
    return nextBpm >= MANUAL_MIN_BPM && nextBpm <= MANUAL_MAX_BPM
  })

  const emitManualBpm = (
    nextBpm: number,
    locked = true
  ) => {
    if (
      !Number.isFinite(nextBpm)
      || nextBpm < MANUAL_MIN_BPM
      || nextBpm > MANUAL_MAX_BPM
    ) {
      return false
    }

    manualBpmCommandToken.value += 1
    manualBpmCommand.value = {
      bpm: nextBpm,
      locked,
      token: manualBpmCommandToken.value
    }
    return true
  }

  const applyManualBpmFactor = (factor: 0.5 | 2) => {
    const baseBpm = manualBpmBase.value ?? bpm.value
    if (baseBpm === null) return false

    const nextStep = manualBpmStep.value
      + (factor === 0.5 ? -1 : 1)
    if (
      nextStep < -MANUAL_BPM_STEP_LIMIT
      || nextStep > MANUAL_BPM_STEP_LIMIT
    ) {
      return false
    }

    const nextBpm = baseBpm * Math.pow(2, nextStep)
    if (!emitManualBpm(nextBpm)) return false

    manualBpmBase.value = baseBpm
    manualBpmStep.value = nextStep
    return true
  }

  const resetManualBpm = () => {
    const baseBpm = manualBpmBase.value
    if (baseBpm === null) return false

    manualBpmStep.value = 0
    return emitManualBpm(baseBpm, false)
  }

  const clearManualBpmCalibration = () => {
    manualBpmBase.value = null
    manualBpmStep.value = 0
    manualBpmCommand.value = null
  }

  const resetBeatGridAnalysis = () => {
    beatGridResetToken.value += 1
  }

  return {
    bpm,
    status,
    source,
    beatGridPeriod,
    beatGridAnchor,
    modelStatus,
    modelError,
    modelHops,
    modelBeats,
    modelSilent,
    musicScore,
    musicDetected,
    beatPulse,
    manualBpmCommand,
    manualBpmCanHalve,
    manualBpmCanDouble,
    manualBpmResetAvailable,
    applyManualBpmFactor,
    resetManualBpm,
    clearManualBpmCalibration,
    beatGridResetToken,
    resetBeatGridAnalysis
  }
}

export const bpmAnalyzer = () => {
  const {
    videoSrc,
    isVideoPlaying,
    seekVersion,
    getVideoElement
  } = videoManager()
  const {
    bpm,
    status,
    source,
    beatGridPeriod,
    beatGridAnchor,
    modelStatus,
    modelError,
    modelHops,
    modelBeats,
    modelSilent,
    musicScore,
    musicDetected,
    beatPulse,
    manualBpmCommand,
    clearManualBpmCalibration,
    beatGridResetToken
  } = useRealtimeBpm()

  let monitorTimer: ReturnType<typeof setInterval> | null = null
  let history: RealtimeBpmSample[] = []
  let estimates: TempoEstimate[] = []
  let lastEstimateTime = 0
  let lastPublishedTime = 0
  let fullBaseline = 0
  let lowBaseline = 0
  let nextBeatTimeSeconds = 0
  let beatPeriodSeconds = 0
  let lastBeatModelValueAt = 0
  let modelBpmHistory: number[] = []
  let modelBeatClock: ModelBeatClock | null = null
  let modelBeatRafId: number | null = null
  let beatGridReadings: BeatGridReading[] = []
  let beatGridLockedBpm: number | null = null
  let beatGridLargeErrorCount = 0
  let beatGridReadingSource: 'model' | 'spectrum' | null = null
  let manualBpmOverrideUntil = 0
  const octaveLock = createBpmOctaveLock({
    minBpm: MANUAL_MIN_BPM,
    maxBpm: MANUAL_MAX_BPM
  })

  const resetBeatWorker = () => {
    beatGeneration += 1
    beatWorker?.postMessage({
      type: 'reset',
      generation: beatGeneration
    })
  }

  const stopModelBeatScheduler = (clearClock = false) => {
    if (
      typeof window !== 'undefined'
      && modelBeatRafId !== null
    ) {
      cancelAnimationFrame(modelBeatRafId)
    }
    modelBeatRafId = null
    if (clearClock) {
      modelBeatClock = null
    }
  }

  const getAudioPlayheadTime = () => {
    if (!audioContext) return 0
    const timestamp = audioContext.getOutputTimestamp?.()
    const contextTime = timestamp?.contextTime
    if (typeof contextTime === 'number' && Number.isFinite(contextTime)) {
      return contextTime
    }
    return audioContext.currentTime
  }

  const getVideoPlaybackRate = () => {
    const video = getVideoElement()
    const playbackRate = video?.playbackRate
    return typeof playbackRate === 'number' && Number.isFinite(playbackRate)
      ? Math.max(0.01, playbackRate)
      : 1
  }

  const mapAudioTimeToMediaTime = (audioTime: number) => {
    const video = getVideoElement()
    if (
      !audioContext
      || !video
      || !Number.isFinite(audioTime)
      || !Number.isFinite(video.currentTime)
    ) {
      return null
    }

    return video.currentTime
      - (getAudioPlayheadTime() - audioTime) * getVideoPlaybackRate()
  }

  const setBeatGrid = (anchor: number | null, period: number) => {
    if (
      anchor === null
      || !Number.isFinite(anchor)
      || !Number.isFinite(period)
      || period <= 0
    ) {
      return
    }

    beatGridAnchor.value = anchor
    beatGridPeriod.value = period
  }

  const clearBeatGrid = (force = true) => {
    if (!force && beatGridLockedBpm !== null) {
      return
    }

    beatGridAnchor.value = null
    beatGridPeriod.value = null
    beatGridReadings = []
    beatGridLockedBpm = null
    beatGridLargeErrorCount = 0
    beatGridReadingSource = null
  }

  const averageBeatAnchor = (
    readings: BeatGridReading[],
    period: number
  ) => {
    const referenceAnchor = readings[readings.length - 1]?.anchor
    if (referenceAnchor === undefined || !Number.isFinite(referenceAnchor)) {
      return null
    }

    let anchorSum = 0
    for (const reading of readings) {
      const beatOffset = Math.round(
        (reading.anchor - referenceAnchor) / period
      )
      anchorSum += reading.anchor - beatOffset * period
    }

    const averagedAnchor = anchorSum / readings.length
    return Number.isFinite(averagedAnchor) ? averagedAnchor : null
  }

  const registerBeatGridReading = (
    reading: BeatGridReading,
    readingSource: 'model' | 'spectrum'
  ) => {
    if (
      !Number.isFinite(reading.observedAt)
      || !Number.isFinite(reading.bpm)
      || reading.bpm <= 0
      || !Number.isFinite(reading.anchor)
    ) {
      return
    }

    if (beatGridLockedBpm !== null) {
      const bpmError = Math.abs(reading.bpm - beatGridLockedBpm)
      const largeError = bpmError >= BEAT_GRID_LARGE_ERROR_MIN_BPM
        && bpmError / beatGridLockedBpm >= BEAT_GRID_LARGE_ERROR_RATIO

      if (!largeError) {
        beatGridLargeErrorCount = 0
        return
      }

      beatGridLargeErrorCount += 1
      if (beatGridLargeErrorCount < BEAT_GRID_LARGE_ERROR_COUNT) {
        return
      }

      clearBeatGrid()
      beatGridReadings.push(reading)
      beatGridReadingSource = readingSource
      return
    }

    if (beatGridReadingSource !== readingSource) {
      beatGridReadings = []
      beatGridReadingSource = readingSource
    }

    beatGridReadings.push(reading)
    const oldestAllowedTime = reading.observedAt - BEAT_GRID_READING_WINDOW_MS
    const firstValidIndex = beatGridReadings.findIndex(
      item => item.observedAt >= oldestAllowedTime
    )
    if (firstValidIndex > 0) {
      beatGridReadings.splice(0, firstValidIndex)
    }

    const firstReading = beatGridReadings[0]
    if (
      !firstReading
      || beatGridReadings.length < BEAT_GRID_MIN_READINGS
      || reading.observedAt - firstReading.observedAt
        < BEAT_GRID_STABLE_DURATION_MS
    ) {
      return
    }

    let minBpm = Number.POSITIVE_INFINITY
    let maxBpm = 0
    let bpmSum = 0
    for (const item of beatGridReadings) {
      minBpm = Math.min(minBpm, item.bpm)
      maxBpm = Math.max(maxBpm, item.bpm)
      bpmSum += item.bpm
    }

    if (maxBpm - minBpm > BEAT_GRID_STABLE_SPREAD_BPM) {
      return
    }

    const averagedBpm = bpmSum / beatGridReadings.length
    const averagedPeriod = 60 / averagedBpm
    const averagedAnchor = averageBeatAnchor(
      beatGridReadings,
      averagedPeriod
    )
    if (averagedAnchor === null) {
      return
    }

    setBeatGrid(averagedAnchor, averagedPeriod)
    beatGridLockedBpm = averagedBpm
    beatGridLargeErrorCount = 0
    beatGridReadings = []
  }

  const mapAudioTimeToPerformanceTime = (audioTime: number) => {
    if (!audioContext) return performance.now()

    const timestamp = audioContext.getOutputTimestamp?.()
    const contextTime = timestamp?.contextTime
    const performanceTime = timestamp?.performanceTime
    if (
      typeof contextTime === 'number'
      && Number.isFinite(contextTime)
      && typeof performanceTime === 'number'
      && Number.isFinite(performanceTime)
      && performanceTime > 0
    ) {
      return performanceTime
        + (audioTime - contextTime) * 1000
    }

    const outputLatency = Number.isFinite(audioContext.outputLatency)
      ? audioContext.outputLatency
      : audioContext.baseLatency || 0
    return performance.now()
      + (audioTime - audioContext.currentTime + outputLatency) * 1000
  }

  const runModelBeatScheduler = () => {
    modelBeatRafId = null
    const clock = modelBeatClock
    if (
      !clock
      || clock.generation !== beatGeneration
      || !isVideoPlaying.value
      || !audioContext
    ) {
      return
    }

    const playhead = getAudioPlayheadTime()
    let nextIndex = clock.lastPulseIndex + 1
    let nextAudioTime = clock.anchor + nextIndex * clock.period

    // If playback was interrupted or the scheduler fell behind, skip stale
    // beats instead of firing a burst of old flashes.
    if (nextAudioTime < playhead - Math.max(0.18, clock.period * 0.6)) {
      const currentIndex = Math.floor((playhead - clock.anchor) / clock.period)
      clock.lastPulseIndex = Math.max(clock.lastPulseIndex, currentIndex)
      nextIndex = clock.lastPulseIndex + 1
      nextAudioTime = clock.anchor + nextIndex * clock.period
    }

    if (mapAudioTimeToPerformanceTime(nextAudioTime) <= performance.now() + 6) {
      clock.lastPulseIndex = nextIndex
      beatPulse.value += 1
    }

    modelBeatRafId = requestAnimationFrame(runModelBeatScheduler)
  }

  const ensureModelBeatScheduler = () => {
    if (
      typeof window === 'undefined'
      || modelBeatRafId !== null
      || !modelBeatClock
    ) {
      return
    }
    modelBeatRafId = requestAnimationFrame(runModelBeatScheduler)
  }

  const updateModelBeatClock = (message: BeatWorkerMessage) => {
    if (
      !isVideoPlaying.value
      || typeof message.audioTime !== 'number'
      || !Number.isFinite(message.audioTime)
      || typeof message.bpm !== 'number'
      || !Number.isFinite(message.bpm)
      || message.bpm <= 0
    ) {
      return
    }

    const period = 60 / message.bpm
    if (
      !modelBeatClock
      || modelBeatClock.generation !== beatGeneration
    ) {
      modelBeatClock = {
        anchor: message.audioTime,
        period,
        lastPulseIndex: -1,
        generation: beatGeneration
      }
    } else {
      const predictedIndex = Math.round(
        (message.audioTime - modelBeatClock.anchor) / modelBeatClock.period
      )
      const predictedTime = modelBeatClock.anchor
        + predictedIndex * modelBeatClock.period
      const phaseError = message.audioTime - predictedTime

      if (Math.abs(phaseError) < modelBeatClock.period * 0.45) {
        modelBeatClock.anchor += phaseError * 0.2
        modelBeatClock.period += (period - modelBeatClock.period) * 0.15
      } else {
        modelBeatClock = {
          anchor: message.audioTime,
          period,
          lastPulseIndex: -1,
          generation: beatGeneration
        }
      }
    }

    const mediaAnchor = mapAudioTimeToMediaTime(message.audioTime)
    if (mediaAnchor !== null) {
      registerBeatGridReading(
        {
          observedAt: performance.now(),
          bpm: bpm.value ?? message.bpm,
          anchor: mediaAnchor
        },
        'model'
      )
    }
    ensureModelBeatScheduler()
  }

  const startManualBeatClock = (manualBpm: number) => {
    stopModelBeatScheduler(true)
    if (
      !isVideoPlaying.value
      || !audioContext
      || !Number.isFinite(manualBpm)
      || manualBpm <= 0
    ) {
      return
    }

    modelBeatClock = {
      anchor: getAudioPlayheadTime(),
      period: 60 / manualBpm,
      lastPulseIndex: -1,
      generation: beatGeneration
    }
    const video = getVideoElement()
    setBeatGrid(
      video && Number.isFinite(video.currentTime)
        ? video.currentTime
        : null,
      modelBeatClock.period
    )
    beatGridReadings = []
    beatGridLockedBpm = manualBpm
    beatGridLargeErrorCount = 0
    beatGridReadingSource = null
    ensureModelBeatScheduler()
  }

  const handleBeatWorkerMessage = (message: BeatWorkerMessage) => {
    if (message.type === 'ready') {
      beatWorkerReady = true
      beatWorkerFailed = false
      stopModelBeatScheduler(true)
      modelStatus.value = 'ready'
      modelError.value = ''
      modelHops.value = 0
      modelBeats.value = 0
      modelSilent.value = false
      clearBeatGrid(false)
      modelBpmHistory = []
      musicScore.value = 0
      musicDetected.value = null
      bpm.value = null
      source.value = null
      beatWorker?.postMessage({
        type: 'reset',
        generation: beatGeneration
      })
      if (isVideoPlaying.value) {
        status.value = 'analyzing'
      }
      return
    }

    if (
      message.generation !== undefined &&
      message.generation !== beatGeneration
    ) {
      return
    }

    if (message.type === 'state' || message.type === 'beat') {
      if (typeof message.musicScore === 'number') {
        musicScore.value = message.musicScore
      }
      if (message.isMusic !== undefined) {
        musicDetected.value = message.isMusic
      }

      const musicAllowsOutput = message.isMusic === undefined
        || message.isMusic === true

      const confidence = typeof message.confidence === 'number'
        && Number.isFinite(message.confidence)
        ? message.confidence
        : 1
      const manualOverrideActive = performance.now() < manualBpmOverrideUntil

      if (
        !manualOverrideActive
        && musicAllowsOutput
        && typeof message.bpm === 'number'
        && Number.isFinite(message.bpm)
        && confidence >= MODEL_BPM_MIN_CONFIDENCE
      ) {
        const stabilized = octaveLock.stabilize(
          message.bpm,
          confidence,
          performance.now()
        )
        if (stabilized.switched) {
          modelBpmHistory = []
        }
        modelBpmHistory.push(stabilized.bpm)
        if (modelBpmHistory.length > MODEL_BPM_HISTORY_SIZE) {
          modelBpmHistory.shift()
        }

        const sorted = [...modelBpmHistory].sort((left, right) => left - right)
        const medianBpm = sorted[Math.floor(sorted.length / 2)]
          ?? stabilized.bpm
        const currentBpm = bpm.value

        if (
          currentBpm === null
          || source.value !== 'model'
          || Math.abs(medianBpm - currentBpm) > MODEL_BPM_SNAP_THRESHOLD
        ) {
          bpm.value = medianBpm
        } else {
          const smoothing = 0.1 + confidence * 0.08
          bpm.value = currentBpm + (medianBpm - currentBpm) * smoothing
        }

        source.value = 'model'
        lastBeatModelValueAt = performance.now()
      } else if (
        !manualOverrideActive
        && musicAllowsOutput
        && source.value === 'model'
        && bpm.value !== null
        && typeof message.bpm === 'number'
        && Number.isFinite(message.bpm)
      ) {
        // Hold the last stable model reading while confidence recovers.
        lastBeatModelValueAt = performance.now()
      } else if (!manualOverrideActive && !musicAllowsOutput) {
        if (beatGridLockedBpm === null) {
          bpm.value = null
          source.value = null
        }
        lastBeatModelValueAt = 0
        modelBpmHistory = []
        clearBeatGrid(false)
        stopModelBeatScheduler(true)
      }
      if (typeof message.hops === 'number') {
        modelHops.value = message.hops
      }
      if (typeof message.beats === 'number') {
        modelBeats.value = message.beats
      }
      if (typeof message.silent === 'boolean') {
        modelSilent.value = message.silent
      }
      status.value = manualOverrideActive
        ? 'analyzing'
        : !isVideoPlaying.value
          ? 'paused'
          : message.isMusic === false
            ? 'non-music'
            : message.isMusic === null
              ? 'filtering'
              : 'analyzing'
      if (
        !manualOverrideActive
        && musicAllowsOutput
        && message.type === 'beat'
        && !message.silent
        && confidence >= MODEL_BPM_MIN_CONFIDENCE
      ) {
        if (typeof message.audioTime === 'number') {
          updateModelBeatClock(message)
        } else {
          beatPulse.value += 1
        }
      }
      return
    }

    if (message.type === 'error') {
      beatWorkerReady = false
      beatWorkerFailed = true
      stopModelBeatScheduler(true)
      modelStatus.value = 'error'
      modelError.value = message.message || beatWorkerError || '节拍识别模型不可用'
      musicScore.value = 0
      musicDetected.value = null
      source.value = null
      clearBeatGrid(false)
      status.value = videoSrc.value ? 'waiting' : 'idle'
    }
  }

  beatWorkerMessageHandler = handleBeatWorkerMessage

  const resetSignal = (
    clearValue: boolean,
    resetOctaveLock = true,
    preserveBeatGrid = false
  ) => {
    stopModelBeatScheduler(true)
    history = []
    estimates = []
    lastEstimateTime = 0
    lastPublishedTime = 0
    fullBaseline = 0
    lowBaseline = 0
    nextBeatTimeSeconds = 0
    beatPeriodSeconds = 0
    lastBeatModelValueAt = 0
    modelHops.value = 0
    modelBeats.value = 0
    modelSilent.value = false
    if (!preserveBeatGrid) {
      clearBeatGrid()
    }
    modelBpmHistory = []
    if (resetOctaveLock) {
      octaveLock.reset()
    }
    manualBpmOverrideUntil = manualBpmCommand.value?.locked
      ? Number.POSITIVE_INFINITY
      : 0
    musicScore.value = 0
    musicDetected.value = null
    previousFrequencyData?.fill(0)
    if (clearValue && !preserveBeatGrid) {
      bpm.value = null
      source.value = null
    }
  }

  const publishEstimate = (estimate: TempoEstimate, now: number) => {
    const stabilized = octaveLock.stabilize(
      estimate.bpm,
      estimate.confidence,
      now
    )
    if (stabilized.switched) {
      estimates = []
    }
    estimates.push({
      ...estimate,
      bpm: stabilized.bpm
    })
    if (estimates.length > 6) {
      estimates.shift()
    }

    const sorted = estimates
      .map(item => item.bpm)
      .sort((left, right) => left - right)
    const medianBpm = sorted[Math.floor(sorted.length / 2)] ?? estimate.bpm
    const currentBpm = bpm.value
    const smoothing = 0.18 + estimate.confidence * 0.22

    if (
      currentBpm === null ||
      Math.abs(medianBpm - currentBpm) > 15
    ) {
      bpm.value = medianBpm
    } else {
      bpm.value = currentBpm + (medianBpm - currentBpm) * smoothing
    }

    const nextBeatPeriod = 60 / (bpm.value ?? estimate.bpm)
    const nowSeconds = now / 1000
    if (
      nextBeatTimeSeconds <= 0 ||
      beatPeriodSeconds <= 0 ||
      Math.abs(nextBeatPeriod - beatPeriodSeconds) / beatPeriodSeconds > 0.03
    ) {
      const beatsAhead = Math.ceil((nowSeconds - estimate.referenceTime) / nextBeatPeriod)
      nextBeatTimeSeconds = estimate.referenceTime + Math.max(0, beatsAhead) * nextBeatPeriod
      if (nextBeatTimeSeconds < nowSeconds + 0.03) {
        nextBeatTimeSeconds += nextBeatPeriod
      }
    } else {
      const observedNextBeat = estimate.referenceTime +
        Math.ceil((nowSeconds - estimate.referenceTime) / nextBeatPeriod) * nextBeatPeriod
      const phaseDelta = observedNextBeat - nextBeatTimeSeconds
      if (Math.abs(phaseDelta) < nextBeatPeriod * 0.4) {
        nextBeatTimeSeconds += phaseDelta * 0.22
      }
    }
    beatPeriodSeconds = nextBeatPeriod
    const video = getVideoElement()
    const playbackRate = getVideoPlaybackRate()
    const mediaAnchor = video && Number.isFinite(video.currentTime)
      ? video.currentTime - (now / 1000 - estimate.referenceTime) * playbackRate
      : null
    if (mediaAnchor !== null) {
      registerBeatGridReading(
        {
          observedAt: now,
          bpm: bpm.value ?? estimate.bpm,
          anchor: mediaAnchor
        },
        'spectrum'
      )
    }
    lastPublishedTime = now
    modelBpmHistory = []
    stopModelBeatScheduler(true)
    source.value = 'spectrum'
    status.value = 'analyzing'
  }

  watch(
    () => manualBpmCommand.value?.token,
    () => {
      const command = manualBpmCommand.value
      if (
        !command
        || !Number.isFinite(command.bpm)
        || command.bpm < MANUAL_MIN_BPM
        || command.bpm > MANUAL_MAX_BPM
      ) {
        return
      }

      if (command.locked) {
        octaveLock.lockTo(command.bpm)
      } else {
        octaveLock.reset()
      }
      bpm.value = command.bpm
      source.value = command.locked ? 'manual' : null
      modelBpmHistory = []
      estimates = []
      nextBeatTimeSeconds = 0
      beatPeriodSeconds = 0
      lastPublishedTime = performance.now()
      lastBeatModelValueAt = performance.now()
      manualBpmOverrideUntil = command.locked
        ? Number.POSITIVE_INFINITY
        : 0
      startManualBeatClock(command.bpm)
      if (isVideoPlaying.value) {
        status.value = 'analyzing'
      }
    }
  )

  watch(
    () => beatGridResetToken.value,
    () => {
      clearManualBpmCalibration()
      resetSignal(true)
      resetBeatWorker()
      status.value = !videoSrc.value
        ? 'idle'
        : isVideoPlaying.value
          ? 'waiting'
          : 'paused'
    }
  )

  const monitor = () => {
    const video = getVideoElement()
    if (!video || !videoSrc.value) {
      status.value = videoSrc.value ? 'waiting' : 'idle'
      return
    }

    try {
      ensureAnalyser(video)
    } catch {
      status.value = 'unavailable'
      return
    }

    const isPlaybackPaused = !isVideoPlaying.value || video.paused || video.ended
    const hasRecentBeatModelValue = beatWorkerReady
      && !beatWorkerFailed
      && lastBeatModelValueAt > 0
      && performance.now() - lastBeatModelValueAt <= BEAT_MODEL_VALUE_TIMEOUT_MS

    if (isPlaybackPaused) {
      status.value = 'paused'
      return
    }

    if (performance.now() < manualBpmOverrideUntil) {
      status.value = 'analyzing'
      return
    }

    const musicGateBlocked = modelStatus.value === 'loading'
      || (
        beatWorkerReady
        && !beatWorkerFailed
        && musicDetected.value !== true
      )

    if (musicGateBlocked) {
      if (beatGridLockedBpm === null) {
        bpm.value = null
        source.value = null
      }
      lastBeatModelValueAt = 0
      clearBeatGrid(false)
      stopModelBeatScheduler(true)
      status.value = musicDetected.value === false
        ? 'non-music'
        : 'filtering'
      return
    }

    if (hasRecentBeatModelValue) {
      status.value = 'analyzing'
      return
    }

    const analyser = analyserNode
    const spectrum = frequencyData
    const previousSpectrum = previousFrequencyData
    if (!analyser || !spectrum || !previousSpectrum) {
      status.value = 'waiting'
      return
    }

    if (!audioContext || audioContext.state !== 'running') {
      status.value = 'waiting'
      return
    }

    const now = performance.now()
    analyser.getByteFrequencyData(spectrum)

    const binWidth = audioContext.sampleRate / analyser.fftSize
    const maxBin = Math.min(
      spectrum.length - 1,
      Math.floor(12000 / binWidth)
    )
    let fullOnset = 0
    let lowOnset = 0

    for (let bin = 1; bin <= maxBin; bin++) {
      const current = spectrum[bin] ?? 0
      const previous = previousSpectrum[bin] ?? 0
      const positiveDelta = Math.max(0, current - previous)
      if (positiveDelta <= 0) continue

      const frequency = bin * binWidth
      const weight = frequency <= 180
        ? 2.1
        : frequency <= 2200
          ? 1
          : 0.62

      fullOnset += positiveDelta * weight
      if (frequency >= 35 && frequency <= 180) {
        lowOnset += positiveDelta
      }
    }

    previousSpectrum.set(spectrum)
    fullOnset /= 150
    lowOnset /= 8

    if (fullBaseline <= 0) {
      fullBaseline = fullOnset
      lowBaseline = lowOnset
    } else {
      const baselineAlpha = 0.035
      fullBaseline += baselineAlpha * (fullOnset - fullBaseline)
      lowBaseline += baselineAlpha * (lowOnset - lowBaseline)
    }

    history.push({
      time: now / 1000,
      full: Math.max(0, fullOnset - fullBaseline),
      low: Math.max(0, lowOnset - lowBaseline)
    })

    const historyStart = now / 1000 - REALTIME_HISTORY_SECONDS - 1
    if (history.length > 600) {
      history.splice(0, history.length - 600)
    } else {
      const firstValidIndex = history.findIndex(sample => sample.time >= historyStart)
      if (firstValidIndex > 0) {
        history.splice(0, firstValidIndex)
      }
    }

    if (now - lastEstimateTime >= REALTIME_ESTIMATE_INTERVAL_MS) {
      lastEstimateTime = now
      const estimate = estimateTempo(history, now / 1000)
      if (estimate && estimate.confidence >= SPECTRUM_BPM_MIN_CONFIDENCE) {
        publishEstimate(estimate, now)
      } else if (
        lastPublishedTime > 0 &&
        now - lastPublishedTime > REALTIME_VALUE_TIMEOUT_MS
      ) {
        if (beatGridLockedBpm === null) {
          bpm.value = null
          source.value = null
        }
        stopModelBeatScheduler(true)
        clearBeatGrid(false)
        estimates = []
        nextBeatTimeSeconds = 0
        beatPeriodSeconds = 0
        status.value = 'waiting'
      }
    }

    if (bpm.value !== null && nextBeatTimeSeconds > 0) {
      const nowSeconds = now / 1000
      while (nowSeconds >= nextBeatTimeSeconds - 0.012) {
        if (nowSeconds <= nextBeatTimeSeconds + 0.13) {
          beatPulse.value++
        }
        nextBeatTimeSeconds += 60 / bpm.value
      }
    }
  }

  const start = () => {
    if (monitorTimer) return
    status.value = videoSrc.value ? 'waiting' : 'idle'
    monitorTimer = setInterval(monitor, REALTIME_SAMPLE_INTERVAL_MS)
    monitor()
  }

  const stop = () => {
    if (monitorTimer) {
      clearInterval(monitorTimer)
      monitorTimer = null
    }
    resetSignal(false)
    resetBeatWorker()
    status.value = 'idle'
  }

  const activateAudioContext = () => {
    if (!videoSrc.value) return
    const video = getVideoElement()
    if (!video) return

    try {
      ensureAnalyser(video)
    } catch {
      status.value = 'unavailable'
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', activateAudioContext, { capture: true })
  }

  watch(
    () => videoSrc.value,
    (source) => {
      clearManualBpmCalibration()
      resetSignal(true)
      resetBeatWorker()
      if (!source) {
        modelStatus.value = 'idle'
        modelError.value = ''
        modelHops.value = 0
        modelBeats.value = 0
        modelSilent.value = false
        stop()
        return
      }

      modelStatus.value = beatWorkerReady && !beatWorkerFailed
        ? 'ready'
        : beatWorkerFailed
          ? 'error'
          : 'loading'
      modelError.value = ''
      status.value = 'waiting'
      start()
    },
    { immediate: true }
  )

  watch(
    () => seekVersion.value,
    () => {
      const preserveLockedBeatGrid = beatGridLockedBpm !== null
      resetSignal(true, false, preserveLockedBeatGrid)
      if (!preserveLockedBeatGrid) {
        resetBeatWorker()
      }
      status.value = isVideoPlaying.value ? 'waiting' : 'paused'
    }
  )

  watch(
    () => isVideoPlaying.value,
    (isPlaying) => {
      if (!isPlaying) {
        stopModelBeatScheduler(true)
        nextBeatTimeSeconds = 0
        beatPeriodSeconds = 0
      } else if (
        manualBpmOverrideUntil > performance.now()
        && bpm.value !== null
      ) {
        startManualBeatClock(bpm.value)
      } else if (lastPublishedTime > 0) {
        lastPublishedTime = performance.now()
      }
    }
  )

  onUnmounted(() => {
    stop()
    if (beatWorkerMessageHandler === handleBeatWorkerMessage) {
      beatWorkerMessageHandler = null
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', activateAudioContext, { capture: true })
    }
  })

  return {
    bpm,
    status,
    beatGridPeriod,
    beatGridAnchor
  }
}
