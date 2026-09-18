import { loadModel } from './model.js'
import { BeatTracker } from './tracker.js'
import { BeatGrid } from './grid.js'
import { MusicGate } from './musicgate.js'

const STATE_POST_INTERVAL = 10

let tracker = null
let grid = null
let musicGate = null
let ready = false
let hopCount = 0
let beatCount = 0
let fps = 100
let generation = 0
let lastStatePost = -STATE_POST_INTERVAL
let initialization = null

const reset = () => {
  tracker?.reset()
  grid?.reset()
  musicGate?.reset()
  hopCount = 0
  beatCount = 0
  lastStatePost = -STATE_POST_INTERVAL
}

const postError = (error) => {
  self.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error)
  })
}

const initialize = async () => {
  if (initialization) return initialization

  initialization = (async () => {
    const manifestUrl = new URL(
      '../../models/beattracker/madmom-beats.json',
      import.meta.url
    )
    const modelUrl = new URL(
      '../../models/beattracker/madmom-beats.bin',
      import.meta.url
    )

    const [manifestResponse, modelResponse] = await Promise.all([
      fetch(manifestUrl),
      fetch(modelUrl)
    ])
    if (!manifestResponse.ok || !modelResponse.ok) {
      throw new Error('无法加载节拍识别模型')
    }

    const manifest = await manifestResponse.json()
    const modelBuffer = await modelResponse.arrayBuffer()
    const model = loadModel(manifest, modelBuffer)
    tracker = new BeatTracker(model, manifest, modelBuffer)
    grid = new BeatGrid(4)
    musicGate = new MusicGate(manifest.fps)
    fps = manifest.fps
    ready = true
    self.postMessage({
      type: 'ready',
      sampleRate: manifest.sample_rate,
      hopSize: manifest.hop_size,
      fps: manifest.fps
    })
  })().catch((error) => {
    initialization = null
    postError(error)
    throw error
  })

  return initialization
}

self.onmessage = async (event) => {
  const message = event.data
  if (!message || typeof message.type !== 'string') return

  if (message.type === 'init') {
    try {
      await initialize()
    } catch {
      // The error is reported by initialize().
    }
    return
  }

  if (message.type === 'reset') {
    if (typeof message.generation === 'number') {
      generation = message.generation
    }
    reset()
    return
  }

  if (message.type !== 'hop' || !ready) return
  if (
    typeof message.generation === 'number' &&
    message.generation !== generation
  ) {
    return
  }

  const hop = new Float32Array(message.hop)
  const beatTime = tracker.pushHop(hop)
  const now = hopCount / fps
  const beats = grid.step(now, beatTime !== null, tracker.silent)
  const music = musicGate.process(tracker, grid)
  const musicEnabled = music.isMusic === true
  const audioTime = typeof message.audioTime === 'number'
    ? message.audioTime
    : null
  hopCount += 1

  const bpm = musicEnabled && grid.bpm > 0 ? grid.bpm : null
  const confidence = grid.confidence

  if (hopCount - lastStatePost >= STATE_POST_INTERVAL) {
    lastStatePost = hopCount
    self.postMessage({
      type: 'state',
      bpm,
      confidence,
      silent: tracker.silent || !musicEnabled,
      musicScore: music.score,
      isMusic: music.isMusic,
      hops: hopCount,
      beats: beatCount,
      audioTime,
      generation
    })
  }

  if (!musicEnabled) return

  for (const beat of beats) {
    beatCount += 1
    self.postMessage({
      type: 'beat',
      bpm,
      confidence,
      position: beat.inBar,
      predicted: beat.predicted,
      hops: hopCount,
      beats: beatCount,
      audioTime: audioTime === null
        ? null
        : audioTime - (now - beat.time),
      generation
    })
  }
}
