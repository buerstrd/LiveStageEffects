<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { presetsManager, type PresetPoint, type PresetColorPoint } from '~/composables/presetsmanager'
import { sampleCurveBrightness, sampleCurveColor } from '~/composables/devicesmanager'
import {
  eventsManager,
  formatTriggerTime,
  getEventPresetPlaybacks,
  getEventPresetTriggers,
  getEventRangeDurationMs,
  isValidTriggerTime,
  normalizeEventTimelineTrackCount,
  parseTimeToSeconds,
  type EventItem,
  type EventPresetPlayback
} from '~/composables/eventsmanager'
import { formatVideoTime, videoManager } from '~/composables/videomanager'
import { settingsManager } from '~/composables/settingsmanager'
import { windowsManager } from '~/composables/windowsmanager'

const {
  activePreset,
  presets,
  selectedPresetId,
  updatePresetEffect,
  isPlaying,
  isPlaybackPaused,
  playProgress,
  playTriggerTime,
  playSeekProgress,
  playSeekVersion,
  togglePlay
} = presetsManager()
const {
  events,
  selectedEventId,
  playingEventId,
  playingEventTriggerId,
  eventPlayProgress,
  isEventRecording,
  selectEvent,
  addEventPresetTrigger,
  updateEventPresetTriggerTime,
  updateEventPresetTriggerTrack,
  removeEventPresetTrigger
} = eventsManager()
const {
  videoSrc,
  currentTime: videoCurrentTime,
  duration: videoDuration,
  seekVideo: seekVideoTo
} = videoManager()
const { disableAnimations } = settingsManager()
const {
  designViewMode,
  timelineFollowEnabled,
  setTimelineFollowEnabled
} = windowsManager()

// 预设效果预览颜色方块 DOM 引用
const previewBoxRef = ref<HTMLDivElement | null>(null)
const designViewRef = ref<HTMLElement | null>(null)
const timelineEditorRef = ref<HTMLElement | null>(null)
const timelineThumbnailStripRef = ref<HTMLElement | null>(null)

// 预览播放填充态进入与退出渐变透明度 (0.0 ~ 1.0)
const fillAlpha = ref(0)

// 历史消退扫描填充列表 (用于重复按下发送/预览时，让前一个填充带平滑渐变动画消失)
interface FadingFill {
  progress: number
  alpha: number
}
const fadingFills = ref<FadingFill[]>([])

// 当前主颜色
const currentColor = computed(() => {
  return activePreset.value?.effect?.color || '#ffffff'
})

const normalizeColorPoint = (
  point: Partial<PresetColorPoint>,
  fallbackColor: string
): PresetColorPoint => ({
  x: typeof point.x === 'number' && Number.isFinite(point.x)
    ? Math.max(0, Math.min(1, point.x))
    : 0,
  y: typeof point.y === 'number' && Number.isFinite(point.y)
    ? Math.max(0, Math.min(1, point.y))
    : 1,
  color: typeof point.color === 'string' && point.color.trim()
    ? point.color
    : fallbackColor
})

// 当前重复次数 (>= 1)
const currentRepeat = computed(() => {
  return Math.max(1, activePreset.value?.effect?.repeat ?? 1)
})

// 当前时长 (ms, 默认 500ms)
const currentDuration = computed(() => {
  return activePreset.value?.effect?.duration ?? 500
})

// -------------------------------------------------------------
// 事件时间线
// -------------------------------------------------------------
const TIMELINE_MIN_DURATION = 0.1
const TIMELINE_TRACK_RECOMMENDED_HEIGHT = 76
const TIMELINE_VERTICAL_ZOOM_MIN = 0.75
const TIMELINE_VERTICAL_ZOOM_MAX = 2.5
const TIMELINE_VERTICAL_ZOOM_STEP = 0.25
const TIMELINE_WAVEFORM_LANE_HEIGHT = 48
const PRESET_DRAG_MIME = 'application/x-livestage-preset'
const PRESET_DRAG_META_MIME = 'application/x-livestage-preset-meta'
const PRESET_DRAG_TEXT_PREFIX = 'livestage-preset:'
const TIMELINE_TRIGGER_DRAG_MIME = 'application/x-livestage-timeline-trigger'
const TIMELINE_CLIP_DRAG_ANIMATION_ID = 'timeline-clip-drag'

type TimelineInteractionMode = 'pan' | 'playhead'

interface PresetDragRect {
  left: number
  top: number
  width: number
  height: number
}

interface PresetDragPayload {
  id: number
  rect?: PresetDragRect
  grabOffset?: {
    x: number
    y: number
  }
}

interface TimelineTriggerDragPayload {
  eventId: number
  triggerId: number
}

interface TimelinePresetItem {
  event: EventItem
  playback: EventPresetPlayback
  startTime: number
  durationSeconds: number
  color: string
  track: number
}

interface TimelineInteractionState {
  mode: TimelineInteractionMode
  pointerId: number
  startClientX: number
  captureElement?: HTMLElement
  initialScrollLeft?: number
  allowClickSeek?: boolean
  moved: boolean
}

interface TimelineScrollbarDragState {
  pointerId: number
  startClientX: number
  startScrollLeft: number
  trackWidth: number
  thumbWidth: number
}

interface TimelineVerticalScrollbarDragState {
  pointerId: number
  startClientY: number
  startScrollTop: number
  trackHeight: number
  thumbHeight: number
}

interface TimelineThumbnail {
  time: number
  left: number
  width: number
  src: string
}

interface TimelinePresetDropFlight {
  key: number
  presetId: number
  presetName: string
  color: string
  from: PresetDragRect
  to: PresetDragRect
}

const timelineEventId = ref<number | null>(null)
const timelineContentRef = ref<HTMLDivElement | null>(null)
const timelineScrollRef = ref<HTMLDivElement | null>(null)
const timelineScrollbarRef = ref<HTMLDivElement | null>(null)
const timelineTracksViewportRef = ref<HTMLDivElement | null>(null)
const timelineVerticalScrollbarRef = ref<HTMLDivElement | null>(null)
const timelineScrollbarThumbWidth = ref(0)
const timelineScrollbarThumbLeft = ref(0)
const timelineScrollbarHasOverflow = ref(false)
const timelineScrollbarActive = ref(false)
const timelineVerticalScrollbarThumbHeight = ref(0)
const timelineVerticalScrollbarThumbTop = ref(0)
const timelineVerticalScrollbarHasOverflow = ref(false)
const timelineVerticalScrollbarActive = ref(false)
const timelineZoom = useState<number>('design_timeline_zoom', () => 1)
const timelineVerticalZoom = useState<number>('design_timeline_vertical_zoom', () => 1)
const timelineScrollLeft = useState<number>('design_timeline_scroll_left', () => 0)
const timelineTracksScrollTop = useState<number>(
  'design_timeline_tracks_scroll_top',
  () => 0
)
const workspaceRestoreVersion = useState<number>(
  'project_workspace_restore_version',
  () => 0
)
const timelineViewportWidth = ref(0)

const syncTimelineViewportWidth = () => {
  const viewport = timelineScrollRef.value
  if (!viewport) return 0

  const width = Math.round(viewport.clientWidth)
  if (width > 0 && width !== timelineViewportWidth.value) {
    timelineViewportWidth.value = width
  }
  return width
}

const timelineThumbnails = ref<TimelineThumbnail[]>([])
const timelineWaveformCanvasRef = ref<HTMLCanvasElement | null>(null)
const timelineWaveformReady = ref(false)
const timelinePlayheadRef = ref<HTMLDivElement | null>(null)
const timelineClipProgressRefs = new Map<number, HTMLSpanElement>()
let timelineProgressRenderRafId: number | null = null
const timelineInteractionMode = ref<TimelineInteractionMode | null>(null)
const timelineDraggingTriggerId = ref<number | null>(null)
const timelinePresetDropPosition = ref<number | null>(null)
const timelinePresetDropTrack = ref<number | null>(null)
const timelineDropAnimatingTriggerId = ref<number | null>(null)
const timelineDuplicatingTriggerId = ref<number | null>(null)
const timelinePresetDropFlight = ref<TimelinePresetDropFlight | null>(null)
const timelinePresetDropFlightRef = ref<HTMLElement | null>(null)
let timelineInteraction: TimelineInteractionState | null = null
let timelineDropAnimationTimer: ReturnType<typeof setTimeout> | null = null
let timelineDropAnimationSequence = 0
let timelineClipDragPointerX = 0
let timelineClipDragPointerY = 0
let timelineClipDragGrabOffsetX = 0
let timelineClipDragGrabOffsetY = 0
let timelineClipDragDropped = false
let timelineScrollbarDrag: TimelineScrollbarDragState | null = null
let timelineScrollbarHideTimer: ReturnType<typeof setTimeout> | null = null
let timelineVerticalScrollbarDrag: TimelineVerticalScrollbarDragState | null = null
let timelineVerticalScrollbarHideTimer: ReturnType<typeof setTimeout> | null = null

const timelineScrollbarVisible = computed(() => {
  return timelineScrollbarHasOverflow.value && timelineScrollbarActive.value
})

const timelineVerticalScrollbarVisible = computed(() => {
  return timelineVerticalScrollbarHasOverflow.value &&
    timelineVerticalScrollbarActive.value
})

const clearTimelineScrollbarHideTimer = () => {
  if (!timelineScrollbarHideTimer) return

  clearTimeout(timelineScrollbarHideTimer)
  timelineScrollbarHideTimer = null
}

const showTimelineScrollbar = () => {
  if (!timelineScrollbarHasOverflow.value) return

  clearTimelineScrollbarHideTimer()
  timelineScrollbarActive.value = true
  timelineScrollbarHideTimer = setTimeout(() => {
    timelineScrollbarHideTimer = null
    if (!timelineScrollbarDrag) {
      timelineScrollbarActive.value = false
    }
  }, 1200)
}

const hideTimelineScrollbarSoon = () => {
  clearTimelineScrollbarHideTimer()
  timelineScrollbarHideTimer = setTimeout(() => {
    timelineScrollbarHideTimer = null
    if (!timelineScrollbarDrag) {
      timelineScrollbarActive.value = false
    }
  }, 180)
}

const clearTimelineVerticalScrollbarHideTimer = () => {
  if (!timelineVerticalScrollbarHideTimer) return

  clearTimeout(timelineVerticalScrollbarHideTimer)
  timelineVerticalScrollbarHideTimer = null
}

const showTimelineVerticalScrollbar = () => {
  if (!timelineVerticalScrollbarHasOverflow.value) return

  clearTimelineVerticalScrollbarHideTimer()
  timelineVerticalScrollbarActive.value = true
  timelineVerticalScrollbarHideTimer = setTimeout(() => {
    timelineVerticalScrollbarHideTimer = null
    if (!timelineVerticalScrollbarDrag) {
      timelineVerticalScrollbarActive.value = false
    }
  }, 1200)
}

const hideTimelineVerticalScrollbarSoon = () => {
  clearTimelineVerticalScrollbarHideTimer()
  timelineVerticalScrollbarHideTimer = setTimeout(() => {
    timelineVerticalScrollbarHideTimer = null
    if (!timelineVerticalScrollbarDrag) {
      timelineVerticalScrollbarActive.value = false
    }
  }, 180)
}

const selectedTimelineEvent = computed(() => {
  if (timelineEventId.value === null) return null
  return events.value.find(event => event.id === timelineEventId.value) ?? null
})

const showDesignWorkspace = computed(() => {
  if (designViewMode.value === 'timeline') {
    return timelineEventId.value !== null
  }
  return activePreset.value !== null
})

const animateDesignTargetSwitch = (element: HTMLElement | null) => {
  if (disableAnimations.value || !element || typeof element.animate !== 'function') {
    return
  }

  element.getAnimations().forEach((animation) => {
    if (animation.id === 'design-target-switch') {
      animation.cancel()
    }
  })
  element.animate(
    [
      { filter: 'brightness(0.95) saturate(0.97)' },
      { filter: 'brightness(1) saturate(1)' }
    ],
    {
      id: 'design-target-switch',
      duration: 260,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
    }
  )
}

const animateTimelineTracksReveal = () => {
  const viewport = timelineTracksViewportRef.value
  if (
    disableAnimations.value ||
    designViewMode.value !== 'timeline' ||
    !viewport ||
    typeof viewport.animate !== 'function'
  ) {
    return
  }

  viewport.getAnimations().forEach((animation) => {
    if (animation.id === 'timeline-tracks-reveal') {
      animation.cancel()
    }
  })
  viewport.animate(
    [
      { opacity: 0, transform: 'scale(0.985)', transformOrigin: 'center' },
      { opacity: 1, transform: 'scale(1)', transformOrigin: 'center' }
    ],
    {
      id: 'timeline-tracks-reveal',
      duration: 320,
      delay: 180,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      fill: 'backwards'
    }
  )
}

const timelinePresetItems = computed<TimelinePresetItem[]>(() => {
  const event = selectedTimelineEvent.value
  if (!event) return []

  return getEventPresetPlaybacks(event, presets.value).map(playback => ({
    event,
    playback,
    startTime: playback.startTime,
    durationSeconds: playback.durationMs / 1000,
    color: playback.preset.effect?.color || 'var(--md-sys-color-primary, #8ab4f8)',
    track: playback.track
  }))
})

const timelineTrackCount = computed(() => {
  const event = selectedTimelineEvent.value
  if (!event) return 0
  return normalizeEventTimelineTrackCount(
    event.timelineTrackCount,
    getEventPresetTriggers(event)
  )
})

const timelineTrackHeight = computed(() => {
  return Math.round(
    TIMELINE_TRACK_RECOMMENDED_HEIGHT * timelineVerticalZoom.value
  )
})

const timelineTracksHeight = computed(() => {
  return timelineTrackCount.value * timelineTrackHeight.value
})

const timelineTrackIndexes = computed(() => {
  return Array.from({ length: timelineTrackCount.value }, (_, index) => index)
})

const showTimelineEmptyState = computed(() => {
  return timelineTrackCount.value === 0
})

const timelineTracksContentStyle = computed(() => ({
  height: `${timelineTracksHeight.value}px`,
  '--timeline-track-height': `${timelineTrackHeight.value}px`
}))

const getTimelinePresetItemsForTrack = (trackIndex: number) => {
  return timelinePresetItems.value.filter(item => item.track === trackIndex)
}

const timelineSelectedEventRange = computed(() => {
  const event = selectedTimelineEvent.value
  if (!event || !isValidTriggerTime(event.time)) return null

  const startTime = parseTimeToSeconds(event.time)
  const durationSeconds = (getEventRangeDurationMs(event, presets.value) ?? 0) / 1000
  return {
    startTime,
    durationSeconds: Math.max(TIMELINE_MIN_DURATION, durationSeconds)
  }
})

const timelineRangeStart = computed(() => {
  return timelineSelectedEventRange.value?.startTime ?? 0
})

const timelineRangeDuration = computed(() => {
  return Math.max(
    TIMELINE_MIN_DURATION,
    timelineSelectedEventRange.value?.durationSeconds ?? TIMELINE_MIN_DURATION
  )
})

const timelineRangeEnd = computed(() => {
  return timelineRangeStart.value + timelineRangeDuration.value
})

const timelinePixelWidth = computed(() => {
  return Math.max(1, timelineViewportWidth.value * timelineZoom.value)
})

const timelineZoomStyle = computed(() => {
  if (timelineViewportWidth.value <= 0 || timelineZoom.value <= 1) {
    return {
      width: '100%',
      minWidth: '100%'
    }
  }

  return {
    width: `${timelinePixelWidth.value}px`,
    minWidth: '100%'
  }
})

const timelinePlayheadTime = computed(() => {
  return Math.max(
    timelineRangeStart.value,
    Math.min(timelineRangeEnd.value, videoCurrentTime.value)
  )
})

const timelineVideoPosition = computed(() => {
  if (videoCurrentTime.value < timelineRangeStart.value) return 'before'
  if (videoCurrentTime.value > timelineRangeEnd.value) return 'after'
  return 'inside'
})

const timelinePlayheadPercent = computed(() => {
  return (
    (timelinePlayheadTime.value - timelineRangeStart.value)
    / timelineRangeDuration.value
  ) * 100
})

const renderTimelinePlaybackProgress = () => {
  timelineProgressRenderRafId = null

  const playhead = timelinePlayheadRef.value
  if (playhead) {
    const parentWidth = playhead.parentElement?.clientWidth ?? 0
    const isInsideRange = timelineVideoPosition.value === 'inside'
    playhead.style.display = isInsideRange ? 'block' : 'none'
    if (isInsideRange && parentWidth > 0) {
      const playheadX = (timelinePlayheadPercent.value / 100) * parentWidth
      playhead.style.transform = `translate3d(${playheadX - 0.5}px, 0, 0)`
    }
  }

  for (const item of timelinePresetItems.value) {
    const progressElement = timelineClipProgressRefs.get(item.playback.triggerId)
    if (!progressElement) continue

    const progress = (
      playingEventId.value === item.event.id &&
      playingEventTriggerId.value === item.playback.triggerId
    )
      ? eventPlayProgress.value
      : 0
    progressElement.style.transform = `scaleX(${Math.max(0, Math.min(1, progress))})`
  }
}

const scheduleTimelinePlaybackProgressRender = () => {
  if (typeof requestAnimationFrame === 'undefined') {
    renderTimelinePlaybackProgress()
    return
  }
  if (timelineProgressRenderRafId !== null) return
  timelineProgressRenderRafId = requestAnimationFrame(renderTimelinePlaybackProgress)
}

const setTimelineClipProgressRef = (
  triggerId: number,
  element: unknown
) => {
  if (element instanceof HTMLSpanElement) {
    timelineClipProgressRefs.set(triggerId, element)
  } else {
    timelineClipProgressRefs.delete(triggerId)
  }
  scheduleTimelinePlaybackProgressRender()
}

const getTimelinePositionPercent = (time: number) => {
  const offset = time - timelineRangeStart.value
  return Math.max(
    0,
    Math.min(100, (offset / timelineRangeDuration.value) * 100)
  )
}

const getTimelineSpanPercent = (durationSeconds: number) => {
  return Math.max(
    0,
    Math.min(100, (durationSeconds / timelineRangeDuration.value) * 100)
  )
}

const timelinePresetDropTimeLabel = computed(() => {
  const position = timelinePresetDropPosition.value
  if (position === null) return ''

  const time = timelineRangeStart.value
    + (position / 100) * timelineRangeDuration.value
  return formatVideoTime(time, timelineRangeEnd.value >= 3600)
})

const selectedTimelineEventLabel = computed(() => {
  const event = selectedTimelineEvent.value
  if (!event) return ''

  const startTime = isValidTriggerTime(event.time) ? parseTimeToSeconds(event.time) : 0
  const durationSeconds = (getEventRangeDurationMs(event, presets.value) ?? 0) / 1000
  const position = formatTriggerTime(startTime, timelineRangeEnd.value >= 3600)
  return `ID ${event.id} · ${event.name} · ${position} · ${durationSeconds.toFixed(2)}s`
})

const timelineDurationLabel = computed(() => {
  return formatVideoTime(videoDuration.value, videoDuration.value >= 3600)
})

const timelineCurrentTimeLabel = computed(() => {
  return formatVideoTime(videoCurrentTime.value, videoDuration.value >= 3600)
})

const TIMELINE_RULER_STEPS = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30,
  60, 120, 300, 600, 900, 1800, 3600, 7200
]

const getTimelineRulerStep = (duration: number, pixelWidth: number) => {
  const targetLabelCount = Math.max(2, Math.floor(Math.max(240, pixelWidth) / 82))
  const rawStep = duration / targetLabelCount
  return TIMELINE_RULER_STEPS.find(step => step >= rawStep)
    ?? Math.ceil(rawStep / 3600) * 3600
}

const getTimelineMinorTickStep = (majorStep: number) => {
  const divisor = [10, 5, 4, 2, 1].find(value => majorStep / value >= 0.05) ?? 1
  return majorStep / divisor
}

const timelineTicks = computed(() => {
  const duration = timelineRangeDuration.value
  const rangeStart = timelineRangeStart.value
  const rangeEnd = timelineRangeEnd.value
  const majorStep = getTimelineRulerStep(duration, timelinePixelWidth.value)
  const minorStep = getTimelineMinorTickStep(majorStep)
  const maxTickCount = 1200
  const rawTickCount = Math.max(1, Math.floor(duration / minorStep))
  const tickStep = rawTickCount > maxTickCount
    ? duration / maxTickCount
    : minorStep
  const majorEvery = Math.max(1, Math.round(majorStep / tickStep))
  const ticks: Array<{ time: number; left: number; label: string; major: boolean }> = []
  const tickCount = Math.min(maxTickCount, Math.floor(duration / tickStep))

  for (let index = 0; index <= tickCount; index++) {
    const offset = Math.min(duration, index * tickStep)
    const time = rangeStart + offset
    const major = index % majorEvery === 0 || index === tickCount
    ticks.push({
      time,
      left: (offset / duration) * 100,
      label: formatTriggerTime(time, rangeEnd >= 3600),
      major
    })
  }

  return ticks
})

const timelineThumbnailCount = computed(() => {
  if (
    timelineEventId.value === null ||
    timelineSelectedEventRange.value === null ||
    !videoSrc.value ||
    videoDuration.value <= 0
  ) {
    return 0
  }

  return Math.max(4, Math.min(48, Math.ceil(Math.max(320, timelinePixelWidth.value) / 144)))
})

// 波形仅保留当前事件区间的降采样峰值，避免解码整段视频或长期驻留 PCM。
const TIMELINE_WAVEFORM_BASE_BINS = 65536
const TIMELINE_WAVEFORM_CAPTURE_SAMPLE_RATE = 8000
const TIMELINE_WAVEFORM_CAPTURE_BUFFER_SIZE = 256
let timelineWaveformBasePeaks: Float32Array | null = null
let timelineWaveformMaxPeak = 0
let timelineWaveformDrawRafId = 0

interface TimelineThumbnailWorker {
  video: HTMLVideoElement
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  mediaDuration: number
}

interface TimelineThumbnailEncoder {
  worker: Worker
  available: boolean
  pending: {
    id: number
    resolve: (src: string | null) => void
    timeoutId: ReturnType<typeof setTimeout>
  } | null
}

let timelineThumbnailTaskVersion = 0
let timelineThumbnailDebounceTimer: ReturnType<typeof setTimeout> | null = null
let timelineThumbnailCacheKey: string | null = null
let timelineThumbnailWorkers: HTMLVideoElement[] = []
let timelineThumbnailEncoders: TimelineThumbnailEncoder[] = []
let timelineThumbnailEncoderRequestId = 0

const stopTimelineThumbnailEncoders = () => {
  const encoders = [...timelineThumbnailEncoders]
  timelineThumbnailEncoders = []

  for (const encoder of encoders) {
    const pending = encoder.pending
    encoder.pending = null
    if (pending) {
      clearTimeout(pending.timeoutId)
      pending.resolve(null)
    }
    encoder.worker.terminate()
  }
}

const startTimelineThumbnailEncoders = (count: number) => {
  stopTimelineThumbnailEncoders()
  if (typeof Worker === 'undefined') return

  for (let index = 0; index < count; index++) {
    try {
      const worker = new Worker(
        new URL('../workers/timeline-thumbnail-worker.ts', import.meta.url),
        { type: 'module' }
      )
      const encoder: TimelineThumbnailEncoder = {
        worker,
        available: true,
        pending: null
      }

      worker.onmessage = (event: MessageEvent<{
        id: number
        src?: string
        error?: string
      }>) => {
        const pending = encoder.pending
        if (!pending || pending.id !== event.data.id) return

        encoder.pending = null
        clearTimeout(pending.timeoutId)
        if (event.data.error) {
          encoder.available = false
          worker.terminate()
          pending.resolve(null)
          return
        }
        pending.resolve(event.data.src || null)
      }
      worker.onerror = () => {
        const pending = encoder.pending
        encoder.pending = null
        encoder.available = false
        worker.terminate()
        if (pending) {
          clearTimeout(pending.timeoutId)
          pending.resolve(null)
        }
      }
      timelineThumbnailEncoders.push(encoder)
    } catch {
      // Main-thread canvas encoding remains available as a fallback.
    }
  }
}

const encodeTimelineThumbnailBitmap = (
  encoder: TimelineThumbnailEncoder | null,
  bitmap: ImageBitmap,
  width: number,
  height: number,
  quality: number
) => {
  if (!encoder || !encoder.available || encoder.pending) {
    bitmap.close()
    return Promise.resolve<string | null>(null)
  }

  return new Promise<string | null>((resolve) => {
    const id = ++timelineThumbnailEncoderRequestId
    const timeoutId = setTimeout(() => {
      if (!encoder.pending || encoder.pending.id !== id) return
      encoder.pending = null
      encoder.available = false
      encoder.worker.terminate()
      resolve(null)
    }, 2000)
    encoder.pending = { id, resolve, timeoutId }

    try {
      encoder.worker.postMessage(
        { id, bitmap, width, height, quality },
        [bitmap]
      )
    } catch {
      encoder.pending = null
      clearTimeout(timeoutId)
      bitmap.close()
      resolve(null)
    }
  })
}

const disposeTimelineThumbnailWorker = (video: HTMLVideoElement) => {
  timelineThumbnailWorkers = timelineThumbnailWorkers.filter(worker => worker !== video)
  video.pause()
  video.removeAttribute('src')
  video.load()
  video.remove()
}

const stopTimelineThumbnailWorkers = () => {
  const workers = [...timelineThumbnailWorkers]
  timelineThumbnailWorkers = []
  for (const video of workers) {
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
  }
}

const clearTimelineThumbnails = () => {
  timelineThumbnailTaskVersion++
  timelineThumbnailCacheKey = null
  if (timelineThumbnailDebounceTimer) {
    clearTimeout(timelineThumbnailDebounceTimer)
    timelineThumbnailDebounceTimer = null
  }
  timelineThumbnails.value = []
  stopTimelineThumbnailWorkers()
  stopTimelineThumbnailEncoders()
}

const waitForTimelineThumbnailEvent = (
  video: HTMLVideoElement,
  eventName: 'loadedmetadata' | 'loadeddata',
  taskVersion: number,
  timeoutMs: number
) => {
  return new Promise<boolean>((resolve) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      video.removeEventListener(eventName, handleReady)
      video.removeEventListener('error', handleError)
    }
    const finish = (ready: boolean) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(ready)
    }
    const handleReady = () => finish(taskVersion === timelineThumbnailTaskVersion)
    const handleError = () => finish(false)

    video.addEventListener(eventName, handleReady, { once: true })
    video.addEventListener('error', handleError, { once: true })
    timeoutId = setTimeout(() => finish(false), timeoutMs)

    if (taskVersion !== timelineThumbnailTaskVersion) {
      finish(false)
    }
  })
}

const waitForTimelineThumbnailReady = async (
  video: HTMLVideoElement,
  taskVersion: number,
  initialTime: number
) => {
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    const metadataReady = await waitForTimelineThumbnailEvent(
      video,
      'loadedmetadata',
      taskVersion,
      6000
    )
    if (!metadataReady) return false
  }

  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    try {
      video.preload = 'auto'
      const duration = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : 0
      video.currentTime = duration > 0
        ? Math.max(0, Math.min(initialTime, Math.max(0, duration - 0.001)))
        : Math.max(0, initialTime)
    } catch {
      return false
    }
    return waitForTimelineThumbnailEvent(video, 'loadeddata', taskVersion, 6000)
  }

  return taskVersion === timelineThumbnailTaskVersion
}

const seekTimelineThumbnailVideo = (
  video: HTMLVideoElement,
  time: number,
  taskVersion: number
) => {
  return new Promise<boolean>((resolve) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('error', handleError)
    }
    const finish = (ready: boolean) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(ready && taskVersion === timelineThumbnailTaskVersion)
    }
    const handleSeeked = () => finish(true)
    const handleError = () => finish(false)

    video.addEventListener('seeked', handleSeeked, { once: true })
    video.addEventListener('error', handleError, { once: true })
    timeoutId = setTimeout(() => finish(false), 1400)

    if (taskVersion !== timelineThumbnailTaskVersion) {
      finish(false)
      return
    }

    try {
      if (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        Math.abs(video.currentTime - time) < 0.001
      ) {
        finish(true)
      } else {
        const seekableVideo = video as HTMLVideoElement & {
          fastSeek?: (seekTime: number) => void
        }
        if (typeof seekableVideo.fastSeek === 'function') {
          seekableVideo.fastSeek(time)
        } else {
          video.currentTime = time
        }
      }
    } catch {
      finish(false)
    }
  })
}

const getTimelineThumbnailWorkerCount = (count: number) => {
  // 事件区间通常较短，保留两个解码器兼顾速度，同时避免多解码器造成内存峰值。
  return count > 1 ? 2 : count
}

const buildTimelineThumbnailOrder = (count: number) => {
  if (count <= 1) return [0]

  const order = [0, count - 1]
  const addMiddleFirst = (start: number, end: number) => {
    if (start > end) return
    const middle = Math.floor((start + end) / 2)
    order.push(middle)
    addMiddleFirst(start, middle - 1)
    addMiddleFirst(middle + 1, end)
  }
  addMiddleFirst(1, count - 2)
  return order
}

const createTimelineThumbnailWorker = async (
  source: string,
  sourceDuration: number,
  taskVersion: number,
  initialTime: number
): Promise<TimelineThumbnailWorker | null> => {
  if (!document.body) return null

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'metadata'
  video.setAttribute('aria-hidden', 'true')
  video.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;'
  document.body.appendChild(video)
  timelineThumbnailWorkers.push(video)

  try {
    video.src = source
    video.load()

    if (!(await waitForTimelineThumbnailReady(video, taskVersion, initialTime))) {
      disposeTimelineThumbnailWorker(video)
      return null
    }
    if (taskVersion !== timelineThumbnailTaskVersion || source !== videoSrc.value) {
      disposeTimelineThumbnailWorker(video)
      return null
    }

    const mediaDuration = Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : sourceDuration
    const aspectRatio = video.videoWidth > 0 && video.videoHeight > 0
      ? video.videoWidth / video.videoHeight
      : 16 / 9
    const canvas = document.createElement('canvas')
    canvas.width = 144
    canvas.height = Math.max(1, Math.round(canvas.width / aspectRatio))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context || mediaDuration <= 0) {
      disposeTimelineThumbnailWorker(video)
      return null
    }

    return {
      video,
      canvas,
      context,
      mediaDuration
    }
  } catch {
    disposeTimelineThumbnailWorker(video)
    return null
  }
}

const buildTimelineThumbnailPreview = (
  cached: TimelineThumbnail[],
  count: number,
  rangeStart: number,
  rangeDuration: number,
  mediaDuration: number
) => {
  if (cached.length === 0 || rangeDuration <= 0 || mediaDuration <= 0) {
    return Array.from(
      { length: count },
      (): TimelineThumbnail | null => null
    )
  }

  const sortedCache = [...cached].sort((a, b) => a.time - b.time)
  const preview: Array<TimelineThumbnail | null> = []

  for (let index = 0; index < count; index++) {
    const time = Math.min(
      Math.max(0, mediaDuration - Math.min(0.04, mediaDuration * 0.001)),
      Math.max(0, rangeStart + ((index + 0.5) / count) * rangeDuration)
    )
    let low = 0
    let high = sortedCache.length - 1
    let nearestIndex = 0

    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const candidate = sortedCache[middle]
      if (!candidate) break

      if (candidate.time < time) {
        low = middle + 1
      } else {
        high = middle - 1
      }
      nearestIndex = middle
    }

    const before = sortedCache[Math.max(0, nearestIndex - 1)]
    const after = sortedCache[Math.min(sortedCache.length - 1, nearestIndex)]
    const nearest = !before || (after && Math.abs(after.time - time) < Math.abs(before.time - time))
      ? after
      : before

    preview.push(nearest
      ? {
          time,
          left: (index / count) * 100,
          width: (1 / count) * 100,
          src: nearest.src
        }
      : null)
  }

  return preview
}

const captureTimelineThumbnail = async (
  worker: TimelineThumbnailWorker,
  encoder: TimelineThumbnailEncoder | null,
  taskVersion: number
) => {
  const width = worker.canvas.width
  const height = worker.canvas.height
  let bitmap: ImageBitmap | null = null

  if (
    encoder?.available &&
    typeof createImageBitmap === 'function'
  ) {
    try {
      bitmap = await createImageBitmap(worker.video, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: 'medium'
      })
    } catch {
      bitmap = null
    }
  }

  if (bitmap) {
    const src = await encodeTimelineThumbnailBitmap(
      encoder,
      bitmap,
      width,
      height,
      0.62
    )
    if (src) return src
  }

  if (taskVersion !== timelineThumbnailTaskVersion) return null
  worker.context.drawImage(worker.video, 0, 0, width, height)
  return worker.canvas.toDataURL('image/jpeg', 0.62)
}

const generateTimelineThumbnails = async () => {
  const source = videoSrc.value
  const sourceDuration = videoDuration.value
  const count = timelineThumbnailCount.value
  const rangeStart = timelineRangeStart.value
  const rangeDuration = timelineRangeDuration.value

  if (
    !source ||
    sourceDuration <= 0 ||
    count <= 0 ||
    timelineEventId.value === null ||
    rangeDuration <= 0
  ) {
    return
  }

  const cacheKey = `${source}|${rangeStart.toFixed(3)}|${rangeDuration.toFixed(3)}`
  if (
    timelineThumbnailCacheKey === cacheKey &&
    timelineThumbnails.value.length >= count
  ) {
    return
  }

  const taskVersion = ++timelineThumbnailTaskVersion
  stopTimelineThumbnailWorkers()
  const cachedThumbnails = timelineThumbnailCacheKey === cacheKey
    ? [...timelineThumbnails.value]
    : []
  if (timelineThumbnailCacheKey !== cacheKey) {
    timelineThumbnailCacheKey = cacheKey
    timelineThumbnails.value = []
  }
  const preview = buildTimelineThumbnailPreview(
    cachedThumbnails,
    count,
    rangeStart,
    rangeDuration,
    sourceDuration
  )
  if (cachedThumbnails.length > 0) {
    timelineThumbnails.value = preview.filter(
      (thumbnail): thumbnail is TimelineThumbnail => thumbnail !== null
    )
  }

  const workerCount = Math.min(count, getTimelineThumbnailWorkerCount(count))
  let workers: TimelineThumbnailWorker[] = []
  let encodersStarted = false

  try {
    const workerResults = await Promise.all(
      Array.from(
        { length: workerCount },
        (_, workerIndex) => createTimelineThumbnailWorker(
          source,
          sourceDuration,
          taskVersion,
          rangeStart + (workerIndex / Math.max(1, workerCount)) * rangeDuration
        )
      )
    )
    workers = workerResults.filter(
      (worker): worker is TimelineThumbnailWorker => worker !== null
    )

    if (
      workers.length === 0 ||
      taskVersion !== timelineThumbnailTaskVersion ||
      source !== videoSrc.value
    ) {
      return
    }
    startTimelineThumbnailEncoders(workers.length)
    encodersStarted = true

    const order = buildTimelineThumbnailOrder(count)
    const generated: Array<TimelineThumbnail | null> = Array.from(
      { length: count },
      () => null
    )
    let nextOrderIndex = 0
    let completedCount = 0
    let lastPublishTime = 0

    const publish = (force = false) => {
      const now = performance.now()
      if (!force && lastPublishTime > 0 && now - lastPublishTime < 50) return
      lastPublishTime = now
      timelineThumbnails.value = generated
        .map((thumbnail, index) => thumbnail ?? preview[index] ?? null)
        .filter(
          (thumbnail): thumbnail is TimelineThumbnail => thumbnail !== null
        )
    }

    const runWorker = async (
      worker: TimelineThumbnailWorker,
      workerIndex: number
    ) => {
      const encoder = timelineThumbnailEncoders[
        workerIndex % Math.max(1, timelineThumbnailEncoders.length)
      ] ?? null

      try {
        while (
          taskVersion === timelineThumbnailTaskVersion &&
          source === videoSrc.value
        ) {
          const orderIndex = nextOrderIndex++
          if (orderIndex >= order.length) return

          const thumbnailIndex = order[orderIndex]
          if (thumbnailIndex === undefined) continue

          const lastSeekTime = Math.max(
            0,
            worker.mediaDuration - Math.min(0.04, worker.mediaDuration * 0.001)
          )
          const time = Math.min(
            lastSeekTime,
            Math.max(
              0,
              rangeStart + ((thumbnailIndex + 0.5) / count) * rangeDuration
            )
          )
          const seeked = await seekTimelineThumbnailVideo(
            worker.video,
            time,
            taskVersion
          )
          if (
            !seeked ||
            taskVersion !== timelineThumbnailTaskVersion ||
            worker.video.videoWidth <= 0 ||
            worker.video.videoHeight <= 0
          ) {
            continue
          }

          const src = await captureTimelineThumbnail(
            worker,
            encoder,
            taskVersion
          )
          if (!src || taskVersion !== timelineThumbnailTaskVersion) continue

          generated[thumbnailIndex] = {
            time,
            left: (thumbnailIndex / count) * 100,
            width: (1 / count) * 100,
            src
          }
          completedCount++
          publish(completedCount === count)
        }
      } finally {
        disposeTimelineThumbnailWorker(worker.video)
      }
    }

    await Promise.all(
      workers.map((worker, workerIndex) => runWorker(worker, workerIndex))
    )
    if (
      taskVersion === timelineThumbnailTaskVersion &&
      source === videoSrc.value
    ) {
      publish(true)
    }
  } finally {
    for (const worker of workers) {
      disposeTimelineThumbnailWorker(worker.video)
    }
    if (
      encodersStarted &&
      taskVersion === timelineThumbnailTaskVersion &&
      source === videoSrc.value
    ) {
      stopTimelineThumbnailEncoders()
    }
  }
}

const scheduleTimelineThumbnailGeneration = () => {
  if (timelineThumbnailDebounceTimer) {
    clearTimeout(timelineThumbnailDebounceTimer)
    timelineThumbnailDebounceTimer = null
  }

  if (timelineThumbnailCount.value <= 0) {
    clearTimelineThumbnails()
    return
  }

  timelineThumbnailDebounceTimer = setTimeout(() => {
    timelineThumbnailDebounceTimer = null
    void generateTimelineThumbnails()
  }, 60)
}

let timelineWaveformTaskVersion = 0
let timelineWaveformAudioContext: AudioContext | null = null
let timelineWaveformLoadedKey: string | null = null
let timelineWaveformLoadingKey: string | null = null
let timelineWaveformLoadTimer: ReturnType<typeof setTimeout> | null = null
let timelineWaveformCaptureTaskVersion = 0
let timelineWaveformCaptureVideo: HTMLVideoElement | null = null
let timelineWaveformCaptureSource: MediaElementAudioSourceNode | null = null
let timelineWaveformCaptureProcessor: ScriptProcessorNode | null = null
let timelineWaveformCaptureGain: GainNode | null = null
let timelineWaveformCaptureTimer: ReturnType<typeof setInterval> | null = null
let timelineWaveformCaptureFinish: ((completed: boolean) => void) | null = null

const getTimelineWaveformKey = (
  source: string,
  rangeStart: number,
  rangeDuration: number
) => {
  return `${source}|${rangeStart.toFixed(3)}|${rangeDuration.toFixed(3)}`
}

const closeTimelineWaveformContext = () => {
  const context = timelineWaveformAudioContext
  timelineWaveformAudioContext = null
  if (context) {
    void context.close()
  }
}

const stopTimelineWaveformCapture = (taskVersion?: number) => {
  if (
    taskVersion !== undefined &&
    timelineWaveformCaptureTaskVersion !== taskVersion
  ) {
    return
  }
  timelineWaveformCaptureTaskVersion = 0
  timelineWaveformCaptureFinish?.(false)
  timelineWaveformCaptureFinish = null
  if (timelineWaveformCaptureTimer) {
    clearInterval(timelineWaveformCaptureTimer)
    timelineWaveformCaptureTimer = null
  }
  if (timelineWaveformCaptureProcessor) {
    timelineWaveformCaptureProcessor.onaudioprocess = null
    timelineWaveformCaptureProcessor.disconnect()
    timelineWaveformCaptureProcessor = null
  }
  timelineWaveformCaptureSource?.disconnect()
  timelineWaveformCaptureSource = null
  timelineWaveformCaptureGain?.disconnect()
  timelineWaveformCaptureGain = null
  if (timelineWaveformCaptureVideo) {
    timelineWaveformCaptureVideo.pause()
    timelineWaveformCaptureVideo.removeAttribute('src')
    timelineWaveformCaptureVideo.load()
    timelineWaveformCaptureVideo.remove()
    timelineWaveformCaptureVideo = null
  }
  closeTimelineWaveformContext()
}

const clearTimelineWaveform = () => {
  timelineWaveformTaskVersion++
  timelineWaveformLoadedKey = null
  timelineWaveformLoadingKey = null
  if (timelineWaveformLoadTimer) {
    clearTimeout(timelineWaveformLoadTimer)
    timelineWaveformLoadTimer = null
  }
  timelineWaveformBasePeaks = null
  timelineWaveformMaxPeak = 0
  timelineWaveformReady.value = false
  stopTimelineWaveformCapture()
  closeTimelineWaveformContext()
  scheduleTimelineWaveformDraw()
}

const getTimelineWaveformPeak = (startBin: number, endBin: number) => {
  const basePeaks = timelineWaveformBasePeaks
  if (!basePeaks || endBin <= startBin) {
    return 0
  }

  let peak = 0
  const firstBin = Math.max(0, Math.floor(startBin))
  const lastBin = Math.min(basePeaks.length - 1, Math.ceil(endBin))
  for (let index = firstBin; index <= lastBin; index++) {
    const value = basePeaks[index] ?? 0
    if (value > peak) peak = value
  }
  return peak
}

const drawTimelineWaveform = () => {
  if (designViewMode.value !== 'timeline' || timelineEventId.value === null) return

  const canvas = timelineWaveformCanvasRef.value
  const content = timelineContentRef.value
  if (!canvas || !content) return

  const contentWidth = Math.max(
    1,
    Math.round(content.getBoundingClientRect().width || timelinePixelWidth.value)
  )
  const renderWidth = Math.min(contentWidth, 8192)
  const height = TIMELINE_WAVEFORM_LANE_HEIGHT
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

  if (
    canvas.width !== Math.round(renderWidth * dpr) ||
    canvas.height !== Math.round(height * dpr)
  ) {
    canvas.width = Math.round(renderWidth * dpr)
    canvas.height = Math.round(height * dpr)
  }
  canvas.style.width = `${contentWidth}px`
  canvas.style.height = `${height}px`

  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, renderWidth, height)

  const basePeaks = timelineWaveformBasePeaks
  if (!timelineWaveformReady.value || !basePeaks || basePeaks.length <= 0) return

  const centerY = height / 2
  const maxAmplitude = centerY - 2

  context.beginPath()
  context.moveTo(0, centerY + 0.5)
  context.lineTo(renderWidth, centerY + 0.5)
  context.strokeStyle = 'rgba(170, 179, 191, 0.16)'
  context.lineWidth = 1
  context.stroke()

  context.beginPath()
  for (let x = 0; x < renderWidth; x++) {
    const binRangeStart = Math.floor((x / renderWidth) * basePeaks.length)
    const binRangeEnd = Math.max(
      binRangeStart + 1,
      Math.ceil(((x + 1) / renderWidth) * basePeaks.length)
    )
    const peak = getTimelineWaveformPeak(
      Math.min(binRangeStart, basePeaks.length - 1),
      Math.min(binRangeEnd, basePeaks.length)
    )
    const normalizedPeak = Math.sqrt(peak / timelineWaveformMaxPeak)
    const amplitude = Math.max(0.6, normalizedPeak * maxAmplitude)
    const drawX = x + 0.5
    context.moveTo(drawX, centerY - amplitude)
    context.lineTo(drawX, centerY + amplitude)
  }
  context.strokeStyle = 'rgba(138, 180, 248, 0.72)'
  context.lineWidth = 1
  context.stroke()

}

const scheduleTimelineWaveformDraw = () => {
  if (timelineWaveformDrawRafId) return
  if (typeof requestAnimationFrame === 'undefined') {
    drawTimelineWaveform()
    return
  }
  timelineWaveformDrawRafId = requestAnimationFrame(() => {
    timelineWaveformDrawRafId = 0
    drawTimelineWaveform()
  })
}

const updateTimelineScrollbar = () => {
  const scroll = timelineScrollRef.value
  const track = timelineScrollbarRef.value
  if (!scroll || !track) {
    timelineScrollbarThumbWidth.value = 0
    timelineScrollbarThumbLeft.value = 0
    return
  }

  const viewportWidth = scroll.clientWidth
  const contentWidth = scroll.scrollWidth
  const trackWidth = track.clientWidth
  const maxScrollLeft = Math.max(0, contentWidth - viewportWidth)
  if (
    viewportWidth <= 0 ||
    trackWidth <= 0
  ) {
    timelineScrollbarHasOverflow.value = false
    timelineScrollbarActive.value = false
    clearTimelineScrollbarHideTimer()
    timelineScrollbarThumbWidth.value = 0
    timelineScrollbarThumbLeft.value = 0
    return
  }

  if (contentWidth <= viewportWidth || maxScrollLeft <= 0) {
    timelineScrollbarHasOverflow.value = false
    timelineScrollbarActive.value = false
    clearTimelineScrollbarHideTimer()
    timelineScrollbarThumbWidth.value = 0
    timelineScrollbarThumbLeft.value = 0
    return
  }

  const overflowBecameAvailable = !timelineScrollbarHasOverflow.value
  timelineScrollbarHasOverflow.value = true
  const thumbWidth = Math.max(28, trackWidth * (viewportWidth / contentWidth))
  const maxThumbLeft = Math.max(0, trackWidth - thumbWidth)
  const thumbLeft = maxScrollLeft > 0
    ? (scroll.scrollLeft / maxScrollLeft) * maxThumbLeft
    : 0

  timelineScrollbarThumbWidth.value = thumbWidth
  timelineScrollbarThumbLeft.value = thumbLeft
  if (overflowBecameAvailable) {
    showTimelineScrollbar()
  }
}

const scheduleTimelineScrollbarUpdate = () => {
  if (typeof requestAnimationFrame === 'undefined') {
    updateTimelineScrollbar()
    return
  }

  requestAnimationFrame(updateTimelineScrollbar)
}

const startTimelineScrollbarDrag = (event: PointerEvent) => {
  const scroll = timelineScrollRef.value
  const track = timelineScrollbarRef.value
  if (event.button !== 0 || !scroll || !track) return

  pauseTimelineFollow()
  event.preventDefault()
  clearTimelineScrollbarHideTimer()
  timelineScrollbarActive.value = true
  const trackRect = track.getBoundingClientRect()
  const trackWidth = trackRect.width
  const thumbWidth = timelineScrollbarThumbWidth.value
  if (trackWidth <= 0 || thumbWidth <= 0) return

  const maxThumbLeft = Math.max(0, trackWidth - thumbWidth)
  const pointerLeft = event.clientX - trackRect.left
  const currentThumbLeft = timelineScrollbarThumbLeft.value
  if (
    pointerLeft < currentThumbLeft ||
    pointerLeft > currentThumbLeft + thumbWidth
  ) {
    const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth)
    const nextThumbLeft = Math.max(
      0,
      Math.min(maxThumbLeft, pointerLeft - thumbWidth / 2)
    )
    scroll.scrollLeft = maxThumbLeft > 0
      ? (nextThumbLeft / maxThumbLeft) * maxScrollLeft
      : 0
    updateTimelineScrollbar()
  }

  track.setPointerCapture(event.pointerId)
  timelineScrollbarDrag = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startScrollLeft: scroll.scrollLeft,
    trackWidth,
    thumbWidth
  }
}

const handleTimelineScrollbarPointerMove = (event: PointerEvent) => {
  const drag = timelineScrollbarDrag
  const scroll = timelineScrollRef.value
  if (!drag || !scroll || event.pointerId !== drag.pointerId) return

  event.preventDefault()
  const maxThumbLeft = Math.max(0, drag.trackWidth - drag.thumbWidth)
  const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth)
  const deltaX = event.clientX - drag.startClientX
  scroll.scrollLeft = maxThumbLeft > 0
    ? drag.startScrollLeft + (deltaX / maxThumbLeft) * maxScrollLeft
    : 0
  updateTimelineScrollbar()
}

const finishTimelineScrollbarDrag = (event: PointerEvent) => {
  if (!timelineScrollbarDrag || event.pointerId !== timelineScrollbarDrag.pointerId) {
    return
  }

  const track = timelineScrollbarRef.value
  timelineScrollbarDrag = null
  if (track?.hasPointerCapture(event.pointerId)) {
    track.releasePointerCapture(event.pointerId)
  }
  showTimelineScrollbar()
}

const handleTimelineScroll = () => {
  const scroll = timelineScrollRef.value
  if (scroll) {
    timelineScrollLeft.value = scroll.scrollLeft
  }
  scheduleTimelineScrollbarUpdate()
  showTimelineScrollbar()
}

const updateTimelineVerticalScrollbar = () => {
  const scroll = timelineTracksViewportRef.value
  const track = timelineVerticalScrollbarRef.value
  if (!scroll || !track) {
    timelineVerticalScrollbarThumbHeight.value = 0
    timelineVerticalScrollbarThumbTop.value = 0
    return
  }

  const viewportHeight = scroll.clientHeight
  const contentHeight = scroll.scrollHeight
  const trackHeight = track.clientHeight
  const maxScrollTop = Math.max(0, contentHeight - viewportHeight)
  if (
    viewportHeight <= 0 ||
    trackHeight <= 0 ||
    contentHeight <= viewportHeight ||
    maxScrollTop <= 0
  ) {
    timelineVerticalScrollbarHasOverflow.value = false
    timelineVerticalScrollbarActive.value = false
    clearTimelineVerticalScrollbarHideTimer()
    timelineVerticalScrollbarThumbHeight.value = 0
    timelineVerticalScrollbarThumbTop.value = 0
    return
  }

  const overflowBecameAvailable = !timelineVerticalScrollbarHasOverflow.value
  timelineVerticalScrollbarHasOverflow.value = true
  const thumbHeight = Math.min(
    trackHeight,
    Math.max(28, trackHeight * (viewportHeight / contentHeight))
  )
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight)
  const thumbTop = maxScrollTop > 0
    ? (scroll.scrollTop / maxScrollTop) * maxThumbTop
    : 0

  timelineVerticalScrollbarThumbHeight.value = thumbHeight
  timelineVerticalScrollbarThumbTop.value = thumbTop
  if (overflowBecameAvailable) {
    showTimelineVerticalScrollbar()
  }
}

const scheduleTimelineVerticalScrollbarUpdate = () => {
  if (typeof requestAnimationFrame === 'undefined') {
    updateTimelineVerticalScrollbar()
    return
  }

  requestAnimationFrame(updateTimelineVerticalScrollbar)
}

const startTimelineVerticalScrollbarDrag = (event: PointerEvent) => {
  const scroll = timelineTracksViewportRef.value
  const track = timelineVerticalScrollbarRef.value
  if (event.button !== 0 || !scroll || !track) return

  event.preventDefault()
  clearTimelineVerticalScrollbarHideTimer()
  timelineVerticalScrollbarActive.value = true
  const trackRect = track.getBoundingClientRect()
  const trackHeight = trackRect.height
  const thumbHeight = timelineVerticalScrollbarThumbHeight.value
  if (trackHeight <= 0 || thumbHeight <= 0) return

  const maxThumbTop = Math.max(0, trackHeight - thumbHeight)
  const pointerTop = event.clientY - trackRect.top
  const currentThumbTop = timelineVerticalScrollbarThumbTop.value
  if (
    pointerTop < currentThumbTop ||
    pointerTop > currentThumbTop + thumbHeight
  ) {
    const maxScrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
    const nextThumbTop = Math.max(
      0,
      Math.min(maxThumbTop, pointerTop - thumbHeight / 2)
    )
    scroll.scrollTop = maxThumbTop > 0
      ? (nextThumbTop / maxThumbTop) * maxScrollTop
      : 0
    updateTimelineVerticalScrollbar()
  }

  track.setPointerCapture(event.pointerId)
  timelineVerticalScrollbarDrag = {
    pointerId: event.pointerId,
    startClientY: event.clientY,
    startScrollTop: scroll.scrollTop,
    trackHeight,
    thumbHeight
  }
}

const handleTimelineVerticalScrollbarPointerMove = (event: PointerEvent) => {
  const drag = timelineVerticalScrollbarDrag
  const scroll = timelineTracksViewportRef.value
  if (!drag || !scroll || event.pointerId !== drag.pointerId) return

  event.preventDefault()
  const maxThumbTop = Math.max(0, drag.trackHeight - drag.thumbHeight)
  const maxScrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
  const deltaY = event.clientY - drag.startClientY
  scroll.scrollTop = maxThumbTop > 0
    ? drag.startScrollTop + (deltaY / maxThumbTop) * maxScrollTop
    : 0
  updateTimelineVerticalScrollbar()
}

const finishTimelineVerticalScrollbarDrag = (event: PointerEvent) => {
  if (
    !timelineVerticalScrollbarDrag ||
    event.pointerId !== timelineVerticalScrollbarDrag.pointerId
  ) {
    return
  }

  const track = timelineVerticalScrollbarRef.value
  timelineVerticalScrollbarDrag = null
  if (track?.hasPointerCapture(event.pointerId)) {
    track.releasePointerCapture(event.pointerId)
  }
  showTimelineVerticalScrollbar()
}

const handleTimelineTracksScroll = () => {
  const scroll = timelineTracksViewportRef.value
  if (scroll) {
    timelineTracksScrollTop.value = scroll.scrollTop
  }
  scheduleTimelineVerticalScrollbarUpdate()
  showTimelineVerticalScrollbar()
}

const captureTimelineWaveformByPlayback = async (
  source: string,
  rangeStart: number,
  rangeDuration: number,
  totalDuration: number,
  cacheKey: string,
  taskVersion: number
) => {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    rangeDuration <= 0 ||
    totalDuration <= 0
  ) {
    return null
  }

  const AudioContextConstructor = window.AudioContext
    || (window as typeof window & {
      webkitAudioContext?: typeof AudioContext
    }).webkitAudioContext
  if (!AudioContextConstructor) return null

  const rangeEnd = Math.min(totalDuration, rangeStart + rangeDuration)
  if (rangeEnd <= rangeStart) return null

  const video = document.createElement('video')
  video.preload = 'auto'
  video.playsInline = true
  video.setAttribute('aria-hidden', 'true')
  video.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;'
  document.body.appendChild(video)
  timelineWaveformCaptureTaskVersion = taskVersion
  timelineWaveformCaptureVideo = video

  const waitForEvent = (
    eventName: 'loadedmetadata' | 'loadeddata' | 'seeked',
    timeoutMs: number
  ) => new Promise<boolean>((resolve) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timeoutId)
      video.removeEventListener(eventName, handleReady)
      video.removeEventListener('error', handleError)
    }
    const finish = (ready: boolean) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(ready)
    }
    const handleReady = () => finish(true)
    const handleError = () => finish(false)
    const timeoutId = setTimeout(() => finish(false), timeoutMs)
    video.addEventListener(eventName, handleReady, { once: true })
    video.addEventListener('error', handleError, { once: true })
  })

  try {
    video.src = source
    video.load()
    if (!(await waitForEvent('loadeddata', 8000))) return null
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null

    let context: AudioContext
    try {
      context = new AudioContextConstructor({
        sampleRate: TIMELINE_WAVEFORM_CAPTURE_SAMPLE_RATE
      })
    } catch {
      context = new AudioContextConstructor()
    }
    timelineWaveformAudioContext = context
    if (context.state === 'suspended') {
      await context.resume()
    }
    if (typeof context.createScriptProcessor !== 'function') return null

    const sourceNode = context.createMediaElementSource(video)
    const silentGain = context.createGain()
    silentGain.gain.value = 0
    sourceNode.connect(silentGain)
    silentGain.connect(context.destination)
    timelineWaveformCaptureSource = sourceNode
    timelineWaveformCaptureGain = silentGain

    // 等媒体真正有可定位的数据后再 seek，避免 loadedmetadata 阶段的
    // seeked 事件早于实际定位完成，导致音频仍从视频 0 秒输出。
    const seekTarget = Math.max(0, Math.min(rangeStart, totalDuration))
    if (Math.abs(video.currentTime - seekTarget) > 0.001 || video.seeking) {
      video.currentTime = seekTarget
      const seekStartedAt = performance.now()
      while (
        (
          video.seeking ||
          Math.abs(video.currentTime - seekTarget) > 0.02
        ) &&
        performance.now() - seekStartedAt < 6000
      ) {
        await new Promise<void>((resolve) => setTimeout(resolve, 16))
      }
      if (
        video.seeking ||
        Math.abs(video.currentTime - seekTarget) > 0.02 ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        return null
      }
    }

    const processor = context.createScriptProcessor(
      TIMELINE_WAVEFORM_CAPTURE_BUFFER_SIZE,
      1,
      1
    )
    sourceNode.connect(processor)
    processor.connect(silentGain)
    timelineWaveformCaptureProcessor = processor

    try {
      video.playbackRate = rangeDuration <= 2
        ? 2
        : rangeDuration <= 5
          ? 4
          : rangeDuration <= 15
            ? 8
            : 16
    } catch {
      video.playbackRate = 4
    }
    const effectivePlaybackRate = Math.max(1, video.playbackRate || 1)
    const binCount = TIMELINE_WAVEFORM_BASE_BINS
    const peaks = new Float32Array(binCount)
    let maxPeak = 0
    let lastPublishTime = 0
    let capturedSourceSeconds = 0
    let captureAnchorSourceTime = seekTarget
    let captureStarted = false
    let captureArmed = false

    const publishPeaks = (force = false) => {
      if (
        taskVersion !== timelineWaveformTaskVersion ||
        cacheKey !== timelineWaveformLoadingKey
      ) {
        return
      }
      const now = performance.now()
      if (!force && now - lastPublishTime < 120) return
      lastPublishTime = now
      timelineWaveformBasePeaks = peaks
      timelineWaveformMaxPeak = Math.max(0.001, maxPeak)
      timelineWaveformReady.value = true
      scheduleTimelineWaveformDraw()
    }

    processor.onaudioprocess = (event) => {
      if (
        taskVersion !== timelineWaveformTaskVersion ||
        cacheKey !== timelineWaveformLoadingKey
      ) {
        return
      }
      if (!captureArmed || video.paused || video.ended) return

      const input = event.inputBuffer.getChannelData(0)
      const blockSourceDuration = (
        input.length / context.sampleRate
      ) * effectivePlaybackRate
      const actualSourceTime = video.currentTime
      const expectedBlockEnd = captureAnchorSourceTime
        + capturedSourceSeconds
        + blockSourceDuration
      if (
        Number.isFinite(actualSourceTime) &&
        actualSourceTime + blockSourceDuration < rangeStart
      ) {
        return
      }
      if (!captureStarted) {
        captureStarted = true
        captureAnchorSourceTime = Math.max(
          seekTarget,
          actualSourceTime - blockSourceDuration
        )
        capturedSourceSeconds = 0
      } else if (
        !video.seeking &&
        Number.isFinite(actualSourceTime) &&
        Math.abs(actualSourceTime - expectedBlockEnd) >
          Math.max(0.05, blockSourceDuration * 1.5)
      ) {
        captureAnchorSourceTime = Math.max(
          seekTarget,
          actualSourceTime - blockSourceDuration
        )
        capturedSourceSeconds = 0
      }

      const callbackStartTime = captureAnchorSourceTime + capturedSourceSeconds
      for (let index = 0; index < input.length; index++) {
        const sourceTime = callbackStartTime
          + (index / context.sampleRate) * effectivePlaybackRate
        if (sourceTime < rangeStart || sourceTime >= rangeEnd) continue

        const relative = (sourceTime - rangeStart) / rangeDuration
        const bin = Math.max(
          0,
          Math.min(
            binCount - 1,
            Math.floor(relative * binCount)
          )
        )
        const peak = Math.abs(input[index] ?? 0)
        if (peak > (peaks[bin] ?? 0)) {
          peaks[bin] = peak
        }
        if (peak > maxPeak) maxPeak = peak
      }
      capturedSourceSeconds += (
        input.length / context.sampleRate
      ) * effectivePlaybackRate
      publishPeaks()
    }

    const playbackCompleted = new Promise<boolean>((resolve) => {
      let settled = false
      const cleanup = () => {
        timelineWaveformCaptureFinish = null
        if (timelineWaveformCaptureTimer) {
          clearInterval(timelineWaveformCaptureTimer)
          timelineWaveformCaptureTimer = null
        }
        video.removeEventListener('ended', handleEnded)
        video.removeEventListener('error', handleError)
      }
      const finish = (completed: boolean) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(completed)
      }
      const handleEnded = () => finish(true)
      const handleError = () => finish(false)
      const checkRange = () => {
        if (
          taskVersion !== timelineWaveformTaskVersion ||
          cacheKey !== timelineWaveformLoadingKey
        ) {
          finish(false)
          return
        }
        if (video.ended || video.currentTime >= rangeEnd - 0.001) {
          finish(true)
        }
      }

      timelineWaveformCaptureFinish = finish
      video.addEventListener('ended', handleEnded, { once: true })
      video.addEventListener('error', handleError, { once: true })
      timelineWaveformCaptureTimer = setInterval(checkRange, 32)
      checkRange()
    })

    captureArmed = true
    await video.play()
    if (!(await playbackCompleted)) return null
    // 等待音频处理链把区间末尾的缓冲样本排空，避免末段波形缺失。
    await new Promise<void>((resolve) => setTimeout(resolve, 240))
    publishPeaks(true)

    return {
      peaks,
      maxPeak: Math.max(0.001, maxPeak)
    }
  } catch {
    return null
  } finally {
    stopTimelineWaveformCapture(taskVersion)
  }
}

const loadTimelineWaveform = async () => {
  const source = videoSrc.value
  const rangeStart = timelineRangeStart.value
  const rangeDuration = timelineRangeDuration.value
  const cacheKey = source
    ? getTimelineWaveformKey(source, rangeStart, rangeDuration)
    : null
  if (
    !source ||
    !cacheKey ||
    timelineEventId.value === null ||
    rangeDuration <= 0 ||
    timelineWaveformLoadedKey === cacheKey ||
    timelineWaveformLoadingKey === cacheKey
  ) {
    return
  }

  const taskVersion = ++timelineWaveformTaskVersion
  timelineWaveformLoadingKey = cacheKey
  timelineWaveformReady.value = false
  timelineWaveformBasePeaks = null
  timelineWaveformMaxPeak = 0
  stopTimelineWaveformCapture()

  try {
    const rangePeaks = await captureTimelineWaveformByPlayback(
      source,
      rangeStart,
      rangeDuration,
      videoDuration.value,
      cacheKey,
      taskVersion
    )
    if (
      taskVersion !== timelineWaveformTaskVersion ||
      cacheKey !== timelineWaveformLoadingKey
    ) {
      return
    }
    if (!rangePeaks) return

    timelineWaveformBasePeaks = rangePeaks.peaks
    timelineWaveformMaxPeak = rangePeaks.maxPeak
    timelineWaveformReady.value = true
    timelineWaveformLoadedKey = cacheKey
    nextTick(() => {
      scheduleTimelineWaveformDraw()
    })
  } catch {
    if (taskVersion === timelineWaveformTaskVersion) {
      timelineWaveformReady.value = false
      timelineWaveformBasePeaks = null
      timelineWaveformMaxPeak = 0
    }
  } finally {
    if (taskVersion === timelineWaveformTaskVersion) {
      timelineWaveformLoadingKey = null
      closeTimelineWaveformContext()
    }
  }
}

const scheduleTimelineWaveformLoad = () => {
  if (timelineWaveformLoadTimer) {
    clearTimeout(timelineWaveformLoadTimer)
    timelineWaveformLoadTimer = null
  }

  if (!videoSrc.value || timelineEventId.value === null) {
    clearTimelineWaveform()
    return
  }

  timelineWaveformLoadTimer = setTimeout(() => {
    timelineWaveformLoadTimer = null
    void loadTimelineWaveform()
  }, 120)
}

const selectTimelineEvent = (event: EventItem) => {
  selectEvent(event.id)
}

const removeTimelinePreset = async (item: TimelinePresetItem, event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()

  const target = event.currentTarget
  const clip = target instanceof Element ? target.closest('.timeline-clip') : null
  if (clip instanceof HTMLElement && !disableAnimations.value) {
    clip.classList.add('is-removing')
    await new Promise<void>((resolve) => {
      const animation = clip.animate(
        [
          {
            opacity: 1,
            transform: 'scaleX(1)',
            transformOrigin: 'left center'
          },
          {
            opacity: 0,
            transform: 'scaleX(0.82)',
            transformOrigin: 'left center'
          }
        ],
        {
          duration: 180,
          easing: 'cubic-bezier(0.4, 0, 1, 1)',
          fill: 'forwards'
        }
      )
      animation.addEventListener('finish', () => resolve(), { once: true })
      animation.addEventListener('cancel', () => resolve(), { once: true })
    })
  }

  removeEventPresetTrigger(item.event.id, item.playback.triggerId)
}

const seekTimelinePreset = (item: TimelinePresetItem) => {
  pauseTimelineFollow()
  selectTimelineEvent(item.event)
  seekVideoTo(item.startTime)
}

const duplicateTimelinePreset = async (item: TimelinePresetItem) => {
  const eventStartTime = isValidTriggerTime(item.event.time)
    ? parseTimeToSeconds(item.event.time)
    : 0
  const duplicateOffset = Math.max(
    0,
    item.startTime - eventStartTime + item.durationSeconds
  )
  const trigger = addEventPresetTrigger(
    item.event.id,
    item.playback.preset.id,
    duplicateOffset,
    item.track
  )
  if (!trigger) return

  selectTimelineEvent(item.event)
  if (disableAnimations.value) return

  timelineDuplicatingTriggerId.value = trigger.id
  await nextTick()

  const sourceClip = timelineContentRef.value?.querySelector<HTMLElement>(
    `[data-timeline-trigger-id="${item.playback.triggerId}"]`
  )
  const duplicateClip = timelineContentRef.value?.querySelector<HTMLElement>(
    `[data-timeline-trigger-id="${trigger.id}"]`
  )
  const sourceRect = sourceClip?.getBoundingClientRect()
  const duplicateRect = duplicateClip?.getBoundingClientRect()
  if (
    !sourceClip ||
    !duplicateClip ||
    !sourceRect ||
    !duplicateRect ||
    duplicateRect.width <= 0 ||
    duplicateRect.height <= 0
  ) {
    timelineDuplicatingTriggerId.value = null
    return
  }

  const translateX = sourceRect.left - duplicateRect.left
  const translateY = sourceRect.top - duplicateRect.top
  const animation = duplicateClip.animate(
    [
      {
        opacity: 0.58,
        transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(0.97)`,
        transformOrigin: 'left center'
      },
      {
        opacity: 1,
        transform: 'translate3d(0, 0, 0) scale(1)',
        transformOrigin: 'left center'
      }
    ],
    {
      duration: 320,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      fill: 'forwards'
    }
  )
  const finishDuplicateAnimation = () => {
    if (timelineDuplicatingTriggerId.value === trigger.id) {
      timelineDuplicatingTriggerId.value = null
    }
  }
  animation.addEventListener('finish', finishDuplicateAnimation, { once: true })
  animation.addEventListener('cancel', finishDuplicateAnimation, { once: true })
}

const readDraggedPresetPayload = (
  dataTransfer: DataTransfer | null
): PresetDragPayload | null => {
  if (!dataTransfer) return null

  const metaValue = dataTransfer.getData(PRESET_DRAG_META_MIME)
  if (metaValue) {
    try {
      const parsed = JSON.parse(metaValue) as Partial<PresetDragPayload>
      const rect = parsed.rect
      const grabOffset = parsed.grabOffset
      if (
        typeof parsed.id === 'number' &&
        Number.isInteger(parsed.id) &&
        parsed.id > 0 &&
        rect &&
        Number.isFinite(rect.left) &&
        Number.isFinite(rect.top) &&
        Number.isFinite(rect.width) &&
        Number.isFinite(rect.height) &&
        rect.width > 0 &&
        rect.height > 0
      ) {
        return {
          id: parsed.id,
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          },
          grabOffset: grabOffset &&
            Number.isFinite(grabOffset.x) &&
            Number.isFinite(grabOffset.y)
            ? {
                x: Math.max(0, Math.min(rect.width, grabOffset.x)),
                y: Math.max(0, Math.min(rect.height, grabOffset.y))
              }
            : undefined
        }
      }
    } catch {
      // 兼容仅携带预设 ID 的旧拖放数据
    }
  }

  const rawValue = dataTransfer.getData(PRESET_DRAG_MIME)
    || dataTransfer.getData('text/plain')
  const normalizedValue = rawValue.startsWith(PRESET_DRAG_TEXT_PREFIX)
    ? rawValue.slice(PRESET_DRAG_TEXT_PREFIX.length)
    : rawValue
  const presetId = Number.parseInt(normalizedValue, 10)
  return Number.isInteger(presetId) && presetId > 0
    ? { id: presetId }
    : null
}

const readTimelineTriggerDragPayload = (
  dataTransfer: DataTransfer | null
): TimelineTriggerDragPayload | null => {
  if (!dataTransfer) return null

  const rawValue = dataTransfer.getData(TIMELINE_TRIGGER_DRAG_MIME)
  if (!rawValue) return null

  try {
    const parsed = JSON.parse(rawValue) as Partial<TimelineTriggerDragPayload>
    if (
      typeof parsed.eventId === 'number' &&
      Number.isInteger(parsed.eventId) &&
      parsed.eventId > 0 &&
      typeof parsed.triggerId === 'number' &&
      Number.isInteger(parsed.triggerId) &&
      parsed.triggerId > 0
    ) {
      return {
        eventId: parsed.eventId,
        triggerId: parsed.triggerId
      }
    }
  } catch {
    return null
  }

  return null
}

const handleTimelinePresetDragOver = (event: DragEvent) => {
  const eventItem = selectedTimelineEvent.value
  const dataTransfer = event.dataTransfer
  const isTimelineTriggerDrag = !!dataTransfer?.types.includes(
    TIMELINE_TRIGGER_DRAG_MIME
  )
  if (
    !eventItem ||
    !dataTransfer ||
    (
      !isTimelineTriggerDrag &&
      !dataTransfer.types.includes(PRESET_DRAG_META_MIME) &&
      !dataTransfer.types.includes(PRESET_DRAG_MIME) &&
      !dataTransfer.types.includes('text/plain')
    )
  ) {
    return
  }

  event.preventDefault()
  pauseTimelineFollow()
  dataTransfer.dropEffect = isTimelineTriggerDrag ? 'move' : 'copy'
  timelinePresetDropPosition.value = getTimelinePositionPercent(
    getTimelineSecondsAtClientX(event.clientX)
  )
  timelinePresetDropTrack.value = getTimelineTrackIndexAtClientY(event.clientY)
}

const handleTimelinePresetDragLeave = (event: DragEvent) => {
  const currentTarget = event.currentTarget as HTMLElement | null
  const relatedTarget = event.relatedTarget as Node | null
  if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) return

  timelinePresetDropPosition.value = null
  timelinePresetDropTrack.value = null
}

const finishTimelinePresetDropAnimation = (animationKey: number) => {
  if (animationKey !== timelineDropAnimationSequence) return

  if (timelineDropAnimationTimer) {
    clearTimeout(timelineDropAnimationTimer)
    timelineDropAnimationTimer = null
  }
  timelinePresetDropFlight.value = null
  timelineDropAnimatingTriggerId.value = null
}

const handleTimelinePresetDrop = async (event: DragEvent) => {
  pauseTimelineFollow()
  const eventItem = selectedTimelineEvent.value
  const timelineTrigger = readTimelineTriggerDragPayload(event.dataTransfer)
  const draggedPreset = readDraggedPresetPayload(event.dataTransfer)
  const dropTrack = getTimelineTrackIndexAtClientY(event.clientY)
  timelinePresetDropPosition.value = null
  timelinePresetDropTrack.value = null

  if (timelineTrigger) {
    const sourceEvent = events.value.find(
      item => item.id === timelineTrigger.eventId
    )
    if (!sourceEvent) return

    event.preventDefault()
    timelineClipDragDropped = true
    timelineClipDragPointerX = event.clientX
    timelineClipDragPointerY = event.clientY
    const eventStartTime = isValidTriggerTime(sourceEvent.time)
      ? parseTimeToSeconds(sourceEvent.time)
      : 0
    const dropTime = getTimelineSecondsAtClientX(event.clientX)
    updateEventPresetTriggerTime(
      sourceEvent.id,
      timelineTrigger.triggerId,
      Math.max(0, dropTime - eventStartTime)
    )
    updateEventPresetTriggerTrack(
      sourceEvent.id,
      timelineTrigger.triggerId,
      dropTrack
    )
    selectTimelineEvent(sourceEvent)
    return
  }

  if (!eventItem || !draggedPreset) return

  const preset = presets.value.find(item => item.id === draggedPreset.id)
  if (!preset) return

  event.preventDefault()
  const eventStartTime = isValidTriggerTime(eventItem.time)
    ? parseTimeToSeconds(eventItem.time)
    : 0
  const dropTime = getTimelineSecondsAtClientX(event.clientX)
  const trigger = addEventPresetTrigger(
    eventItem.id,
    preset.id,
    Math.max(0, dropTime - eventStartTime),
    dropTrack
  )
  if (!trigger) return
  if (disableAnimations.value || !draggedPreset.rect) return

  const animationKey = ++timelineDropAnimationSequence
  if (timelineDropAnimationTimer) {
    clearTimeout(timelineDropAnimationTimer)
  }
  timelineDropAnimatingTriggerId.value = trigger.id
  timelineDropAnimationTimer = setTimeout(() => {
    finishTimelinePresetDropAnimation(animationKey)
  }, 520)

  await nextTick()
  const clipElement = timelineContentRef.value?.querySelector<HTMLElement>(
    `[data-timeline-trigger-id="${trigger.id}"]`
  )
  const clipRect = clipElement?.getBoundingClientRect()
  if (!clipRect || clipRect.width <= 0 || clipRect.height <= 0) return

  const flight: TimelinePresetDropFlight = {
    key: animationKey,
    presetId: preset.id,
    presetName: preset.name,
    color: preset.effect?.color || '#ffffff',
    from: {
      left: event.clientX - (
        draggedPreset.grabOffset?.x ?? draggedPreset.rect.width / 2
      ),
      top: event.clientY - (
        draggedPreset.grabOffset?.y ?? draggedPreset.rect.height / 2
      ),
      width: draggedPreset.rect.width,
      height: draggedPreset.rect.height
    },
    to: {
      left: clipRect.left,
      top: clipRect.top,
      width: clipRect.width,
      height: clipRect.height
    }
  }
  timelinePresetDropFlight.value = flight
  await nextTick()

  const flightElement = timelinePresetDropFlightRef.value
  if (!flightElement || typeof flightElement.animate !== 'function') return

  flightElement.querySelectorAll<HTMLElement>('.preset-drop-flight-label')
    .forEach(label => {
      label.animate(
        [
          { opacity: 1 },
          { opacity: 0 }
        ],
        {
          duration: 180,
          easing: 'ease-out',
          fill: 'forwards'
        }
      )
    })

  const deltaX = flight.to.left - flight.from.left
  const deltaY = flight.to.top - flight.from.top
  const scaleX = flight.to.width / flight.from.width
  const scaleY = flight.to.height / flight.from.height
  const animation = flightElement.animate(
    [
      {
        borderRadius: '10px',
        transform: 'translate3d(0, 0, 0) scale(1, 1)'
      },
      {
        borderRadius: '5px',
        transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`
      }
    ],
    {
      duration: 320,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      fill: 'forwards'
    }
  )
  animation.onfinish = () => {
    finishTimelinePresetDropAnimation(animationKey)
  }
}

const clampTimelineZoom = (value: number) => {
  return Math.max(1, Number(value.toFixed(6)))
}

const setTimelineZoom = (delta: number) => {
  pauseTimelineFollow()
  syncTimelineViewportWidth()
  timelineZoom.value = clampTimelineZoom(timelineZoom.value + delta)
  showTimelineScrollbar()
}

const clampTimelineVerticalZoom = (value: number) => {
  return Math.max(
    TIMELINE_VERTICAL_ZOOM_MIN,
    Math.min(TIMELINE_VERTICAL_ZOOM_MAX, Number(value.toFixed(3)))
  )
}

const setTimelineVerticalZoom = (delta: number) => {
  pauseTimelineFollow()
  timelineVerticalZoom.value = clampTimelineVerticalZoom(
    timelineVerticalZoom.value + delta
  )
  nextTick(scheduleTimelineVerticalScrollbarUpdate)
  showTimelineVerticalScrollbar()
}

const normalizeTimelineWheelDelta = (
  delta: number,
  deltaMode: number,
  pageSize: number
) => {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * 16
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * pageSize
  return delta
}

const getTimelineWheelRegion = (
  target: EventTarget | null
): 'ruler' | 'media' | 'tracks' | null => {
  if (!(target instanceof Element)) return null
  if (target.closest('.timeline-ruler')) return 'ruler'
  if (target.closest('.timeline-tracks-viewport')) return 'tracks'
  if (
    target.closest('.timeline-thumbnail-strip') ||
    target.closest('.timeline-waveform-strip')
  ) {
    return 'media'
  }
  return null
}

const handleTimelineWheel = (event: WheelEvent) => {
  const scroll = timelineScrollRef.value
  const content = timelineContentRef.value
  const region = getTimelineWheelRegion(event.target)
  if (!region || !scroll || !content) return

  if (region === 'tracks') {
    const tracks = timelineTracksViewportRef.value
    if (!tracks || event.deltaY === 0) return

    event.preventDefault()
    const delta = normalizeTimelineWheelDelta(
      event.deltaY,
      event.deltaMode,
      tracks.clientHeight
    )
    tracks.scrollTop += delta
    scheduleTimelineVerticalScrollbarUpdate()
    showTimelineVerticalScrollbar()
    return
  }

  if (region === 'ruler') {
    const rawDelta = event.deltaY !== 0 ? event.deltaY : event.deltaX
    if (rawDelta === 0) return

    event.preventDefault()
    pauseTimelineFollow()
    const delta = normalizeTimelineWheelDelta(
      rawDelta,
      event.deltaMode,
      scroll.clientHeight
    )
    scroll.scrollLeft += delta
    scheduleTimelineScrollbarUpdate()
    showTimelineScrollbar()
    return
  }

  if (event.deltaY === 0) return

  event.preventDefault()
  pauseTimelineFollow()
  syncTimelineViewportWidth()
  const contentRect = content.getBoundingClientRect()
  if (contentRect.width <= 0) return

  const pointerX = event.clientX - scroll.getBoundingClientRect().left
  const anchorRatio = Math.max(
    0,
    Math.min(1, (scroll.scrollLeft + pointerX) / contentRect.width)
  )
  const normalizedDelta = normalizeTimelineWheelDelta(
    event.deltaY,
    event.deltaMode,
    scroll.clientHeight
  )
  const zoomFactor = Math.exp(-normalizedDelta * 0.0018)
  const nextZoom = clampTimelineZoom(timelineZoom.value * zoomFactor)

  if (nextZoom === timelineZoom.value) return
  showTimelineScrollbar()
  timelineZoom.value = nextZoom

  nextTick(() => {
    const nextContent = timelineContentRef.value
    if (!nextContent) return
    const nextWidth = nextContent.getBoundingClientRect().width
    scroll.scrollLeft = Math.max(0, anchorRatio * nextWidth - pointerX)
    scheduleTimelineScrollbarUpdate()
  })
}

const getTimelineSecondsAtClientX = (clientX: number) => {
  const content = timelineContentRef.value
  if (!content) return 0

  const rect = content.getBoundingClientRect()
  if (rect.width <= 0) return 0

  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  return Math.round(
    (timelineRangeStart.value + ratio * timelineRangeDuration.value) * 100
  ) / 100
}

const getTimelineTrackIndexAtClientY = (clientY: number) => {
  const viewport = timelineTracksViewportRef.value
  if (!viewport || timelineTrackCount.value <= 0) return 0

  const rect = viewport.getBoundingClientRect()
  const pointerY = clientY - rect.top + viewport.scrollTop
  return Math.max(
    0,
    Math.min(
      timelineTrackCount.value - 1,
      Math.floor(pointerY / timelineTrackHeight.value)
    )
  )
}

const pauseTimelineFollow = () => {
  if (timelineFollowEnabled.value) {
    setTimelineFollowEnabled(false)
  }
}

const followTimelinePlayhead = () => {
  const scroll = timelineScrollRef.value
  if (!scroll) return

  if (timelineZoom.value <= 1) {
    scroll.scrollLeft = 0
    scheduleTimelineWaveformDraw()
    return
  }

  if (timelineInteractionMode.value) return

  const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth)
  if (maxScrollLeft <= 1) {
    scroll.scrollLeft = 0
    scheduleTimelineWaveformDraw()
    return
  }

  const playheadX = (timelinePlayheadPercent.value / 100) * scroll.scrollWidth
  const viewportLeft = scroll.scrollLeft
  const viewportRight = viewportLeft + scroll.clientWidth

  if (playheadX > viewportRight) {
    scroll.scrollLeft = Math.min(maxScrollLeft, viewportRight)
  } else if (playheadX < viewportLeft) {
    scroll.scrollLeft = Math.max(0, playheadX)
  }
  scheduleTimelineWaveformDraw()
}

const startTimelineMediaDrag = (event: PointerEvent, allowClickSeek = false) => {
  if (event.button !== 0) return
  pauseTimelineFollow()
  event.preventDefault()
  const captureElement = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : null
  if (captureElement) {
    captureElement.setPointerCapture(event.pointerId)
  }

  timelineInteraction = {
    mode: 'pan',
    pointerId: event.pointerId,
    startClientX: event.clientX,
    captureElement: captureElement ?? undefined,
    initialScrollLeft: timelineScrollRef.value?.scrollLeft ?? 0,
    allowClickSeek,
    moved: false
  }
  timelineInteractionMode.value = 'pan'
}

const startTimelinePlayheadDrag = (event: PointerEvent) => {
  if (event.button !== 0) return

  pauseTimelineFollow()
  event.preventDefault()
  const captureElement = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : null
  if (captureElement) {
    captureElement.setPointerCapture(event.pointerId)
  }

  timelineInteraction = {
    mode: 'playhead',
    pointerId: event.pointerId,
    startClientX: event.clientX,
    captureElement: captureElement ?? undefined,
    moved: true
  }
  timelineInteractionMode.value = 'playhead'
}

const handleTimelineRulerClick = (event: MouseEvent) => {
  if (event.button !== 0) return
  pauseTimelineFollow()
  seekVideoTo(getTimelineSecondsAtClientX(event.clientX))
}

const handleTimelineClipDragStart = (
  item: TimelinePresetItem,
  event: DragEvent
) => {
  const dataTransfer = event.dataTransfer
  if (!dataTransfer) {
    event.preventDefault()
    return
  }

  pauseTimelineFollow()
  dataTransfer.effectAllowed = 'move'
  dataTransfer.setData(TIMELINE_TRIGGER_DRAG_MIME, JSON.stringify({
    eventId: item.event.id,
    triggerId: item.playback.triggerId
  }))
  const clip = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : null
  if (clip) {
    const rect = clip.getBoundingClientRect()
    timelineClipDragGrabOffsetX = event.clientX - rect.left
    timelineClipDragGrabOffsetY = event.clientY - rect.top
    if (!disableAnimations.value) {
      clip.animate(
        [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0.58, transform: 'scale(0.97)' }
        ],
        {
          id: TIMELINE_CLIP_DRAG_ANIMATION_ID,
          duration: 140,
          easing: 'ease-out',
          fill: 'forwards'
        }
      )
    }
  }
  timelineClipDragPointerX = event.clientX
  timelineClipDragPointerY = event.clientY
  timelineClipDragDropped = false
  timelineDraggingTriggerId.value = item.playback.triggerId
}

const handleTimelineClipDrag = (event: DragEvent) => {
  timelineClipDragPointerX = event.clientX
  timelineClipDragPointerY = event.clientY
}

const handleTimelineClipDragEnd = async (
  item: TimelinePresetItem,
  event: DragEvent
) => {
  if (Number.isFinite(event.clientX)) {
    timelineClipDragPointerX = event.clientX
  }
  if (Number.isFinite(event.clientY)) {
    timelineClipDragPointerY = event.clientY
  }

  const shouldAnimateDrop = timelineClipDragDropped && !disableAnimations.value
  timelineDraggingTriggerId.value = null
  timelinePresetDropPosition.value = null
  timelinePresetDropTrack.value = null
  timelineClipDragDropped = false

  await nextTick()
  const clip = timelineContentRef.value?.querySelector<HTMLElement>(
    `[data-timeline-trigger-id="${item.playback.triggerId}"]`
  )
  if (!clip || typeof clip.animate !== 'function') return

  clip.getAnimations().forEach((animation) => {
    if (animation.id === TIMELINE_CLIP_DRAG_ANIMATION_ID) {
      animation.cancel()
    }
  })

  if (disableAnimations.value) return

  if (shouldAnimateDrop) {
    const clipRect = clip.getBoundingClientRect()
    const dragLeft = timelineClipDragPointerX - timelineClipDragGrabOffsetX
    const dragTop = timelineClipDragPointerY - timelineClipDragGrabOffsetY
    const translateX = dragLeft - clipRect.left
    const translateY = dragTop - clipRect.top

    clip.animate(
      [
        {
          opacity: 0.58,
          transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(0.97)`
        },
        {
          opacity: 1,
          transform: 'translate3d(0, 0, 0) scale(1)'
        }
      ],
      {
        duration: 320,
        easing: 'cubic-bezier(0.2, 0, 0, 1)'
      }
    )
    return
  }

  clip.animate(
    [
      { opacity: 0.58, transform: 'scale(0.97)' },
      { opacity: 1, transform: 'scale(1)' }
    ],
    {
      duration: 140,
      easing: 'ease-out'
    }
  )
}

const handleTimelinePointerMove = (event: PointerEvent) => {
  const interaction = timelineInteraction
  if (!interaction || event.pointerId !== interaction.pointerId) return
  if ((event.buttons & 1) === 0) {
    handleTimelinePointerUp(event)
    return
  }

  if (interaction.mode === 'pan') {
    const deltaX = event.clientX - interaction.startClientX
    if (!interaction.moved && Math.abs(deltaX) < 3) return

    interaction.moved = true
    event.preventDefault()
    const scroll = timelineScrollRef.value
    if (scroll) {
      const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth)
      scroll.scrollLeft = Math.max(
        0,
        Math.min(
          maxScrollLeft,
          (interaction.initialScrollLeft ?? 0) - deltaX
        )
      )
    }
    scheduleTimelineWaveformDraw()
    return
  }

  if (interaction.mode === 'playhead') {
    event.preventDefault()
    seekVideoTo(getTimelineSecondsAtClientX(event.clientX))
  }
}

const handleTimelinePointerUp = (event: PointerEvent) => {
  const interaction = timelineInteraction
  if (!interaction || event.pointerId !== interaction.pointerId) return

  if (interaction.mode === 'pan') {
    if (!interaction.moved && interaction.allowClickSeek && event.type !== 'pointercancel') {
      seekVideoTo(getTimelineSecondsAtClientX(event.clientX))
    }
  }

  const captureElement = interaction.captureElement
  if (captureElement?.hasPointerCapture(event.pointerId)) {
    captureElement.releasePointerCapture(event.pointerId)
  }

  timelineInteraction = null
  timelineInteractionMode.value = null
  timelineDraggingTriggerId.value = null
}

watch(selectedPresetId, () => {
  if (timelineEventId.value !== null && !isEventRecording.value) {
    selectEvent(null)
    timelineEventId.value = null
  }
})

watch(videoCurrentTime, () => {
  if (!timelineFollowEnabled.value) return
  followTimelinePlayhead()
})

watch(timelineFollowEnabled, (enabled) => {
  if (!enabled) return
  nextTick(followTimelinePlayhead)
}, { immediate: true })

watch(timelineZoom, () => {
  nextTick(() => {
    const scroll = timelineScrollRef.value
    if (scroll && timelineZoom.value <= 1) {
      scroll.scrollLeft = 0
    }
    scheduleTimelineWaveformDraw()
    scheduleTimelineScrollbarUpdate()
  })
})

watch(
  () => [
    timelineRangeStart.value,
    timelineRangeDuration.value
  ] as const,
  () => {
    nextTick(scheduleTimelineScrollbarUpdate)
  }
)

// 当前编辑的活动曲线类别 ('brightness' | 'color')
const activeCurveType = useState<'brightness' | 'color'>(
  'design_active_curve_type',
  () => 'brightness'
)

// 曲线编辑工具模式 ('pointer': 鼠标选择 | 'pen': 笔/调整节点 | 'add': 添加节点 | 'delete': 删除节点)
export type CurveEditTool = 'pointer' | 'pen' | 'add' | 'delete'
const activeEditTool = useState<CurveEditTool>('design_active_edit_tool', () => 'pointer')

// 根据当前选中的操作工具动态切换画布指针样式
const canvasCursorClass = computed(() => {
  if (activeEditTool.value === 'pointer') {
    return hoveredPoint.value ? 'cursor-pointer' : 'cursor-default'
  }
  if (activeEditTool.value === 'pen') {
    return activeDragPoint.value ? 'cursor-grabbing' : (hoveredPoint.value ? 'cursor-grab' : 'cursor-default')
  }
  if (activeEditTool.value === 'add') {
    return 'cursor-crosshair'
  }
  if (activeEditTool.value === 'delete') {
    const isMid = hoveredPoint.value && hoveredPoint.value.index > 0 &&
      hoveredPoint.value.index < (hoveredPoint.value.type === 'brightness' ? currentPoints.value.length - 1 : currentColorPoints.value.length - 1)
    return isMid ? 'cursor-pointer' : 'cursor-default'
  }
  return 'cursor-default'
})

watch(activeEditTool, () => {
  stopCanvasDrag()
  hoveredPoint.value = null
  drawCurve()
})

// 亮度曲线关键点列表 (默认 50% 亮度水平直线)
const currentPoints = computed<PresetPoint[]>(() => {
  const pts = activePreset.value?.effect?.points
  if (!pts || pts.length === 0) {
    return [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 }
    ]
  }
  return [...pts].sort((a, b) => a.x - b.x)
})

// 颜色曲线关键点列表 (默认 100% 纯白平直直线)
const currentColorPoints = computed<PresetColorPoint[]>(() => {
  const cps = activePreset.value?.effect?.colorPoints
  if (!cps || cps.length === 0) {
    return [
      { x: 0, y: 1.0, color: currentColor.value },
      { x: 1, y: 1.0, color: currentColor.value }
    ]
  }
  // 若是旧版默认的双色倾斜或50%平直，自动规范为 100% 纯色平直
  const [firstColorPoint, secondColorPoint] = cps
  if (
    cps.length === 2 &&
    firstColorPoint &&
    secondColorPoint &&
    (firstColorPoint.y === 0.2 || firstColorPoint.y === 0.5) &&
    (secondColorPoint.y === 0.8 || secondColorPoint.y === 0.5)
  ) {
    return [
      { x: 0, y: 1.0, color: currentColor.value },
      { x: 1, y: 1.0, color: currentColor.value }
    ]
  }
  return [...cps]
    .map(cp => normalizeColorPoint(cp, currentColor.value))
    .sort((a, b) => a.x - b.x)
})

// 当前选中的渐变颜色节点索引
const selectedColorNodeIndex = ref<number | null>(null)

// -------------------------------------------------------------
// 色彩转换工具函数 (HEX <-> RGB <-> HSV)
// -------------------------------------------------------------
const hexToRgb = (hex: string) => {
  let clean = hex.replace(/^#/, '')
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('')
  }
  const num = parseInt(clean, 16)
  if (isNaN(num) || clean.length !== 6) {
    return { r: 255, g: 255, b: 255 }
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  }
}

const rgbToHex = (r: number, g: number, b: number): string => {
  const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toLowerCase()
}

const rgbToHsv = (r: number, g: number, b: number) => {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  const s = max === 0 ? 0 : d / max
  const v = max

  if (d !== 0) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      case b: h = (r - g) / d + 4; break
    }
    h /= 6
  }
  return { h: h * 360, s, v }
}

const hsvToRgb = (h: number, s: number, v: number) => {
  h = (h % 360 + 360) % 360
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r1 = 0, g1 = 0, b1 = 0

  if (h >= 0 && h < 60) { r1 = c; g1 = x; b1 = 0 }
  else if (h >= 60 && h < 120) { r1 = x; g1 = c; b1 = 0 }
  else if (h >= 120 && h < 180) { r1 = 0; g1 = c; b1 = x }
  else if (h >= 180 && h < 240) { r1 = 0; g1 = x; b1 = c }
  else if (h >= 240 && h < 300) { r1 = x; g1 = 0; b1 = c }
  else { r1 = c; g1 = 0; b1 = x }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255)
  }
}

const fallbackInputRef = ref<HTMLInputElement | null>(null)

// 统一设色：若选中了颜色曲线节点，则为该节点设色；否则设为主颜色
const setColor = (color: string) => {
  if (!activePreset.value) return
  const hex = color.toLowerCase()
  const currentPts = [...currentColorPoints.value]
  const selectedIndex = selectedColorNodeIndex.value
  const selectedPoint = selectedIndex === null ? undefined : currentPts[selectedIndex]

  if (selectedIndex !== null && selectedPoint) {
    currentPts[selectedIndex] = normalizeColorPoint(
      { ...selectedPoint, color: hex },
      currentColor.value
    )
    updatePresetEffect(activePreset.value.id, { color: hex, colorPoints: currentPts })
  } else {
    // 若未选中特定节点，且当前颜色曲线所有节点颜色相同，则整体同步更新为该颜色
    const firstPoint = currentPts[0]
    const allSameColor = firstPoint
      ? currentPts.every(cp => cp.color.toLowerCase() === firstPoint.color.toLowerCase())
      : false
    if (allSameColor) {
      const updatedPts = currentPts.map(cp => normalizeColorPoint({ ...cp, color: hex }, currentColor.value))
      updatePresetEffect(activePreset.value.id, { color: hex, colorPoints: updatedPts })
    } else {
      updatePresetEffect(activePreset.value.id, { color: hex })
    }
  }

  drawCurve()
}

// -------------------------------------------------------------
// 历史颜色系统 (无预设颜色，由输入框旁 + 按钮添加)
// -------------------------------------------------------------
const historyColors = useState<string[]>('design_history_colors', () => [])

const loadHistoryColors = () => {
  if (historyColors.value.length > 0) return
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem('lse_history_colors')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        historyColors.value = parsed
        return
      }
    }
  } catch {}
  historyColors.value = []
}

const saveHistoryColors = () => {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem('lse_history_colors', JSON.stringify(historyColors.value))
  } catch {}
}

const addColorToHistory = (hexColor: string) => {
  const clean = (hexColor || '').trim().toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(clean)) return

  // 若已存在，先移除旧位置移到最前
  const existingIdx = historyColors.value.indexOf(clean)
  if (existingIdx !== -1) {
    historyColors.value.splice(existingIdx, 1)
  }
  historyColors.value.unshift(clean)
  if (historyColors.value.length > 15) {
    historyColors.value.pop()
  }
  saveHistoryColors()
}

const removeHistoryColor = (idx: number, e: Event) => {
  e.stopPropagation()
  historyColors.value.splice(idx, 1)
  saveHistoryColors()
}

const clearHistoryColors = () => {
  historyColors.value = []
  saveHistoryColors()
}

const addHexToHistory = () => {
  const clean = (displayHex.value || '').trim().replace(/^#/, '')
  if (/^[0-9A-Fa-f]{6}$/.test(clean)) {
    const hex = '#' + clean.toLowerCase()
    setColor(hex)
    addColorToHistory(hex)
  } else {
    addColorToHistory(currentColor.value)
  }
}

const addRgbToHistory = () => {
  const parsed = parseRgbString(displayRgb.value)
  if (parsed) {
    const hex = rgbToHex(parsed.r, parsed.g, parsed.b)
    setColor(hex)
    addColorToHistory(hex)
  } else {
    addColorToHistory(currentColor.value)
  }
}

// -------------------------------------------------------------
// 吸色工具
// -------------------------------------------------------------
const applyPickedColor = (color: string) => {
  setColor(color)
  addColorToHistory(color)
}

const pickScreenColor = async () => {
  if (typeof window !== 'undefined' && 'EyeDropper' in window) {
    try {
      const eyeDropper = new (window as any).EyeDropper()
      const result = await eyeDropper.open()
      if (result?.sRGBHex) {
        applyPickedColor(result.sRGBHex)
      }
    } catch {}
  } else {
    fallbackInputRef.value?.click()
  }
}

// -------------------------------------------------------------
// HEX 文本框双向同步
// -------------------------------------------------------------
const hexInputVal = ref('')
const isHexFocused = ref(false)

const displayHex = computed(() => {
  if (isHexFocused.value) return hexInputVal.value
  return currentColor.value.replace(/^#/, '').toUpperCase()
})

const onHexFocus = () => {
  isHexFocused.value = true
  hexInputVal.value = currentColor.value.replace(/^#/, '').toUpperCase()
}

const onHexBlur = () => {
  isHexFocused.value = false
  const clean = hexInputVal.value.trim().replace(/^#/, '')
  if (/^[0-9A-Fa-f]{6}$/.test(clean)) {
    setColor('#' + clean)
  }
}

const onHexInput = (e: Event) => {
  const target = e.target as HTMLInputElement
  const raw = target.value.trim().replace(/^#/, '')
  hexInputVal.value = raw
  if (/^[0-9A-Fa-f]{6}$/.test(raw)) {
    setColor('#' + raw)
  }
}

const onHexKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    (e.target as HTMLInputElement).blur()
  }
}

// -------------------------------------------------------------
// RGB 数值输入框双向同步
// -------------------------------------------------------------
const rgbInputVal = ref('')
const isRgbFocused = ref(false)

const currentRgbObj = computed(() => {
  return hexToRgb(currentColor.value)
})

const displayRgb = computed(() => {
  if (isRgbFocused.value) return rgbInputVal.value
  const rgb = currentRgbObj.value
  return `${rgb.r}, ${rgb.g}, ${rgb.b}`
})

const onRgbFocus = () => {
  isRgbFocused.value = true
  const rgb = currentRgbObj.value
  rgbInputVal.value = `${rgb.r}, ${rgb.g}, ${rgb.b}`
}

const parseRgbString = (val: string): { r: number; g: number; b: number } | null => {
  const parts = val.replace(/[^0-9,\s]/g, '').trim().split(/[,\s]+/).filter(Boolean)
  const [rPart, gPart, bPart] = parts
  if (rPart && gPart && bPart) {
    const r = Math.max(0, Math.min(255, parseInt(rPart, 10)))
    const g = Math.max(0, Math.min(255, parseInt(gPart, 10)))
    const b = Math.max(0, Math.min(255, parseInt(bPart, 10)))
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      return { r, g, b }
    }
  }
  return null
}

const onRgbBlur = () => {
  isRgbFocused.value = false
  const parsed = parseRgbString(rgbInputVal.value)
  if (parsed) {
    setColor(rgbToHex(parsed.r, parsed.g, parsed.b))
  }
}

const onRgbInput = (e: Event) => {
  const target = e.target as HTMLInputElement
  rgbInputVal.value = target.value
  const parsed = parseRgbString(target.value)
  if (parsed) {
    setColor(rgbToHex(parsed.r, parsed.g, parsed.b))
  }
}

const onRgbKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    (e.target as HTMLInputElement).blur()
  }
}

// -------------------------------------------------------------
// 重复次数与周期时长控制 (可直接输入，也可微调)
// -------------------------------------------------------------
const repeatInputVal = ref('')
const isRepeatFocused = ref(false)

const displayRepeat = computed(() => {
  if (isRepeatFocused.value) return repeatInputVal.value
  return currentRepeat.value.toString()
})

const onRepeatFocus = () => {
  isRepeatFocused.value = true
  repeatInputVal.value = currentRepeat.value.toString()
}

const onRepeatBlur = () => {
  isRepeatFocused.value = false
  let val = parseInt(repeatInputVal.value, 10)
  if (isNaN(val) || val < 1) val = 1
  if (val > 99) val = 99
  if (activePreset.value) {
    updatePresetEffect(activePreset.value.id, { repeat: val })
  }
}

const onRepeatInput = (e: Event) => {
  const target = e.target as HTMLInputElement
  repeatInputVal.value = target.value
  const val = parseInt(target.value, 10)
  if (!isNaN(val) && val >= 1 && val <= 99 && activePreset.value) {
    updatePresetEffect(activePreset.value.id, { repeat: val })
  }
}

const onRepeatKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    (e.target as HTMLInputElement).blur()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    changeRepeat(1)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    changeRepeat(-1)
  }
}

const durationInputVal = ref('')
const isDurationFocused = ref(false)

const displayDuration = computed(() => {
  if (isDurationFocused.value) return durationInputVal.value
  return currentDuration.value.toString()
})

const onDurationFocus = () => {
  isDurationFocused.value = true
  durationInputVal.value = currentDuration.value.toString()
}

const onDurationBlur = () => {
  isDurationFocused.value = false
  let val = parseInt(durationInputVal.value, 10)
  if (isNaN(val) || val < 50) val = 50
  if (val > 20000) val = 20000
  if (activePreset.value) {
    updatePresetEffect(activePreset.value.id, { duration: val })
  }
}

const onDurationInput = (e: Event) => {
  const target = e.target as HTMLInputElement
  durationInputVal.value = target.value
  const val = parseInt(target.value, 10)
  if (!isNaN(val) && val >= 50 && val <= 20000 && activePreset.value) {
    updatePresetEffect(activePreset.value.id, { duration: val })
  }
}

const onDurationKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    (e.target as HTMLInputElement).blur()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    changeDuration(50)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    changeDuration(-50)
  }
}

const changeRepeat = (delta: number) => {
  if (!activePreset.value) return
  let next = currentRepeat.value + delta
  if (next < 1) next = 1
  if (next > 99) next = 99
  updatePresetEffect(activePreset.value.id, { repeat: next })
  if (isRepeatFocused.value) {
    repeatInputVal.value = next.toString()
  }
}

const changeDuration = (deltaMs: number) => {
  if (!activePreset.value) return
  const next = Math.max(50, Math.min(20000, currentDuration.value + deltaMs))
  updatePresetEffect(activePreset.value.id, { duration: next })
  if (isDurationFocused.value) {
    durationInputVal.value = next.toString()
  }
}

// -------------------------------------------------------------
// 双曲线叠加画框 (亮度曲线 + 颜色曲线在同一个坐标系叠加)
// -------------------------------------------------------------
const curveCanvasRef = ref<HTMLCanvasElement | null>(null)
const canvasViewportRef = ref<HTMLDivElement | null>(null)

// 曲线内边距
const padLeft = 38
const padRight = 16
const padTop = 16
const padBottom = 24

// 正在拖拽的节点信息
const activeDragPoint = ref<{ type: 'brightness' | 'color', index: number } | null>(null)
const hoveredPoint = ref<{ type: 'brightness' | 'color', index: number } | null>(null)

// 坐标映射
const toScreenX = (nx: number, w: number) => {
  const innerW = Math.max(10, w - padLeft - padRight)
  return padLeft + nx * innerW
}

const toScreenY = (ny: number, h: number) => {
  const innerH = Math.max(10, h - padTop - padBottom)
  return padTop + (1 - ny) * innerH
}

const toNormX = (sx: number, w: number) => {
  const innerW = Math.max(10, w - padLeft - padRight)
  return Math.max(0, Math.min(1, (sx - padLeft) / innerW))
}

const toNormY = (sy: number, h: number) => {
  const innerH = Math.max(10, h - padTop - padBottom)
  return Math.max(0, Math.min(1, 1 - (sy - padTop) / innerH))
}

// 线性折线插值求值 (点与点之间直线相连，不进行平滑连接)
const evaluateCurveY = (nx: number, pts: Array<{ x: number, y: number }>): number => {
  if (pts.length === 0) return 0.5
  const firstPoint = pts[0]
  if (!firstPoint) return 0.5
  if (pts.length === 1) return firstPoint.y
  if (nx <= firstPoint.x) return firstPoint.y

  const lastPoint = pts[pts.length - 1]
  if (!lastPoint) return firstPoint.y
  if (nx >= lastPoint.x) return lastPoint.y

  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]
    const p2 = pts[i + 1]
    if (!p1 || !p2) continue

    if (nx >= p1.x && nx <= p2.x) {
      if (p2.x === p1.x) return p1.y
      const t = (nx - p1.x) / (p2.x - p1.x)
      return p1.y + t * (p2.y - p1.y)
    }
  }
  return lastPoint.y
}

// 主题色常量 (亮度曲线)
const THEME_CURVE_COLOR = '#a8c7fa'

// 绘制双曲线主画布 (亮度曲线与颜色曲线直接叠加在同一个画框内)
const drawCurve = () => {
  const canvas = curveCanvasRef.value
  const viewport = canvasViewportRef.value
  if (!canvas || !viewport) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const rect = viewport.getBoundingClientRect()
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const w = rect.width
  const h = rect.height

  if (w <= 0 || h <= 0) return

  canvas.width = w * dpr
  canvas.height = h * dpr
  ctx.resetTransform()
  ctx.scale(dpr, dpr)

  const innerW = w - padLeft - padRight
  const innerH = h - padTop - padBottom

  // 1. 背景底色 (深黑工程底色)
  ctx.fillStyle = '#13161c'
  ctx.fillRect(0, 0, w, h)

  // 2. 绘制工程坐标网格与标尺
  const yDivisions = [0, 0.25, 0.5, 0.75, 1.0]
  ctx.font = '9px "Google Sans", sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'

  for (const ny of yDivisions) {
    const sy = toScreenY(ny, h)
    ctx.beginPath()
    ctx.moveTo(padLeft, sy)
    ctx.lineTo(padLeft + innerW, sy)
    if (ny === 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
      ctx.lineWidth = 1.5
    } else if (ny === 1.0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
      ctx.lineWidth = 1
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
      ctx.lineWidth = 1
    }
    ctx.stroke()

    // 刻度文字 (0% ~ 100%)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
    ctx.fillText(`${Math.round(ny * 100)}%`, padLeft - 6, sy)
  }

  // 垂直时间刻度线
  const durMs = currentDuration.value
  const xDivisions = [0, 0.25, 0.5, 0.75, 1.0]
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  for (const nx of xDivisions) {
    const sx = toScreenX(nx, w)
    ctx.beginPath()
    ctx.moveTo(sx, padTop)
    ctx.lineTo(sx, padTop + innerH)
    ctx.strokeStyle = nx === 0 || nx === 1.0 ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.06)'
    ctx.lineWidth = 1
    ctx.stroke()

    // 时间刻度文字
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
    const timeLabel = Math.round(nx * durMs) + 'ms'
    ctx.fillText(timeLabel, sx, padTop + innerH + 5)
  }

  const bPts = currentPoints.value
  const cPts = currentColorPoints.value
  const samples = Math.max(120, Math.floor(innerW))
  const sampleStep = 1 / samples

  // -----------------------------------------------------------
  // 3. 绘制亮度曲线 (Theme Curve, 折线连接，不平滑)
  // -----------------------------------------------------------
  const isBrightnessActive = activeCurveType.value === 'brightness'

  // 亮度曲线下方填充
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(toScreenX(0, w), toScreenY(0, h))
  ctx.lineTo(toScreenX(0, w), toScreenY(evaluateCurveY(0, bPts), h))
  for (const p of bPts) {
    ctx.lineTo(toScreenX(p.x, w), toScreenY(p.y, h))
  }
  ctx.lineTo(toScreenX(1, w), toScreenY(evaluateCurveY(1, bPts), h))
  ctx.lineTo(toScreenX(1, w), toScreenY(0, h))
  ctx.closePath()
  ctx.fillStyle = isBrightnessActive ? 'rgba(168, 199, 250, 0.12)' : 'rgba(168, 199, 250, 0.02)'
  ctx.fill()
  ctx.restore()

  // 亮度曲线线条 (直线段相连，不平滑；选中高亮时加粗发光，非选中时淡化弱化)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(toScreenX(0, w), toScreenY(evaluateCurveY(0, bPts), h))
  for (const p of bPts) {
    ctx.lineTo(toScreenX(p.x, w), toScreenY(p.y, h))
  }
  ctx.lineTo(toScreenX(1, w), toScreenY(evaluateCurveY(1, bPts), h))
  ctx.strokeStyle = isBrightnessActive ? THEME_CURVE_COLOR : 'rgba(168, 199, 250, 0.35)'
  ctx.lineWidth = isBrightnessActive ? 2.5 : 1.4
  ctx.globalAlpha = isBrightnessActive ? 1.0 : 0.38
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (isBrightnessActive) {
    ctx.shadowColor = 'rgba(168, 199, 250, 0.45)'
    ctx.shadowBlur = 6
  }
  ctx.stroke()
  ctx.restore()

  // 亮度曲线控制节点
  for (let i = 0; i < bPts.length; i++) {
    const p = bPts[i]
    if (!p) continue

    const sx = toScreenX(p.x, w)
    const sy = toScreenY(p.y, h)
    const isHovered = isBrightnessActive && hoveredPoint.value?.type === 'brightness' && hoveredPoint.value.index === i
    const isDragging = isBrightnessActive && activeDragPoint.value?.type === 'brightness' && activeDragPoint.value.index === i

    ctx.save()
    ctx.globalAlpha = isBrightnessActive ? 1.0 : 0.38
    ctx.beginPath()
    const radius = isDragging ? 5.5 : (isHovered ? 5 : (isBrightnessActive ? 3.8 : 2.6))
    ctx.arc(sx, sy, radius, 0, Math.PI * 2)
    ctx.fillStyle = isHovered || isDragging ? '#ffffff' : (isBrightnessActive ? THEME_CURVE_COLOR : 'rgba(168, 199, 250, 0.6)')
    ctx.fill()
    ctx.lineWidth = isBrightnessActive ? 1.6 : 1.0
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    ctx.restore()
  }

  // -----------------------------------------------------------
  // 4. 绘制颜色曲线 (Color Curve, 折线连接，不平滑)
  // -----------------------------------------------------------
  const isColorActive = activeCurveType.value === 'color'

  // 创建横跨颜色曲线的连续彩色渐变笔刷 (依 Y 轴色彩程度计算描边明暗)
  const colorGrad = ctx.createLinearGradient(padLeft, 0, padLeft + innerW, 0)
  for (const cp of cPts) {
    const nodeRgb = hexToRgb(cp.color)
    const degree = typeof cp.y === 'number' ? Math.max(0, Math.min(1, cp.y)) : 1.0
    const gradColor = rgbToHex(
      Math.round(nodeRgb.r * degree),
      Math.round(nodeRgb.g * degree),
      Math.round(nodeRgb.b * degree)
    )
    colorGrad.addColorStop(Math.max(0, Math.min(1, cp.x)), gradColor)
  }

  // 颜色曲线下方微量彩色填充
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(toScreenX(0, w), toScreenY(0, h))
  ctx.lineTo(toScreenX(0, w), toScreenY(evaluateCurveY(0, cPts), h))
  for (const cp of cPts) {
    ctx.lineTo(toScreenX(cp.x, w), toScreenY(cp.y, h))
  }
  ctx.lineTo(toScreenX(1, w), toScreenY(evaluateCurveY(1, cPts), h))
  ctx.lineTo(toScreenX(1, w), toScreenY(0, h))
  ctx.closePath()
  ctx.fillStyle = isColorActive ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.015)'
  ctx.fill()
  ctx.restore()

  // 颜色曲线主线条 (全彩渐变色折线描边，直线相连，不平滑；选中高亮时加粗发光，非选中时淡化弱化)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(toScreenX(0, w), toScreenY(evaluateCurveY(0, cPts), h))
  for (const cp of cPts) {
    ctx.lineTo(toScreenX(cp.x, w), toScreenY(cp.y, h))
  }
  ctx.lineTo(toScreenX(1, w), toScreenY(evaluateCurveY(1, cPts), h))
  ctx.strokeStyle = colorGrad
  ctx.lineWidth = isColorActive ? 3.0 : 1.5
  ctx.globalAlpha = isColorActive ? 1.0 : 0.35
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (isColorActive) {
    ctx.shadowColor = 'rgba(255, 255, 255, 0.3)'
    ctx.shadowBlur = 6
  }
  ctx.stroke()
  ctx.restore()

  // 颜色曲线节点
  for (let i = 0; i < cPts.length; i++) {
    const cp = cPts[i]
    if (!cp) continue

    const sx = toScreenX(cp.x, w)
    const sy = toScreenY(cp.y, h)
    const isSelected = isColorActive && selectedColorNodeIndex.value === i
    const isHovered = isColorActive && hoveredPoint.value?.type === 'color' && hoveredPoint.value.index === i
    const isDragging = isColorActive && activeDragPoint.value?.type === 'color' && activeDragPoint.value.index === i

    ctx.save()
    ctx.globalAlpha = isColorActive ? 1.0 : 0.35

    // 选中光环 (仅当处于激活状态时)
    if (isSelected || isDragging) {
      ctx.beginPath()
      ctx.arc(sx, sy, 9, 0, Math.PI * 2)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2.0
      ctx.stroke()
    }

    // 节点实心彩色圆球
    ctx.beginPath()
    const radius = isColorActive
      ? (isSelected || isDragging ? 6.5 : (isHovered ? 6 : 4.8))
      : 3.2
    ctx.arc(sx, sy, radius, 0, Math.PI * 2)
    const nodeRgb = hexToRgb(cp.color)
    const degree = typeof cp.y === 'number' ? Math.max(0, Math.min(1, cp.y)) : 1.0
    ctx.fillStyle = rgbToHex(
      Math.round(nodeRgb.r * degree),
      Math.round(nodeRgb.g * degree),
      Math.round(nodeRgb.b * degree)
    )
    ctx.fill()
    ctx.lineWidth = isColorActive ? 1.8 : 1.0
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()

    ctx.restore()
  }

  // -----------------------------------------------------------
  // 5. 预览播放进度填充 (自左向右淡主题色填充，带进出平滑渐变动画)
  // -----------------------------------------------------------
  const renderScanFill = (prog: number, alpha: number) => {
    if (alpha <= 0 || prog <= 0) return
    const scanX = toScreenX(prog, w)
    if (scanX <= padLeft) return

    ctx.save()
    ctx.beginPath()
    ctx.rect(padLeft, padTop, innerW, innerH)
    ctx.clip()

    const a0 = (0.04 * alpha).toFixed(4)
    const a1 = (0.14 * alpha).toFixed(4)
    const fillGrad = ctx.createLinearGradient(padLeft, 0, scanX, 0)
    fillGrad.addColorStop(0, `rgba(168, 199, 250, ${a0})`)
    fillGrad.addColorStop(1, `rgba(168, 199, 250, ${a1})`)
    ctx.fillStyle = fillGrad
    ctx.fillRect(padLeft, padTop, scanX - padLeft, innerH)
    ctx.restore()
  }

  // 1) 绘制正在渐变消退的历史填充层 (重复按下发送时，前一个填充带平滑渐变消失动画)
  for (const f of fadingFills.value) {
    renderScanFill(f.progress, f.alpha)
  }

  // 2) 绘制当前正在进行的扫描填充
  if (fillAlpha.value > 0 && (isPlaying.value || playProgress.value > 0)) {
    renderScanFill(playProgress.value, fillAlpha.value)
  }
}

// 根据 X 进度获取无程度加权的基底色彩
const getBaseColorAtX = (colorPoints: PresetColorPoint[], x: number, fallback: string): string => {
  if (!colorPoints || colorPoints.length === 0) return fallback
  if (colorPoints.length === 1) return colorPoints[0]?.color ?? fallback
  const sorted = [...colorPoints].sort((a, b) => a.x - b.x)
  const firstPoint = sorted[0]
  const lastPoint = sorted[sorted.length - 1]
  if (!firstPoint || !lastPoint) return fallback
  if (x <= firstPoint.x) return firstPoint.color
  if (x >= lastPoint.x) return lastPoint.color

  for (let i = 0; i < sorted.length - 1; i++) {
    const cp1 = sorted[i]
    const cp2 = sorted[i + 1]
    if (!cp1 || !cp2) continue

    if (x >= cp1.x && x <= cp2.x) {
      const span = cp2.x - cp1.x
      if (span <= 0.0001) return cp1.color
      const t = (x - cp1.x) / span
      const rgb1 = hexToRgb(cp1.color)
      const rgb2 = hexToRgb(cp2.color)
      const r = Math.round(rgb1.r + t * (rgb2.r - rgb1.r))
      const g = Math.round(rgb1.g + t * (rgb2.g - rgb1.g))
      const b = Math.round(rgb1.b + t * (rgb2.b - rgb1.b))
      return rgbToHex(r, g, b)
    }
  }
  return fallback
}

// -------------------------------------------------------------
// 曲线画框鼠标交互 (智能感应双曲线节点与点击空白加点)
// -------------------------------------------------------------
// 仅在当前选中的曲线类型中查找命中节点（选择哪条曲线，就仅可修改对应的曲线）
const findNearNode = (sx: number, sy: number, w: number, h: number, threshold = 14) => {
  if (activeCurveType.value === 'color') {
    const cPts = currentColorPoints.value
    for (let i = 0; i < cPts.length; i++) {
      const point = cPts[i]
      if (!point) continue

      const px = toScreenX(point.x, w)
      const py = toScreenY(point.y, h)
      if (Math.hypot(px - sx, py - sy) <= threshold) {
        return { type: 'color' as const, index: i }
      }
    }
  } else {
    const bPts = currentPoints.value
    for (let i = 0; i < bPts.length; i++) {
      const point = bPts[i]
      if (!point) continue

      const px = toScreenX(point.x, w)
      const py = toScreenY(point.y, h)
      if (Math.hypot(px - sx, py - sy) <= threshold) {
        return { type: 'brightness' as const, index: i }
      }
    }
  }
  return null
}

const stopCanvasDrag = () => {
  activeDragPoint.value = null
  if (typeof window !== 'undefined') {
    window.removeEventListener('pointermove', onGlobalPointerMove)
    window.removeEventListener('pointerup', onGlobalPointerUp)
    window.removeEventListener('pointercancel', onGlobalPointerUp)
    window.removeEventListener('blur', stopCanvasDrag)
  }
  drawCurve()
}

const onGlobalPointerMove = (e: PointerEvent) => {
  if (e.buttons === 0) {
    stopCanvasDrag()
    return
  }
  onCanvasPointerMove(e)
}

const onGlobalPointerUp = (e: PointerEvent) => {
  try {
    ;(e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId)
  } catch {}
  stopCanvasDrag()
}

const onCanvasPointerDown = (e: PointerEvent) => {
  if (e.button !== 0) return // 只响应鼠标主键 (左键)
  const viewport = canvasViewportRef.value
  if (!viewport || !activePreset.value) return
  const rect = viewport.getBoundingClientRect()
  const sx = e.clientX - rect.left
  const sy = e.clientY - rect.top
  const w = rect.width
  const h = rect.height

  try {
    ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
  } catch {}

  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', onGlobalPointerMove)
    window.addEventListener('pointerup', onGlobalPointerUp)
    window.addEventListener('pointercancel', onGlobalPointerUp)
    window.addEventListener('blur', stopCanvasDrag)
  }

  const hit = findNearNode(sx, sy, w, h)

  // 1. 鼠标选择模式 (默认安全模式：仅查看与选中节点，严禁修改曲线，避免误操作)
  if (activeEditTool.value === 'pointer') {
    if (hit) {
      if (hit.type === 'color') {
        selectedColorNodeIndex.value = hit.index
      } else {
        selectedColorNodeIndex.value = null
      }
    } else {
      selectedColorNodeIndex.value = null
    }
    drawCurve()
    return
  }

  // 2. 笔/调节模式 (只允许拖拽调整已有节点，禁止点击空白处新增节点)
  if (activeEditTool.value === 'pen') {
    if (hit) {
      activeDragPoint.value = hit
      if (hit.type === 'color') {
        selectedColorNodeIndex.value = hit.index
      } else {
        selectedColorNodeIndex.value = null
      }
      drawCurve()
    }
    return
  }

  // 3. 添加节点模式 (点击曲线空白处新增关键节点)
  if (activeEditTool.value === 'add') {
    if (hit) {
      // 若正好点击在现有节点上，选中并允许直接微调
      activeDragPoint.value = hit
      if (hit.type === 'color') {
        selectedColorNodeIndex.value = hit.index
      }
      drawCurve()
      return
    }

    const nx = toNormX(sx, w)
    const ny = toNormY(sy, h)

    if (activeCurveType.value === 'brightness') {
      const newPts = [...currentPoints.value, { x: nx, y: ny }].sort((a, b) => a.x - b.x)
      updatePresetEffect(activePreset.value.id, { points: newPts })
      const idx = newPts.findIndex(p => Math.abs(p.x - nx) < 0.001 && Math.abs(p.y - ny) < 0.001)
      activeDragPoint.value = { type: 'brightness', index: idx }
      drawCurve()
    } else {
      const baseHex = getBaseColorAtX(currentColorPoints.value, nx, currentColor.value)
      const newPts = [...currentColorPoints.value, { x: nx, y: ny, color: baseHex }].sort((a, b) => a.x - b.x)
      updatePresetEffect(activePreset.value.id, { colorPoints: newPts })
      const idx = newPts.findIndex(p => Math.abs(p.x - nx) < 0.001)
      selectedColorNodeIndex.value = idx
      activeDragPoint.value = { type: 'color', index: idx }
      drawCurve()
    }
    return
  }

  // 4. 删除节点模式 (点击中间关键节点直接删除)
  if (activeEditTool.value === 'delete') {
    if (hit) {
      if (hit.type === 'brightness') {
        const pts = [...currentPoints.value]
        if (pts.length > 2 && hit.index > 0 && hit.index < pts.length - 1) {
          pts.splice(hit.index, 1)
          updatePresetEffect(activePreset.value.id, { points: pts })
          drawCurve()
        }
      } else {
        const pts = [...currentColorPoints.value]
        if (pts.length > 2 && hit.index > 0 && hit.index < pts.length - 1) {
          pts.splice(hit.index, 1)
          selectedColorNodeIndex.value = null
          updatePresetEffect(activePreset.value.id, { colorPoints: pts })
          drawCurve()
        }
      }
    }
  }
}

const onCanvasPointerMove = (e: PointerEvent) => {
  // 如果处于拖拽状态但鼠标按键已松开，彻底终止拖拽，杜绝粘连
  if (activeDragPoint.value !== null && e.buttons === 0) {
    stopCanvasDrag()
    return
  }

  const viewport = canvasViewportRef.value
  if (!viewport || !activePreset.value) return
  const rect = viewport.getBoundingClientRect()
  const sx = e.clientX - rect.left
  const sy = e.clientY - rect.top
  const w = rect.width
  const h = rect.height

  // 仅在笔或添加模式下才响应拖拽位移；鼠标与删除模式严禁拖动节点
  if (activeDragPoint.value !== null && (activeEditTool.value === 'pen' || activeEditTool.value === 'add')) {
    const nx = toNormX(sx, w)
    const ny = toNormY(sy, h)

    if (activeDragPoint.value.type === 'brightness') {
      const pts = [...currentPoints.value]
      const idx = activeDragPoint.value.index
      const point = pts[idx]
      if (!point) return

      point.y = ny
      if (idx > 0 && idx < pts.length - 1) {
        const previousPoint = pts[idx - 1]
        const nextPoint = pts[idx + 1]
        if (previousPoint && nextPoint) {
          point.x = Math.max(previousPoint.x + 0.01, Math.min(nextPoint.x - 0.01, nx))
        }
      }
      updatePresetEffect(activePreset.value.id, { points: pts })
      drawCurve()
    } else {
      const pts = [...currentColorPoints.value]
      const idx = activeDragPoint.value.index
      const point = pts[idx]
      if (!point) return

      point.y = ny
      if (idx > 0 && idx < pts.length - 1) {
        const previousPoint = pts[idx - 1]
        const nextPoint = pts[idx + 1]
        if (previousPoint && nextPoint) {
          point.x = Math.max(previousPoint.x + 0.01, Math.min(nextPoint.x - 0.01, nx))
        }
      }
      updatePresetEffect(activePreset.value.id, { colorPoints: pts })
      drawCurve()
    }
  } else {
    hoveredPoint.value = findNearNode(sx, sy, w, h)
    drawCurve()
  }
}

const onCanvasPointerUp = (e: PointerEvent) => {
  try {
    ;(e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId)
  } catch {}
  stopCanvasDrag()
}

const onCanvasDblClick = (e: MouseEvent) => {
  // 仅在删除工具激活时允许删除节点，避免误操作
  if (activeEditTool.value !== 'delete') return

  const viewport = canvasViewportRef.value
  if (!viewport || !activePreset.value) return
  const rect = viewport.getBoundingClientRect()
  const sx = e.clientX - rect.left
  const sy = e.clientY - rect.top
  const hit = findNearNode(sx, sy, rect.width, rect.height)
  if (hit !== null) {
    if (hit.type === 'brightness') {
      const pts = [...currentPoints.value]
      if (pts.length > 2 && hit.index > 0 && hit.index < pts.length - 1) {
        pts.splice(hit.index, 1)
        updatePresetEffect(activePreset.value.id, { points: pts })
        drawCurve()
      }
    } else {
      const pts = [...currentColorPoints.value]
      if (pts.length > 2 && hit.index > 0 && hit.index < pts.length - 1) {
        pts.splice(hit.index, 1)
        selectedColorNodeIndex.value = null
        updatePresetEffect(activePreset.value.id, { colorPoints: pts })
        drawCurve()
      }
    }
  }
}

const onCanvasContextMenu = (e: MouseEvent) => {
  e.preventDefault()
  if (activeEditTool.value !== 'pointer') {
    onCanvasDblClick(e)
  }
}

// -------------------------------------------------------------
// 曲线模板管理系统 (无预设模板，仅针对当前选中滑块生效)
// -------------------------------------------------------------
interface CurveTemplate {
  id: string
  name: string
  type: 'brightness' | 'color'
  points?: PresetPoint[]
  colorPoints?: PresetColorPoint[]
}

const curveTemplates = useState<CurveTemplate[]>('design_curve_templates', () => [])

// 仅获取当前选中滑块类型所对应的模板列表
const activeCurveTemplates = computed(() => {
  return curveTemplates.value.filter(t => {
    const tType = t.type || (t.colorPoints && t.colorPoints.length > 0 ? 'color' : 'brightness')
    return tType === activeCurveType.value
  })
})

const loadCurveTemplates = () => {
  if (curveTemplates.value.length > 0) return
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem('lse_curve_templates')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        curveTemplates.value = parsed
        return
      }
    }
  } catch {}
  curveTemplates.value = []
}

const saveCurveTemplates = () => {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem('lse_curve_templates', JSON.stringify(curveTemplates.value))
  } catch {}
}

const addCurrentCurveAsTemplate = () => {
  if (!activePreset.value) return
  const isBrightness = activeCurveType.value === 'brightness'
  const sameTypeCount = activeCurveTemplates.value.length + 1
  const name = isBrightness ? `亮度 ${sameTypeCount}` : `色彩 ${sameTypeCount}`

  const newTmpl: CurveTemplate = {
    id: 'tmpl-' + Date.now(),
    name,
    type: activeCurveType.value,
    points: isBrightness ? currentPoints.value.map(p => ({ ...p })) : undefined,
    colorPoints: !isBrightness
      ? currentColorPoints.value.map(cp => normalizeColorPoint(cp, currentColor.value))
      : undefined
  }

  curveTemplates.value.push(newTmpl)
  saveCurveTemplates()
}

const applyCurveTemplate = (tmpl: CurveTemplate) => {
  if (!activePreset.value) return

  // 仅针对当前选中滑块类型的曲线生效
  if (activeCurveType.value === 'brightness') {
    if (tmpl.points && tmpl.points.length > 0) {
      updatePresetEffect(activePreset.value.id, {
        points: tmpl.points.map(p => ({ ...p }))
      })
    }
  } else if (activeCurveType.value === 'color') {
    if (tmpl.colorPoints && tmpl.colorPoints.length > 0) {
      updatePresetEffect(activePreset.value.id, {
        colorPoints: tmpl.colorPoints.map(cp => normalizeColorPoint(cp, currentColor.value))
      })
    }
  }

  drawCurve()
}

const removeCurveTemplate = (id: string, e: Event) => {
  e.stopPropagation()
  if (editingTemplateId.value === id) {
    editingTemplateId.value = null
  }
  curveTemplates.value = curveTemplates.value.filter(t => t.id !== id)
  saveCurveTemplates()
}

// 自定义模板双击重命名
const editingTemplateId = ref<string | null>(null)
const editingTemplateName = ref('')
const templateEditInputRef = ref<HTMLInputElement | null>(null)

const startEditTemplate = (tmpl: CurveTemplate) => {
  editingTemplateId.value = tmpl.id
  editingTemplateName.value = tmpl.name
  nextTick(() => {
    templateEditInputRef.value?.focus()
    templateEditInputRef.value?.select()
  })
}

const saveEditTemplate = (tmpl: CurveTemplate) => {
  if (editingTemplateId.value !== tmpl.id) return
  const trimmed = editingTemplateName.value.trim()
  if (trimmed) {
    tmpl.name = trimmed
    saveCurveTemplates()
  }
  editingTemplateId.value = null
}

const cancelEditTemplate = () => {
  editingTemplateId.value = null
}

// -------------------------------------------------------------
// 预览播放循环联动 (支持进入与退出平滑渐变动画)
// -------------------------------------------------------------
let playRafId: number | null = null
let playStartTime = 0
let lastLoopTime = 0
let playbackPausedAt = 0
let handledPlaySeekVersion = playSeekVersion.value

// 预设效果预览色块更新 (纯净色块实时呈现当前预设的亮度曲线与颜色曲线合成光效)
const updatePreviewSquare = () => {
  if (!previewBoxRef.value) return

  if (isPlaying.value || fillAlpha.value > 0) {
    const prog = playProgress.value
    const brightness = sampleCurveBrightness(currentPoints.value, prog)
    const rgb = sampleCurveColor(currentColorPoints.value, prog, currentColor.value)
    const factor = isPlaying.value ? 1 : fillAlpha.value

    const r = Math.max(0, Math.min(255, Math.round(rgb.r * brightness * factor)))
    const g = Math.max(0, Math.min(255, Math.round(rgb.g * brightness * factor)))
    const b = Math.max(0, Math.min(255, Math.round(rgb.b * brightness * factor)))

    previewBoxRef.value.style.backgroundColor = `rgb(${r}, ${g}, ${b})`
  } else {
    previewBoxRef.value.style.backgroundColor = '#000000'
  }
}

const runPlayLoop = (timestamp: number) => {
  if (!lastLoopTime) lastLoopTime = timestamp
  const deltaMs = Math.min(100, timestamp - lastLoopTime)
  lastLoopTime = timestamp

  // 更新所有消退历史填充层的透明度 (与播放完成后动画相同: 约 220ms 平滑淡出)
  if (fadingFills.value.length > 0) {
    for (let i = fadingFills.value.length - 1; i >= 0; i--) {
      const f = fadingFills.value[i]
      if (!f) continue

      f.alpha = Math.max(0, f.alpha - deltaMs / 220)
      if (f.alpha <= 0) {
        fadingFills.value.splice(i, 1)
      }
    }
  }

  const dur = currentDuration.value
  const repeat = currentRepeat.value

  if (playSeekVersion.value !== handledPlaySeekVersion) {
    handledPlaySeekVersion = playSeekVersion.value
    playProgress.value = Math.max(0, Math.min(1, playSeekProgress.value))
    if (isPlaying.value) {
      playStartTime = timestamp - (playProgress.value * dur)
      if (isPlaybackPaused.value) {
        playbackPausedAt = performance.now()
      }
    }
  }

  if (isPlaying.value) {
    fillAlpha.value = 1

    if (!playStartTime) {
      playStartTime = timestamp - (playProgress.value * dur)
    }

    if (!isPlaybackPaused.value) {
      const elapsed = timestamp - playStartTime

      if (repeat > 0 && elapsed >= dur * repeat) {
        isPlaying.value = false
        playProgress.value = 1.0 // 保持充满状态以执行平滑退出淡出
        playStartTime = 0
      } else {
        playProgress.value = (elapsed % dur) / dur
      }
    }
  } else {
    // 退出渐变动画: 约 220ms 平滑淡出
    if (fillAlpha.value > 0) {
      fillAlpha.value = Math.max(0, fillAlpha.value - deltaMs / 220)
    }

    if (fillAlpha.value <= 0 && fadingFills.value.length === 0) {
      fillAlpha.value = 0
      playProgress.value = 0
      if (playRafId) {
        cancelAnimationFrame(playRafId)
        playRafId = null
      }
      lastLoopTime = 0
      drawCurve()
      updatePreviewSquare()
      return
    }
  }

  drawCurve()
  updatePreviewSquare()
  playRafId = requestAnimationFrame(runPlayLoop)
}

watch(
  () => isPlaybackPaused.value,
  (paused) => {
    if (paused) {
      if (isPlaying.value && playStartTime > 0) {
        playbackPausedAt = performance.now()
      }
      return
    }

    if (playbackPausedAt > 0 && playStartTime > 0) {
      playStartTime += performance.now() - playbackPausedAt
    }
    playbackPausedAt = 0
  }
)

watch(
  [() => isPlaying.value, () => playTriggerTime.value],
  ([playing]) => {
    if (playing) {
      // 连续按键按下预设/重复触发播放时，前一个扫描填充不直接消失，捕获到渐变消退列表中 (与播放完成后动画相同)
      if (playProgress.value > 0 && fillAlpha.value > 0) {
        fadingFills.value.push({
          progress: playProgress.value,
          alpha: fillAlpha.value
        })
        if (fadingFills.value.length > 6) {
          fadingFills.value.shift()
        }
      }

      playProgress.value = 0
      fillAlpha.value = 1
      playStartTime = 0
      lastLoopTime = 0
      if (playRafId) cancelAnimationFrame(playRafId)
      playRafId = requestAnimationFrame(runPlayLoop)
    } else {
      if (fillAlpha.value > 0 || fadingFills.value.length > 0) {
        // 停止时继续保持 RAF 循环以执行平滑退出渐变动画
        playStartTime = 0
        lastLoopTime = 0
        if (!playRafId) {
          playRafId = requestAnimationFrame(runPlayLoop)
        }
      } else {
        if (playRafId) {
          cancelAnimationFrame(playRafId)
          playRafId = null
        }
        playProgress.value = 0
        drawCurve()
        updatePreviewSquare()
      }
    }
  }
)

// -------------------------------------------------------------
// 生命周期与尺寸联动
// -------------------------------------------------------------
let resizeObserver: ResizeObserver | null = null
let timelineResizeObserver: ResizeObserver | null = null
let curveRevealAnimation: Animation | null = null
let curvePresetTransitionAnimation: Animation | null = null
let curvePresetTransitionLayer: HTMLCanvasElement | null = null

const observeCurveCanvas = () => {
  if (!canvasViewportRef.value || typeof ResizeObserver === 'undefined') return

  resizeObserver?.disconnect()
  resizeObserver = new ResizeObserver(() => {
    drawCurve()
  })
  resizeObserver.observe(canvasViewportRef.value)
}

const animateCurveReveal = () => {
  const canvas = curveCanvasRef.value
  if (
    !canvas ||
    disableAnimations.value ||
    typeof canvas.animate !== 'function'
  ) {
    return
  }

  curveRevealAnimation?.cancel()
  curveRevealAnimation = canvas.animate(
    [
      { opacity: 0, transform: 'scale(0.985)', transformOrigin: 'center' },
      { opacity: 1, transform: 'scale(1)', transformOrigin: 'center' }
    ],
    {
      duration: 320,
      easing: 'cubic-bezier(0.2, 0, 0, 1)'
    }
  )
}

const animateCurveTypeSwitch = () => {
  const canvas = curveCanvasRef.value
  if (
    !canvas ||
    disableAnimations.value ||
    typeof canvas.animate !== 'function'
  ) {
    return
  }

  canvas.getAnimations().forEach((animation) => {
    if (animation.id === 'curve-type-switch') {
      animation.cancel()
    }
  })
  canvas.animate(
    [
      { opacity: 0.35 },
      { opacity: 1 }
    ],
    {
      id: 'curve-type-switch',
      duration: 260,
      easing: 'cubic-bezier(0.2, 0, 0, 1)'
    }
  )
}

const removeCurvePresetTransition = () => {
  curvePresetTransitionAnimation?.cancel()
  curvePresetTransitionAnimation = null
  curvePresetTransitionLayer?.remove()
  curvePresetTransitionLayer = null
}

const captureCurveFrame = () => {
  const canvas = curveCanvasRef.value
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null

  const snapshot = document.createElement('canvas')
  snapshot.width = canvas.width
  snapshot.height = canvas.height
  const snapshotContext = snapshot.getContext('2d')
  if (!snapshotContext) return null

  snapshotContext.drawImage(canvas, 0, 0)
  return snapshot
}

const animateCurvePresetSwitch = (snapshot: HTMLCanvasElement | null) => {
  const viewport = canvasViewportRef.value
  removeCurvePresetTransition()

  if (
    !snapshot ||
    !viewport ||
    disableAnimations.value ||
    typeof snapshot.animate !== 'function'
  ) {
    return
  }

  Object.assign(snapshot.style, {
    position: 'absolute',
    top: '0',
    right: '0',
    bottom: '0',
    left: '0',
    width: '100%',
    height: '100%',
    display: 'block',
    pointerEvents: 'none',
    zIndex: '2',
    willChange: 'opacity'
  })
  viewport.appendChild(snapshot)
  curvePresetTransitionLayer = snapshot

  const animation = snapshot.animate(
    [
      { opacity: 1 },
      { opacity: 0 }
    ],
    {
      duration: 160,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      fill: 'forwards'
    }
  )
  curvePresetTransitionAnimation = animation
  animation.finished
    .then(() => {
      if (curvePresetTransitionLayer === snapshot) {
        snapshot.remove()
        curvePresetTransitionLayer = null
        curvePresetTransitionAnimation = null
      }
    })
    .catch(() => {})
}

const refreshCurveCanvas = () => {
  nextTick(() => {
    requestAnimationFrame(() => {
      if (designViewMode.value === 'timeline' || !showDesignWorkspace.value) {
        return
      }
      observeCurveCanvas()
      drawCurve()
      updatePreviewSquare()
      animateCurveReveal()
    })
  })
}

const observeTimelineViewport = () => {
  const viewport = timelineScrollRef.value
  if (!viewport) return

  timelineResizeObserver?.disconnect()
  syncTimelineViewportWidth()
  nextTick(() => {
    scheduleTimelineScrollbarUpdate()
    scheduleTimelineVerticalScrollbarUpdate()
  })

  if (typeof ResizeObserver === 'undefined') {
    scheduleTimelineThumbnailGeneration()
    scheduleTimelineWaveformDraw()
    scheduleTimelineVerticalScrollbarUpdate()
    return
  }

  timelineResizeObserver = new ResizeObserver(() => {
    const nextWidth = Math.round(viewport.clientWidth)
    if (nextWidth > 0 && nextWidth !== timelineViewportWidth.value) {
      timelineViewportWidth.value = nextWidth
    }
    scheduleTimelineWaveformDraw()
    scheduleTimelineScrollbarUpdate()
    scheduleTimelineVerticalScrollbarUpdate()
  })
  timelineResizeObserver.observe(viewport)
  if (timelineContentRef.value) {
    timelineResizeObserver.observe(timelineContentRef.value)
  }
  if (timelineTracksViewportRef.value) {
    timelineResizeObserver.observe(timelineTracksViewportRef.value)
  }
}

const restoreTimelineViewportState = () => {
  nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scroll = timelineScrollRef.value
        if (scroll) {
          scroll.scrollLeft = timelineScrollLeft.value
        }
        const tracks = timelineTracksViewportRef.value
        if (tracks) {
          tracks.scrollTop = timelineTracksScrollTop.value
        }
        scheduleTimelineScrollbarUpdate()
        scheduleTimelineVerticalScrollbarUpdate()
      })
    })
  })
}

watch(workspaceRestoreVersion, () => {
  restoreTimelineViewportState()
})

const handleDesignWorkspaceAfterEnter = () => {
  if (designViewMode.value !== 'timeline') {
    refreshCurveCanvas()
    return
  }
  if (timelineEventId.value === null) {
    return
  }
  observeTimelineViewport()
}

watch(
  () => currentColor.value,
  () => {
    drawCurve()
  },
  { immediate: true }
)

watch(
  () => activePreset.value?.id,
  (presetId, previousPresetId) => {
    const shouldAnimateCurveSwitch =
      presetId !== null &&
      previousPresetId !== null &&
      presetId !== previousPresetId
    const curveSnapshot = shouldAnimateCurveSwitch
      ? captureCurveFrame()
      : null

    selectedColorNodeIndex.value = null
    // 保留 fadingFills，连续按键切换预设时的消退动画能平滑过渡，不直接闪断消失
    nextTick(() => {
      drawCurve()
      updatePreviewSquare()
      if (shouldAnimateCurveSwitch) {
        animateDesignTargetSwitch(designViewRef.value)
        animateCurvePresetSwitch(curveSnapshot)
      } else {
        removeCurvePresetTransition()
      }
    })
  },
  { flush: 'sync' }
)

watch(selectedEventId, (eventId, previousEventId) => {
  timelineEventId.value = eventId

  if (timelineEventId.value !== null) {
    resizeObserver?.disconnect()
    resizeObserver = null
    nextTick(() => {
      if (timelineTracksViewportRef.value) {
        timelineTracksViewportRef.value.scrollTop = 0
      }
      observeTimelineViewport()
      scheduleTimelineWaveformDraw()
      scheduleTimelineVerticalScrollbarUpdate()
      if (
        designViewMode.value === 'timeline' &&
        eventId !== null &&
        previousEventId !== null &&
        eventId !== previousEventId
      ) {
        animateDesignTargetSwitch(timelineEditorRef.value)
        animateDesignTargetSwitch(timelineThumbnailStripRef.value)
        animateDesignTargetSwitch(timelineWaveformCanvasRef.value)
        animateTimelineTracksReveal()
      }
    })
    return
  }

  timelineResizeObserver?.disconnect()
  timelineResizeObserver = null
  nextTick(() => {
    drawCurve()
    updatePreviewSquare()
    observeCurveCanvas()
  })
})

watch(designViewMode, (mode, previousMode) => {
  if (mode !== 'timeline' || previousMode === 'timeline') return
  nextTick(animateTimelineTracksReveal)
}, { flush: 'post' })

// 监听滑块切换曲线类型：滑块选中对应曲线时即刻高亮对应曲线，清除节点残留拾取与悬浮态
watch(activeCurveType, () => {
  selectedColorNodeIndex.value = null
  hoveredPoint.value = null
  drawCurve()
  animateCurveTypeSwitch()
})

watch(
  () => [
    videoSrc.value,
    videoDuration.value,
    timelineThumbnailCount.value,
    timelineEventId.value,
    timelineRangeStart.value,
    timelineRangeDuration.value
  ] as const,
  ([source, duration, thumbnailCount, eventId, rangeStart, rangeDuration]) => {
    if (
      !source ||
      duration <= 0
    ) {
      clearTimelineThumbnails()
      return
    }

    if (eventId === null || rangeDuration <= 0 || rangeStart < 0) return
    if (thumbnailCount <= 0) {
      clearTimelineThumbnails()
      return
    }

    clearTimelineThumbnails()
    scheduleTimelineThumbnailGeneration()
  }
)

watch(
  [timelineRangeStart, timelineRangeDuration],
  () => {
    nextTick(() => {
      scheduleTimelineWaveformDraw()
    })
  }
)

watch(
  [timelineTrackCount, timelineTrackHeight],
  () => {
    nextTick(() => {
      scheduleTimelineVerticalScrollbarUpdate()
    })
  }
)

watch(
  [
    () => playingEventId.value,
    () => playingEventTriggerId.value,
    () => eventPlayProgress.value,
    () => videoCurrentTime.value,
    () => timelineVideoPosition.value,
    () => timelinePixelWidth.value,
    () => designViewMode.value,
    timelinePresetItems
  ],
  scheduleTimelinePlaybackProgressRender,
  { flush: 'post' }
)

watch(
  [
    () => videoSrc.value,
    () => videoDuration.value,
    () => timelineEventId.value,
    timelineRangeStart,
    timelineRangeDuration
  ],
  ([source, duration, eventId]) => {
    if (!source || duration <= 0 || eventId === null) {
      clearTimelineWaveform()
      return
    }
    clearTimelineWaveform()
    scheduleTimelineWaveformLoad()
  },
  { immediate: true }
)

onMounted(() => {
  loadHistoryColors()
  loadCurveTemplates()
  window.addEventListener('pointermove', handleTimelinePointerMove, true)
  window.addEventListener('pointerup', handleTimelinePointerUp, true)
  window.addEventListener('pointercancel', handleTimelinePointerUp, true)
  nextTick(() => {
    drawCurve()
    updatePreviewSquare()
    observeCurveCanvas()
    scheduleTimelinePlaybackProgressRender()
    if (timelineEventId.value !== null) {
      observeTimelineViewport()
    }
    restoreTimelineViewportState()
  })
  refreshCurveCanvas()
})

onUnmounted(() => {
  stopCanvasDrag()
  clearTimelineThumbnails()
  clearTimelineWaveform()
  removeCurvePresetTransition()
  window.removeEventListener('pointermove', handleTimelinePointerMove, true)
  window.removeEventListener('pointerup', handleTimelinePointerUp, true)
  window.removeEventListener('pointercancel', handleTimelinePointerUp, true)
  if (playRafId) {
    cancelAnimationFrame(playRafId)
    playRafId = null
  }
  if (timelineWaveformDrawRafId) {
    cancelAnimationFrame(timelineWaveformDrawRafId)
    timelineWaveformDrawRafId = 0
  }
  if (timelineProgressRenderRafId !== null) {
    cancelAnimationFrame(timelineProgressRenderRafId)
    timelineProgressRenderRafId = null
  }
  curveRevealAnimation?.cancel()
  curveRevealAnimation = null
  timelineClipProgressRefs.clear()
  if (timelineDropAnimationTimer) {
    clearTimeout(timelineDropAnimationTimer)
    timelineDropAnimationTimer = null
  }
  clearTimelineScrollbarHideTimer()
  clearTimelineVerticalScrollbarHideTimer()
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (timelineResizeObserver) {
    timelineResizeObserver.disconnect()
    timelineResizeObserver = null
  }
})

defineExpose({
  pickScreenColor,
  setColor
})
</script>

<template>
  <div class="design-container">
    <Transition
      name="design-workspace-fade"
      mode="out-in"
      @after-enter="handleDesignWorkspaceAfterEnter"
    >
      <!-- 没有可展示的设计目标时展示空态引导 -->
      <div v-if="!showDesignWorkspace" key="design-ready" class="design-empty-state">
      <svg class="empty-icon" viewBox="0 0 24 24" fill="currentColor">
        <path
          d="m16.24 11.51 1.57-1.57-3.75-3.75-1.57 1.57-4.14-4.13c-.78-.78-2.05-.78-2.83 0l-1.9 1.9c-.78.78-.78 2.05 0 2.83l4.13 4.13L3 17.25V21h3.75l4.76-4.76 4.13 4.13c.95.95 2.23.6 2.83 0l1.9-1.9c.78-.78.78-2.05 0-2.83l-4.13-4.13zm-7.06-.44L5.04 6.94l1.89-1.9L8.2 6.31 7.02 7.5l1.41 1.41 1.19-1.19 1.45 1.45-1.89 1.9zm7.88 7.89-4.13-4.13 1.9-1.9 1.45 1.45-1.19 1.19 1.41 1.41 1.19-1.19 1.27 1.27-1.9 1.9zm3.65-11.92a.996.996 0 0 0 0-1.41l-2.34-2.34c-.47-.47-1.12-.29-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
        />
      </svg>
      <span class="empty-title">未选中预设或事件</span>
    </div>

      <!-- 聚焦预设窗口展示曲线，聚焦事件窗口展示时间线 -->
      <div v-else key="design-workspace" class="design-workspace">
      <!-- 下半窗口：参数面板、曲线画布与事件时间线共用主区域 -->
      <div class="design-canvas-area">
        <div
          class="design-stage"
          :class="{ 'is-timeline-mode': designViewMode === 'timeline' }"
        >
        <div
          ref="designViewRef"
          class="design-view"
          :aria-hidden="designViewMode === 'timeline'"
          :inert="designViewMode === 'timeline'"
        >
      <!-- 顶部参数工具栏：快速颜色与参数控制项 -->
      <div class="design-toolbar">
        <!-- 历史颜色 -->
        <div class="history-colors-box">
          <div class="history-colors-header">
            <span class="history-title">历史颜色</span>
            <button
              class="clear-history-btn"
              :disabled="historyColors.length === 0"
              type="button"
              aria-label="一键清空历史颜色"
              @click="clearHistoryColors"
            >
              <svg class="clear-history-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
              </svg>
            </button>
          </div>
          <div v-if="historyColors.length > 0" class="history-colors-grid">
            <div
              v-for="(color, idx) in historyColors"
              :key="idx"
              class="history-color-item"
              :class="{ 'is-active': currentColor.toLowerCase() === color.toLowerCase() }"
              :style="{ backgroundColor: color }"
              @click="setColor(color)"
            >
              <button
                class="remove-history-btn"
                type="button"
                @click="removeHistoryColor(idx, $event)"
              >
                ×
              </button>
            </div>
          </div>
          <div v-else class="empty-history-box">
            <span class="empty-history-text">暂无历史颜色</span>
          </div>
        </div>

        <div class="toolbar-divider" />

        <!-- 色彩数值输入列 (十六进制上，RGB 下) -->
        <div class="color-values-col">
          <!-- HEX 文本输入行 -->
          <div class="color-input-row">
            <div class="color-val-input-wrapper hex-wrapper">
              <span
                class="color-preview-swatch"
                :style="{ backgroundColor: currentColor }"
                @click="fallbackInputRef?.click()"
              />
              <span class="color-val-prefix">#</span>
              <input
                type="text"
                class="color-val-input hex-input"
                :value="displayHex"
                maxlength="6"
                spellcheck="false"
                @focus="onHexFocus"
                @blur="onHexBlur"
                @input="onHexInput"
                @keydown="onHexKeydown"
              />
            </div>
            <button
              class="eyedropper-btn"
              type="button"
              aria-label="吸色工具"
              @click="pickScreenColor"
            >
              <svg class="eyedropper-icon" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M20.71 5.63l-2.34-2.34a.996.996 0 0 0-1.41 0l-3.12 3.12-1.93-1.91-1.41 1.41 1.42 1.42L3 16.25V21h4.75l8.92-8.92 1.42 1.42 1.41-1.41-1.92-1.92 3.12-3.12c.4-.4.4-1.03.01-1.42zM6.92 19L5 17.08l8.06-8.06 1.92 1.92L6.92 19z"
                />
              </svg>
            </button>
          </div>

          <!-- RGB 数值输入行 -->
          <div class="color-input-row">
            <div class="color-val-input-wrapper rgb-wrapper">
              <span class="color-val-prefix rgb-prefix">RGB</span>
              <input
                type="text"
                class="color-val-input rgb-input"
                :value="displayRgb"
                spellcheck="false"
                @focus="onRgbFocus"
                @blur="onRgbBlur"
                @input="onRgbInput"
                @keydown="onRgbKeydown"
              />
            </div>
            <button
              class="add-history-btn"
              type="button"
              @click="addRgbToHistory"
            >
              +
            </button>
          </div>
        </div>

        <!-- 播放参数控制列 (重复 上，周期 下，可输入与微调) -->
        <div class="playback-params-col">
          <!-- 重复次数 (可直接输入，也可微调) -->
          <div class="param-stepper-box">
            <span class="param-stepper-label">重复</span>
            <div class="stepper-controls">
              <button
                class="stepper-btn"
                type="button"
                :disabled="currentRepeat <= 1"
                @click="changeRepeat(-1)"
              >
                -
              </button>
              <input
                type="text"
                class="stepper-input"
                :value="displayRepeat"
                spellcheck="false"
                @focus="onRepeatFocus"
                @blur="onRepeatBlur"
                @input="onRepeatInput"
                @keydown="onRepeatKeydown"
              />
              <span class="stepper-unit">次</span>
              <button
                class="stepper-btn"
                type="button"
                :disabled="currentRepeat >= 99"
                @click="changeRepeat(1)"
              >
                +
              </button>
            </div>
          </div>

          <!-- 周期时长 (可直接输入，也可微调) -->
          <div class="param-stepper-box">
            <span class="param-stepper-label">周期</span>
            <div class="stepper-controls">
              <button
                class="stepper-btn"
                type="button"
                :disabled="currentDuration <= 50"
                @click="changeDuration(-50)"
              >
                -
              </button>
              <input
                type="text"
                class="stepper-input"
                :value="displayDuration"
                spellcheck="false"
                @focus="onDurationFocus"
                @blur="onDurationBlur"
                @input="onDurationInput"
                @keydown="onDurationKeydown"
              />
              <span class="stepper-unit">ms</span>
              <button
                class="stepper-btn"
                type="button"
                :disabled="currentDuration >= 20000"
                @click="changeDuration(50)"
              >
                +
              </button>
            </div>
          </div>
        </div>

        <div class="toolbar-divider" />

        <!-- 预设效果预览方块 (仅为一个颜色方块，仅预览当前预设的效果，点击预览按钮生效) -->
        <div
          ref="previewBoxRef"
          class="effect-preview-box"
          @click="togglePlay"
        />

        <!-- 降级取色器（隐藏） -->
        <input
          ref="fallbackInputRef"
          type="color"
          class="hidden-color-input"
          :value="currentColor"
          @input="applyPickedColor(($event.target as HTMLInputElement).value)"
        />
        </div>
        <!-- 曲线顶栏：曲线切换、提示与自定义曲线模版 -->
        <div class="curve-toolbar">
          <div class="tool-left-group">
            <!-- 双曲线选择切换滑块 -->
            <div class="curve-selector-group">
              <div class="curve-sel-glider" :class="activeCurveType" />
              <button
                class="curve-sel-btn"
                :class="{ 'is-active': activeCurveType === 'brightness' }"
                type="button"
                @click="activeCurveType = 'brightness'"
              >
                <span>亮度曲线</span>
              </button>
              <button
                class="curve-sel-btn"
                :class="{ 'is-active': activeCurveType === 'color' }"
                type="button"
                @click="activeCurveType = 'color'"
              >
                <span>颜色曲线</span>
              </button>
            </div>

            <!-- 曲线操作工具组 (鼠标、笔、添加、删除) -->
            <div class="curve-tools-group" role="toolbar" aria-label="曲线编辑工具">
              <button
                class="curve-tool-btn"
                :class="{ 'is-active': activeEditTool === 'pointer' }"
                type="button"
                aria-label="鼠标选择工具"
                @click="activeEditTool = 'pointer'"
              >
                <svg class="curve-tool-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 2l12 11.2-5.8.5 3.3 7.3-2.2 1-3.2-7.4L7 18.5V2z" />
                </svg>
              </button>
              <button
                class="curve-tool-btn"
                :class="{ 'is-active': activeEditTool === 'pen' }"
                type="button"
                aria-label="笔工具"
                @click="activeEditTool = 'pen'"
              >
                <svg class="curve-tool-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                </svg>
              </button>
              <button
                class="curve-tool-btn"
                :class="{ 'is-active': activeEditTool === 'add' }"
                type="button"
                aria-label="添加节点工具"
                @click="activeEditTool = 'add'"
              >
                <svg class="curve-tool-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                </svg>
              </button>
              <button
                class="curve-tool-btn"
                :class="{ 'is-active': activeEditTool === 'delete' }"
                type="button"
                aria-label="删除节点工具"
                @click="activeEditTool = 'delete'"
              >
                <svg class="curve-tool-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                </svg>
              </button>
            </div>
          </div>

          <!-- 曲线模板栏 -->
          <div class="custom-templates-group">
            <div v-if="activeCurveTemplates.length > 0" class="templates-list">
              <div
                v-for="tmpl in activeCurveTemplates"
                :key="tmpl.id"
                class="template-pill-btn"
                :class="{ 'is-editing': editingTemplateId === tmpl.id }"
                role="button"
                tabindex="0"
                @click="editingTemplateId === tmpl.id ? null : applyCurveTemplate(tmpl)"
                @dblclick.stop="startEditTemplate(tmpl)"
                @keydown.enter="editingTemplateId === tmpl.id ? null : applyCurveTemplate(tmpl)"
              >
                <template v-if="editingTemplateId === tmpl.id">
                  <input
                    ref="templateEditInputRef"
                    v-model="editingTemplateName"
                    class="template-name-input"
                    type="text"
                    @click.stop
                    @dblclick.stop
                    @blur="saveEditTemplate(tmpl)"
                    @keydown.enter="saveEditTemplate(tmpl)"
                    @keydown.esc="cancelEditTemplate"
                  />
                  <!-- 删除垃圾桶图标（位于打钩保存左侧） -->
                  <span
                    class="del-tmpl-btn"
                    aria-label="删除此模板"
                    @mousedown.prevent
                    @click.stop="removeCurveTemplate(tmpl.id, $event)"
                  >
                    <svg class="tmpl-action-icon" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                    </svg>
                  </span>
                  <!-- 打钩完成保存图标 -->
                  <span
                    class="save-tmpl-check"
                    aria-label="完成保存"
                    @mousedown.prevent
                    @click.stop="saveEditTemplate(tmpl)"
                  >
                    <svg class="tmpl-action-icon" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                  </span>
                </template>
                <template v-else>
                  <span class="tmpl-name-text">{{ tmpl.name }}</span>
                </template>
              </div>
            </div>
            <button
              class="save-tmpl-btn"
              type="button"
              aria-label="保存为模板"
              @click="addCurrentCurveAsTemplate"
            >
              <svg class="save-tmpl-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
              </svg>
            </button>
          </div>
        </div>

        <!-- 双曲线画布视口 -->
        <div
          ref="canvasViewportRef"
          class="curve-canvas-viewport"
        >
          <canvas
            ref="curveCanvasRef"
            :class="['curve-canvas', canvasCursorClass]"
            @pointerdown="onCanvasPointerDown"
            @pointermove="onCanvasPointerMove"
            @pointerup="onCanvasPointerUp"
            @pointercancel="onCanvasPointerUp"
            @lostpointercapture="onCanvasPointerUp"
            @dblclick="onCanvasDblClick"
            @contextmenu="onCanvasContextMenu"
          />
        </div>
          </div>

        <!-- 事件时间线：与视频时间对应的剪辑式编辑轨道 -->
        <section
          ref="timelineEditorRef"
          class="timeline-editor"
          :aria-hidden="designViewMode !== 'timeline'"
          :inert="designViewMode !== 'timeline'"
          @wheel="handleTimelineWheel"
        >
          <div
            class="timeline-scroll-shell"
            @pointerenter="showTimelineScrollbar"
            @pointermove="showTimelineScrollbar"
            @pointerleave="hideTimelineScrollbarSoon"
          >
            <div
              ref="timelineScrollRef"
              class="timeline-scroll"
              :class="{
                'is-interacting': timelineInteractionMode !== null,
                'is-panning': timelineInteractionMode === 'pan'
              }"
              @scroll="handleTimelineScroll"
            >
            <div
              ref="timelineContentRef"
              class="timeline-content"
              :style="timelineZoomStyle"
              @dragover="handleTimelinePresetDragOver"
              @dragleave="handleTimelinePresetDragLeave"
              @drop="handleTimelinePresetDrop"
            >
              <div
                class="timeline-ruler"
                @pointerdown.stop="startTimelinePlayheadDrag"
                @click.stop="handleTimelineRulerClick"
              >
                <div
                  v-for="tick in timelineTicks"
                  :key="`timeline-tick-${tick.time}`"
                  class="timeline-tick"
                  :class="{ 'is-major': tick.major }"
                  :style="{ left: `${tick.left}%` }"
                >
                  <span v-if="tick.major" class="timeline-tick-label">{{ tick.label }}</span>
                </div>

                <Transition name="timeline-drop-time">
                  <div
                    v-if="timelinePresetDropPosition !== null"
                    class="timeline-drop-time"
                    :style="{ left: `${timelinePresetDropPosition}%` }"
                  >
                    {{ timelinePresetDropTimeLabel }}
                  </div>
                </Transition>
              </div>

              <div
                class="timeline-track"
              >
                <div
                  ref="timelineThumbnailStripRef"
                  class="timeline-thumbnail-strip"
                  aria-hidden="true"
                  @pointerdown.stop="startTimelineMediaDrag"
                >
                  <TransitionGroup name="timeline-thumbnail">
                    <div
                      v-for="thumbnail in timelineThumbnails"
                      :key="`timeline-thumbnail-${thumbnail.time}`"
                      class="timeline-thumbnail-cell"
                      :style="{
                        left: `${thumbnail.left}%`,
                        width: `${thumbnail.width}%`
                      }"
                    >
                      <img :src="thumbnail.src" alt="" draggable="false" />
                    </div>
                  </TransitionGroup>
                </div>

                <div
                  class="timeline-waveform-strip"
                  aria-hidden="true"
                  @pointerdown.stop="startTimelineMediaDrag"
                />

                <Transition name="timeline-waveform">
                  <canvas
                    v-if="timelineWaveformReady"
                    ref="timelineWaveformCanvasRef"
                    class="timeline-waveform-canvas"
                    aria-hidden="true"
                  />
                </Transition>

                <div
                  ref="timelineTracksViewportRef"
                  class="timeline-tracks-viewport"
                  @pointerenter="showTimelineVerticalScrollbar"
                  @pointermove="showTimelineVerticalScrollbar"
                  @pointerleave="hideTimelineVerticalScrollbarSoon"
                  @scroll="handleTimelineTracksScroll"
                >
                  <div v-if="showTimelineEmptyState" class="timeline-empty-state">
                    暂无轨道
                  </div>

                  <div
                    class="timeline-tracks-content"
                    :style="timelineTracksContentStyle"
                  >
                    <div
                      v-if="timelineSelectedEventRange"
                      class="timeline-event-range"
                      :style="{
                        left: `${getTimelinePositionPercent(timelineSelectedEventRange.startTime)}%`,
                        width: `max(16px, ${getTimelineSpanPercent(timelineSelectedEventRange.durationSeconds)}%)`
                      }"
                    />

                    <div
                      v-for="trackIndex in timelineTrackIndexes"
                      :key="`timeline-track-${trackIndex}`"
                      class="timeline-preset-track"
                      :class="{ 'is-drop-target': timelinePresetDropTrack === trackIndex }"
                    >
                      <div
                        v-for="item in getTimelinePresetItemsForTrack(trackIndex)"
                        :key="`timeline-preset-${item.playback.triggerId}`"
                        class="timeline-clip"
                        :class="{
                          'is-selected': timelineEventId === item.event.id,
                          'is-playing': (
                            playingEventId === item.event.id &&
                            playingEventTriggerId === item.playback.triggerId
                          ),
                          'is-dragging': timelineDraggingTriggerId === item.playback.triggerId,
                          'is-duplicating': timelineDuplicatingTriggerId === item.playback.triggerId,
                          'is-preset-drop-created': (
                            timelineDropAnimatingTriggerId === item.playback.triggerId
                          )
                        }"
                        :data-timeline-trigger-id="String(item.playback.triggerId)"
                        :draggable="(
                          timelineDropAnimatingTriggerId !== item.playback.triggerId &&
                          timelineDuplicatingTriggerId !== item.playback.triggerId
                        )"
                        :style="{
                          left: `${getTimelinePositionPercent(item.startTime)}%`,
                          width: `max(16px, ${getTimelineSpanPercent(item.durationSeconds)}%)`,
                          '--clip-color': item.color
                        }"
                        @dragstart="handleTimelineClipDragStart(item, $event)"
                        @drag="handleTimelineClipDrag"
                        @dragend="handleTimelineClipDragEnd(item, $event)"
                        @click.stop="seekTimelinePreset(item)"
                        @dblclick.stop="duplicateTimelinePreset(item)"
                        @pointerdown.stop
                      >
                        <div class="timeline-clip-progress">
                          <span
                            :ref="element => setTimelineClipProgressRef(
                              item.playback.triggerId,
                              element
                            )"
                          />
                        </div>

                        <div class="timeline-clip-content">
                          <span class="timeline-clip-id">P{{ item.playback.preset.id }}</span>
                          <span class="timeline-clip-name">{{ item.playback.preset.name }}</span>
                        </div>

                        <button
                          class="timeline-clip-remove"
                          type="button"
                          aria-label="移除时间线预设"
                          draggable="false"
                          @dragstart.stop.prevent
                          @pointerdown.stop
                          @click.stop="removeTimelinePreset(item, $event)"
                          @dblclick.stop
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.41 4.29 19.71 2.88 18.29 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  ref="timelinePlayheadRef"
                  class="timeline-playhead"
                  @pointerdown.stop="startTimelinePlayheadDrag"
                  @click.stop="handleTimelineRulerClick"
                >
                  <span class="timeline-playhead-cap" />
                </div>
              </div>
            </div>
          </div>
            <div
              ref="timelineScrollbarRef"
              class="timeline-overlay-scrollbar"
              :class="{ 'is-visible': timelineScrollbarVisible }"
              :aria-hidden="!timelineScrollbarVisible"
              role="scrollbar"
              aria-label="时间线横向滚动"
              aria-orientation="horizontal"
              @pointerdown.stop="startTimelineScrollbarDrag"
              @pointermove.stop="handleTimelineScrollbarPointerMove"
              @pointerup.stop="finishTimelineScrollbarDrag"
              @pointercancel.stop="finishTimelineScrollbarDrag"
              @lostpointercapture.stop="finishTimelineScrollbarDrag"
            >
              <div
                class="timeline-overlay-scrollbar-thumb"
                :style="{
                  width: `${timelineScrollbarThumbWidth}px`,
                  transform: `translate3d(${timelineScrollbarThumbLeft}px, 0, 0)`
                }"
              />
            </div>
            <div
              ref="timelineVerticalScrollbarRef"
              class="timeline-overlay-vertical-scrollbar"
              :class="{ 'is-visible': timelineVerticalScrollbarVisible }"
              :aria-hidden="!timelineVerticalScrollbarVisible"
              role="scrollbar"
              aria-label="时间线轨道纵向滚动"
              aria-orientation="vertical"
              @pointerenter="showTimelineVerticalScrollbar"
              @pointerdown.stop="startTimelineVerticalScrollbarDrag"
              @pointermove.stop="handleTimelineVerticalScrollbarPointerMove"
              @pointerup.stop="finishTimelineVerticalScrollbarDrag"
              @pointercancel.stop="finishTimelineVerticalScrollbarDrag"
              @lostpointercapture.stop="finishTimelineVerticalScrollbarDrag"
            >
              <div
                class="timeline-overlay-vertical-scrollbar-thumb"
                :style="{
                  height: `${timelineVerticalScrollbarThumbHeight}px`,
                  transform: `translate3d(0, ${timelineVerticalScrollbarThumbTop}px, 0)`
                }"
              />
            </div>
          </div>

          <div class="timeline-toolbar">
            <div class="timeline-heading">
              <span v-if="selectedTimelineEvent" class="timeline-selection">{{ selectedTimelineEventLabel }}</span>
              <span v-else class="timeline-selection is-empty">未选择事件</span>
            </div>

            <div class="timeline-time-readout">
              {{ timelineCurrentTimeLabel }} / {{ timelineDurationLabel }}
            </div>

            <div class="timeline-zoom-controls">
              <span class="timeline-axis-name">X</span>
              <button
                class="timeline-zoom-btn"
                type="button"
                aria-label="缩小时间线"
                :disabled="timelineZoom <= 1"
                @click="setTimelineZoom(-1)"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13H5v-2h14v2z" />
                </svg>
              </button>
              <span class="timeline-zoom-value">{{ timelineZoom.toFixed(2) }}</span>
              <button
                class="timeline-zoom-btn"
                type="button"
                aria-label="放大时间线"
                @click="setTimelineZoom(1)"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                </svg>
              </button>
            </div>

            <div class="timeline-zoom-controls">
              <span class="timeline-axis-name">Y</span>
              <button
                class="timeline-zoom-btn"
                type="button"
                aria-label="缩小时间线轨道高度"
                :disabled="timelineVerticalZoom <= TIMELINE_VERTICAL_ZOOM_MIN"
                @click="setTimelineVerticalZoom(-TIMELINE_VERTICAL_ZOOM_STEP)"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13H5v-2h14v2z" />
                </svg>
              </button>
              <span class="timeline-zoom-value">{{ timelineVerticalZoom.toFixed(2) }}</span>
              <button
                class="timeline-zoom-btn"
                type="button"
                aria-label="放大时间线轨道高度"
                :disabled="timelineVerticalZoom >= TIMELINE_VERTICAL_ZOOM_MAX"
                @click="setTimelineVerticalZoom(TIMELINE_VERTICAL_ZOOM_STEP)"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                </svg>
              </button>
            </div>
          </div>
        </section>
        </div>
      </div>
      </div>
    </Transition>

    <Teleport to="body">
      <div
        v-if="timelinePresetDropFlight"
        :key="timelinePresetDropFlight.key"
        ref="timelinePresetDropFlightRef"
        class="preset-drop-flight"
        :style="{
          left: `${timelinePresetDropFlight.from.left}px`,
          top: `${timelinePresetDropFlight.from.top}px`,
          width: `${timelinePresetDropFlight.from.width}px`,
          height: `${timelinePresetDropFlight.from.height}px`,
          '--drop-flight-color': timelinePresetDropFlight.color
        }"
      >
        <span class="preset-drop-flight-id preset-drop-flight-label">
          {{ timelinePresetDropFlight.presetId }}
        </span>
        <span class="preset-drop-flight-name preset-drop-flight-label">
          {{ timelinePresetDropFlight.presetName }}
        </span>
      </div>
    </Teleport>

  </div>
</template>

<style scoped>
.design-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  background-color: var(--md-sys-color-surface, #1c1f26);
  color: var(--md-sys-color-on-surface, #e8edf2);
  user-select: none;
  overflow: hidden;
}

.design-workspace-fade-enter-active,
.design-workspace-fade-leave-active {
  transition: opacity 180ms ease;
  will-change: opacity;
}

.design-workspace-fade-enter-from,
.design-workspace-fade-leave-to {
  opacity: 0;
}

/* 空状态 */
.design-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 32px 16px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  text-align: center;
}

.empty-icon {
  width: 44px;
  height: 44px;
  color: var(--md-sys-color-outline, #727b8c);
  margin-bottom: 12px;
  opacity: 0.6;
}

.empty-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface, #e8edf2);
  margin-bottom: 6px;
}

.empty-desc {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  max-width: 280px;
  line-height: 1.5;
}

/* 主工作区 */
.design-workspace {
  flex: 1;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 顶部参数工具栏 */
.design-toolbar {
  display: flex;
  align-items: center;
  padding: 8px 14px;
  gap: 14px;
  background-color: var(--md-sys-color-surface-container-high, #282c35);
  border-bottom: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08));
  flex-shrink: 0;
  flex-wrap: wrap;
}

/* 历史颜色面板 */
.history-colors-box {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 120px;
}

.history-colors-header {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 18px;
}

.clear-history-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  outline: none;
  transition: all 0.12s ease;
  flex-shrink: 0;
}

.clear-history-btn:hover:not(:disabled) {
  background-color: rgba(255, 82, 82, 0.2);
  color: var(--md-sys-color-error, #f28b82);
}

.clear-history-btn:active:not(:disabled) {
  transform: scale(0.92);
}

.clear-history-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
}

.clear-history-icon {
  width: 12px;
  height: 12px;
}

.history-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

.history-colors-grid {
  display: grid;
  grid-template-columns: repeat(5, 18px);
  gap: 5px;
  max-width: 120px;
  min-height: 41px;
}

.history-color-item {
  position: relative;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  cursor: pointer;
  box-sizing: border-box;
  transition: border-color 0.15s ease;
}

.history-color-item:hover {
  border-color: rgba(255, 255, 255, 0.7);
}

.history-color-item.is-active {
  outline: 2px solid var(--md-sys-color-primary, #8ab4f8);
  outline-offset: 1px;
  border-color: transparent;
}

.remove-history-btn {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #ff5252;
  color: #ffffff;
  border: none;
  font-size: 9px;
  line-height: 1;
  display: none;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.history-color-item:hover .remove-history-btn {
  display: flex;
}

.empty-history-box {
  height: 41px;
  width: 110px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.empty-history-text {
  font-size: 11px;
  color: var(--md-sys-color-outline, #727b8c);
  user-select: none;
}

/* 分隔线 */
.toolbar-divider {
  width: 1px;
  height: 54px;
  background-color: var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.1));
}

/* 色彩数值列 (十六进制上，RGB 下) */
.color-values-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.color-input-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.color-val-input-wrapper {
  display: inline-flex;
  align-items: center;
  height: 24px;
  background-color: var(--md-sys-color-surface-container-highest, #323843);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  padding: 0 7px;
  width: 142px;
  box-sizing: border-box;
  transition: border-color 0.15s ease;
}

.color-val-input-wrapper:focus-within {
  border-color: var(--md-sys-color-primary, #8ab4f8);
}

/* 十六进制 # 左侧颜色小方块预览 */
.color-preview-swatch {
  width: 12px;
  height: 12px;
  border-radius: 2.5px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  margin-right: 5px;
  flex-shrink: 0;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.color-preview-swatch:hover {
  border-color: #ffffff;
}

.color-val-prefix {
  font-family: 'Google Sans', sans-serif;
  font-size: 11px;
  font-weight: 700;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  margin-right: 4px;
  user-select: none;
}

.color-val-prefix.rgb-prefix {
  font-size: 10px;
  letter-spacing: 0.5px;
}

.color-val-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font-family: 'Google Sans', sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface, #e8edf2);
  padding: 0;
}

.hex-input {
  text-transform: uppercase;
}

/* 输入框旁添加到历史颜色加号按钮 */
.add-history-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background-color: var(--md-sys-color-surface-container-highest, #323843);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  font-size: 14px;
  line-height: 1;
  font-weight: bold;
  cursor: pointer;
  padding: 0;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.add-history-btn:hover {
  background-color: rgba(255, 255, 255, 0.08);
  color: var(--md-sys-color-primary, #8ab4f8);
  border-color: var(--md-sys-color-primary, #8ab4f8);
}

/* 吸色按钮 (与 add-history-btn 保持 24x24 紧凑结构一致) */
.eyedropper-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background-color: var(--md-sys-color-surface-container-highest, #323843);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  padding: 0;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.eyedropper-btn:hover {
  background-color: rgba(255, 255, 255, 0.08);
  color: var(--md-sys-color-primary, #8ab4f8);
  border-color: var(--md-sys-color-primary, #8ab4f8);
}

.eyedropper-icon {
  width: 14px;
  height: 14px;
}

.hidden-color-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

/* 播放参数控制列 (重复 上，周期 下) */
.playback-params-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.param-stepper-box {
  display: flex;
  align-items: center;
  gap: 6px;
}

.param-stepper-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  white-space: nowrap;
  width: 24px;
  flex-shrink: 0;
}

.stepper-controls {
  display: inline-flex;
  align-items: center;
  background-color: var(--md-sys-color-surface-container-highest, #323843);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  overflow: hidden;
  height: 24px;
  width: 112px;
  box-sizing: border-box;
  transition: border-color 0.15s ease;
}

.stepper-controls:focus-within {
  border-color: var(--md-sys-color-primary, #8ab4f8);
}

.stepper-btn {
  width: 20px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface, #e8edf2);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: bold;
  outline: none;
  transition: background-color 0.12s ease;
  padding: 0;
  flex-shrink: 0;
}

.stepper-btn:hover:not(:disabled) {
  background-color: rgba(255, 255, 255, 0.08);
  color: var(--md-sys-color-primary, #8ab4f8);
}

.stepper-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.stepper-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font-family: 'Google Sans', sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface, #e8edf2);
  text-align: center;
  padding: 0;
}

.stepper-unit {
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  margin-right: 2px;
  user-select: none;
  min-width: 18px;
  text-align: center;
  flex-shrink: 0;
}

/* 预设灯效预览方块 (54x54px 纯净色块，与两行控件总高 54px 严格齐平) */
.effect-preview-box {
  width: 54px;
  height: 54px;
  border-radius: 4px;
  border: 1px solid transparent;
  background-color: #000000;
  box-sizing: border-box;
  flex-shrink: 0;
  cursor: pointer;
}

/* -------------------------------------------------------------
   下半窗口：双曲线叠加主画框区域
   ------------------------------------------------------------- */
.design-canvas-area {
  flex: 1;
  width: 100%;
  min-height: 0;
  background-color: #12151b;
  position: relative;
  overflow: hidden;
}

.design-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.design-stage > .design-view,
.design-stage > .timeline-editor {
  position: absolute;
  inset: 0;
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  opacity: 1;
  pointer-events: auto;
  transition: opacity 180ms ease;
  will-change: opacity;
}

.design-stage:not(.is-timeline-mode) > .timeline-editor,
.design-stage.is-timeline-mode > .design-view {
  opacity: 0;
  pointer-events: none;
}

/* 曲线顶栏 */
.curve-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  background-color: #1a1e27;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  gap: 12px;
  flex-wrap: wrap;
}

.tool-left-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 双曲线切换滑块组 (Segmented Slider) */
.curve-selector-group {
  position: relative;
  display: inline-flex;
  align-items: center;
  background-color: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 2px;
  user-select: none;
}

.curve-sel-glider {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  width: calc(50% - 2px);
  background-color: var(--md-sys-color-surface-container-highest, #343a46);
  border-radius: 4px;
  transition: transform 0.22s cubic-bezier(0.2, 0, 0, 1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  z-index: 0;
}

.curve-sel-glider.color {
  transform: translateX(100%);
}

.curve-sel-btn {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 9px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  outline: none;
  transition: color 0.15s ease;
}

.curve-sel-btn:hover {
  color: #ffffff;
}

.curve-sel-btn.is-active {
  color: #ffffff;
  font-weight: 700;
}

/* 曲线操作工具组 (鼠标、笔、添加、删除) */
.curve-tools-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background-color: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 2px;
  user-select: none;
}

.curve-tool-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  outline: none;
  transition: all 0.15s ease;
}

.curve-tool-btn:hover {
  color: #ffffff;
  background-color: rgba(255, 255, 255, 0.08);
}

.curve-tool-btn.is-active {
  color: var(--md-sys-color-primary, #8ab4f8);
  background-color: var(--md-sys-color-surface-container-highest, #343a46);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}

.curve-tool-icon {
  width: 14px;
  height: 14px;
}

/* 自定义模版栏 */
.custom-templates-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.templates-list {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.template-pill-btn {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  background-color: var(--md-sys-color-surface-container-highest, #2c323d);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: var(--md-sys-color-on-surface, #e8edf2);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  outline: none;
  transition: all 0.12s ease;
  white-space: nowrap;
  user-select: none;
}

.template-pill-btn:hover:not(.is-editing) {
  background-color: rgba(138, 180, 248, 0.18);
  border-color: var(--md-sys-color-primary, #8ab4f8);
  color: var(--md-sys-color-primary, #8ab4f8);
}

.template-pill-btn.is-editing {
  padding: 0 4px 0 6px;
  border-color: var(--md-sys-color-primary, #8ab4f8);
  background-color: var(--md-sys-color-surface-container-highest, #2c323d);
  cursor: default;
  gap: 2px;
}

.template-name-input {
  background: transparent;
  border: none;
  outline: none;
  color: var(--md-sys-color-on-surface, #ffffff);
  font-size: 11px;
  font-weight: 500;
  font-family: inherit;
  height: 18px;
  min-width: 36px;
  max-width: 90px;
  padding: 0 2px;
}

.del-tmpl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  transition: all 0.12s ease;
  flex-shrink: 0;
  margin-left: 2px;
}

.del-tmpl-btn:hover {
  background-color: rgba(255, 82, 82, 0.2);
  color: var(--md-sys-color-error, #f28b82);
}

.del-tmpl-btn:active {
  transform: scale(0.92);
}

.save-tmpl-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  color: var(--md-sys-color-primary, #8ab4f8);
  cursor: pointer;
  transition: all 0.12s ease;
  flex-shrink: 0;
}

.save-tmpl-check:hover {
  background-color: rgba(138, 180, 248, 0.25);
  color: #ffffff;
}

.save-tmpl-check:active {
  transform: scale(0.92);
}

.tmpl-action-icon {
  width: 13px;
  height: 13px;
}

.tmpl-name-text {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.save-tmpl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 4px;
  background-color: rgba(168, 199, 250, 0.15);
  border: 1px solid var(--md-sys-color-primary, #8ab4f8);
  color: var(--md-sys-color-primary, #8ab4f8);
  cursor: pointer;
  outline: none;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.save-tmpl-btn:hover {
  background-color: var(--md-sys-color-primary, #8ab4f8);
  color: #12151b;
}

.save-tmpl-icon {
  width: 14px;
  height: 14px;
}

/* 曲线画布视口 */
.curve-canvas-viewport {
  flex: 1;
  width: 100%;
  min-height: 160px;
  position: relative;
  overflow: hidden;
}

.curve-canvas {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}

.curve-canvas.cursor-default {
  cursor: default;
}

.curve-canvas.cursor-pointer {
  cursor: pointer;
}

.curve-canvas.cursor-grab {
  cursor: grab;
}

.curve-canvas.cursor-grabbing {
  cursor: grabbing;
}

.curve-canvas.cursor-crosshair {
  cursor: crosshair;
}

/* -------------------------------------------------------------
   事件时间线
   ------------------------------------------------------------- */
.timeline-editor {
  --timeline-thumbnail-lane-height: 48px;
  --timeline-waveform-lane-height: 48px;
  flex: 1;
  width: 100%;
  max-width: none;
  min-height: 0;
  max-height: none;
  display: flex;
  flex-direction: column;
  background-color: #11141a;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.timeline-toolbar {
  height: 28px;
  min-height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 10px;
  background-color: #1a1e27;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.timeline-heading {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 7px;
}

.timeline-selection {
  min-width: 0;
  overflow: hidden;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-selection.is-empty {
  opacity: 0.55;
}

.timeline-time-readout {
  flex-shrink: 0;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.timeline-zoom-controls {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 1px;
}

.timeline-zoom-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  outline: none;
}

.timeline-zoom-btn:hover:not(:disabled) {
  background-color: rgba(255, 255, 255, 0.08);
  color: #ffffff;
}

.timeline-zoom-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.timeline-zoom-btn svg {
  width: 14px;
  height: 14px;
}

.timeline-axis-name {
  min-width: 18px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.timeline-zoom-value {
  min-width: 34px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.timeline-scroll-shell {
  position: relative;
  flex: 1;
  width: 100%;
  min-height: 0;
  overflow: hidden;
}

.timeline-scroll {
  flex: 1;
  width: 100%;
  height: 100%;
  max-width: none;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  background-color: var(--md-sys-color-surface, #1c1f26);
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.timeline-scroll::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.timeline-overlay-scrollbar {
  position: absolute;
  right: 6px;
  bottom: 3px;
  left: 6px;
  z-index: 12;
  height: 8px;
  border-radius: 999px;
  background-color: rgba(10, 12, 16, 0.48);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  touch-action: none;
  transition: opacity 140ms ease, background-color 140ms ease;
}

.timeline-overlay-scrollbar.is-visible {
  opacity: 0.72;
  pointer-events: auto;
}

.timeline-overlay-scrollbar.is-visible:hover {
  background-color: rgba(10, 12, 16, 0.68);
  opacity: 1;
}

.timeline-overlay-scrollbar-thumb {
  width: 0;
  min-width: 28px;
  height: 100%;
  border-radius: inherit;
  background-color: rgba(170, 179, 191, 0.58);
  cursor: grab;
  will-change: width, transform;
  transition: background-color 120ms ease;
}

.timeline-overlay-scrollbar.is-visible:hover .timeline-overlay-scrollbar-thumb {
  background-color: rgba(205, 214, 225, 0.82);
}

.timeline-overlay-scrollbar:active .timeline-overlay-scrollbar-thumb {
  background-color: var(--md-sys-color-primary, #8ab4f8);
  cursor: grabbing;
}

.timeline-overlay-vertical-scrollbar {
  position: absolute;
  top: calc(
    26px
    + var(--timeline-thumbnail-lane-height)
    + var(--timeline-waveform-lane-height)
    + 6px
  );
  right: 4px;
  bottom: 14px;
  z-index: 12;
  width: 8px;
  border-radius: 999px;
  background-color: rgba(10, 12, 16, 0.48);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  touch-action: none;
  transition: opacity 140ms ease, background-color 140ms ease;
}

.timeline-overlay-vertical-scrollbar.is-visible {
  opacity: 0.72;
  pointer-events: auto;
}

.timeline-overlay-vertical-scrollbar.is-visible:hover {
  background-color: rgba(10, 12, 16, 0.68);
  opacity: 1;
}

.timeline-overlay-vertical-scrollbar-thumb {
  width: 100%;
  min-height: 28px;
  border-radius: inherit;
  background-color: rgba(170, 179, 191, 0.58);
  cursor: grab;
  will-change: height, transform;
  transition: background-color 120ms ease;
}

.timeline-overlay-vertical-scrollbar.is-visible:hover
  .timeline-overlay-vertical-scrollbar-thumb {
  background-color: rgba(205, 214, 225, 0.82);
}

.timeline-overlay-vertical-scrollbar:active
  .timeline-overlay-vertical-scrollbar-thumb {
  background-color: var(--md-sys-color-primary, #8ab4f8);
  cursor: grabbing;
}

.timeline-waveform-enter-active {
  animation: timeline-waveform-reveal 620ms cubic-bezier(0.4, 0, 0.2, 1) both;
}

.timeline-waveform-leave-active {
  transition:
    opacity 160ms cubic-bezier(0.2, 0, 0, 1),
    transform 160ms cubic-bezier(0.2, 0, 0, 1);
}

.timeline-waveform-leave-to {
  opacity: 0;
  transform: scale(0.985);
}

@keyframes timeline-waveform-reveal {
  from {
    opacity: 0.35;
    clip-path: inset(0 100% 0 0);
  }

  to {
    opacity: 1;
    clip-path: inset(0 0 0 0);
  }
}

.timeline-waveform-canvas {
  position: absolute;
  top: var(--timeline-thumbnail-lane-height);
  left: 0;
  z-index: 4;
  display: block;
  background: transparent;
  pointer-events: none;
}

.timeline-content {
  width: 100%;
  max-width: none;
  height: 100%;
  min-width: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
}

.timeline-ruler {
  position: relative;
  width: 100%;
  height: 26px;
  flex-shrink: 0;
  background-color: #151922;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  cursor: default;
  touch-action: none;
  overflow: hidden;
}

.timeline-tick {
  position: absolute;
  top: 15px;
  bottom: 0;
  width: 1px;
  background-color: rgba(255, 255, 255, 0.13);
  pointer-events: none;
}

.timeline-tick.is-major {
  top: 10px;
  background-color: rgba(255, 255, 255, 0.28);
}

.timeline-tick-label {
  position: absolute;
  left: 4px;
  top: -10px;
  color: rgba(232, 237, 242, 0.62);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.timeline-drop-time {
  position: absolute;
  top: 2px;
  z-index: 5;
  min-width: 48px;
  padding: 1px 4px;
  box-sizing: border-box;
  border-radius: 3px;
  background-color: rgba(138, 180, 248, 0.2);
  color: var(--md-sys-color-on-surface, #e8edf2);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
  pointer-events: none;
  transform: translateX(-50%);
  transition:
    left 120ms linear,
    opacity 120ms ease,
    transform 160ms cubic-bezier(0.2, 0, 0, 1);
}

.timeline-drop-time-enter-active,
.timeline-drop-time-leave-active {
  transition:
    left 120ms linear,
    opacity 120ms ease,
    transform 160ms cubic-bezier(0.2, 0, 0, 1);
}

.timeline-drop-time-enter-from,
.timeline-drop-time-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px);
}

.timeline-track {
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  isolation: isolate;
  background-color: var(--md-sys-color-surface, #1c1f26);
  cursor: default;
  overflow: hidden;
}

.timeline-thumbnail-strip {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: var(--timeline-thumbnail-lane-height);
  z-index: 0;
  overflow: hidden;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  cursor: grab;
  pointer-events: auto;
  touch-action: none;
}

.timeline-thumbnail-cell {
  position: absolute;
  top: 0;
  bottom: 0;
  overflow: hidden;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  will-change: opacity, transform;
}

.timeline-thumbnail-enter-active {
  animation: timeline-media-reveal 260ms cubic-bezier(0.4, 0, 0.2, 1) both;
}

.timeline-thumbnail-leave-active {
  transition:
    opacity 160ms cubic-bezier(0.2, 0, 0, 1),
    transform 160ms cubic-bezier(0.2, 0, 0, 1);
}

.timeline-thumbnail-leave-to {
  opacity: 0;
  transform: scale(0.985);
}

@keyframes timeline-media-reveal {
  from {
    opacity: 0.35;
  }

  to {
    opacity: 1;
  }
}

.timeline-thumbnail-cell img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  opacity: 1;
  filter: none;
  pointer-events: none;
  user-select: none;
}

.timeline-waveform-strip {
  position: absolute;
  top: var(--timeline-thumbnail-lane-height);
  right: 0;
  left: 0;
  height: var(--timeline-waveform-lane-height);
  z-index: 0;
  overflow: hidden;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  cursor: grab;
  pointer-events: auto;
  touch-action: none;
}

.timeline-scroll.is-panning .timeline-thumbnail-strip,
.timeline-scroll.is-panning .timeline-waveform-strip {
  cursor: grabbing;
}

.timeline-tracks-viewport {
  position: absolute;
  top: calc(
    var(--timeline-thumbnail-lane-height)
    + var(--timeline-waveform-lane-height)
  );
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 2;
  background-color: #11141a;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.timeline-tracks-viewport::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.timeline-tracks-content {
  position: relative;
  width: 100%;
  min-height: 0;
  background-color: var(--md-sys-color-surface, #1c1f26);
}

.timeline-empty-state {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(170, 179, 191, 0.45);
  font-size: 11px;
  pointer-events: none;
}

.timeline-event-range {
  position: absolute;
  top: 0;
  bottom: 0;
  min-width: 16px;
  border: 1px solid rgba(138, 180, 248, 0.22);
  border-radius: 0;
  background-color: rgba(138, 180, 248, 0.07);
  pointer-events: none;
  z-index: 1;
}

.timeline-preset-track {
  position: relative;
  width: 100%;
  height: var(--timeline-track-height, 76px);
  box-sizing: border-box;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  transition: background-color 120ms ease;
}

.timeline-preset-track.is-drop-target {
  background-color: rgba(138, 180, 248, 0.08);
  box-shadow: inset 0 0 0 1px rgba(138, 180, 248, 0.18);
}

.timeline-preset-track:last-child {
  border-bottom: none;
}

.timeline-clip {
  position: absolute;
  top: 8px;
  bottom: 8px;
  min-width: 16px;
  border: 1px solid color-mix(in srgb, var(--clip-color) 42%, #596170 58%);
  border-radius: 5px;
  background-color: color-mix(in srgb, var(--clip-color) 36%, #242a34 64%);
  cursor: grab;
  overflow: hidden;
  z-index: 3;
  touch-action: none;
  user-select: none;
  transform-origin: center;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}

.timeline-clip:hover {
  border-color: color-mix(in srgb, var(--clip-color) 68%, #ffffff 32%);
}

.timeline-clip.is-selected {
  border-color: var(--md-sys-color-primary, #8ab4f8);
  z-index: 5;
}

.timeline-clip.is-playing {
  border-color: var(--md-sys-color-primary, #8ab4f8);
}

.timeline-clip.is-dragging {
  cursor: grabbing;
  opacity: 0.58;
  transform: scale(0.97);
  z-index: 6;
}

.timeline-clip.is-duplicating {
  pointer-events: none;
  z-index: 7;
}

.timeline-clip.is-removing {
  pointer-events: none;
}

.timeline-clip.is-preset-drop-created {
  opacity: 0;
  pointer-events: none;
}

.preset-drop-flight {
  position: fixed;
  z-index: 20000;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 12px 8px;
  overflow: hidden;
  border: none;
  border-radius: 10px;
  background-color: color-mix(
    in srgb,
    var(--drop-flight-color, #ffffff) 32%,
    #282c35
  );
  color: var(--md-sys-color-on-surface, #e8edf2);
  pointer-events: none;
  transform-origin: top left;
  will-change: transform, border-radius;
}

.preset-drop-flight-id {
  position: absolute;
  top: 6px;
  left: 6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background-color: rgba(138, 180, 248, 0.12);
  color: var(--md-sys-color-primary, #8ab4f8);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.preset-drop-flight-name {
  max-width: 100%;
  overflow: hidden;
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-drop-flight-label {
  will-change: opacity;
}

.timeline-clip-progress {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.timeline-clip-progress span {
  display: block;
  width: 100%;
  height: 100%;
  background:
    linear-gradient(
      to right,
      rgba(255, 255, 255, 0.08),
      rgba(255, 255, 255, 0.34)
    );
  transform: scaleX(0);
  transform-origin: left center;
  will-change: transform;
}

.timeline-clip-content {
  position: relative;
  z-index: 1;
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  padding: 4px 24px 4px 9px;
  opacity: 1;
  pointer-events: none;
  transition: opacity 180ms ease-out;
}

.timeline-clip.is-preset-drop-created .timeline-clip-content {
  opacity: 0;
  transition: none;
}

.timeline-clip-id {
  color: rgba(255, 255, 255, 0.82);
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
}

.timeline-clip-name {
  overflow: hidden;
  color: #ffffff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-clip-remove {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background-color: rgba(10, 12, 16, 0.56);
  color: rgba(255, 255, 255, 0.86);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  z-index: 4;
  touch-action: none;
}

.timeline-clip:hover .timeline-clip-remove,
.timeline-clip.is-selected .timeline-clip-remove {
  opacity: 1;
  pointer-events: auto;
}

.timeline-clip-remove:hover {
  background-color: rgba(239, 107, 115, 0.9);
}

.timeline-clip-remove svg {
  width: 11px;
  height: 11px;
}

.timeline-playhead {
  position: absolute;
  top: -26px;
  bottom: 0;
  left: 0;
  display: none;
  width: 1px;
  background-color: var(--md-sys-color-primary, #8ab4f8);
  box-shadow: 0 0 0 1px rgba(138, 180, 248, 0.2);
  cursor: grab;
  pointer-events: auto;
  z-index: 8;
  transform: translate3d(0, 0, 0);
  will-change: transform;
}

.timeline-playhead::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -6px;
  width: 13px;
}

.timeline-playhead:active {
  cursor: grabbing;
}

.timeline-playhead-cap {
  position: absolute;
  top: 0;
  left: 50%;
  width: 9px;
  height: 9px;
  border-radius: 50% 50% 50% 0;
  background-color: var(--md-sys-color-primary, #8ab4f8);
  pointer-events: none;
  transform: translateX(-50%) rotate(-45deg);
}
</style>
