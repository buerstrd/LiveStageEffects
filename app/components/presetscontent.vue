<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRealtimeBpm } from '~/composables/bpmanalyzer'
import {
  createDefaultPresetPoints,
  normalizeCurveTemplate,
  normalizePresetPoint,
  type PresetCurveTemplate,
  type PresetItem,
  type PresetPoint
} from '~/utils/presetcurve'
import { presetsManager } from '~/composables/presetsmanager'
import { renderStatusManager } from '~/composables/renderstatusmanager'
import {
  eventsManager,
  formatTimelineTime,
  getEventPresets,
  getEventPresetPlaybacks,
  getEventPresetTriggers,
  getEventRangeDurationMs,
  isValidTriggerTime,
  normalizeEventTimelineTrackCount,
  parseTimeToSeconds,
  type EventItem,
  type EventPresetPlayback
} from '~/composables/eventsmanager'
import { videoManager } from '~/composables/videomanager'
import { windowsManager } from '~/composables/windowsmanager'
import { devicesManager } from '~/composables/devicesmanager'

const {
  selectedPresetId,
  editingPresetId,
  presetDragPointerOffsetX,
  selectPreset,
  triggerPlaySync,
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
  isEventRecording,
  recordPresetEvent,
  selectEvent,
  addEventPresetTrigger,
  addEventPresetTriggers,
  importPresetToEvent,
  removeEventPreset,
  updateEventPresetEffect,
  updateEventPresetShortcut,
  moveEventPreset,
  updateEventPresetTriggerRange,
  updateEventPresetTriggers,
  removeEventPresetTriggers
} = eventsManager()

const presetContextEvent = computed(() => {
  if (selectedEventId.value === null) return null
  return events.value.find(event => event.id === selectedEventId.value) ?? null
})

const presets = computed<PresetItem[]>(() => {
  return presetContextEvent.value
    ? getEventPresets(presetContextEvent.value)
    : []
})

const activePreset = computed(() => {
  if (selectedPresetId.value === null) return null
  return presets.value.find(preset => preset.id === selectedPresetId.value) ?? null
})

const updatePresetShortcut = (presetId: number, shortcut: string) => {
  const event = presetContextEvent.value
  if (!event) return
  updateEventPresetShortcut(event.id, presetId, shortcut)
}

const movePreset = (
  draggedId: number,
  targetId: number,
  position: 'before' | 'after'
) => {
  const event = presetContextEvent.value
  if (!event) return
  moveEventPreset(event.id, draggedId, targetId, position)
}

const updatePresetEffect = (
  presetId: number,
  partialEffect: Parameters<typeof updateEventPresetEffect>[1]
) => {
  const event = presetContextEvent.value
  if (!event) return
  updateEventPresetEffect(event.id, presetId, partialEffect)
}

const removePreset = (presetId: number) => {
  const event = presetContextEvent.value
  if (!event) return
  removeEventPreset(event.id, presetId)
  if (selectedPresetId.value === presetId) {
    selectPreset(null)
  }
}
const {
  videoSrc,
  currentTime: videoCurrentTime,
  duration: videoDuration,
  seekVideo: seekVideoTo
} = videoManager()
const {
  beatGridAnchor,
  beatGridPeriod
} = useRealtimeBpm()
const {
  timelineFollowEnabled,
  setTimelineFollowEnabled,
  focusWindow
} = windowsManager()
const {
  sendPresetToDevice,
  stopDevicePlayback,
  pauseDevicePlayback,
  resumeDevicePlayback,
  seekDevicePlayback
} = devicesManager()
const effectiveDesignViewMode = computed(() => {
  return 'curve' as const
})
const {
  beginRenderTask,
  updateRenderTask,
  finishRenderTask,
  cancelRenderTask
} = renderStatusManager()

const designViewRef = ref<HTMLElement | null>(null)
const timelineEditorRef = ref<HTMLElement | null>(null)
const timelineThumbnailStripRef = ref<HTMLElement | null>(null)

// 预览播放填充态进入与退出渐变透明度 (0.0 ~ 1.0)
const fillAlpha = ref(0)

// 历史消退扫描填充列表 (用于重复触发预览时，让前一个填充带平滑渐变动画消失)
interface FadingFill {
  progress: number
  alpha: number
}
const fadingFills = ref<FadingFill[]>([])

const enqueueFadingFill = (progress: number, alpha: number) => {
  if (alpha <= 0) return

  fadingFills.value.push({
    progress: Math.max(0, Math.min(1, progress)),
    alpha: Math.max(0, Math.min(1, alpha))
  })
  if (fadingFills.value.length > 6) {
    fadingFills.value.shift()
  }
}

// 当前主颜色
const currentColor = computed(() => {
  return activePreset.value?.effect?.color || '#ffffff'
})

// 当前重复次数 (0 表示无限重复)
const currentRepeat = computed(() => {
  const repeat = activePreset.value?.effect?.repeat ?? 1
  return Number.isFinite(repeat)
    ? Math.max(0, Math.min(99, Math.round(repeat)))
    : 1
})

// 当前时长 (ms, 默认 500ms)
const currentDuration = computed(() => {
  return activePreset.value?.effect?.duration ?? 500
})

// -------------------------------------------------------------
// 事件时间线
// -------------------------------------------------------------
const TIMELINE_MIN_DURATION = 0.1
const TIMELINE_MAX_ZOOM = 20
const TIMELINE_TRACK_RECOMMENDED_HEIGHT = 76
const TIMELINE_VERTICAL_ZOOM_MIN = 0.75
const TIMELINE_VERTICAL_ZOOM_MAX = 2.5
const TIMELINE_VERTICAL_ZOOM_STEP = 0.25
const TIMELINE_WAVEFORM_LANE_HEIGHT = 48
const TIMELINE_BEAT_MARKER_LIMIT = 2000
const TIMELINE_FILL_MAX_PREVIEWS = 200
const TIMELINE_BPM_SNAP_RADIUS_PX = 26
const TIMELINE_BPM_SNAP_STRENGTH = 0.85
const TIMELINE_MARQUEE_THRESHOLD = 3
const PRESET_DRAG_MIME = 'application/x-livestage-preset'
const PRESET_DRAG_META_MIME = 'application/x-livestage-preset-meta'
const TIMELINE_TRIGGER_DRAG_MIME = 'application/x-livestage-timeline-trigger'

type TimelineInteractionMode =
  | 'pan'
  | 'marquee'
  | 'playhead'

interface PresetDragRect {
  left: number
  top: number
  width: number
  height: number
}

interface PresetDragPayload {
  id: number
  sourceEventId?: number
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

interface TimelineFillPreview {
  key: string
  startTime: number
  durationSeconds: number
  color: string
  track: number
}

interface TimelineFillDragState {
  pointerId: number
  handle: HTMLElement
  item: TimelinePresetItem
  eventStartTime: number
  copyStartTime: number
  copyDurationSeconds: number
  lastClientX: number
  direction: 'copy' | 'remove' | null
  previewCount: number
  removePreviewTriggerIds: number[]
}

interface TimelineClipDragGroupItem {
  triggerId: number
  startTime: number
  track: number
  rect: DOMRect | null
  dropRect: DOMRect | null
  element: HTMLElement | null
}

interface TimelineClipDragGroup {
  eventId: number
  primaryTriggerId: number
  startClientX: number
  startClientY: number
  items: TimelineClipDragGroupItem[]
}

interface TimelineInteractionState {
  mode: TimelineInteractionMode
  pointerId: number
  startClientX: number
  startClientY?: number
  captureElement?: HTMLElement
  initialScrollLeft?: number
  initialScrollTop?: number
  panButton?: 0 | 1
  allowClickSeek?: boolean
  initialSelectedTriggerIds?: number[]
  additive?: boolean
  eventId?: number
  moved: boolean
}

interface TimelineMarqueeRect {
  left: number
  top: number
  width: number
  height: number
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

interface TimelineThumbnailSample {
  time: number
  src: string
  usedAt: number
}

interface TimelineBeatMarker {
  key: string
  time: number
  left: number
}

interface TimelinePresetDropFlight {
  key: number
  presetId: number
  presetName: string
  color: string
  from: PresetDragRect
  to: PresetDragRect
}

const timelineEventId = ref<number | null>(selectedEventId.value)
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
const timelineWaveformReady = ref(false)
const timelineWaveformLayerRef = ref<HTMLDivElement | null>(null)
const timelineWaveformCanvasRef = ref<HTMLCanvasElement | null>(null)
const timelinePlayheadRef = ref<HTMLDivElement | null>(null)
const selectedTimelineTriggerIds = ref<number[]>([])
const timelineMarqueeRect = ref<TimelineMarqueeRect | null>(null)
let timelineProgressRenderRafId: number | null = null
const timelineInteractionMode = ref<TimelineInteractionMode | null>(null)
const timelineInteractionPanButton = ref<0 | 1 | null>(null)
const timelineDraggingTriggerIds = ref<number[]>([])
const timelinePresetDropPosition = ref<number | null>(null)
const timelinePresetDropTrack = ref<number | null>(null)
const timelineDropAnimatingTriggerId = ref<number | null>(null)
const timelineDuplicatingTriggerId = ref<number | null>(null)
const timelinePresetDropFlight = ref<TimelinePresetDropFlight | null>(null)
const timelinePresetDropFlightRef = ref<HTMLElement | null>(null)
const timelineFillPreviews = ref<TimelineFillPreview[]>([])
const timelineFillDraggingTriggerId = ref<number | null>(null)
const timelineFillSourceStartPreview = ref<number | null>(null)
const timelineFillSourceDurationPreview = ref<number | null>(null)
const timelineFillRemovePreviewTriggerIds = ref<number[]>([])
let timelineInteraction: TimelineInteractionState | null = null
let timelineFillDragState: TimelineFillDragState | null = null
let timelineClipDragGroup: TimelineClipDragGroup | null = null
let timelineDropAnimationTimer: ReturnType<typeof setTimeout> | null = null
let timelineDropAnimationSequence = 0
let timelineClipDragDropped = false
let timelineClipDragOffsetX = 0
let timelineClipDragOffsetY = 0
let timelineClipDragOffsetFrameId: number | null = null
let timelinePresetDropFrameId: number | null = null
let timelinePendingPresetDrop: {
  position: number
  track: number
} | null = null
let timelineNativeDragImage: HTMLElement | null = null
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
  if (effectiveDesignViewMode.value === 'timeline') {
    return timelineEventId.value !== null
  }
  return activePreset.value !== null
})

const animateDesignTargetSwitch = (element: HTMLElement | null) => {
  if (!element || typeof element.animate !== 'function') {
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
    effectiveDesignViewMode.value !== 'timeline' ||
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

  return getEventPresetPlaybacks(event).map(playback => ({
    event,
    playback,
    startTime: (
      (
        timelineFillDraggingTriggerId.value === playback.triggerId
          ? timelineFillSourceStartPreview.value
          : null
      )
      ?? playback.startTime
    ),
    durationSeconds: (
      (
        timelineFillDraggingTriggerId.value === playback.triggerId
          ? timelineFillSourceDurationPreview.value
          : null
      )
      ?? playback.singleDurationMs / 1000
    ),
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
  const durationSeconds = (getEventRangeDurationMs(event) ?? 0) / 1000
  return {
    startTime,
    durationSeconds: Math.max(TIMELINE_MIN_DURATION, durationSeconds)
  }
})

const timelineCommittedRangeStart = computed(() => {
  return timelineSelectedEventRange.value?.startTime ?? 0
})

const timelineCommittedRangeDuration = computed(() => {
  return Math.max(
    TIMELINE_MIN_DURATION,
    timelineSelectedEventRange.value?.durationSeconds ?? TIMELINE_MIN_DURATION
  )
})

const timelineRangeStart = computed(() => {
  return timelineCommittedRangeStart.value
})

const timelineRangeDuration = computed(() => {
  return timelineCommittedRangeDuration.value
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

}

const scheduleTimelinePlaybackProgressRender = () => {
  if (typeof requestAnimationFrame === 'undefined') {
    renderTimelinePlaybackProgress()
    return
  }
  if (timelineProgressRenderRafId !== null) return
  timelineProgressRenderRafId = requestAnimationFrame(renderTimelinePlaybackProgress)
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

const timelineBeatMarkers = computed<TimelineBeatMarker[]>(() => {
  const anchor = beatGridAnchor.value
  const period = beatGridPeriod.value
  const rangeStart = timelineRangeStart.value
  const rangeDuration = timelineRangeDuration.value
  const rangeEnd = rangeStart + rangeDuration
  if (
    anchor === null
    || period === null
    || !Number.isFinite(anchor)
    || !Number.isFinite(period)
    || period <= 0
    || rangeDuration <= 0
  ) {
    return []
  }

  const epsilon = Math.min(1e-4, period * 0.001)
  const firstIndex = Math.ceil((rangeStart - anchor) / period - epsilon)
  const lastIndex = Math.floor((rangeEnd - anchor) / period + epsilon)
  if (
    !Number.isFinite(firstIndex)
    || !Number.isFinite(lastIndex)
    || lastIndex < firstIndex
  ) {
    return []
  }

  const beatCount = lastIndex - firstIndex + 1
  const pixelsPerBeat = (
    timelinePixelWidth.value * period
  ) / rangeDuration
  const readableStep = Math.max(
    1,
    Math.ceil(4 / Math.max(pixelsPerBeat, 1e-6))
  )
  const markerStep = Math.max(
    readableStep,
    Math.ceil(beatCount / TIMELINE_BEAT_MARKER_LIMIT)
  )
  const markers: TimelineBeatMarker[] = []
  for (
    let beatIndex = firstIndex;
    beatIndex <= lastIndex;
    beatIndex += markerStep
  ) {
    const time = anchor + beatIndex * period
    if (time < rangeStart - epsilon || time > rangeEnd + epsilon) continue

    markers.push({
      key: `timeline-beat-${beatIndex}`,
      time,
      left: Math.max(
        0,
        Math.min(100, ((time - rangeStart) / rangeDuration) * 100)
      )
    })
  }
  return markers
})

const timelinePresetDropTimeLabel = computed(() => {
  const position = timelinePresetDropPosition.value
  if (position === null) return ''

  const time = timelineRangeStart.value
    + (position / 100) * timelineRangeDuration.value
  return formatTimelineTime(time, timelineRangeEnd.value >= 3600)
})

const selectedTimelineEventLabel = computed(() => {
  const event = selectedTimelineEvent.value
  if (!event) return ''

  const startTime = isValidTriggerTime(event.time) ? parseTimeToSeconds(event.time) : 0
  const durationSeconds = (getEventRangeDurationMs(event) ?? 0) / 1000
  const position = formatTimelineTime(startTime, timelineRangeEnd.value >= 3600)
  return `ID ${event.id} · ${event.name} · ${position} · ${Math.round(durationSeconds)}s`
})

const timelineDurationLabel = computed(() => {
  return formatTimelineTime(videoDuration.value, videoDuration.value >= 3600)
})

const timelineCurrentTimeLabel = computed(() => {
  return formatTimelineTime(videoCurrentTime.value, videoDuration.value >= 3600)
})

const TIMELINE_RULER_STEPS = [
  1, 2, 5, 10, 15, 30,
  60, 120, 300, 600, 900, 1800, 3600, 7200
]
const TIMELINE_RULER_TARGET_LABEL_WIDTH = 82
const TIMELINE_MIN_RULER_STEP_SECONDS = 1

const getTimelineRulerStep = (duration: number, pixelWidth: number) => {
  const targetLabelCount = Math.max(
    2,
    Math.floor(
      Math.max(240, pixelWidth) / TIMELINE_RULER_TARGET_LABEL_WIDTH
    )
  )
  const rawStep = duration / targetLabelCount
  return TIMELINE_RULER_STEPS.find(step => step >= rawStep)
    ?? Math.ceil(rawStep / 3600) * 3600
}

const getTimelineMinorTickStep = (majorStep: number) => {
  const divisor = [10, 5, 4, 2, 1].find(value => majorStep / value >= 0.05) ?? 1
  return Math.max(TIMELINE_MIN_RULER_STEP_SECONDS, majorStep / divisor)
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
      label: formatTimelineTime(time, rangeEnd >= 3600),
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

// 波形按固定绝对时间分桶缓存峰值，区间变化时只补采集缺失分桶。
const TIMELINE_WAVEFORM_BASE_BINS = 65536
const TIMELINE_WAVEFORM_CAPTURE_SAMPLE_RATE = 8000
const TIMELINE_WAVEFORM_CAPTURE_BUFFER_SIZE = 256
const TIMELINE_WAVEFORM_CAPTURE_CHUNK_SECONDS = 30
const TIMELINE_WAVEFORM_CAPTURE_PREROLL_SECONDS = 8
const TIMELINE_WAVEFORM_CACHE_BINS_PER_SECOND = 64
const TIMELINE_WAVEFORM_CACHE_LIMIT = 2048
const TIMELINE_WAVEFORM_CAPTURE_END_TOLERANCE_SECONDS = 0.02
const TIMELINE_WAVEFORM_CAPTURE_MAX_ATTEMPTS = 3
const TIMELINE_WAVEFORM_INTERACTION_IDLE_MS = 140
let timelineWaveformBasePeaks: Float32Array | null = null
let timelineWaveformMaxPeak = 0
let timelineWaveformDrawRafId = 0
let timelineWaveformInteractionActive = false
let timelineWaveformRefreshPending = false
let timelineWaveformInteractionTimer: ReturnType<typeof setTimeout> | null = null
let timelineWaveformCacheRevision = 0
let timelineWaveformPeaksRevision = -1

interface TimelineWaveformCacheChunk {
  start: number
  end: number
  peaks: Float32Array
  maxPeak: number
  capturedUntil: number
  audioBlockCount: number
  usedAt: number
}

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
let timelineThumbnailCacheSource: string | null = null
let timelineThumbnailSamples: TimelineThumbnailSample[] = []
let timelineThumbnailWorkers: HTMLVideoElement[] = []
let timelineThumbnailEncoders: TimelineThumbnailEncoder[] = []
let timelineThumbnailEncoderRequestId = 0
const TIMELINE_THUMBNAIL_CACHE_LIMIT = 512

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

const resetTimelineThumbnailCache = (source: string | null = null) => {
  timelineThumbnailCacheSource = source
  timelineThumbnailSamples = []
}

const insertTimelineThumbnailSample = (
  source: string,
  time: number,
  src: string
) => {
  if (timelineThumbnailCacheSource !== source) {
    resetTimelineThumbnailCache(source)
  }

  const usedAt = Date.now()
  const existingIndex = timelineThumbnailSamples.findIndex(sample => {
    return Math.abs(sample.time - time) < 0.08
  })
  if (existingIndex >= 0) {
    timelineThumbnailSamples[existingIndex] = { time, src, usedAt }
  } else {
    timelineThumbnailSamples.push({ time, src, usedAt })
  }

  if (timelineThumbnailSamples.length <= TIMELINE_THUMBNAIL_CACHE_LIMIT) {
    return
  }

  timelineThumbnailSamples = timelineThumbnailSamples
    .sort((a, b) => b.usedAt - a.usedAt)
    .slice(0, TIMELINE_THUMBNAIL_CACHE_LIMIT)
}

const clearTimelineThumbnails = () => {
  timelineThumbnailTaskVersion++
  if (timelineThumbnailDebounceTimer) {
    clearTimeout(timelineThumbnailDebounceTimer)
    timelineThumbnailDebounceTimer = null
  }
  timelineThumbnails.value = []
  stopTimelineThumbnailWorkers()
  stopTimelineThumbnailEncoders()
  cancelRenderTask('thumbnail')
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

const buildTimelineThumbnailOrder = (indexes: number[]) => {
  if (indexes.length <= 1) return [...indexes]

  const order = [indexes[0]!, indexes[indexes.length - 1]!]
  const addMiddleFirst = (start: number, end: number) => {
    if (start > end) return
    const middle = Math.floor((start + end) / 2)
    const index = indexes[middle]
    if (index !== undefined) {
      order.push(index)
    }
    addMiddleFirst(start, middle - 1)
    addMiddleFirst(middle + 1, end)
  }
  addMiddleFirst(1, indexes.length - 2)
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
  cached: TimelineThumbnailSample[],
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
  const maxReuseDistance = Math.max(
    0.05,
    (rangeDuration / Math.max(1, count)) * 1.2
  )
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

    const canReuse = nearest
      && Math.abs(nearest.time - time) <= maxReuseDistance
    if (canReuse && nearest) {
      nearest.usedAt = Date.now()
    }

    preview.push(canReuse && nearest
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
  const rangeStart = timelineCommittedRangeStart.value
  const rangeDuration = timelineCommittedRangeDuration.value

  if (
    !source ||
    sourceDuration <= 0 ||
    count <= 0 ||
    timelineEventId.value === null ||
    rangeDuration <= 0
  ) {
    return
  }

  if (timelineThumbnailCacheSource !== source) {
    resetTimelineThumbnailCache(source)
  }

  const preview = buildTimelineThumbnailPreview(
    timelineThumbnailSamples,
    count,
    rangeStart,
    rangeDuration,
    sourceDuration
  )
  timelineThumbnails.value = preview.filter(
    (thumbnail): thumbnail is TimelineThumbnail => thumbnail !== null
  )
  const missingIndexes = preview.flatMap((thumbnail, index) => {
    return thumbnail ? [] : [index]
  })
  if (missingIndexes.length === 0) return

  const taskVersion = ++timelineThumbnailTaskVersion
  const renderTaskToken = beginRenderTask('thumbnail')
  let renderTaskFinished = false
  stopTimelineThumbnailWorkers()

  const workerCount = Math.min(
    missingIndexes.length,
    getTimelineThumbnailWorkerCount(missingIndexes.length)
  )
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

    const order = buildTimelineThumbnailOrder(missingIndexes)
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
          insertTimelineThumbnailSample(source, time, src)
          completedCount++
          updateRenderTask(
            'thumbnail',
            renderTaskToken,
            completedCount / count
          )
          publish(completedCount === missingIndexes.length)
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
      renderTaskFinished = true
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
    if (renderTaskFinished) {
      finishRenderTask('thumbnail', renderTaskToken)
    } else {
      cancelRenderTask('thumbnail', renderTaskToken)
    }
  }
}

const scheduleTimelineThumbnailGeneration = () => {
  if (effectiveDesignViewMode.value !== 'timeline') return

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
let timelineWaveformCacheSource: string | null = null
const timelineWaveformCacheChunks = new Map<number, TimelineWaveformCacheChunk>()

const getTimelineWaveformKey = (
  source: string,
  rangeStart: number,
  rangeDuration: number
) => {
  return `${source}|${rangeStart.toFixed(3)}|${rangeDuration.toFixed(3)}`
}

const resetTimelineWaveformCache = (source: string | null = null) => {
  timelineWaveformCacheSource = source
  timelineWaveformCacheChunks.clear()
  timelineWaveformCacheRevision++
  timelineWaveformPeaksRevision = -1
}

const isTimelineWaveformChunkValid = (
  chunk: TimelineWaveformCacheChunk
) => {
  return (
    chunk.audioBlockCount > 0 &&
    chunk.capturedUntil >= (
      chunk.end - TIMELINE_WAVEFORM_CAPTURE_END_TOLERANCE_SECONDS
    )
  )
}

const clearTimelineWaveformInteractionTimer = () => {
  if (timelineWaveformInteractionTimer) {
    clearTimeout(timelineWaveformInteractionTimer)
    timelineWaveformInteractionTimer = null
  }
}

const trimTimelineWaveformCache = () => {
  if (timelineWaveformCacheChunks.size <= TIMELINE_WAVEFORM_CACHE_LIMIT) return

  const oldestChunks = [...timelineWaveformCacheChunks.entries()]
    .sort((a, b) => a[1].usedAt - b[1].usedAt)
  const removeCount = timelineWaveformCacheChunks.size - TIMELINE_WAVEFORM_CACHE_LIMIT
  for (let index = 0; index < removeCount; index++) {
    const entry = oldestChunks[index]
    if (entry) {
      timelineWaveformCacheChunks.delete(entry[0])
    }
  }
}

const publishTimelineWaveformChunks = () => {
  if (timelineWaveformInteractionActive) {
    timelineWaveformRefreshPending = true
    return
  }

  const rangeStart = timelineCommittedRangeStart.value
  const rangeDuration = timelineCommittedRangeDuration.value
  const rangeEnd = rangeStart + rangeDuration
  if (
    timelineEventId.value === null ||
    timelineWaveformBasePeaks === null ||
    rangeDuration <= 0 ||
    rangeEnd <= rangeStart
  ) {
    timelineWaveformReady.value = false
    scheduleTimelineWaveformDraw()
    return
  }

  const completedRangeEnd = Math.min(videoDuration.value, rangeEnd)
  timelineWaveformReady.value = (
    getTimelineWaveformMissingChunkIndexes(
      rangeStart,
      completedRangeEnd
    ).length === 0
  )
  nextTick(scheduleTimelineWaveformDraw)
}

const refreshTimelineWaveformFromCache = () => {
  timelineWaveformRefreshPending = false
  const rangeStart = timelineCommittedRangeStart.value
  const rangeDuration = Math.max(
    TIMELINE_MIN_DURATION,
    timelineCommittedRangeDuration.value
  )
  if (timelineEventId.value === null || rangeDuration <= 0) {
    timelineWaveformBasePeaks = null
    timelineWaveformMaxPeak = 0
    timelineWaveformReady.value = false
    scheduleTimelineWaveformDraw(true)
    return
  }

  const rangeEnd = Math.min(
    videoDuration.value,
    rangeStart + rangeDuration
  )
  if (
    getTimelineWaveformMissingChunkIndexes(rangeStart, rangeEnd).length > 0
  ) {
    timelineWaveformReady.value = false
    scheduleTimelineWaveformDraw(true)
    return
  }

  if (
    timelineWaveformPeaksRevision !== timelineWaveformCacheRevision
    || !timelineWaveformBasePeaks
  ) {
    const rangePeaks = buildTimelineWaveformRangePeaks(
      rangeStart,
      rangeDuration
    )
    timelineWaveformBasePeaks = rangePeaks.peaks
    timelineWaveformMaxPeak = rangePeaks.maxPeak
    timelineWaveformPeaksRevision = timelineWaveformCacheRevision
  }

  publishTimelineWaveformChunks()
  scheduleTimelineWaveformDraw(true)
}

const finishTimelineWaveformInteraction = () => {
  clearTimelineWaveformInteractionTimer()
  timelineWaveformInteractionActive = false
  if (timelineWaveformRefreshPending) {
    refreshTimelineWaveformFromCache()
  }
}

const beginTimelineWaveformInteraction = () => {
  timelineWaveformInteractionActive = true
  timelineWaveformRefreshPending = true
  clearTimelineWaveformInteractionTimer()
  timelineWaveformInteractionTimer = setTimeout(
    finishTimelineWaveformInteraction,
    TIMELINE_WAVEFORM_INTERACTION_IDLE_MS
  )
}

const getTimelineWaveformCachePeak = (startTime: number, endTime: number) => {
  if (endTime <= startTime) return 0

  let peak = 0
  const firstChunkIndex = Math.floor(
    startTime / TIMELINE_WAVEFORM_CAPTURE_CHUNK_SECONDS
  )
  const lastChunkIndex = Math.floor(
    Math.max(startTime, endTime - 1e-6)
    / TIMELINE_WAVEFORM_CAPTURE_CHUNK_SECONDS
  )

  for (
    let chunkIndex = firstChunkIndex;
    chunkIndex <= lastChunkIndex;
    chunkIndex++
  ) {
    const chunk = timelineWaveformCacheChunks.get(chunkIndex)
    if (!chunk || !isTimelineWaveformChunkValid(chunk)) continue

    const overlapStart = Math.max(startTime, chunk.start)
    const overlapEnd = Math.min(endTime, chunk.end)
    if (overlapEnd <= overlapStart) continue

    const firstBin = Math.max(
      0,
      Math.floor(
        (overlapStart - chunk.start) * TIMELINE_WAVEFORM_CACHE_BINS_PER_SECOND
      )
    )
    const lastBin = Math.min(
      chunk.peaks.length - 1,
      Math.max(
        firstBin,
        Math.ceil(
          (overlapEnd - chunk.start) * TIMELINE_WAVEFORM_CACHE_BINS_PER_SECOND
        ) - 1
      )
    )

    for (let bin = firstBin; bin <= lastBin; bin++) {
      const value = chunk.peaks[bin] ?? 0
      if (value > peak) peak = value
    }
  }

  return peak
}

const touchTimelineWaveformCacheRange = (
  rangeStart: number,
  rangeEnd: number
) => {
  const firstChunkIndex = Math.floor(
    rangeStart / TIMELINE_WAVEFORM_CAPTURE_CHUNK_SECONDS
  )
  const lastChunkIndex = Math.floor(
    Math.max(rangeStart, rangeEnd - 1e-6)
    / TIMELINE_WAVEFORM_CAPTURE_CHUNK_SECONDS
  )
  const usedAt = Date.now()

  for (
    let chunkIndex = firstChunkIndex;
    chunkIndex <= lastChunkIndex;
    chunkIndex++
  ) {
    const chunk = timelineWaveformCacheChunks.get(chunkIndex)
    if (chunk && isTimelineWaveformChunkValid(chunk)) {
      chunk.usedAt = usedAt
    }
  }
}

const buildTimelineWaveformRangePeaks = (
  rangeStart: number,
  rangeDuration: number
) => {
  const peaks = new Float32Array(TIMELINE_WAVEFORM_BASE_BINS)
  let maxPeak = 0
  const binDuration = rangeDuration / TIMELINE_WAVEFORM_BASE_BINS

  for (let bin = 0; bin < TIMELINE_WAVEFORM_BASE_BINS; bin++) {
    const startTime = rangeStart + bin * binDuration
    const peak = getTimelineWaveformCachePeak(
      startTime,
      startTime + binDuration
    )
    peaks[bin] = peak
    if (peak > maxPeak) maxPeak = peak
  }
  touchTimelineWaveformCacheRange(rangeStart, rangeStart + rangeDuration)

  return {
    peaks,
    maxPeak: Math.max(0.001, maxPeak)
  }
}

const getTimelineWaveformMissingChunkIndexes = (
  rangeStart: number,
  rangeEnd: number
) => {
  const firstChunkIndex = Math.floor(
    rangeStart / TIMELINE_WAVEFORM_CAPTURE_CHUNK_SECONDS
  )
  const lastChunkIndex = Math.floor(
    Math.max(rangeStart, rangeEnd - 1e-6)
    / TIMELINE_WAVEFORM_CAPTURE_CHUNK_SECONDS
  )
  const missingChunkIndexes: number[] = []

  for (
    let chunkIndex = firstChunkIndex;
    chunkIndex <= lastChunkIndex;
    chunkIndex++
  ) {
    const chunk = timelineWaveformCacheChunks.get(chunkIndex)
    if (!chunk || !isTimelineWaveformChunkValid(chunk)) {
      missingChunkIndexes.push(chunkIndex)
    }
  }

  return missingChunkIndexes
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
  clearTimelineWaveformInteractionTimer()
  timelineWaveformInteractionActive = false
  timelineWaveformRefreshPending = false
  timelineWaveformBasePeaks = null
  timelineWaveformMaxPeak = 0
  timelineWaveformPeaksRevision = -1
  timelineWaveformReady.value = false
  stopTimelineWaveformCapture()
  cancelRenderTask('waveform')
  closeTimelineWaveformContext()
  scheduleTimelineWaveformDraw()
}

const drawTimelineWaveform = (force = false) => {
  timelineWaveformDrawRafId = 0
  if (timelineWaveformInteractionActive && !force) {
    timelineWaveformRefreshPending = true
    return
  }

  const canvas = timelineWaveformCanvasRef.value
  const basePeaks = timelineWaveformBasePeaks
  if (
    effectiveDesignViewMode.value !== 'timeline' ||
    timelineEventId.value === null ||
    !timelineWaveformReady.value ||
    !canvas ||
    !basePeaks ||
    basePeaks.length === 0
  ) {
    return
  }

  const rect = canvas.getBoundingClientRect()
  const renderWidth = Math.min(
    8192,
    Math.max(1, Math.ceil(rect.width || canvas.clientWidth))
  )
  const height = TIMELINE_WAVEFORM_LANE_HEIGHT
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

  if (
    canvas.width !== Math.round(renderWidth * dpr) ||
    canvas.height !== Math.round(height * dpr)
  ) {
    canvas.width = Math.round(renderWidth * dpr)
    canvas.height = Math.round(height * dpr)
  }

  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, renderWidth, height)

  const centerY = height / 2
  const maxAmplitude = centerY - 2
  context.beginPath()
  context.moveTo(0, centerY + 0.5)
  context.lineTo(renderWidth, centerY + 0.5)
  context.strokeStyle = 'rgba(170, 179, 191, 0.16)'
  context.lineWidth = 1
  context.stroke()

  const binCount = basePeaks.length
  context.beginPath()
  for (let x = 0; x < renderWidth; x++) {
    const firstBin = Math.max(
      0,
      Math.floor((x / renderWidth) * binCount)
    )
    const lastBin = Math.max(
      firstBin,
      Math.min(
        binCount - 1,
        Math.ceil(((x + 1) / renderWidth) * binCount) - 1
      )
    )
    let peak = 0
    for (let bin = firstBin; bin <= lastBin; bin++) {
      const value = basePeaks[bin] ?? 0
      if (value > peak) peak = value
    }

    const normalizedPeak = Math.sqrt(
      peak / Math.max(0.001, timelineWaveformMaxPeak)
    )
    const amplitude = Math.max(0.6, normalizedPeak * maxAmplitude)
    const drawX = x + 0.5
    context.moveTo(drawX, centerY - amplitude)
    context.lineTo(drawX, centerY + amplitude)
  }
  context.strokeStyle = 'rgba(138, 180, 248, 0.72)'
  context.lineWidth = 1
  context.stroke()
}

const setTimelineWaveformCanvasRef = (element: unknown) => {
  timelineWaveformCanvasRef.value = element instanceof HTMLCanvasElement
    ? element
    : null
  if (timelineWaveformCanvasRef.value) {
    scheduleTimelineWaveformDraw()
  }
}

const scheduleTimelineWaveformDraw = (force = false) => {
  if (timelineWaveformInteractionActive && !force) {
    timelineWaveformRefreshPending = true
    return
  }
  if (timelineWaveformDrawRafId) return
  if (typeof requestAnimationFrame === 'undefined') {
    drawTimelineWaveform(force)
    return
  }
  timelineWaveformDrawRafId = requestAnimationFrame(() => {
    timelineWaveformDrawRafId = 0
    drawTimelineWaveform(force)
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
  beginTimelineWaveformInteraction()
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
  taskVersion: number,
  renderTaskToken: number
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
  const missingChunkIndexes = getTimelineWaveformMissingChunkIndexes(
    rangeStart,
    rangeEnd
  )
  if (missingChunkIndexes.length === 0) {
    return buildTimelineWaveformRangePeaks(rangeStart, rangeDuration)
  }

  const video = document.createElement('video')
  video.preload = 'auto'
  video.playsInline = true
  video.preservesPitch = false
  ;(video as HTMLVideoElement & { webkitPreservesPitch?: boolean })
    .webkitPreservesPitch = false
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
    const firstMissingChunkIndex = missingChunkIndexes[0] ?? 0
    const seekTarget = Math.max(
      0,
      Math.min(
        firstMissingChunkIndex * TIMELINE_WAVEFORM_CAPTURE_CHUNK_SECONDS
          - TIMELINE_WAVEFORM_CAPTURE_PREROLL_SECONDS,
        totalDuration
      )
    )
    if (Math.abs(video.currentTime - seekTarget) > 0.001 || video.seeking) {
      video.currentTime = seekTarget
      const seekStartedAt = performance.now()
      while (
        (
          video.seeking ||
          Math.abs(video.currentTime - seekTarget) > 0.02
        ) &&
        performance.now() - seekStartedAt < 12000
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

    let activePlaybackRate = 1
    let activeChunkPeaks = new Float32Array(0)
    let activeChunkMaxPeak = 0
    let lastPublishTime = 0
    let captureAudioAnchorTime = 0
    let captureSourceAnchorTime = seekTarget
    let captureStarted = false
    let captureArmed = false
    let activeChunkStart = seekTarget
    let activeChunkEnd = seekTarget
    let activeChunkCapturedUntil = seekTarget
    let activeChunkAudioBlockCount = 0

    const publishPeaks = (force = false) => {
      if (
        taskVersion !== timelineWaveformTaskVersion ||
        cacheKey !== timelineWaveformLoadingKey
      ) {
        return
      }
      if (timelineWaveformInteractionActive) {
        timelineWaveformRefreshPending = true
        return
      }
      const rangeEnd = Math.min(
        videoDuration.value,
        rangeStart + rangeDuration
      )
      if (
        getTimelineWaveformMissingChunkIndexes(rangeStart, rangeEnd).length > 0
      ) {
        timelineWaveformReady.value = false
        return
      }
      const now = performance.now()
      if (!force && now - lastPublishTime < 120) return
      lastPublishTime = now
      let peaksChanged = false
      if (
        timelineWaveformPeaksRevision !== timelineWaveformCacheRevision
        || !timelineWaveformBasePeaks
      ) {
        const rangePeaks = buildTimelineWaveformRangePeaks(
          rangeStart,
          rangeDuration
        )
        timelineWaveformBasePeaks = rangePeaks.peaks
        timelineWaveformMaxPeak = rangePeaks.maxPeak
        timelineWaveformPeaksRevision = timelineWaveformCacheRevision
        peaksChanged = true
      }
      if (peaksChanged || force) {
        publishTimelineWaveformChunks()
      }
    }

    processor.onaudioprocess = (event) => {
      if (
        taskVersion !== timelineWaveformTaskVersion ||
        cacheKey !== timelineWaveformLoadingKey
      ) {
        return
      }
      if (!captureArmed || (video.paused && !video.ended)) return

      const input = event.inputBuffer.getChannelData(0)
      const blockSourceDuration = (
        input.length / context.sampleRate
      ) * activePlaybackRate
      if (video.seeking) return

      const blockPlaybackTime = Number.isFinite(event.playbackTime)
        ? event.playbackTime
        : context.currentTime
      const actualSourceTime = video.currentTime
      if (!captureStarted) {
        captureStarted = true
        captureAudioAnchorTime = blockPlaybackTime
        captureSourceAnchorTime = Math.max(
          captureSourceAnchorTime,
          Number.isFinite(actualSourceTime)
            ? actualSourceTime - blockSourceDuration
            : captureSourceAnchorTime
        )
      } else if (Number.isFinite(actualSourceTime)) {
        const expectedBlockEnd = captureSourceAnchorTime
          + Math.max(0, blockPlaybackTime - captureAudioAnchorTime) *
            activePlaybackRate
          + blockSourceDuration
        if (
          Math.abs(actualSourceTime - expectedBlockEnd) >
          Math.max(0.05, blockSourceDuration * 1.5)
        ) {
          captureSourceAnchorTime = Math.max(
            0,
            actualSourceTime - blockSourceDuration
          )
          captureAudioAnchorTime = blockPlaybackTime
        }
      }
      const callbackStartTime = captureSourceAnchorTime + Math.max(
        0,
        blockPlaybackTime - captureAudioAnchorTime
      ) * activePlaybackRate
      const callbackEndTime = callbackStartTime + blockSourceDuration
      if (
        callbackEndTime > activeChunkStart &&
        callbackStartTime < activeChunkEnd
      ) {
        activeChunkAudioBlockCount++
        activeChunkCapturedUntil = Math.max(
          activeChunkCapturedUntil,
          Math.min(callbackEndTime, activeChunkEnd)
        )
      }
      for (let index = 0; index < input.length; index++) {
        const sourceTime = callbackStartTime
          + (index / context.sampleRate) * activePlaybackRate
        if (
          sourceTime < activeChunkStart ||
          sourceTime >= activeChunkEnd
        ) {
          continue
        }

        const relative = sourceTime - activeChunkStart
        const bin = Math.max(
          0,
          Math.min(
            activeChunkPeaks.length - 1,
            Math.floor(relative * TIMELINE_WAVEFORM_CACHE_BINS_PER_SECOND)
          )
        )
        const peak = Math.abs(input[index] ?? 0)
        if (peak > (activeChunkPeaks[bin] ?? 0)) {
          activeChunkPeaks[bin] = peak
        }
        if (peak > activeChunkMaxPeak) activeChunkMaxPeak = peak
      }
      publishPeaks()
      if (
        activeChunkCapturedUntil >= (
          activeChunkEnd - TIMELINE_WAVEFORM_CAPTURE_END_TOLERANCE_SECONDS
        )
      ) {
        captureArmed = false
        timelineWaveformCaptureFinish?.(true)
      }
    }

    const waitForChunkBoundary = (chunkEnd: number) => (
      new Promise<boolean>((resolve) => {
        let settled = false
        let endedAt = 0
        const chunkDuration = Math.max(0, chunkEnd - activeChunkStart)
        const timeoutId = setTimeout(() => {
          finish(false)
        }, Math.max(
          12000,
          (chunkDuration / Math.max(1, activePlaybackRate)) * 4000 + 5000
        ))
        const cleanup = () => {
          clearTimeout(timeoutId)
          if (timelineWaveformCaptureFinish === finish) {
            timelineWaveformCaptureFinish = null
          }
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
        const handleEnded = () => {
          endedAt = performance.now()
        }
        const handleError = () => finish(false)
        const checkRange = () => {
          if (
            taskVersion !== timelineWaveformTaskVersion ||
            cacheKey !== timelineWaveformLoadingKey
          ) {
            finish(false)
            return
          }
          if (
            activeChunkCapturedUntil >= (
              chunkEnd - TIMELINE_WAVEFORM_CAPTURE_END_TOLERANCE_SECONDS
            )
          ) {
            finish(true)
          } else if (
            Number.isFinite(video.currentTime) &&
            video.currentTime >= (
              chunkEnd - TIMELINE_WAVEFORM_CAPTURE_END_TOLERANCE_SECONDS
            )
          ) {
            finish(true)
          } else if (
            video.ended &&
            endedAt > 0 &&
            performance.now() - endedAt > 400
          ) {
            finish(
              chunkEnd >= (
                totalDuration - TIMELINE_WAVEFORM_CAPTURE_END_TOLERANCE_SECONDS
              )
            )
          }
        }

        timelineWaveformCaptureFinish = finish
        video.addEventListener('ended', handleEnded, { once: true })
        video.addEventListener('error', handleError, { once: true })
        timelineWaveformCaptureTimer = setInterval(checkRange, 32)
        checkRange()
      })
    )

    const chunkAttempts = new Map<number, number>()
    for (
      let missingIndex = 0;
      missingIndex < missingChunkIndexes.length;
      missingIndex++
    ) {
      const chunkIndex = missingChunkIndexes[missingIndex]
      if (chunkIndex === undefined) continue

      const chunkStart = chunkIndex * TIMELINE_WAVEFORM_CAPTURE_CHUNK_SECONDS
      const chunkEnd = Math.min(
        totalDuration,
        chunkStart + TIMELINE_WAVEFORM_CAPTURE_CHUNK_SECONDS
      )
      if (chunkEnd <= chunkStart) continue

      const attempt = chunkAttempts.get(chunkIndex) ?? 0
      const isRetry = attempt > 0
      const canRetry = attempt + 1 < TIMELINE_WAVEFORM_CAPTURE_MAX_ATTEMPTS
      const captureSeekTarget = Math.max(
        0,
        chunkStart - TIMELINE_WAVEFORM_CAPTURE_PREROLL_SECONDS
      )
      if (missingIndex > 0 || isRetry) {
        captureArmed = false
        video.pause()
        video.currentTime = captureSeekTarget
        const seekStartedAt = performance.now()
        while (
          (
            video.seeking ||
            Math.abs(video.currentTime - captureSeekTarget) > 0.02
          ) &&
          performance.now() - seekStartedAt < 12000
        ) {
          await new Promise<void>((resolve) => setTimeout(resolve, 16))
        }
        if (
          video.seeking ||
          Math.abs(video.currentTime - captureSeekTarget) > 0.02 ||
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          return null
        }
      }

      activeChunkStart = chunkStart
      activeChunkEnd = chunkEnd
      captureSourceAnchorTime = captureSeekTarget
      captureAudioAnchorTime = 0
      captureStarted = false
      const chunkDuration = chunkEnd - chunkStart
      let requestedPlaybackRate = chunkDuration <= 2
        ? 2
        : chunkDuration <= 5
          ? 4
          : chunkDuration <= 15
            ? 6
            : 8
      if (isRetry) {
        requestedPlaybackRate = Math.max(
          1,
          Math.min(requestedPlaybackRate, 4 / attempt)
        )
      }
      try {
        video.playbackRate = requestedPlaybackRate
      } catch {
        requestedPlaybackRate = 4
        video.playbackRate = requestedPlaybackRate
      }
      activePlaybackRate = Math.max(1, video.playbackRate || requestedPlaybackRate)
      activeChunkPeaks = new Float32Array(
        Math.max(
          1,
          Math.ceil(
            chunkDuration * TIMELINE_WAVEFORM_CACHE_BINS_PER_SECOND
          )
        )
      )
      activeChunkMaxPeak = 0
      activeChunkCapturedUntil = chunkStart
      activeChunkAudioBlockCount = 0

      const chunkCompleted = waitForChunkBoundary(chunkEnd)
      captureAudioAnchorTime = 0
      captureSourceAnchorTime = captureSeekTarget
      captureStarted = false
      if (context.state !== 'running') {
        try {
          await context.resume()
        } catch {
          return null
        }
      }
      captureArmed = true
      try {
        await video.play()
      } catch {
        captureArmed = false
        if (canRetry) {
          chunkAttempts.set(chunkIndex, attempt + 1)
          await new Promise<void>((resolve) => setTimeout(resolve, 180))
          missingIndex--
          continue
        }
        return null
      }
      if (!(await chunkCompleted)) {
        captureArmed = false
        video.pause()
        if (canRetry) {
          chunkAttempts.set(chunkIndex, attempt + 1)
          await new Promise<void>((resolve) => setTimeout(resolve, 180))
          missingIndex--
          continue
        }
        return null
      }

      // 等待音频链排空当前分段末尾的缓冲样本，再定位下一段。
      await new Promise<void>((resolve) => setTimeout(resolve, 180))
      if (
        taskVersion !== timelineWaveformTaskVersion ||
        cacheKey !== timelineWaveformLoadingKey
      ) {
        return null
      }
      const capturedChunk: TimelineWaveformCacheChunk = {
        start: chunkStart,
        end: chunkEnd,
        peaks: activeChunkPeaks,
        maxPeak: activeChunkMaxPeak,
        capturedUntil: Math.min(activeChunkCapturedUntil, chunkEnd),
        audioBlockCount: activeChunkAudioBlockCount,
        usedAt: Date.now()
      }
      const chunkIsValid = isTimelineWaveformChunkValid(capturedChunk)
      if (!chunkIsValid || capturedChunk.maxPeak <= 1e-6) {
        captureArmed = false
        video.pause()
        if (canRetry) {
          chunkAttempts.set(chunkIndex, attempt + 1)
          await new Promise<void>((resolve) => setTimeout(resolve, 180))
          missingIndex--
          continue
        }
        if (!chunkIsValid) {
          return null
        }
      }
      timelineWaveformCacheChunks.set(chunkIndex, capturedChunk)
      timelineWaveformCacheRevision++
      trimTimelineWaveformCache()
      publishPeaks(true)
      updateRenderTask(
        'waveform',
        renderTaskToken,
        (missingIndex + 1) / missingChunkIndexes.length
      )
      captureArmed = false
      video.pause()
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 120))
    publishPeaks(true)

    return buildTimelineWaveformRangePeaks(rangeStart, rangeDuration)
  } catch {
    return null
  } finally {
    stopTimelineWaveformCapture(taskVersion)
  }
}

const loadTimelineWaveform = async () => {
  if (effectiveDesignViewMode.value !== 'timeline') return

  const source = videoSrc.value
  const rangeStart = timelineCommittedRangeStart.value
  const rangeDuration = timelineCommittedRangeDuration.value
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
  if (timelineWaveformCacheSource !== source) {
    resetTimelineWaveformCache(source)
  }
  const rangeEnd = Math.min(
    videoDuration.value,
    rangeStart + rangeDuration
  )
  if (
    getTimelineWaveformMissingChunkIndexes(rangeStart, rangeEnd).length === 0
  ) {
    const rangePeaks = buildTimelineWaveformRangePeaks(
      rangeStart,
      rangeDuration
    )
    timelineWaveformBasePeaks = rangePeaks.peaks
    timelineWaveformMaxPeak = rangePeaks.maxPeak
    timelineWaveformPeaksRevision = timelineWaveformCacheRevision
    timelineWaveformLoadedKey = cacheKey
    publishTimelineWaveformChunks()
    return
  }

  const taskVersion = ++timelineWaveformTaskVersion
  const renderTaskToken = beginRenderTask('waveform')
  let renderTaskFinished = false
  timelineWaveformLoadingKey = cacheKey
  timelineWaveformReady.value = false
  timelineWaveformBasePeaks = null
  timelineWaveformMaxPeak = 0
  timelineWaveformPeaksRevision = -1
  stopTimelineWaveformCapture()

  try {
    const rangePeaks = await captureTimelineWaveformByPlayback(
      source,
      rangeStart,
      rangeDuration,
      videoDuration.value,
      cacheKey,
      taskVersion,
      renderTaskToken
    )
    if (
      taskVersion !== timelineWaveformTaskVersion ||
      cacheKey !== timelineWaveformLoadingKey
    ) {
      return
    }
    renderTaskFinished = true
    if (!rangePeaks) {
      timelineWaveformBasePeaks = null
      timelineWaveformMaxPeak = 0
      timelineWaveformReady.value = false
      scheduleTimelineWaveformDraw()
      return
    }

    timelineWaveformBasePeaks = rangePeaks.peaks
    timelineWaveformMaxPeak = rangePeaks.maxPeak
    timelineWaveformPeaksRevision = timelineWaveformCacheRevision
    timelineWaveformLoadedKey = cacheKey
    publishTimelineWaveformChunks()
  } catch {
    if (taskVersion === timelineWaveformTaskVersion) {
      timelineWaveformReady.value = false
      timelineWaveformBasePeaks = null
      timelineWaveformMaxPeak = 0
      timelineWaveformPeaksRevision = -1
    }
  } finally {
    if (taskVersion === timelineWaveformTaskVersion) {
      timelineWaveformLoadingKey = null
      closeTimelineWaveformContext()
    }
    if (renderTaskFinished) {
      finishRenderTask('waveform', renderTaskToken)
    } else {
      cancelRenderTask('waveform', renderTaskToken)
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

const getTimelineClipElement = (triggerId: number) => {
  return timelineContentRef.value?.querySelector<HTMLElement>(
    `[data-timeline-trigger-id="${triggerId}"]`
  ) ?? null
}

const animateTimelineClipRemoval = (clip: HTMLElement) => {
  clip.classList.add('is-removing')
  return new Promise<void>((resolve) => {
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

const removeTimelinePresetIds = async (
  eventId: number,
  triggerIds: number[]
) => {
  const availableTriggerIds = new Set(
    timelinePresetItems.value
      .filter(item => item.event.id === eventId)
      .map(item => item.playback.triggerId)
  )
  const uniqueTriggerIds = [...new Set(triggerIds)].filter(
    triggerId => availableTriggerIds.has(triggerId)
  )
  if (uniqueTriggerIds.length === 0) return

  const removedIds = new Set(uniqueTriggerIds)
  selectedTimelineTriggerIds.value = selectedTimelineTriggerIds.value.filter(
    triggerId => !removedIds.has(triggerId)
  )
  const clips = uniqueTriggerIds
    .map(getTimelineClipElement)
    .filter((clip): clip is HTMLElement => clip !== null)
  await Promise.all(clips.map(animateTimelineClipRemoval))

  removeEventPresetTriggers(eventId, uniqueTriggerIds)
}

const removeTimelinePreset = async (item: TimelinePresetItem, event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()

  const targetIds = selectedTimelineTriggerIds.value.includes(
    item.playback.triggerId
  )
    ? selectedTimelineTriggerIds.value
    : [item.playback.triggerId]
  await removeTimelinePresetIds(item.event.id, targetIds)
}

const handleTimelineDeleteKey = (event: KeyboardEvent) => {
  if (
    (event.key !== 'Delete' && event.key !== 'Backspace')
    || selectedTimelineTriggerIds.value.length === 0
    || timelineEventId.value === null
  ) {
    return
  }

  const target = event.target
  if (target instanceof HTMLElement) {
    const tagName = target.tagName.toLowerCase()
    if (
      tagName === 'input'
      || tagName === 'textarea'
      || target.isContentEditable
    ) {
      return
    }
  }

  event.preventDefault()
  event.stopPropagation()
  void removeTimelinePresetIds(
    timelineEventId.value,
    selectedTimelineTriggerIds.value
  )
}

const seekTimelinePreset = (item: TimelinePresetItem) => {
  pauseTimelineFollow()
  selectedTimelineTriggerIds.value = [item.playback.triggerId]
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
    item.track,
    item.playback.singleDurationMs
  )
  if (!trigger) return

  selectTimelineEvent(item.event)

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

const getTimelineFillPointerTime = (clientX: number) => {
  const content = timelineContentRef.value
  if (!content) return timelineRangeStart.value

  const rect = content.getBoundingClientRect()
  if (rect.width <= 0) return timelineRangeStart.value

  const ratio = (clientX - rect.left) / rect.width
  return timelineRangeStart.value + ratio * timelineRangeDuration.value
}

const getTimelineFillMaxPreviewCount = (state: TimelineFillDragState) => {
  const explicitEndTime = (
    typeof state.item.event.endTime === 'string' &&
    state.item.event.endTime.trim() &&
    isValidTriggerTime(state.item.event.endTime)
  )
    ? parseTimeToSeconds(state.item.event.endTime)
    : null
  if (
    explicitEndTime === null ||
    explicitEndTime <= state.eventStartTime
  ) {
    return TIMELINE_FILL_MAX_PREVIEWS
  }

  const stepSeconds = Math.max(
    TIMELINE_MIN_DURATION,
    state.copyDurationSeconds
  )
  const maxRelativeOffset = Math.max(
    0,
    explicitEndTime - state.eventStartTime - 0.01
  )
  const sourceRelativeEnd = (
    state.item.startTime - state.eventStartTime + stepSeconds
  )
  const remainingSeconds = maxRelativeOffset - sourceRelativeEnd
  if (remainingSeconds < -1e-6) return 0

  return Math.min(
    TIMELINE_FILL_MAX_PREVIEWS,
    Math.floor((Math.max(0, remainingSeconds) + 1e-6) / stepSeconds) + 1
  )
}

const getTimelineFillRemovableItems = (state: TimelineFillDragState) => {
  const selectedTriggerIds = new Set(selectedTimelineTriggerIds.value)
  const useSelectedItems = (
    selectedTriggerIds.size > 1 &&
    selectedTriggerIds.has(state.item.playback.triggerId)
  )

  return timelinePresetItems.value
    .filter((item) => {
      const isSourceItem = (
        item.playback.triggerId === state.item.playback.triggerId
      )
      if (!isSourceItem && item.startTime >= state.item.startTime) {
        return false
      }
      return useSelectedItems
        ? selectedTriggerIds.has(item.playback.triggerId)
        : item.track === state.item.track
    })
    .sort((a, b) => a.startTime - b.startTime)
}

const clearTimelineFillPreview = (state: TimelineFillDragState | null) => {
  if (state) {
    state.copyStartTime = state.item.startTime
    state.copyDurationSeconds = state.item.durationSeconds
    state.direction = null
    state.previewCount = 0
    state.removePreviewTriggerIds = []
  }
  timelineFillSourceStartPreview.value = null
  timelineFillSourceDurationPreview.value = null
  timelineFillPreviews.value = []
  timelineFillRemovePreviewTriggerIds.value = []
}

const updateTimelineFillPreviewAt = (clientX: number) => {
  const state = timelineFillDragState
  if (!state) return

  const bpmIntervalSeconds = getTimelineBpmIntervalSeconds()
  const sourceDurationSeconds = Math.max(
    TIMELINE_MIN_DURATION,
    state.item.durationSeconds
  )
  state.copyStartTime = bpmIntervalSeconds === null
    ? state.item.startTime
    : getTimelineBpmAlignedTime(state.item.startTime)
  state.copyDurationSeconds = (
    bpmIntervalSeconds !== null
    && sourceDurationSeconds > bpmIntervalSeconds
  )
    ? Math.max(TIMELINE_MIN_DURATION, bpmIntervalSeconds)
    : sourceDurationSeconds
  timelineFillSourceStartPreview.value = null
  timelineFillSourceDurationPreview.value = null
  const stepSeconds = bpmIntervalSeconds
    ?? Math.max(TIMELINE_MIN_DURATION, state.copyDurationSeconds)
  const contentWidth = timelineContentRef.value?.getBoundingClientRect().width ?? 0
  const secondsPerPixel = contentWidth > 0
    ? timelineRangeDuration.value / contentWidth
    : 0
  const activationThreshold = Math.max(0.02, secondsPerPixel * 3)
  const pointerTime = getTimelineBpmAlignedTime(
    getTimelineFillPointerTime(clientX)
  )
  const sourceEndTime = state.item.startTime + sourceDurationSeconds
  const distanceFromSourceEnd = (
    pointerTime - sourceEndTime
  )
  const distanceFromSourceStart = state.copyStartTime - pointerTime
  const maxPreviewCount = getTimelineFillMaxPreviewCount(state)

  if (distanceFromSourceEnd >= activationThreshold && maxPreviewCount > 0) {
    timelineFillSourceStartPreview.value = state.copyStartTime
    timelineFillSourceDurationPreview.value = state.copyDurationSeconds
    const nextPreviewCount = Math.min(
      maxPreviewCount,
      Math.floor((distanceFromSourceEnd + 1e-6) / stepSeconds) + 1
    )
    if (
      state.direction === 'copy' &&
      state.previewCount === nextPreviewCount
    ) {
      return
    }

    state.direction = 'copy'
    state.previewCount = nextPreviewCount
    state.removePreviewTriggerIds = []
    timelineFillRemovePreviewTriggerIds.value = []
    timelineFillPreviews.value = Array.from(
      { length: nextPreviewCount },
      (_, index) => ({
        key: `${state.item.playback.triggerId}-fill-${index + 1}`,
        startTime: state.copyStartTime + stepSeconds * (index + 1),
        durationSeconds: state.copyDurationSeconds,
        color: state.item.color,
        track: state.item.track
      })
    )
    return
  }

  if (distanceFromSourceStart >= activationThreshold) {
    const removePreviewTriggerIds = getTimelineFillRemovableItems(state)
      .filter(item => item.startTime >= pointerTime + activationThreshold)
      .map(item => item.playback.triggerId)

    const previewUnchanged = (
      state.direction === 'remove' &&
      state.removePreviewTriggerIds.length === removePreviewTriggerIds.length &&
      state.removePreviewTriggerIds.every(
        (triggerId, index) => triggerId === removePreviewTriggerIds[index]
      )
    )
    if (previewUnchanged) return

    if (removePreviewTriggerIds.length === 0) {
      clearTimelineFillPreview(state)
      return
    }

    state.direction = 'remove'
    state.previewCount = 0
    state.removePreviewTriggerIds = removePreviewTriggerIds
    timelineFillPreviews.value = []
    timelineFillRemovePreviewTriggerIds.value = removePreviewTriggerIds
    return
  }

  if (state.direction !== null) {
    clearTimelineFillPreview(state)
  }
}

const updateTimelineFillPreview = (event: PointerEvent) => {
  const state = timelineFillDragState
  if (!state || event.pointerId !== state.pointerId) return

  state.lastClientX = event.clientX
  updateTimelineFillPreviewAt(event.clientX)
}

const getTimelineFillPreviewsForTrack = (trackIndex: number) => {
  return timelineFillPreviews.value.filter(preview => preview.track === trackIndex)
}

const releaseTimelineFillPointerCapture = (state: TimelineFillDragState) => {
  if (state.handle.hasPointerCapture(state.pointerId)) {
    state.handle.releasePointerCapture(state.pointerId)
  }
}

const finishTimelineClipFillDrag = (
  event: PointerEvent,
  commit: boolean,
  preferLastPointer = false
) => {
  const state = timelineFillDragState
  if (!state || event.pointerId !== state.pointerId) return

  event.preventDefault()
  event.stopPropagation()
  const finalClientX = !preferLastPointer && Number.isFinite(event.clientX)
    ? event.clientX
    : state.lastClientX
  state.lastClientX = finalClientX
  if (commit) {
    updateTimelineFillPreviewAt(finalClientX)
  }
  const previews = [...timelineFillPreviews.value]
  const removePreviewTriggerIds = [
    ...timelineFillRemovePreviewTriggerIds.value
  ]
  const copyDurationSeconds = state.copyDurationSeconds
  const copyStartTime = state.copyStartTime
  timelineFillDragState = null
  timelineFillDraggingTriggerId.value = null
  clearTimelineFillPreview(null)
  releaseTimelineFillPointerCapture(state)

  if (!commit) return

  if (removePreviewTriggerIds.length > 0) {
    removeEventPresetTriggers(
      state.item.event.id,
      removePreviewTriggerIds
    )
    selectTimelineEvent(state.item.event)
    return
  }

  if (previews.length === 0) return

  const offsets = previews.map(
    preview => Math.max(0, preview.startTime - state.eventStartTime)
  )
  const copyDurationMs = Math.max(
    TIMELINE_MIN_DURATION,
    copyDurationSeconds
  ) * 1000
  updateEventPresetTriggerRange(
    state.item.event.id,
    state.item.playback.triggerId,
    Math.max(0, copyStartTime - state.eventStartTime),
    copyDurationMs
  )
  const triggers = addEventPresetTriggers(
    state.item.event.id,
    state.item.playback.preset.id,
    offsets,
    state.item.track,
    copyDurationMs
  )
  if (triggers.length > 0) {
    selectTimelineEvent(state.item.event)
  }
}

const handleTimelineClipFillPointerDown = (
  item: TimelinePresetItem,
  event: PointerEvent
) => {
  if (event.button !== 0 || timelineFillDragState) return

  const handle = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : null
  if (!handle) return

  event.preventDefault()
  event.stopPropagation()
  pauseTimelineFollow()
  try {
    handle.setPointerCapture(event.pointerId)
  } catch {}

  timelineFillDragState = {
    pointerId: event.pointerId,
    handle,
    item,
    eventStartTime: isValidTriggerTime(item.event.time)
      ? parseTimeToSeconds(item.event.time)
      : 0,
    lastClientX: event.clientX,
    copyStartTime: item.startTime,
    copyDurationSeconds: Math.max(
      TIMELINE_MIN_DURATION,
      item.durationSeconds
    ),
    direction: null,
    previewCount: 0,
    removePreviewTriggerIds: []
  }
  timelineFillDraggingTriggerId.value = item.playback.triggerId
  clearTimelineFillPreview(timelineFillDragState)
}

const handleTimelineClipFillPointerMove = (event: PointerEvent) => {
  if (!timelineFillDragState || event.pointerId !== timelineFillDragState.pointerId) return
  event.preventDefault()
  event.stopPropagation()
  updateTimelineFillPreview(event)
}

const handleTimelineClipFillPointerUp = (event: PointerEvent) => {
  finishTimelineClipFillDrag(event, true)
}

const handleTimelineClipFillPointerCancel = (event: PointerEvent) => {
  const state = timelineFillDragState
  if (!state) return

  finishTimelineClipFillDrag(
    event,
    state.direction !== null,
    true
  )
}

const handleTimelineClipFillPointerLostCapture = (event: PointerEvent) => {
  const state = timelineFillDragState
  if (!state) return

  finishTimelineClipFillDrag(
    event,
    state.direction !== null,
    true
  )
}

const cancelTimelineClipFillDrag = () => {
  const state = timelineFillDragState
  timelineFillDragState = null
  timelineFillDraggingTriggerId.value = null
  clearTimelineFillPreview(state)
  if (state) {
    releaseTimelineFillPointerCapture(state)
  }
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
          ...(typeof parsed.sourceEventId === 'number' &&
              Number.isInteger(parsed.sourceEventId) &&
              parsed.sourceEventId > 0
            ? { sourceEventId: parsed.sourceEventId }
            : {}),
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
    } catch {}
  }

  const presetId = Number.parseInt(dataTransfer.getData(PRESET_DRAG_MIME), 10)
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

const commitTimelinePresetDropPosition = () => {
  timelinePresetDropFrameId = null
  const pending = timelinePendingPresetDrop
  timelinePendingPresetDrop = null
  if (!pending) return

  timelinePresetDropPosition.value = pending.position
  const trackChanged = timelinePresetDropTrack.value !== pending.track
  if (trackChanged) {
    timelinePresetDropTrack.value = pending.track
  }
  applyTimelinePresetDropPositionToDom(pending.position)
  if (trackChanged) {
    nextTick(() => applyTimelinePresetDropPositionToDom(pending.position))
  }
}

const applyTimelinePresetDropPositionToDom = (position: number) => {
  const content = timelineContentRef.value
  const dropLine = content?.querySelector<HTMLElement>(
    '.timeline-preset-drop-line'
  )
  const dropTime = content?.querySelector<HTMLElement>('.timeline-drop-time')
  if (dropLine) {
    dropLine.style.left = `${position}%`
  }
  if (dropTime) {
    dropTime.style.left = `${position}%`
    const time = timelineRangeStart.value
      + (position / 100) * timelineRangeDuration.value
    dropTime.textContent = formatTimelineTime(
      time,
      timelineRangeEnd.value >= 3600
    )
  }
}

const scheduleTimelinePresetDropPosition = (
  position: number,
  track: number
) => {
  timelinePendingPresetDrop = { position, track }
  if (timelinePresetDropPosition.value === null) {
    timelinePresetDropPosition.value = position
    nextTick(() => {
      const pending = timelinePendingPresetDrop
      if (pending) {
        applyTimelinePresetDropPositionToDom(pending.position)
      }
    })
  }
  if (timelinePresetDropFrameId !== null) return
  timelinePresetDropFrameId = requestAnimationFrame(
    commitTimelinePresetDropPosition
  )
}

const clearTimelinePresetDropPosition = () => {
  if (timelinePresetDropFrameId !== null) {
    cancelAnimationFrame(timelinePresetDropFrameId)
    timelinePresetDropFrameId = null
  }
  timelinePendingPresetDrop = null
  timelinePresetDropPosition.value = null
  timelinePresetDropTrack.value = null
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
      !dataTransfer.types.includes(PRESET_DRAG_MIME)
    )
  ) {
    return
  }

  event.preventDefault()
  pauseTimelineFollow()
  dataTransfer.dropEffect = isTimelineTriggerDrag ? 'move' : 'copy'
  const presetLeftClientX = event.clientX - (
    presetDragPointerOffsetX.value ?? 0
  )
  const dragGroup = timelineClipDragGroup
  const dragOffsetX = dragGroup
    ? event.clientX - dragGroup.startClientX
    : 0
  const dragGroupLefts = dragGroup
    ? dragGroup.items
        .map(item => item.rect ? item.rect.left + dragOffsetX : null)
        .filter((left): left is number => left !== null)
    : []
  const dropAnchorClientX = dragGroupLefts.length > 0
    ? Math.min(...dragGroupLefts)
    : presetLeftClientX
  const dropTime = getBpmSnappedTimelineTime(
    getTimelineSecondsAtClientX(dropAnchorClientX)
  )
  scheduleTimelinePresetDropPosition(
    getTimelinePositionPercent(dropTime),
    getTimelineTrackIndexAtClientY(event.clientY)
  )
}

const handleTimelinePresetDragLeave = (event: DragEvent) => {
  const currentTarget = event.currentTarget as HTMLElement | null
  const relatedTarget = event.relatedTarget as Node | null
  if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) return

  clearTimelinePresetDropPosition()
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
  const presetLeftClientX = event.clientX - (
    presetDragPointerOffsetX.value ?? 0
  )
  const timelineTrigger = readTimelineTriggerDragPayload(event.dataTransfer)
  const draggedPreset = readDraggedPresetPayload(event.dataTransfer)
  const dropTrack = getTimelineTrackIndexAtClientY(event.clientY)
  clearTimelinePresetDropPosition()

  if (timelineTrigger) {
    const sourceEvent = events.value.find(
      item => item.id === timelineTrigger.eventId
    )
    if (!sourceEvent) return

    event.preventDefault()
    timelineClipDragDropped = true
    const eventStartTime = isValidTriggerTime(sourceEvent.time)
      ? parseTimeToSeconds(sourceEvent.time)
      : 0
    const timelineItem = timelinePresetItems.value.find(
      item => item.playback.triggerId === timelineTrigger.triggerId
    )
    const sourceTrigger = getEventPresetTriggers(sourceEvent).find(
      trigger => trigger.id === timelineTrigger.triggerId
    )
    if (!timelineItem && !sourceTrigger) return

    const dragGroup = timelineClipDragGroup?.eventId === sourceEvent.id
      ? timelineClipDragGroup
      : null
    let dropAnchorClientX = presetLeftClientX
    if (dragGroup) {
      flushTimelineClipDragPreview()
      for (const dragItem of dragGroup.items) {
        dragItem.dropRect = dragItem.element?.isConnected
          ? dragItem.element.getBoundingClientRect()
          : null
      }
      const dropRects = dragGroup.items
        .map(dragItem => dragItem.dropRect)
        .filter((rect): rect is DOMRect => rect !== null)
      if (dropRects.length > 0) {
        dropAnchorClientX = Math.min(
          ...dropRects.map(rect => rect.left)
        )
      }
    }
    const dragItems = dragGroup?.items ?? [{
      triggerId: timelineTrigger.triggerId,
      startTime: timelineItem?.startTime ?? (
        eventStartTime + (
          sourceTrigger && isValidTriggerTime(sourceTrigger.time)
            ? parseTimeToSeconds(sourceTrigger.time)
            : 0
        )
      ),
      track: timelineItem?.track ?? sourceTrigger?.track ?? dropTrack,
      rect: null,
      dropRect: null,
      element: null
    }]
    const primaryItem = dragItems.find(
      item => item.triggerId === timelineTrigger.triggerId
    ) ?? dragItems[0]
    if (!primaryItem) return

    const dropTime = getBpmSnappedTimelineTime(
      getTimelineSecondsAtClientX(dropAnchorClientX)
    )
    const minStartTime = Math.min(
      ...dragItems.map(item => item.startTime)
    )
    const maxStartTime = Math.max(
      ...dragItems.map(item => item.startTime)
    )
    const hasExplicitEndTime = typeof sourceEvent.endTime === 'string'
      && !!sourceEvent.endTime.trim()
    const eventEndTime = hasExplicitEndTime
      ? parseTimeToSeconds(sourceEvent.endTime)
      : null
    const maxAllowedStartTime = eventEndTime === null
      ? Number.POSITIVE_INFINITY
      : Math.max(eventStartTime, eventEndTime - 0.01)
    const timeDelta = Math.max(
      -minStartTime,
      Math.min(
        dropTime - (dragGroup ? minStartTime : primaryItem.startTime),
        maxAllowedStartTime - maxStartTime
      )
    )
    const trackDelta = Math.max(
      -Math.min(...dragItems.map(item => item.track)),
      dropTrack - primaryItem.track
    )
    updateEventPresetTriggers(
      sourceEvent.id,
      dragItems.map(item => ({
        triggerId: item.triggerId,
        offsetSeconds: item.startTime + timeDelta - eventStartTime,
        track: item.track + trackDelta
      }))
    )
    selectTimelineEvent(sourceEvent)
    return
  }

  if (!eventItem || !draggedPreset) return

  const sourceEvent = draggedPreset.sourceEventId === undefined
    ? null
    : events.value.find(item => item.id === draggedPreset.sourceEventId) ?? null
  if (!sourceEvent) return
  const preset = getEventPresets(sourceEvent).find(
    item => item.id === draggedPreset.id
  )
  if (!preset) return

  event.preventDefault()
  const eventStartTime = isValidTriggerTime(eventItem.time)
    ? parseTimeToSeconds(eventItem.time)
    : 0
  const dropTime = getBpmSnappedTimelineTime(
    getTimelineSecondsAtClientX(event.clientX)
  )
  const localPreset = sourceEvent?.id === eventItem.id
    ? preset
    : importPresetToEvent(eventItem.id, preset)
  if (!localPreset) return
  const trigger = addEventPresetTrigger(
    eventItem.id,
    localPreset.id,
    Math.max(0, dropTime - eventStartTime),
    dropTrack
  )
  if (!trigger) return
  if (!draggedPreset.rect) return

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
    presetId: localPreset.id,
    presetName: localPreset.name,
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

const getTimelineMaxZoom = () => {
  return TIMELINE_MAX_ZOOM
}

const timelineMaxZoom = computed(getTimelineMaxZoom)
const isTimelineAtMaxZoom = computed(() => {
  return timelineZoom.value >= timelineMaxZoom.value - 0.000001
})

const clampTimelineZoom = (value: number) => {
  return Math.max(
    1,
    Math.min(getTimelineMaxZoom(), Number(value.toFixed(6)))
  )
}

const setTimelineZoom = (delta: number) => {
  pauseTimelineFollow()
  syncTimelineViewportWidth()
  timelineZoom.value = clampTimelineZoom(timelineZoom.value + delta)
  showTimelineScrollbar()
}

watch(
  [timelineRangeDuration, timelineViewportWidth],
  () => {
    const nextZoom = clampTimelineZoom(timelineZoom.value)
    if (nextZoom !== timelineZoom.value) {
      timelineZoom.value = nextZoom
    }
  }
)

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

  if (timelineClipDragGroup) {
    const rawDelta = event.deltaY !== 0 ? event.deltaY : event.deltaX
    if (rawDelta === 0) return

    beginTimelineWaveformInteraction()
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

  if (region === 'ruler') {
    const rawDelta = event.deltaY !== 0 ? event.deltaY : event.deltaX
    if (rawDelta === 0) return

    beginTimelineWaveformInteraction()
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

  beginTimelineWaveformInteraction()
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

const getBpmSnappedTimelineTime = (time: number) => {
  const anchor = beatGridAnchor.value
  const period = beatGridPeriod.value
  const content = timelineContentRef.value
  if (
    anchor === null
    || period === null
    || !Number.isFinite(anchor)
    || !Number.isFinite(period)
    || period <= 0
    || !Number.isFinite(time)
    || !content
  ) {
    return time
  }

  const contentWidth = content.getBoundingClientRect().width
  if (contentWidth <= 0 || timelineRangeDuration.value <= 0) return time

  const nearestBeat = anchor + Math.round((time - anchor) / period) * period
  const distance = nearestBeat - time
  const radiusSeconds = (
    TIMELINE_BPM_SNAP_RADIUS_PX / contentWidth
  ) * timelineRangeDuration.value
  if (radiusSeconds <= 0 || Math.abs(distance) > radiusSeconds) return time

  const falloff = 1 - Math.abs(distance) / radiusSeconds
  return Math.round(
    (time + distance * falloff * TIMELINE_BPM_SNAP_STRENGTH) * 100
  ) / 100
}

const getTimelineBpmAlignedTime = (time: number, minimumTime?: number) => {
  const anchor = beatGridAnchor.value
  const period = beatGridPeriod.value
  if (
    anchor === null
    || period === null
    || !Number.isFinite(anchor)
    || !Number.isFinite(period)
    || period <= 0
    || !Number.isFinite(time)
  ) {
    return time
  }

  let alignedTime = anchor + Math.round((time - anchor) / period) * period
  if (
    minimumTime !== undefined
    && Number.isFinite(minimumTime)
    && alignedTime < minimumTime
  ) {
    alignedTime = anchor + Math.ceil((minimumTime - anchor) / period) * period
  }
  return Math.round(alignedTime * 100) / 100
}

const getTimelineBpmIntervalSeconds = () => {
  const period = beatGridPeriod.value
  return period !== null && Number.isFinite(period) && period > 0
    ? period
    : null
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

const getTimelineMarqueeClientRect = (event: PointerEvent) => {
  const interaction = timelineInteraction
  const viewport = timelineTracksViewportRef.value
  if (!interaction || !viewport) return null

  const viewportRect = viewport.getBoundingClientRect()
  const startX = Math.max(
    viewportRect.left,
    Math.min(viewportRect.right, interaction.startClientX)
  )
  const startY = Math.max(
    viewportRect.top,
    Math.min(
      viewportRect.bottom,
      interaction.startClientY ?? event.clientY
    )
  )
  const currentX = Math.max(
    viewportRect.left,
    Math.min(viewportRect.right, event.clientX)
  )
  const currentY = Math.max(
    viewportRect.top,
    Math.min(viewportRect.bottom, event.clientY)
  )
  const left = Math.min(startX, currentX)
  const right = Math.max(startX, currentX)
  const top = Math.min(startY, currentY)
  const bottom = Math.max(startY, currentY)
  const track = viewport.parentElement
  const trackRect = track?.getBoundingClientRect() ?? viewportRect

  return {
    left,
    right,
    top,
    bottom,
    overlay: {
      left: left - trackRect.left,
      top: top - trackRect.top,
      width: right - left,
      height: bottom - top
    }
  }
}

const getTimelineTriggerIdsInClientRect = (
  left: number,
  top: number,
  right: number,
  bottom: number
) => {
  const triggerIds: number[] = []
  for (const item of timelinePresetItems.value) {
    const clip = getTimelineClipElement(item.playback.triggerId)
    if (!clip) continue

    const rect = clip.getBoundingClientRect()
    if (
      rect.width <= 0
      || rect.height <= 0
      || rect.right < left
      || rect.left > right
      || rect.bottom < top
      || rect.top > bottom
    ) {
      continue
    }
    triggerIds.push(item.playback.triggerId)
  }
  return triggerIds
}

const startTimelineMarqueeSelection = (event: PointerEvent) => {
  if (
    event.button !== 0
    || timelineInteraction
    || timelineFillDragState
    || timelineEventId.value === null
  ) {
    return
  }

  const viewport = timelineTracksViewportRef.value
  if (!viewport) return
  if (
    event.target instanceof Element
    && event.target.closest('.timeline-clip')
  ) {
    return
  }

  pauseTimelineFollow()
  event.preventDefault()
  try {
    viewport.setPointerCapture(event.pointerId)
  } catch {}

  const additive = event.shiftKey || event.ctrlKey || event.metaKey
  const initialSelectedTriggerIds = additive
    ? [...selectedTimelineTriggerIds.value]
    : []
  selectedTimelineTriggerIds.value = initialSelectedTriggerIds
  timelineInteraction = {
    mode: 'marquee',
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    captureElement: viewport,
    initialSelectedTriggerIds,
    additive,
    moved: false
  }
  timelineMarqueeRect.value = getTimelineMarqueeClientRect(event)?.overlay ?? null
  timelineInteractionMode.value = 'marquee'
}

const startTimelineMiddleDrag = (event: PointerEvent) => {
  if (
    event.button !== 1
    || timelineInteraction
    || timelineFillDragState
    || timelineEventId.value === null
  ) {
    return
  }

  const viewport = timelineTracksViewportRef.value
  const scroll = timelineScrollRef.value
  if (!viewport || !scroll) return

  pauseTimelineFollow()
  event.preventDefault()
  event.stopPropagation()
  try {
    viewport.setPointerCapture(event.pointerId)
  } catch {}

  timelineInteraction = {
    mode: 'pan',
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    captureElement: viewport,
    initialScrollLeft: scroll.scrollLeft,
    initialScrollTop: viewport.scrollTop,
    panButton: 1,
    moved: false
  }
  timelineInteractionMode.value = 'pan'
  timelineInteractionPanButton.value = 1
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
    panButton: 0,
    allowClickSeek,
    moved: false
  }
  timelineInteractionMode.value = 'pan'
  timelineInteractionPanButton.value = 0
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
  const isSelected = selectedTimelineTriggerIds.value.includes(
    item.playback.triggerId
  )
  if (!isSelected) {
    selectedTimelineTriggerIds.value = [item.playback.triggerId]
  }
  const dragItems = (
    isSelected
      ? timelinePresetItems.value.filter(timelineItem => (
          selectedTimelineTriggerIds.value.includes(
            timelineItem.playback.triggerId
          )
        ))
      : [item]
  ).map(timelineItem => {
    const element = getTimelineClipElement(timelineItem.playback.triggerId)
    return {
      triggerId: timelineItem.playback.triggerId,
      startTime: timelineItem.startTime,
      track: timelineItem.track,
      rect: element?.getBoundingClientRect() ?? null,
      dropRect: null,
      element
    }
  })
  timelineClipDragGroup = {
    eventId: item.event.id,
    primaryTriggerId: item.playback.triggerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    items: dragItems
  }
  timelineDraggingTriggerIds.value = dragItems.map(
    dragItem => dragItem.triggerId
  )

  dataTransfer.effectAllowed = 'move'
  dataTransfer.setData(TIMELINE_TRIGGER_DRAG_MIME, JSON.stringify({
    eventId: item.event.id,
    triggerId: item.playback.triggerId
  }))
  hideTimelineNativeDragImage(dataTransfer)
  const clip = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : null
  if (clip) {
    const rect = clip.getBoundingClientRect()
    presetDragPointerOffsetX.value = Math.max(
      0,
      Math.min(rect.width, event.clientX - rect.left)
    )
  }
  timelineClipDragDropped = false
}

const applyTimelineClipDragPreview = () => {
  timelineClipDragOffsetFrameId = null
  const dragItems = timelineClipDragGroup?.items
  if (!dragItems) return

  const content = timelineContentRef.value
  let previewOffsetX = timelineClipDragOffsetX
  if (content && timelineRangeDuration.value > 0) {
    const contentWidth = content.getBoundingClientRect().width
    if (contentWidth > 0) {
      const anchorStartTime = Math.min(
        ...dragItems.map(dragItem => dragItem.startTime)
      )
      const rawOffsetSeconds = (
        timelineClipDragOffsetX / contentWidth
      ) * timelineRangeDuration.value
      const snappedStartTime = getBpmSnappedTimelineTime(
        anchorStartTime + rawOffsetSeconds
      )
      previewOffsetX = (
        (snappedStartTime - anchorStartTime) / timelineRangeDuration.value
      ) * contentWidth
    }
  }

  const transform = `translate3d(${previewOffsetX}px, ${timelineClipDragOffsetY}px, 0)`
  for (const dragItem of dragItems) {
    if (dragItem.element?.isConnected) {
      dragItem.element.style.transform = transform
    }
  }
}

const flushTimelineClipDragPreview = () => {
  if (timelineClipDragOffsetFrameId !== null) {
    cancelAnimationFrame(timelineClipDragOffsetFrameId)
    timelineClipDragOffsetFrameId = null
  }
  applyTimelineClipDragPreview()
}

const hideTimelineNativeDragImage = (dataTransfer: DataTransfer) => {
  const dragImage = document.createElement('div')
  dragImage.style.cssText = [
    'position: fixed',
    'left: -10px',
    'top: -10px',
    'width: 1px',
    'height: 1px',
    'opacity: 0',
    'pointer-events: none'
  ].join(';')
  document.body.appendChild(dragImage)
  dataTransfer.setDragImage(dragImage, 0, 0)
  timelineNativeDragImage?.remove()
  timelineNativeDragImage = dragImage
}

const clearTimelineNativeDragImage = () => {
  timelineNativeDragImage?.remove()
  timelineNativeDragImage = null
}

const handleTimelineClipDrag = (event: DragEvent) => {
  const dragGroup = timelineClipDragGroup
  if (
    !dragGroup
    || !Number.isFinite(event.clientX)
    || !Number.isFinite(event.clientY)
  ) {
    return
  }

  timelineClipDragOffsetX = event.clientX - dragGroup.startClientX
  timelineClipDragOffsetY = event.clientY - dragGroup.startClientY
  if (timelineClipDragOffsetFrameId !== null) return

  timelineClipDragOffsetFrameId = requestAnimationFrame(
    applyTimelineClipDragPreview
  )
}

const resetTimelineClipDragPreview = (
  dragItems = timelineClipDragGroup?.items ?? []
) => {
  if (timelineClipDragOffsetFrameId !== null) {
    cancelAnimationFrame(timelineClipDragOffsetFrameId)
    timelineClipDragOffsetFrameId = null
  }
  timelineClipDragOffsetX = 0
  timelineClipDragOffsetY = 0
  for (const dragItem of dragItems) {
    dragItem.element?.style.removeProperty('transform')
  }
}

const handleTimelineClipDragEnd = async (
  item: TimelinePresetItem,
  _event: DragEvent
) => {
  const dragGroup = timelineClipDragGroup
  const shouldAnimateDrop = timelineClipDragDropped
  const dragItems = dragGroup?.items ?? [{
    triggerId: item.playback.triggerId,
    startTime: item.startTime,
    track: item.track,
    rect: null,
    dropRect: null,
    element: null
  }]
  timelineClipDragGroup = null
  timelineDraggingTriggerIds.value = []
  clearTimelinePresetDropPosition()
  presetDragPointerOffsetX.value = null
  timelineClipDragDropped = false

  await nextTick()
  clearTimelineNativeDragImage()
  resetTimelineClipDragPreview(dragItems)

  for (const dragItem of dragItems) {
    const clip = getTimelineClipElement(dragItem.triggerId)
    if (!clip || typeof clip.animate !== 'function') continue

    const startRect = dragItem.dropRect ?? dragItem.rect
    if (shouldAnimateDrop && startRect) {
      const clipRect = clip.getBoundingClientRect()
      const translateX = startRect.left - clipRect.left
      const translateY = startRect.top - clipRect.top
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
      continue
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
}

const handleTimelinePointerMove = (event: PointerEvent) => {
  const interaction = timelineInteraction
  if (!interaction || event.pointerId !== interaction.pointerId) return
  const activeButton = interaction.mode === 'pan' && interaction.panButton === 1
    ? 4
    : 1
  if ((event.buttons & activeButton) === 0) {
    handleTimelinePointerUp(event)
    return
  }

  if (interaction.mode === 'marquee') {
    const deltaX = event.clientX - interaction.startClientX
    const deltaY = event.clientY - (
      interaction.startClientY ?? event.clientY
    )
    if (
      !interaction.moved
      && Math.hypot(deltaX, deltaY) < TIMELINE_MARQUEE_THRESHOLD
    ) {
      return
    }

    interaction.moved = true
    event.preventDefault()
    const clientRect = getTimelineMarqueeClientRect(event)
    if (!clientRect) return

    timelineMarqueeRect.value = clientRect.overlay
    const triggerIds = getTimelineTriggerIdsInClientRect(
      clientRect.left,
      clientRect.top,
      clientRect.right,
      clientRect.bottom
    )
    selectedTimelineTriggerIds.value = [
      ...new Set([
        ...(interaction.additive
          ? interaction.initialSelectedTriggerIds ?? []
          : []),
        ...triggerIds
      ])
    ]
    return
  }

  if (interaction.mode === 'pan') {
    const deltaX = event.clientX - interaction.startClientX
    const deltaY = event.clientY - (
      interaction.startClientY ?? event.clientY
    )
    if (
      !interaction.moved
      && Math.hypot(deltaX, deltaY) < 3
    ) {
      return
    }

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
    if (interaction.panButton === 1) {
      const tracks = timelineTracksViewportRef.value
      if (tracks) {
        const maxScrollTop = Math.max(
          0,
          tracks.scrollHeight - tracks.clientHeight
        )
        tracks.scrollTop = Math.max(
          0,
          Math.min(
            maxScrollTop,
            (interaction.initialScrollTop ?? 0) - deltaY
          )
        )
      }
      scheduleTimelineVerticalScrollbarUpdate()
      showTimelineVerticalScrollbar()
    }
    scheduleTimelineScrollbarUpdate()
    showTimelineScrollbar()
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

  if (interaction.mode === 'marquee') {
    if (event.type === 'pointercancel') {
      selectedTimelineTriggerIds.value = [
        ...(interaction.initialSelectedTriggerIds ?? [])
      ]
    }
    timelineMarqueeRect.value = null
  }

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
  timelineInteractionPanButton.value = null
  timelineDraggingTriggerIds.value = []
  resetTimelineClipDragPreview()
  clearTimelineNativeDragImage()
  timelineClipDragGroup = null
}

watch(videoCurrentTime, () => {
  if (!timelineFollowEnabled.value) return
  followTimelinePlayhead()
})

watch(timelineFollowEnabled, (enabled) => {
  if (!enabled) return
  nextTick(followTimelinePlayhead)
}, { immediate: true })

watch(timelineZoom, () => {
  beginTimelineWaveformInteraction()
  nextTick(() => {
    const scroll = timelineScrollRef.value
    if (scroll && timelineZoom.value <= 1) {
      scroll.scrollLeft = 0
    }
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

// 曲线编辑始终使用居中十字指针，保证操作位置与节点中心一致
const canvasCursorClass = 'cursor-crosshair'

// 效果曲线关键点列表 (X 为时间，Y 为亮度，color 为节点颜色)
const currentPoints = computed<PresetPoint[]>(() => {
  const pts = activePreset.value?.effect?.points
  if (!pts || pts.length === 0) {
    return createDefaultPresetPoints(currentColor.value)
  }
  return [...pts]
    .map(point => normalizePresetPoint(point, currentColor.value))
    .sort((a, b) => a.x - b.x)
})

// 当前选中的曲线节点索引
const selectedNodeIndex = ref<number | null>(null)

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
const colorPreviewSwatchRef = ref<HTMLButtonElement | null>(null)
const colorPaletteRef = ref<HTMLDivElement | null>(null)
const paletteSpectrumRef = ref<HTMLDivElement | null>(null)
const isColorPaletteOpen = ref(false)
const paletteHue = ref(0)
const paletteSaturation = ref(1)
const paletteValue = ref(1)
const paletteColorChanged = ref(false)
let paletteSpectrumPointerId: number | null = null

// 统一设色：若选中了节点，则仅修改该节点；否则同步修改主色及同色节点
const setColor = (color: string) => {
  if (!activePreset.value) return
  const hex = color.toLowerCase()
  const currentPts = [...currentPoints.value]
  const selectedIndex = selectedNodeIndex.value
  const selectedPoint = selectedIndex === null ? undefined : currentPts[selectedIndex]

  if (selectedIndex !== null && selectedPoint) {
    currentPts[selectedIndex] = normalizePresetPoint(
      { ...selectedPoint, color: hex },
      currentColor.value
    )
    updatePresetEffect(activePreset.value.id, { color: hex, points: currentPts })
  } else {
    const previousColor = currentColor.value.toLowerCase()
    const points = currentPts.map(point => (
      point.color.toLowerCase() === previousColor
        ? { ...point, color: hex }
        : point
    ))
    updatePresetEffect(activePreset.value.id, { color: hex, points })
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

const handleHistoryColorBeforeLeave = (element: Element) => {
  const item = element as HTMLElement
  const grid = item.parentElement
  if (!grid) return

  const itemRect = item.getBoundingClientRect()
  const gridRect = grid.getBoundingClientRect()
  item.style.left = `${itemRect.left - gridRect.left}px`
  item.style.top = `${itemRect.top - gridRect.top}px`
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

const syncPaletteFromCurrentColor = () => {
  const rgb = hexToRgb(currentColor.value)
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
  paletteHue.value = Math.round(hsv.h)
  paletteSaturation.value = hsv.s
  paletteValue.value = hsv.v
}

const applyPaletteColor = () => {
  const rgb = hsvToRgb(
    paletteHue.value,
    paletteSaturation.value,
    paletteValue.value
  )
  const color = rgbToHex(rgb.r, rgb.g, rgb.b)
  if (color !== currentColor.value.toLowerCase()) {
    paletteColorChanged.value = true
  }
  setColor(color)
}

const openColorPalette = () => {
  syncPaletteFromCurrentColor()
  paletteColorChanged.value = false
  isColorPaletteOpen.value = true
}

const closeColorPalette = (commitColor = true) => {
  if (!isColorPaletteOpen.value) return
  isColorPaletteOpen.value = false

  if (paletteSpectrumPointerId !== null && paletteSpectrumRef.value) {
    try {
      paletteSpectrumRef.value.releasePointerCapture(paletteSpectrumPointerId)
    } catch {}
    paletteSpectrumPointerId = null
  }

  if (commitColor && paletteColorChanged.value) {
    addColorToHistory(currentColor.value)
  }
  paletteColorChanged.value = false
}

const toggleColorPalette = () => {
  if (isColorPaletteOpen.value) {
    closeColorPalette()
  } else {
    openColorPalette()
  }
}

const updatePaletteFromPointer = (event: PointerEvent) => {
  const spectrum = paletteSpectrumRef.value
  if (!spectrum) return

  const rect = spectrum.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return

  paletteSaturation.value = Math.max(
    0,
    Math.min(1, (event.clientX - rect.left) / rect.width)
  )
  paletteValue.value = Math.max(
    0,
    Math.min(1, 1 - (event.clientY - rect.top) / rect.height)
  )
  applyPaletteColor()
}

const onPaletteSpectrumPointerDown = (event: PointerEvent) => {
  if (event.button !== 0) return
  event.preventDefault()
  paletteSpectrumPointerId = event.pointerId
  try {
    paletteSpectrumRef.value?.setPointerCapture(event.pointerId)
  } catch {}
  updatePaletteFromPointer(event)
}

const onPaletteSpectrumPointerMove = (event: PointerEvent) => {
  if (paletteSpectrumPointerId !== event.pointerId) return
  updatePaletteFromPointer(event)
}

const onPaletteSpectrumPointerUp = (event: PointerEvent) => {
  if (paletteSpectrumPointerId !== event.pointerId) return
  try {
    paletteSpectrumRef.value?.releasePointerCapture(event.pointerId)
  } catch {}
  paletteSpectrumPointerId = null
}

const onPaletteHueInput = (event: Event) => {
  const hue = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(hue)) return
  paletteHue.value = hue
  applyPaletteColor()
}

const paletteCursorStyle = computed(() => ({
  left: `${paletteSaturation.value * 100}%`,
  top: `${(1 - paletteValue.value) * 100}%`
}))

const handleColorPaletteOutsidePointerDown = (event: PointerEvent) => {
  if (!isColorPaletteOpen.value) return
  const target = event.target
  if (!(target instanceof Node)) return
  if (
    colorPaletteRef.value?.contains(target) ||
    colorPreviewSwatchRef.value?.contains(target)
  ) {
    return
  }
  closeColorPalette()
}

const handleColorPaletteKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    closeColorPalette()
  }
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
  if (currentRepeat.value === 0) return '∞'
  return currentRepeat.value.toString()
})

const onRepeatFocus = () => {
  isRepeatFocused.value = true
  repeatInputVal.value = currentRepeat.value.toString()
}

const onRepeatBlur = () => {
  isRepeatFocused.value = false
  let val = parseInt(repeatInputVal.value, 10)
  if (isNaN(val)) val = 1
  if (val < 0) val = 0
  if (val > 99) val = 99
  if (activePreset.value) {
    updatePresetEffect(activePreset.value.id, { repeat: val })
  }
}

const onRepeatInput = (e: Event) => {
  const target = e.target as HTMLInputElement
  repeatInputVal.value = target.value
  const val = parseInt(target.value, 10)
  if (!isNaN(val) && val >= 0 && val <= 99 && activePreset.value) {
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
  if (next < 0) next = 0
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
// 统一效果曲线画框 (亮度与颜色共享节点)
// -------------------------------------------------------------
const curveCanvasRef = ref<HTMLCanvasElement | null>(null)
const canvasViewportRef = ref<HTMLDivElement | null>(null)

// 曲线内边距
const padLeft = 38
const padRight = 16
const padTop = 16
const padBottom = 24

// 正在拖拽/悬浮的节点索引
const activeDragPoint = ref<number | null>(null)
const hoveredPoint = ref<number | null>(null)
const pendingDeleteNodeIndex = ref<number | null>(null)

interface AddPointPreviewVisual {
  x: number
  y: number
  fromX: number
  fromY: number
  phase: 'enter' | 'move' | 'idle' | 'exit'
  startedAt: number
  duration: number
  fromScale: number
  fromOpacity: number
}

const addPointPreview = ref<AddPointPreviewVisual | null>(null)

interface CurveSample {
  x: number
  y: number
  color: string
}

interface CurveTransition {
  fromSamples: CurveSample[]
  toSamples: CurveSample[]
  startedAt: number
  duration: number
}

interface TrashBadgeVisual {
  point: PresetPoint
  phase: 'enter' | 'exit'
  startedAt: number
  duration: number
  fromScale: number
  fromOpacity: number
}

const CURVE_SAMPLE_COUNT = 96
const CURVE_CHANGE_DURATION = 220
const MIN_CURVE_POINT_X_GAP = 0.01
const TRASH_BADGE_ENTER_DURATION = 180
const TRASH_BADGE_EXIT_DURATION = 140
const ADD_POINT_PREVIEW_ENTER_DURATION = 180
const ADD_POINT_PREVIEW_MOVE_DURATION = 150
const ADD_POINT_PREVIEW_EXIT_DURATION = 140
const ADD_POINT_PREVIEW_TIMEOUT = 2000

let curveSamples: CurveSample[] = []
let curveTransition: CurveTransition | null = null
let curveTransitionPresetId: number | null | undefined
let trashBadgeVisual: TrashBadgeVisual | null = null
let curveAnimationRafId: number | null = null
let addPointPreviewTimer: ReturnType<typeof setTimeout> | null = null

const getAnimationNow = () => (
  typeof performance !== 'undefined' ? performance.now() : Date.now()
)

const easeOutCubic = (progress: number) => 1 - Math.pow(1 - progress, 3)
const easeInCubic = (progress: number) => progress * progress * progress

const interpolateHexColor = (from: string, to: string, progress: number) => {
  const fromRgb = hexToRgb(from)
  const toRgb = hexToRgb(to)
  return rgbToHex(
    fromRgb.r + (toRgb.r - fromRgb.r) * progress,
    fromRgb.g + (toRgb.g - fromRgb.g) * progress,
    fromRgb.b + (toRgb.b - fromRgb.b) * progress
  )
}

const getCurveSampleXs = (
  points: PresetPoint[],
  extraXs: number[] = []
): number[] => {
  const xs = new Set<number>()
  for (let index = 0; index <= CURVE_SAMPLE_COUNT; index++) {
    xs.add(index / CURVE_SAMPLE_COUNT)
  }
  for (const point of points) {
    xs.add(point.x)
  }
  for (const x of extraXs) {
    xs.add(x)
  }
  return [...xs].sort((a, b) => a - b)
}

const sampleCurvePoint = (
  points: PresetPoint[],
  progress: number,
  fallbackColor: string
): CurveSample => {
  const x = Math.max(0, Math.min(1, progress))
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) {
    return { x, y: 0.5, color: fallbackColor }
  }

  let left = first
  let right = first
  let ratio = 0

  if (x >= last.x) {
    left = last
    right = last
  } else if (x > first.x) {
    for (let index = 0; index < points.length - 1; index++) {
      const current = points[index]
      const next = points[index + 1]
      if (!current || !next || x < current.x || x > next.x) continue

      left = current
      right = next
      const span = next.x - current.x
      ratio = span > 0 ? (x - current.x) / span : 0
      break
    }
  }

  return {
    x,
    y: left.y + (right.y - left.y) * ratio,
    color: interpolateHexColor(left.color, right.color, ratio)
  }
}

const buildCurveSamples = (
  points: PresetPoint[],
  sampleXs = getCurveSampleXs(points)
): CurveSample[] => (
  sampleXs.map(x => sampleCurvePoint(points, x, currentColor.value))
)

const settleCurveAnimation = (points: PresetPoint[]) => {
  curveTransition = null
  curveSamples = buildCurveSamples(points)
}

const getCurveSamples = (now: number): CurveSample[] => {
  if (!curveTransition) return curveSamples

  const elapsed = now - curveTransition.startedAt
  const progress = Math.max(0, Math.min(1, elapsed / curveTransition.duration))
  if (progress >= 1) {
    curveSamples = buildCurveSamples(currentPoints.value)
    curveTransition = null
    return curveSamples
  }

  const eased = easeOutCubic(progress)
  return curveTransition.fromSamples.map((fromSample, index) => {
    const toSample = curveTransition?.toSamples[index] ?? fromSample
    return {
      x: toSample.x,
      y: fromSample.y + (toSample.y - fromSample.y) * eased,
      color: interpolateHexColor(fromSample.color, toSample.color, eased)
    }
  })
}

const sampleCurveVisualAtX = (samples: CurveSample[], x: number): CurveSample => {
  const firstSample = samples[0] ?? { x: 0, y: 0.5, color: currentColor.value }
  const lastSample = samples[samples.length - 1] ?? firstSample
  if (x <= firstSample.x) return firstSample
  if (x >= lastSample.x) return lastSample

  for (let index = 0; index < samples.length - 1; index++) {
    const current = samples[index]
    const next = samples[index + 1]
    if (!current || !next || x < current.x || x > next.x) continue

    const span = next.x - current.x
    const progress = span > 0 ? (x - current.x) / span : 0
    return {
      x,
      y: current.y + (next.y - current.y) * progress,
      color: interpolateHexColor(current.color, next.color, progress)
    }
  }

  return lastSample
}

const resampleCurveVisual = (samples: CurveSample[], sampleXs: number[]) => (
  sampleXs.map(x => sampleCurveVisualAtX(samples, x))
)

const getTrashBadgeVisualState = (now: number) => {
  if (!trashBadgeVisual) {
    if (pendingDeleteNodeIndex.value === null) return null
    const point = currentPoints.value[pendingDeleteNodeIndex.value]
    return point ? { point, scale: 1, opacity: 1 } : null
  }

  const elapsed = now - trashBadgeVisual.startedAt
  const progress = Math.max(0, Math.min(1, elapsed / trashBadgeVisual.duration))
  const isEntering = trashBadgeVisual.phase === 'enter'
  const eased = isEntering ? easeOutCubic(progress) : easeInCubic(progress)
  const scale = isEntering
    ? trashBadgeVisual.fromScale + (1 - trashBadgeVisual.fromScale) * eased
    : trashBadgeVisual.fromScale * (1 - eased)
  const opacity = isEntering
    ? trashBadgeVisual.fromOpacity + (1 - trashBadgeVisual.fromOpacity) * eased
    : trashBadgeVisual.fromOpacity * (1 - eased)

  if (progress >= 1) {
    const point = trashBadgeVisual.point
    trashBadgeVisual = null
    return isEntering
      ? { point, scale: 1, opacity: 1 }
      : null
  }

  return {
    point: trashBadgeVisual.point,
    scale,
    opacity
  }
}

const getAddPointPreviewVisualState = (now: number) => {
  const preview = addPointPreview.value
  if (!preview) return null
  if (preview.phase === 'idle') {
    return {
      x: preview.x,
      y: preview.y,
      scale: 1,
      opacity: 1
    }
  }

  const elapsed = now - preview.startedAt
  const progress = Math.max(0, Math.min(1, elapsed / preview.duration))
  const isExiting = preview.phase === 'exit'
  const eased = isExiting ? easeInCubic(progress) : easeOutCubic(progress)
  const x = preview.fromX + (preview.x - preview.fromX) * eased
  const y = preview.fromY + (preview.y - preview.fromY) * eased
  const scale = isExiting
    ? preview.fromScale * (1 - eased)
    : preview.fromScale + (1 - preview.fromScale) * eased
  const opacity = isExiting
    ? preview.fromOpacity * (1 - eased)
    : preview.fromOpacity + (1 - preview.fromOpacity) * eased

  if (progress >= 1) {
    if (!isExiting) {
      preview.phase = 'idle'
      preview.startedAt = now
      preview.duration = 0
      preview.fromX = preview.x
      preview.fromY = preview.y
      preview.fromScale = 1
      preview.fromOpacity = 1
      return {
        x: preview.x,
        y: preview.y,
        scale: 1,
        opacity: 1
      }
    }
    addPointPreview.value = null
    return null
  }

  return {
    x,
    y,
    scale,
    opacity
  }
}

const scheduleCurveAnimationFrame = () => {
  if (typeof requestAnimationFrame === 'undefined') {
    drawCurve()
    return
  }
  if (curveAnimationRafId !== null) return

  curveAnimationRafId = requestAnimationFrame(() => {
    curveAnimationRafId = null
    drawCurve()
    if (
      curveTransition ||
      trashBadgeVisual ||
      (addPointPreview.value && addPointPreview.value.phase !== 'idle')
    ) {
      scheduleCurveAnimationFrame()
    }
  })
}

const setPendingDeleteNode = (index: number | null) => {
  if (pendingDeleteNodeIndex.value === index) return

  const now = getAnimationNow()
  const previousVisual = getTrashBadgeVisualState(now)
  const previousIndex = pendingDeleteNodeIndex.value

  if (index !== null) {
    const point = currentPoints.value[index]
    if (!point) return

    pendingDeleteNodeIndex.value = index
    trashBadgeVisual = {
      point: { ...point },
      phase: 'enter',
      startedAt: now,
      duration: TRASH_BADGE_ENTER_DURATION,
      fromScale: previousVisual?.scale ?? 0.45,
      fromOpacity: previousVisual?.opacity ?? 0
    }
  } else {
    const point = previousIndex === null
      ? trashBadgeVisual?.point
      : currentPoints.value[previousIndex] ?? trashBadgeVisual?.point
    pendingDeleteNodeIndex.value = null
    trashBadgeVisual = point && previousVisual
      ? {
          point: { ...point },
          phase: 'exit',
          startedAt: now,
          duration: TRASH_BADGE_EXIT_DURATION,
          fromScale: previousVisual.scale,
          fromOpacity: previousVisual.opacity
        }
      : null
  }

  scheduleCurveAnimationFrame()
}

const clearAddPointPreviewTimer = () => {
  if (addPointPreviewTimer === null) return
  clearTimeout(addPointPreviewTimer)
  addPointPreviewTimer = null
}

const restartAddPointPreviewTimer = () => {
  clearAddPointPreviewTimer()
  addPointPreviewTimer = setTimeout(() => {
    addPointPreviewTimer = null
    clearAddPointPreview()
  }, ADD_POINT_PREVIEW_TIMEOUT)
}

const clearAddPointPreview = (animated = true) => {
  clearAddPointPreviewTimer()
  const preview = addPointPreview.value
  if (!preview) return

  if (!animated) {
    addPointPreview.value = null
    drawCurve()
    return
  }
  if (preview.phase === 'exit') return

  const now = getAnimationNow()
  const visualState = getAddPointPreviewVisualState(now)
  const currentPreview = addPointPreview.value
  if (!visualState || !currentPreview) {
    drawCurve()
    return
  }

  addPointPreview.value = {
    x: currentPreview.x,
    y: currentPreview.y,
    fromX: visualState.x,
    fromY: visualState.y,
    phase: 'exit',
    startedAt: now,
    duration: ADD_POINT_PREVIEW_EXIT_DURATION,
    fromScale: visualState.scale,
    fromOpacity: visualState.opacity
  }
  scheduleCurveAnimationFrame()
}

const setAddPointPreview = (x: number, y: number) => {
  restartAddPointPreviewTimer()
  const now = getAnimationNow()
  const visualState = getAddPointPreviewVisualState(now)
  const currentPreview = addPointPreview.value

  if (
    visualState &&
    currentPreview?.phase !== 'exit' &&
    Math.abs(visualState.x - x) < 0.0001 &&
    Math.abs(visualState.y - y) < 0.0001
  ) {
    return
  }

  if (visualState && currentPreview && currentPreview.phase !== 'exit') {
    addPointPreview.value = {
      x,
      y,
      fromX: visualState.x,
      fromY: visualState.y,
      phase: 'move',
      startedAt: now,
      duration: ADD_POINT_PREVIEW_MOVE_DURATION,
      fromScale: visualState.scale,
      fromOpacity: visualState.opacity
    }
  } else {
    addPointPreview.value = {
      x,
      y,
      fromX: visualState?.x ?? x,
      fromY: visualState?.y ?? y,
      phase: 'enter',
      startedAt: now,
      duration: ADD_POINT_PREVIEW_ENTER_DURATION,
      fromScale: visualState?.scale ?? 0.35,
      fromOpacity: visualState?.opacity ?? 0
    }
  }
  scheduleCurveAnimationFrame()
}

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

const drawTrashBadge = (
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  scale = 1,
  opacity = 1
) => {
  ctx.save()
  ctx.translate(sx, sy)
  ctx.scale(scale, scale)
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity))
  ctx.beginPath()
  ctx.arc(0, 0, 10, 0, Math.PI * 2)
  ctx.fillStyle = '#f2b8b5'
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()

  ctx.strokeStyle = '#7f1d1d'
  ctx.lineWidth = 1.4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(-4, -3)
  ctx.lineTo(4, -3)
  ctx.moveTo(-2, -3)
  ctx.lineTo(-1.4, -5)
  ctx.lineTo(1.4, -5)
  ctx.lineTo(2, -3)
  ctx.moveTo(-2.6, -1.5)
  ctx.lineTo(-2.2, 4)
  ctx.lineTo(2.2, 4)
  ctx.lineTo(2.6, -1.5)
  ctx.moveTo(-0.8, -0.5)
  ctx.lineTo(-0.8, 2.5)
  ctx.moveTo(0.8, -0.5)
  ctx.lineTo(0.8, 2.5)
  ctx.stroke()
  ctx.restore()
}

const drawAddPointPreview = (
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  scale = 1,
  opacity = 1
) => {
  ctx.save()
  ctx.translate(sx, sy)
  ctx.scale(scale, scale)
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity))
  ctx.beginPath()
  ctx.arc(0, 0, 7.5, 0, Math.PI * 2)
  ctx.fillStyle = '#a8c7fa'
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(-3.5, 0)
  ctx.lineTo(3.5, 0)
  ctx.moveTo(0, -3.5)
  ctx.lineTo(0, 3.5)
  ctx.strokeStyle = '#10213f'
  ctx.lineWidth = 1.8
  ctx.lineCap = 'round'
  ctx.stroke()
  ctx.restore()
}

// 绘制统一效果曲线
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

  const points = currentPoints.value
  if (curveSamples.length === 0) {
    curveSamples = buildCurveSamples(points)
    curveTransitionPresetId = activePreset.value?.id ?? null
  }
  const samples = getCurveSamples(getAnimationNow())

  // 统一曲线的彩色渐变笔刷
  const colorGrad = ctx.createLinearGradient(padLeft, 0, padLeft + innerW, 0)
  for (const sample of samples) {
    colorGrad.addColorStop(
      Math.max(0, Math.min(1, sample.x)),
      sample.color
    )
  }

  // 曲线下方填充
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(toScreenX(0, w), toScreenY(0, h))
  const firstSample = samples[0]
  if (firstSample) {
    ctx.lineTo(toScreenX(firstSample.x, w), toScreenY(firstSample.y, h))
  }
  for (const sample of samples.slice(1)) {
    ctx.lineTo(toScreenX(sample.x, w), toScreenY(sample.y, h))
  }
  ctx.lineTo(toScreenX(1, w), toScreenY(0, h))
  ctx.closePath()
  ctx.fillStyle = colorGrad
  ctx.globalAlpha = 0.1
  ctx.fill()
  ctx.restore()

  // 曲线主线条
  ctx.save()
  ctx.beginPath()
  if (firstSample) {
    ctx.moveTo(toScreenX(firstSample.x, w), toScreenY(firstSample.y, h))
  }
  for (const sample of samples.slice(1)) {
    ctx.lineTo(toScreenX(sample.x, w), toScreenY(sample.y, h))
  }
  ctx.strokeStyle = colorGrad
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.restore()

  // 曲线节点
  for (let index = 0; index < points.length; index++) {
    const point = points[index]
    if (!point) continue

    const sx = toScreenX(point.x, w)
    const visualPoint = sampleCurveVisualAtX(samples, point.x)
    const sy = toScreenY(visualPoint.y, h)
    const isSelected = selectedNodeIndex.value === index
    const isHovered = hoveredPoint.value === index
    const isDragging = activeDragPoint.value === index

    ctx.save()

    if (isSelected || isDragging) {
      ctx.beginPath()
      ctx.arc(sx, sy, 9, 0, Math.PI * 2)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2.0
      ctx.stroke()
    }

    ctx.beginPath()
    const radius = isSelected || isDragging ? 6.5 : (isHovered ? 6 : 4.8)
    ctx.arc(sx, sy, radius, 0, Math.PI * 2)
    ctx.fillStyle = visualPoint.color
    ctx.fill()
    ctx.lineWidth = 1.8
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()

    ctx.restore()
  }

  const trashBadge = getTrashBadgeVisualState(getAnimationNow())
  if (trashBadge && trashBadge.opacity > 0) {
    const targetPoint = pendingDeleteNodeIndex.value === null
      ? undefined
      : currentPoints.value[pendingDeleteNodeIndex.value]
    const badgePoint = targetPoint
      ? sampleCurveVisualAtX(samples, targetPoint.x)
      : trashBadge.point
    drawTrashBadge(
      ctx,
      toScreenX(badgePoint.x, w),
      toScreenY(badgePoint.y, h),
      trashBadge.scale,
      trashBadge.opacity
    )
  }

  const addPointPreviewVisual = getAddPointPreviewVisualState(getAnimationNow())
  if (
    addPointPreviewVisual &&
    activeDragPoint.value === null &&
    pendingDeleteNodeIndex.value === null &&
    hoveredPoint.value === null
  ) {
    const previewCurvePoint = sampleCurveVisualAtX(
      samples,
      addPointPreviewVisual.x
    )
    drawAddPointPreview(
      ctx,
      toScreenX(addPointPreviewVisual.x, w),
      toScreenY(previewCurvePoint.y, h),
      addPointPreviewVisual.scale,
      addPointPreviewVisual.opacity
    )
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

// -------------------------------------------------------------
// 曲线画框鼠标交互
// -------------------------------------------------------------
const findNearNode = (sx: number, sy: number, w: number, h: number, threshold = 7) => {
  const points = currentPoints.value
  const samples = curveSamples.length > 0
    ? getCurveSamples(getAnimationNow())
    : buildCurveSamples(points)

  for (let index = 0; index < points.length; index++) {
    const point = points[index]
    if (!point) continue
    const visualPoint = sampleCurveVisualAtX(samples, point.x)
    if (
      Math.hypot(
        toScreenX(point.x, w) - sx,
        toScreenY(visualPoint.y, h) - sy
      ) <= threshold
    ) {
      return index
    }
  }
  return null
}

const removeCurveNode = (index: number) => {
  if (!activePreset.value) return
  const points = [...currentPoints.value]
  if (points.length <= 2 || index <= 0 || index >= points.length - 1) return

  setPendingDeleteNode(null)
  points.splice(index, 1)
  selectedNodeIndex.value = null
  activeDragPoint.value = null
  updatePresetEffect(activePreset.value.id, { points })
  drawCurve()
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

const isInsideCurvePlot = (sx: number, sy: number, w: number, h: number) => (
  sx >= padLeft &&
  sx <= w - padRight &&
  sy >= padTop &&
  sy <= h - padBottom
)

const getCurveInsertionAt = (nx: number) => {
  if (!activePreset.value) return null
  const points = currentPoints.value.map(point => ({ ...point }))
  const insertIndex = points.findIndex(point => point.x > nx)
  const index = insertIndex === -1 ? points.length : insertIndex
  const previousPoint = points[index - 1]
  const nextPoint = points[index]
  const minX = previousPoint ? previousPoint.x + MIN_CURVE_POINT_X_GAP : 0
  const maxX = nextPoint ? nextPoint.x - MIN_CURVE_POINT_X_GAP : 1
  if (minX > maxX) return null

  const insertX = Math.max(minX, Math.min(maxX, nx))
  const sampled = sampleCurvePoint(
    currentPoints.value,
    insertX,
    currentColor.value
  )

  return {
    index,
    x: insertX,
    y: sampled.y,
    color: sampled.color
  }
}

const addCurveNodeAt = (nx: number) => {
  if (!activePreset.value) return false
  const insertion = getCurveInsertionAt(nx)
  if (!insertion) return false

  const points = currentPoints.value.map(point => ({ ...point }))
  points.splice(insertion.index, 0, {
    x: insertion.x,
    y: insertion.y,
    color: insertion.color
  })
  selectedNodeIndex.value = insertion.index
  activeDragPoint.value = null
  clearAddPointPreview()
  updatePresetEffect(activePreset.value.id, { points })
  settleCurveAnimation(currentPoints.value)
  return true
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

  const hit = findNearNode(sx, sy, w, h)
  const nx = toNormX(sx, w)
  const ny = toNormY(sy, h)

  if (hit !== null && pendingDeleteNodeIndex.value === hit) {
    removeCurveNode(hit)
    return
  }

  setPendingDeleteNode(null)

  if (hit === null) {
    selectedNodeIndex.value = null
    const preview = isInsideCurvePlot(sx, sy, w, h)
      ? getCurveInsertionAt(nx)
      : null
    if (preview) {
      setAddPointPreview(preview.x, preview.y)
    } else {
      clearAddPointPreview()
      drawCurve()
    }
    return
  }

  try {
    ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
  } catch {}

  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', onGlobalPointerMove)
    window.addEventListener('pointerup', onGlobalPointerUp)
    window.addEventListener('pointercancel', onGlobalPointerUp)
    window.addEventListener('blur', stopCanvasDrag)
  }

  const points = currentPoints.value.map(point => ({ ...point }))
  const point = points[hit]
  if (!point) return

  point.y = ny
  if (hit > 0 && hit < points.length - 1) {
    const previousPoint = points[hit - 1]
    const nextPoint = points[hit + 1]
    if (previousPoint && nextPoint) {
      point.x = Math.max(
        previousPoint.x + MIN_CURVE_POINT_X_GAP,
        Math.min(nextPoint.x - MIN_CURVE_POINT_X_GAP, nx)
      )
    }
  }

  selectedNodeIndex.value = hit
  activeDragPoint.value = hit
  clearAddPointPreview()
  updatePresetEffect(activePreset.value.id, { points })
  settleCurveAnimation(currentPoints.value)
  drawCurve()
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

  if (activeDragPoint.value !== null) {
    const nx = toNormX(sx, w)
    const ny = toNormY(sy, h)
    const index = activeDragPoint.value
    const points = currentPoints.value.map(point => ({ ...point }))
    const point = points[index]
    if (!point) return

    point.y = ny
    if (index > 0 && index < points.length - 1) {
      const previousPoint = points[index - 1]
      const nextPoint = points[index + 1]
      if (previousPoint && nextPoint) {
        point.x = Math.max(
          previousPoint.x + MIN_CURVE_POINT_X_GAP,
          Math.min(nextPoint.x - MIN_CURVE_POINT_X_GAP, nx)
        )
      }
    }
    updatePresetEffect(activePreset.value.id, { points })
    settleCurveAnimation(currentPoints.value)
    drawCurve()
  } else {
    const hit = findNearNode(sx, sy, w, h)
    hoveredPoint.value = hit
    if (
      hit === null &&
      addPointPreview.value &&
      addPointPreview.value.phase !== 'exit' &&
      isInsideCurvePlot(sx, sy, w, h)
    ) {
      const preview = getCurveInsertionAt(toNormX(sx, w))
      if (preview) {
        setAddPointPreview(preview.x, preview.y)
      }
    }
    drawCurve()
  }
}

const onCanvasPointerLeave = () => {
  if (activeDragPoint.value !== null) return
  hoveredPoint.value = null
  clearAddPointPreview()
  drawCurve()
}

const onCanvasPointerUp = (e: PointerEvent) => {
  try {
    ;(e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId)
  } catch {}
  stopCanvasDrag()
}

const onCanvasDblClick = (e: MouseEvent) => {
  e.preventDefault()
  if (!activePreset.value) return
  const viewport = canvasViewportRef.value
  if (!viewport) return
  const rect = viewport.getBoundingClientRect()
  const sx = e.clientX - rect.left
  const sy = e.clientY - rect.top
  const hit = findNearNode(sx, sy, rect.width, rect.height)
  const points = currentPoints.value

  if (hit === null) {
    const nx = toNormX(sx, rect.width)
    if (isInsideCurvePlot(sx, sy, rect.width, rect.height)) {
      addCurveNodeAt(nx)
    }
    return
  }

  if (hit <= 0 || hit >= points.length - 1) {
    setPendingDeleteNode(null)
    return
  }

  clearAddPointPreview()
  setPendingDeleteNode(hit)
  selectedNodeIndex.value = hit
  drawCurve()
}

// -------------------------------------------------------------
// 曲线模板管理系统
// -------------------------------------------------------------
const normalizeCurveTemplates = (templates: unknown[]): PresetCurveTemplate[] => (
  templates
    .map((template, index) => normalizeCurveTemplate(template, index, currentColor.value))
    .filter((template): template is PresetCurveTemplate => template !== null)
)

const curveTemplates = useState<PresetCurveTemplate[]>('design_curve_templates', () => [])
curveTemplates.value = normalizeCurveTemplates(curveTemplates.value)

const loadCurveTemplates = () => {
  if (curveTemplates.value.length > 0) return
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem('lse_curve_templates')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        curveTemplates.value = normalizeCurveTemplates(parsed)
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
  const newTmpl: PresetCurveTemplate = {
    id: 'tmpl-' + Date.now(),
    name: `曲线 ${curveTemplates.value.length + 1}`,
    points: currentPoints.value.map(point => ({ ...point }))
  }

  curveTemplates.value.push(newTmpl)
  saveCurveTemplates()
}

const applyCurveTemplate = (tmpl: PresetCurveTemplate) => {
  if (!activePreset.value) return
  setPendingDeleteNode(null)
  if (tmpl.points.length > 0) {
    updatePresetEffect(activePreset.value.id, {
      points: tmpl.points.map(point => ({ ...point }))
    })
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

const startEditTemplate = (tmpl: PresetCurveTemplate) => {
  editingTemplateId.value = tmpl.id
  editingTemplateName.value = tmpl.name
  nextTick(() => {
    templateEditInputRef.value?.focus()
    templateEditInputRef.value?.select()
  })
}

const saveEditTemplate = (tmpl: PresetCurveTemplate) => {
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
let activePlaybackCycle = -1
let previewDevicePlaybackActive = false

const startPreviewDevicePlayback = () => {
  const preset = activePreset.value
  if (!preset) return

  previewDevicePlaybackActive = true
  sendPresetToDevice(preset, undefined, 'preview')
}

const stopPreviewDevicePlayback = () => {
  if (!previewDevicePlaybackActive) return

  previewDevicePlaybackActive = false
  stopDevicePlayback('preview')
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
    activePlaybackCycle = -1
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
        enqueueFadingFill(1, fillAlpha.value)
        isPlaying.value = false
        fillAlpha.value = 0
        playProgress.value = 0
        playStartTime = 0
      } else {
        const cycleIndex = Math.floor(elapsed / dur)
        if (activePlaybackCycle !== -1 && cycleIndex !== activePlaybackCycle) {
          enqueueFadingFill(1, fillAlpha.value)
        }
        activePlaybackCycle = cycleIndex
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
      return
    }
  }

  drawCurve()
  playRafId = requestAnimationFrame(runPlayLoop)
}

watch(
  () => isPlaybackPaused.value,
  (paused) => {
    if (paused) {
      pauseDevicePlayback('preview')
      if (isPlaying.value && playStartTime > 0) {
        playbackPausedAt = performance.now()
      }
      return
    }

    resumeDevicePlayback('preview')
    if (playbackPausedAt > 0 && playStartTime > 0) {
      playStartTime += performance.now() - playbackPausedAt
    }
    playbackPausedAt = 0
  }
)

watch(
  () => playSeekVersion.value,
  () => {
    if (!previewDevicePlaybackActive) return
    seekDevicePlayback(
      playSeekProgress.value * currentDuration.value,
      'preview'
    )
  }
)

watch(
  [() => isPlaying.value, () => playTriggerTime.value],
  ([playing]) => {
    if (playing) {
      startPreviewDevicePlayback()
      // 连续按键按下预设/重复触发播放时，前一个扫描填充不直接消失，捕获到渐变消退列表中 (与播放完成后动画相同)
      if (playProgress.value > 0 && fillAlpha.value > 0) {
        enqueueFadingFill(playProgress.value, fillAlpha.value)
      }

      playProgress.value = 0
      fillAlpha.value = 1
      playStartTime = 0
      lastLoopTime = 0
      activePlaybackCycle = -1
      if (playRafId) cancelAnimationFrame(playRafId)
      playRafId = requestAnimationFrame(runPlayLoop)
    } else {
      stopPreviewDevicePlayback()
      if (fillAlpha.value > 0) {
        enqueueFadingFill(playProgress.value, fillAlpha.value)
        fillAlpha.value = 0
      }
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
    typeof canvas.animate !== 'function'
  ) {
    return
  }

  curveRevealAnimation?.cancel()
  curveRevealAnimation = canvas.animate(
    [
      { opacity: 0 },
      { opacity: 1 }
    ],
    {
      duration: 320,
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
      if (effectiveDesignViewMode.value === 'timeline' || !showDesignWorkspace.value) {
        return
      }
      observeCurveCanvas()
      drawCurve()
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
  if (effectiveDesignViewMode.value !== 'timeline') {
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
  () => currentPoints.value,
  (points) => {
    const presetId = activePreset.value?.id ?? null
    const targetSampleXs = getCurveSampleXs(
      points,
      curveSamples.map(sample => sample.x)
    )
    const targetSamples = buildCurveSamples(points, targetSampleXs)

    if (
      curveTransitionPresetId !== presetId ||
      curveSamples.length === 0 ||
      activeDragPoint.value !== null
    ) {
      curveTransition = null
      curveSamples = buildCurveSamples(points)
      curveTransitionPresetId = presetId
      return
    }

    const now = getAnimationNow()
    const fromSamples = resampleCurveVisual(getCurveSamples(now), targetSampleXs)
    curveTransition = {
      fromSamples,
      toSamples: targetSamples,
      startedAt: now,
      duration: CURVE_CHANGE_DURATION
    }
    curveSamples = fromSamples
    scheduleCurveAnimationFrame()
  },
  { flush: 'sync' }
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

    selectedNodeIndex.value = null
    clearAddPointPreview(false)
    setPendingDeleteNode(null)
    // 保留 fadingFills，连续按键切换预设时的消退动画能平滑过渡，不直接闪断消失
    nextTick(() => {
      drawCurve()
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
  if (eventId !== previousEventId) {
    cancelTimelineClipFillDrag()
    selectedTimelineTriggerIds.value = []
    timelineMarqueeRect.value = null
  }
  timelineEventId.value = eventId

  if (
    timelineEventId.value !== null &&
    effectiveDesignViewMode.value === 'timeline'
  ) {
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
        effectiveDesignViewMode.value === 'timeline' &&
        eventId !== null &&
        previousEventId !== null &&
        eventId !== previousEventId
      ) {
        animateDesignTargetSwitch(timelineEditorRef.value)
        animateDesignTargetSwitch(timelineThumbnailStripRef.value)
        animateDesignTargetSwitch(timelineWaveformLayerRef.value)
        animateTimelineTracksReveal()
      }
    })
    return
  }

  timelineResizeObserver?.disconnect()
  timelineResizeObserver = null
  nextTick(() => {
    drawCurve()
    observeCurveCanvas()
  })
})

watch(timelinePresetItems, (items) => {
  const availableTriggerIds = new Set(
    items.map(item => item.playback.triggerId)
  )
  selectedTimelineTriggerIds.value = selectedTimelineTriggerIds.value.filter(
    triggerId => availableTriggerIds.has(triggerId)
  )
})

watch(effectiveDesignViewMode, (mode, previousMode) => {
  if (mode !== 'timeline') {
    selectedTimelineTriggerIds.value = []
    timelineMarqueeRect.value = null
  }
  if (mode !== 'timeline' || previousMode === 'timeline') return
  nextTick(animateTimelineTracksReveal)
}, { flush: 'post' })

watch(
  () => [
    videoSrc.value,
    videoDuration.value,
    timelineThumbnailCount.value,
    timelineEventId.value,
    timelineCommittedRangeStart.value,
    timelineCommittedRangeDuration.value
  ] as const,
  ([source, duration, thumbnailCount, eventId, rangeStart, rangeDuration]) => {
    if (effectiveDesignViewMode.value !== 'timeline') {
      return
    }
    if (
      !source ||
      duration <= 0
    ) {
      resetTimelineThumbnailCache()
      clearTimelineThumbnails()
      return
    }

    if (timelineThumbnailCacheSource !== source) {
      resetTimelineThumbnailCache(source)
    }
    if (eventId === null || rangeDuration <= 0 || rangeStart < 0) {
      clearTimelineThumbnails()
      return
    }
    if (thumbnailCount <= 0) {
      clearTimelineThumbnails()
      return
    }

    clearTimelineThumbnails()
    scheduleTimelineThumbnailGeneration()
  }
)

watch(
  [timelineCommittedRangeStart, timelineCommittedRangeDuration],
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
    () => videoCurrentTime.value,
    () => timelineVideoPosition.value,
    () => timelinePixelWidth.value,
    () => effectiveDesignViewMode.value
  ],
  scheduleTimelinePlaybackProgressRender,
  { flush: 'post' }
)

watch(
  [
    () => videoSrc.value,
    () => videoDuration.value,
    () => timelineEventId.value,
    timelineCommittedRangeStart,
    timelineCommittedRangeDuration
  ],
  ([source, duration, eventId]) => {
    if (effectiveDesignViewMode.value !== 'timeline') {
      return
    }
    if (!source || duration <= 0) {
      resetTimelineWaveformCache()
      clearTimelineWaveform()
      return
    }
    if (timelineWaveformCacheSource !== source) {
      resetTimelineWaveformCache(source)
    }
    if (eventId === null) {
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
  window.addEventListener('pointerup', handleTimelineClipFillPointerUp, true)
  window.addEventListener(
    'pointercancel',
    handleTimelineClipFillPointerCancel,
    true
  )
  window.addEventListener(
    'lostpointercapture',
    handleTimelineClipFillPointerLostCapture,
    true
  )
  window.addEventListener('pointerdown', handleColorPaletteOutsidePointerDown, true)
  window.addEventListener('keydown', handleColorPaletteKeydown)
  nextTick(() => {
    drawCurve()
    observeCurveCanvas()
    scheduleTimelinePlaybackProgressRender()
    if (
      timelineEventId.value !== null &&
      effectiveDesignViewMode.value === 'timeline'
    ) {
      observeTimelineViewport()
    }
    restoreTimelineViewportState()
  })
  refreshCurveCanvas()
})

onUnmounted(() => {
  stopPreviewDevicePlayback()
  cancelTimelineClipFillDrag()
  clearTimelineNativeDragImage()
  stopCanvasDrag()
  if (effectiveDesignViewMode.value === 'timeline') {
    clearTimelineThumbnails()
    clearTimelineWaveform()
  }
  removeCurvePresetTransition()
  window.removeEventListener('pointermove', handleTimelinePointerMove, true)
  window.removeEventListener('pointerup', handleTimelinePointerUp, true)
  window.removeEventListener('pointercancel', handleTimelinePointerUp, true)
  window.removeEventListener('pointerup', handleTimelineClipFillPointerUp, true)
  window.removeEventListener(
    'pointercancel',
    handleTimelineClipFillPointerCancel,
    true
  )
  window.removeEventListener(
    'lostpointercapture',
    handleTimelineClipFillPointerLostCapture,
    true
  )
  window.removeEventListener('pointerdown', handleColorPaletteOutsidePointerDown, true)
  window.removeEventListener('keydown', handleColorPaletteKeydown)
  closeColorPalette(false)
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
  timelineMarqueeRect.value = null
  if (curveAnimationRafId !== null) {
    cancelAnimationFrame(curveAnimationRafId)
    curveAnimationRafId = null
  }
  clearAddPointPreview(false)
  curveTransition = null
  trashBadgeVisual = null
  curveRevealAnimation?.cancel()
  curveRevealAnimation = null
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

const handleCardClick = (preset: PresetItem) => {
  presetDeselectArmed.value = false
  selectPreset(preset.id)
  if (isEventRecording.value) {
    recordPresetEvent(
      preset,
      presetContextEvent.value?.id
    )
  }
  focusWindow('win-presets')
}

const pendingDeletePresetId = ref<number | null>(null)
let presetDeleteConfirmTimer: ReturnType<typeof setTimeout> | null = null
const gridContainerRef = ref<HTMLDivElement | null>(null)
const draggingPresetId = ref<number | null>(null)
const dragOverPresetId = ref<number | null>(null)
const dragOverPresetPosition = ref<'before' | 'after'>('before')
const presetGridScrollTop = useState<number>('presets_grid_scroll_top', () => 0)
const PRESET_CARD_DEFAULT_SIZE = 96
const presetCardSize = useState<number>('presets_card_size', () => PRESET_CARD_DEFAULT_SIZE)
const presetZoomLabel = computed(() => {
  return `${(presetCardSize.value / PRESET_CARD_DEFAULT_SIZE).toFixed(2)}X`
})
const currentPresetOrdinal = computed(() => {
  if (selectedPresetId.value === null) return null
  const index = presets.value.findIndex(preset => preset.id === selectedPresetId.value)
  return index === -1 ? null : index + 1
})
const editingPreset = computed(() => {
  if (editingPresetId.value === null) return null
  return presets.value.find(preset => preset.id === editingPresetId.value) ?? null
})

const PRESET_CARD_MIN_SIZE = 64
const PRESET_CARD_MAX_SIZE = 160
const PRESET_CARD_SIZE_STEP = 16

const setPresetCardSizeAnimated = async (nextSize: number) => {
  if (nextSize === presetCardSize.value) return

  const cards = gridContainerRef.value
    ? Array.from(gridContainerRef.value.querySelectorAll<HTMLElement>('.preset-card'))
    : []
  const previousFrames = cards.map((card) => {
    const rect = card.getBoundingClientRect()
    card.getAnimations().forEach((animation) => {
      if (animation.id === 'preset-card-resize') {
        animation.cancel()
      }
    })
    return { card, rect }
  })

  presetCardSize.value = nextSize
  await nextTick()

  previousFrames.forEach(({ card, rect: previousRect }) => {
    if (!card.isConnected) return

    const nextRect = card.getBoundingClientRect()
    if (nextRect.width <= 0 || nextRect.height <= 0) return

    const translateX = previousRect.left - nextRect.left
    const translateY = previousRect.top - nextRect.top
    const sizeChanged = (
      Math.abs(previousRect.width - nextRect.width) > 0.5 ||
      Math.abs(previousRect.height - nextRect.height) > 0.5
    )

    if (
      !sizeChanged &&
      Math.abs(translateX) < 0.5 &&
      Math.abs(translateY) < 0.5
    ) {
      return
    }

    card.animate(
      [
        {
          transform: `translate(${translateX}px, ${translateY}px)`,
          width: `${previousRect.width}px`,
          height: `${previousRect.height}px`,
          transformOrigin: 'top left'
        },
        {
          transform: 'translate(0, 0)',
          width: `${nextRect.width}px`,
          height: `${nextRect.height}px`,
          transformOrigin: 'top left'
        }
      ],
      {
        id: 'preset-card-resize',
        duration: 240,
        easing: 'cubic-bezier(0.2, 0, 0, 1)'
      }
    )
  })
}

const zoomOutPresets = () => {
  void setPresetCardSizeAnimated(
    Math.max(
      PRESET_CARD_MIN_SIZE,
      presetCardSize.value - PRESET_CARD_SIZE_STEP
    )
  )
}

const zoomInPresets = () => {
  void setPresetCardSizeAnimated(
    Math.min(
      PRESET_CARD_MAX_SIZE,
      presetCardSize.value + PRESET_CARD_SIZE_STEP
    )
  )
}

const handlePresetGridScroll = () => {
  if (gridContainerRef.value) {
    presetGridScrollTop.value = gridContainerRef.value.scrollTop
  }
}

const restorePresetGridScroll = () => {
  nextTick(() => {
    requestAnimationFrame(() => {
      if (gridContainerRef.value) {
        gridContainerRef.value.scrollTop = presetGridScrollTop.value
      }
    })
  })
}

watch(workspaceRestoreVersion, () => {
  restorePresetGridScroll()
})

const handlePresetDragStart = (preset: PresetItem, event: DragEvent) => {
  if (!event.dataTransfer) {
    event.preventDefault()
    return
  }

  pauseTimelineFollow()
  event.dataTransfer.effectAllowed = 'copyMove'
  event.dataTransfer.setData(PRESET_DRAG_MIME, String(preset.id))
  const cardElement = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : null
  const cardRect = cardElement?.getBoundingClientRect()
  if (cardRect && cardRect.width > 0 && cardRect.height > 0) {
    presetDragPointerOffsetX.value = Math.max(
      0,
      Math.min(cardRect.width, event.clientX - cardRect.left)
    )
    event.dataTransfer.setData(PRESET_DRAG_META_MIME, JSON.stringify({
      id: preset.id,
      ...(presetContextEvent.value
        ? { sourceEventId: presetContextEvent.value.id }
        : {}),
      rect: {
        left: cardRect.left,
        top: cardRect.top,
        width: cardRect.width,
        height: cardRect.height
      },
      grabOffset: {
        x: event.clientX - cardRect.left,
        y: event.clientY - cardRect.top
      }
    }))
  } else {
    presetDragPointerOffsetX.value = 0
  }
  draggingPresetId.value = preset.id
}

const handlePresetDragEnd = () => {
  draggingPresetId.value = null
  dragOverPresetId.value = null
  dragOverPresetPosition.value = 'before'
  presetDragPointerOffsetX.value = null
}

const handlePresetDragOver = (preset: PresetItem, event: DragEvent) => {
  if (
    draggingPresetId.value === null ||
    draggingPresetId.value === preset.id ||
    !event.dataTransfer
  ) {
    return
  }

  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'

  const card = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : null
  if (!card) return

  const rect = card.getBoundingClientRect()
  dragOverPresetId.value = preset.id
  dragOverPresetPosition.value = event.clientX >= rect.left + rect.width / 2
    ? 'after'
    : 'before'
}

const handlePresetDragLeave = (preset: PresetItem, event: DragEvent) => {
  const card = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : null
  const nextTarget = event.relatedTarget
  if (card && nextTarget instanceof Node && card.contains(nextTarget)) return

  if (dragOverPresetId.value === preset.id) {
    dragOverPresetId.value = null
  }
}

const handlePresetDrop = (preset: PresetItem, event: DragEvent) => {
  if (draggingPresetId.value === null || !event.dataTransfer) return

  event.preventDefault()
  event.stopPropagation()
  movePreset(
    draggingPresetId.value,
    preset.id,
    dragOverPresetId.value === preset.id
      ? dragOverPresetPosition.value
      : 'before'
  )
  handlePresetDragEnd()
}

// 快捷键录制状态
const bindingPresetId = ref<number | null>(null)
const presetDeselectArmed = ref(false)

const handleBackgroundClick = () => {
  bindingPresetId.value = null
  if (selectedPresetId.value === null) {
    presetDeselectArmed.value = false
    return
  }

  if (!presetDeselectArmed.value) {
    presetDeselectArmed.value = true
    return
  }

  presetDeselectArmed.value = false
  selectPreset(null)
}

watch(selectedPresetId, () => {
  presetDeselectArmed.value = false
})

const playPresetTriggerAnimation = (presetId: number) => {
  const card = gridContainerRef.value?.querySelector<HTMLElement>(
    `.preset-card[data-preset-id="${presetId}"]`
  )
  const flash = card?.querySelector<HTMLElement>('.preset-trigger-flash')
  if (!flash || typeof flash.animate !== 'function') return

  flash.getAnimations().forEach(animation => animation.cancel())
  flash.animate(
    [
      { opacity: 0.96, transform: 'scale(0.97)' },
      { opacity: 0.9, transform: 'scale(1)', offset: 0.25 },
      { opacity: 0, transform: 'scale(1)' }
    ],
    {
      id: 'preset-trigger-flash',
      duration: 180,
      easing: 'cubic-bezier(0.2, 0, 0, 1)'
    }
  )
}

// 开始录制快捷键
const startBinding = (presetId: number) => {
  bindingPresetId.value = presetId
}

// 格式化按键名称
const formatKeyName = (e: KeyboardEvent): string => {
  if (e.key === ' ') return 'Space'
  if (e.code && e.code.startsWith('Digit')) {
    return e.code.replace('Digit', '')
  }
  if (e.code && e.code.startsWith('Key')) {
    return e.code.replace('Key', '')
  }
  if (e.key.length === 1) {
    return e.key.toUpperCase()
  }
  return e.key
}

// 全局按键监听：录制快捷键 / 捕获已绑定预设的按键触发
const handleGlobalKeyDown = (e: KeyboardEvent) => {
  // 1. 若处于快捷键录制模式
  if (bindingPresetId.value !== null) {
    const bindingId = bindingPresetId.value
    // 忽略单纯按下的修饰键
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
      return
    }

    e.preventDefault()
    e.stopPropagation()

    if (e.key === 'Escape') {
      // Esc 移除当前预设的按键绑定
      updatePresetShortcut(bindingId, '')
      bindingPresetId.value = null
      return
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      // Backspace / Delete 清除快捷键
      updatePresetShortcut(bindingId, '')
      bindingPresetId.value = null
      return
    }

    const keyName = formatKeyName(e)
    updatePresetShortcut(bindingId, keyName)
    bindingPresetId.value = null
    return
  }

  // 若焦点在可输入控件中，忽略快捷键触发
  const target = e.target as HTMLElement | null
  if (target) {
    const tagName = target.tagName.toLowerCase()
    if (tagName === 'input' || tagName === 'textarea' || target.isContentEditable) {
      return
    }
  }

  if (
    effectiveDesignViewMode.value === 'timeline'
    && (e.key === 'Delete' || e.key === 'Backspace')
  ) {
    handleTimelineDeleteKey(e)
    if (e.defaultPrevented) return
  }

  // 忽略单独的修饰键
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
    return
  }

  const pressedKey = formatKeyName(e).toUpperCase()
  const matchedPreset = presets.value.find(
    p => p.shortcut && p.shortcut.toUpperCase() === pressedKey
  )

  if (matchedPreset) {
    e.preventDefault()
    e.stopPropagation()

    presetDeselectArmed.value = false
    // 选中并同步播放效果
    selectPreset(matchedPreset.id)
    triggerPlaySync()

    playPresetTriggerAnimation(matchedPreset.id)
    if (!e.repeat) {
      recordPresetEvent(
        matchedPreset,
        presetContextEvent.value?.id
      )
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeyDown, true)
  restorePresetGridScroll()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeyDown, true)
  if (presetDeleteConfirmTimer) clearTimeout(presetDeleteConfirmTimer)
  editingPresetId.value = null
})

// 删除预设
const handleDeletePreset = (id: number) => {
  if (pendingDeletePresetId.value !== id) {
    if (presetDeleteConfirmTimer) clearTimeout(presetDeleteConfirmTimer)
    pendingDeletePresetId.value = id
    presetDeleteConfirmTimer = setTimeout(() => {
      if (pendingDeletePresetId.value === id) {
        pendingDeletePresetId.value = null
      }
      presetDeleteConfirmTimer = null
    }, 2000)
    return
  }

  if (presetDeleteConfirmTimer) clearTimeout(presetDeleteConfirmTimer)
  presetDeleteConfirmTimer = null
  pendingDeletePresetId.value = null
  removePreset(id)
}

const openPresetEditor = (preset: PresetItem) => {
  presetDeselectArmed.value = false
  editingPresetId.value = preset.id
  selectPreset(preset.id)
  refreshCurveCanvas()
}

const savePresetEditor = () => {
  editingPresetId.value = null
}

const togglePresetEditorPlayback = () => {
  if (!editingPreset.value) return

  if (isPlaying.value) {
    togglePlay()
    return
  }

  triggerPlaySync()
}

watch(
  () => presetContextEvent.value?.id ?? null,
  (eventId, previousEventId) => {
    if (eventId === previousEventId) return

    bindingPresetId.value = null
    pendingDeletePresetId.value = null
    if (presetDeleteConfirmTimer) {
      clearTimeout(presetDeleteConfirmTimer)
      presetDeleteConfirmTimer = null
    }
    editingPresetId.value = null
    presetDeselectArmed.value = false
    selectPreset(null)
  }
)

// 监听新增预设自动滚动至底部
watch(
  () => presets.value.length,
  (newLen, oldLen) => {
    if (newLen > (oldLen || 0)) {
      nextTick(() => {
        if (gridContainerRef.value) {
          gridContainerRef.value.scrollTop = gridContainerRef.value.scrollHeight
        }
      })
    }
  }
)

watch(
  () => presets.value.map(preset => preset.id).join(','),
  () => {
    if (
      editingPresetId.value !== null &&
      !presets.value.some(preset => preset.id === editingPresetId.value)
    ) {
      editingPresetId.value = null
    }
  }
)

defineExpose({
  pickScreenColor,
  setColor
})
</script>

<template>
<div
    class="presets-window-container"
    @click="handleBackgroundClick"
  >
    <!-- 网格滚动区 -->
    <div
      ref="gridContainerRef"
      class="presets-grid-scroll"
      @scroll="handlePresetGridScroll"
    >
      <!-- 正方形网格 -->
      <TransitionGroup
        v-if="presets.length > 0"
        name="presets-list"
        tag="div"
        appear
        class="presets-grid"
        :style="{ '--preset-card-size': `${presetCardSize}px` }"
      >
        <div
          v-for="preset in presets"
          :key="preset.id"
          class="preset-card"
          :class="{
            'is-selected': selectedPresetId === preset.id,
            'is-pending-deselect': presetDeselectArmed && selectedPresetId === preset.id,
            'is-dragging': draggingPresetId === preset.id,
            'is-drag-before': dragOverPresetId === preset.id && dragOverPresetPosition === 'before',
            'is-drag-after': dragOverPresetId === preset.id && dragOverPresetPosition === 'after'
          }"
          :style="{ '--preset-color': preset.effect?.color || '#ffffff' }"
          :data-preset-id="preset.id"
          draggable="true"
          @dragstart="handlePresetDragStart(preset, $event)"
          @dragover="handlePresetDragOver(preset, $event)"
          @dragleave="handlePresetDragLeave(preset, $event)"
          @drop="handlePresetDrop(preset, $event)"
          @dragend="handlePresetDragEnd"
          @pointerdown.stop
          @click.stop="handleCardClick(preset)"
        >
          <span class="preset-trigger-flash" aria-hidden="true" />
          <!-- 每一个预设左上角为 ID 数字 -->
          <span class="preset-id">{{ preset.id }}</span>

          <!-- 右上角快捷键标记/配置按钮 (原垃圾桶位置) -->
          <button
            class="preset-shortcut-badge"
            type="button"
            :class="{
              'is-binding': bindingPresetId === preset.id,
              'has-shortcut': !!preset.shortcut
            }"
            @click.stop="bindingPresetId === preset.id ? (bindingPresetId = null) : startBinding(preset.id)"
          >
            <span v-if="bindingPresetId === preset.id" class="binding-text">...</span>
            <span v-else-if="preset.shortcut" class="shortcut-key">{{ preset.shortcut }}</span>
            <span v-else class="shortcut-placeholder">+</span>
          </button>

          <!-- 预设名称区域 -->
          <div class="preset-name-area">
            <span class="preset-name">{{ preset.name }}</span>
          </div>

          <!-- 左下角编辑预设 -->
          <button
            class="preset-edit-btn"
            type="button"
            aria-label="编辑预设"
            title="编辑预设"
            draggable="false"
            @pointerdown.stop
            @dragstart.stop.prevent
            @mousedown.prevent
            @click.stop="openPresetEditor(preset)"
            @dblclick.stop
          >
            <svg class="preset-action-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
            </svg>
          </button>

          <!-- 右下角删除预设 -->
          <button
            class="preset-delete-btn"
            :class="{ 'is-confirming': pendingDeletePresetId === preset.id }"
            type="button"
            :aria-label="pendingDeletePresetId === preset.id ? '再次点击确认删除预设' : '删除预设'"
            :title="pendingDeletePresetId === preset.id ? '再次点击确认删除' : '删除预设'"
            draggable="false"
            @pointerdown.stop
            @dragstart.stop.prevent
            @mousedown.prevent
            @click.stop="handleDeletePreset(preset.id)"
            @dblclick.stop
          >
            <svg class="preset-action-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
            </svg>
          </button>
        </div>
      </TransitionGroup>

      <!-- 空状态 -->
      <div v-else class="presets-empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 2v3H5V5h14zm-7 5h7v4h-7v-4zm-2 0v4H5v-4h5zm-5 6h5v3H5v-3zm7 3v-3h7v3h-7z"
          />
        </svg>
        <span class="empty-title">暂无预设</span>
      </div>
    </div>

    <!-- 底部统计栏 (若有预设) -->
    <div v-if="presets.length > 0" class="presets-footer">
      <div class="presets-footer-summary">
        <span v-if="currentPresetOrdinal !== null" class="footer-current">
          当前第 {{ currentPresetOrdinal }} 个预设，
        </span>
        <span class="footer-count">共 {{ presets.length }} 个预设</span>
      </div>
      <div class="preset-zoom-controls">
        <button
          class="preset-zoom-btn"
          type="button"
          aria-label="缩小预设"
          :disabled="presetCardSize <= PRESET_CARD_MIN_SIZE"
          @click.stop="zoomOutPresets"
        >
          <svg class="preset-zoom-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13H5v-2h14v2z" />
          </svg>
        </button>
        <span class="preset-zoom-value">{{ presetZoomLabel }}</span>
        <button
          class="preset-zoom-btn"
          type="button"
          aria-label="放大预设"
          :disabled="presetCardSize >= PRESET_CARD_MAX_SIZE"
          @click.stop="zoomInPresets"
        >
          <svg class="preset-zoom-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
          </svg>
        </button>
      </div>
    </div>

    <Transition name="preset-editor-panel">
      <section
        v-if="editingPreset"
        class="preset-editor-panel"
        aria-label="预设曲线编辑器"
        @click.stop
      >
        <header class="preset-editor-header">
          <span class="preset-editor-title">
            编辑预设 {{ editingPreset.id }} · {{ editingPreset.name }}
          </span>
          <div class="preset-editor-actions">
            <button
              class="preset-editor-play"
              type="button"
              :aria-label="isPlaying ? '暂停预览' : '播放预览'"
              :title="isPlaying ? '暂停预览' : '播放预览'"
              @click.stop="togglePresetEditorPlayback"
            >
              <svg v-if="!isPlaying" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            </button>
            <button
              class="preset-editor-save"
              type="button"
              aria-label="保存并关闭预设编辑"
              title="保存并关闭"
              @click.stop="savePresetEditor"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </button>
          </div>
        </header>
        <div class="preset-editor-body">
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
          :class="{ 'is-timeline-mode': effectiveDesignViewMode === 'timeline' }"
        >
        <div
          ref="designViewRef"
          class="design-view"
          :aria-hidden="effectiveDesignViewMode === 'timeline'"
          :inert="effectiveDesignViewMode === 'timeline'"
        >
      <!-- 顶部参数工具栏：快速颜色与参数控制项 -->
      <div class="design-toolbar">
        <!-- 色彩数值输入列 (十六进制上，RGB 下) -->
        <div class="color-values-col">
          <!-- HEX 文本输入行 -->
          <div class="color-input-row">
            <div class="color-val-input-wrapper hex-wrapper">
              <button
                ref="colorPreviewSwatchRef"
                class="color-preview-swatch"
                type="button"
                aria-label="打开调色板"
                aria-haspopup="dialog"
                :aria-expanded="isColorPaletteOpen"
                :style="{ backgroundColor: currentColor }"
                @click="toggleColorPalette"
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
              <Transition name="color-palette">
                <div
                  v-if="isColorPaletteOpen"
                  ref="colorPaletteRef"
                  class="color-palette-popover"
                  role="dialog"
                  aria-label="调色板"
                >
                  <div
                    ref="paletteSpectrumRef"
                    class="color-palette-spectrum"
                    :style="{ '--palette-hue': paletteHue }"
                    @pointerdown="onPaletteSpectrumPointerDown"
                    @pointermove="onPaletteSpectrumPointerMove"
                    @pointerup="onPaletteSpectrumPointerUp"
                    @pointercancel="onPaletteSpectrumPointerUp"
                    @lostpointercapture="onPaletteSpectrumPointerUp"
                  >
                    <span
                      class="color-palette-cursor"
                      :style="paletteCursorStyle"
                    />
                  </div>
                  <input
                    class="color-palette-hue"
                    type="range"
                    min="0"
                    max="360"
                    step="1"
                    :value="paletteHue"
                    aria-label="色相"
                    @input="onPaletteHueInput"
                  >
                  <div class="color-palette-footer">
                    <span
                      class="color-palette-current"
                      :style="{ backgroundColor: currentColor }"
                    />
                    <span class="color-palette-value">
                      {{ currentColor.toUpperCase() }}
                    </span>
                  </div>
                </div>
              </Transition>
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
                :disabled="currentRepeat <= 0"
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
          <div class="history-colors-content">
            <Transition name="history-palette">
              <div
                v-if="historyColors.length > 0"
                class="history-palette-layer"
              >
                <TransitionGroup
                  tag="div"
                  name="history-color"
                  class="history-colors-grid"
                  @before-leave="handleHistoryColorBeforeLeave"
                >
                  <div
                    v-for="(color, idx) in historyColors"
                    :key="color"
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
                </TransitionGroup>
              </div>
            </Transition>
            <Transition name="history-empty">
              <div
                v-if="historyColors.length === 0"
                class="empty-history-box"
              >
                <span class="empty-history-text">暂无历史颜色</span>
              </div>
            </Transition>
          </div>
        </div>

        <!-- 降级取色器（隐藏） -->
        <input
          ref="fallbackInputRef"
          type="color"
          class="hidden-color-input"
          :value="currentColor"
          @input="setColor(($event.target as HTMLInputElement).value)"
          @change="applyPickedColor(($event.target as HTMLInputElement).value)"
        />
        </div>
        <!-- 曲线顶栏：自定义曲线模版 -->
        <div class="curve-toolbar">
          <!-- 曲线模板栏 -->
          <div class="custom-templates-group">
            <div v-if="curveTemplates.length > 0" class="templates-list">
              <div
                v-for="tmpl in curveTemplates"
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

        <!-- 统一效果曲线画布视口 -->
        <div
          ref="canvasViewportRef"
          class="curve-canvas-viewport"
        >
          <canvas
            ref="curveCanvasRef"
            :class="['curve-canvas', canvasCursorClass]"
            @pointerdown="onCanvasPointerDown"
            @pointermove="onCanvasPointerMove"
            @pointerleave="onCanvasPointerLeave"
            @pointerup="onCanvasPointerUp"
            @pointercancel="onCanvasPointerUp"
            @lostpointercapture="onCanvasPointerUp"
            @dblclick="onCanvasDblClick"
            @contextmenu.prevent
          />
        </div>
          </div>

        <!-- 事件时间线：与视频时间对应的剪辑式编辑轨道 -->
        <section
          ref="timelineEditorRef"
          class="timeline-editor"
          :aria-hidden="effectiveDesignViewMode !== 'timeline'"
          :inert="effectiveDesignViewMode !== 'timeline'"
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
                'is-panning': timelineInteractionMode === 'pan',
                'is-middle-panning': timelineInteractionPanButton === 1
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
                :class="{ 'is-clip-dragging': timelineDraggingTriggerIds.length > 0 }"
              >
              <div
                ref="timelineThumbnailStripRef"
                class="timeline-thumbnail-strip"
                aria-hidden="true"
                @pointerdown.stop="startTimelineMediaDrag"
                >
                  <TransitionGroup name="timeline-thumbnail" appear>
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

              <div
                ref="timelineWaveformLayerRef"
                class="timeline-waveform-layer"
                aria-hidden="true"
              >
                  <Transition name="timeline-thumbnail" appear>
                    <canvas
                      v-if="timelineWaveformReady"
                      :ref="setTimelineWaveformCanvasRef"
                      class="timeline-waveform-canvas"
                    />
                  </Transition>
                </div>

              <div
                ref="timelineTracksViewportRef"
                class="timeline-tracks-viewport"
                @pointerdown.capture="startTimelineMiddleDrag"
                @pointerdown="startTimelineMarqueeSelection"
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
                    v-for="beat in timelineBeatMarkers"
                    :key="beat.key"
                    class="timeline-beat-line"
                    :style="{ left: `${beat.left}%` }"
                    aria-hidden="true"
                  />

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
                          'is-selected': selectedTimelineTriggerIds.includes(
                            item.playback.triggerId
                          ),
                          'is-playing': (
                            playingEventId === item.event.id &&
                            playingEventTriggerId === item.playback.triggerId
                          ),
                          'is-fill-dragging': (
                            timelineFillDraggingTriggerId === item.playback.triggerId
                          ),
                          'is-fill-remove-preview': (
                            timelineFillRemovePreviewTriggerIds.includes(
                              item.playback.triggerId
                            )
                          ),
                          'is-dragging': timelineDraggingTriggerIds.includes(
                            item.playback.triggerId
                          ),
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
                        <div class="timeline-clip-content">
                          <span class="timeline-clip-id">P{{ item.playback.preset.id }}</span>
                          <span class="timeline-clip-name">{{ item.playback.preset.name }}</span>
                        </div>

                        <button
                          class="timeline-clip-remove"
                          type="button"
                          :aria-label="(
                            selectedTimelineTriggerIds.includes(item.playback.triggerId)
                            && selectedTimelineTriggerIds.length > 1
                          ) ? '批量删除选中预设' : '移除时间线预设'"
                          :title="(
                            selectedTimelineTriggerIds.includes(item.playback.triggerId)
                            && selectedTimelineTriggerIds.length > 1
                          ) ? '批量删除选中预设' : '移除时间线预设'"
                          draggable="false"
                          @dragstart.stop.prevent
                          @pointerdown.stop
                          @click.stop="removeTimelinePreset(item, $event)"
                          @dblclick.stop
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M18.3 5.71a.996.996 0 0 0-1.41 0L12 10.59 7.11 5.7A.996.996 0 1 0 5.7 7.11L10.59 12 5.7 16.89a.996.996 0 1 0 1.41 1.41L12 13.41l4.89 4.89a.996.996 0 1 0 1.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4z" />
                          </svg>
                        </button>

                        <button
                          class="timeline-clip-fill-handle"
                          type="button"
                          aria-label="拖动批量复制或移除预设"
                          title="拖动复制或移除"
                          draggable="false"
                          @dragstart.stop.prevent
                          @pointerdown.stop.prevent="handleTimelineClipFillPointerDown(item, $event)"
                          @pointermove="handleTimelineClipFillPointerMove"
                          @pointerup="handleTimelineClipFillPointerUp"
                          @pointercancel="handleTimelineClipFillPointerCancel"
                          @lostpointercapture="handleTimelineClipFillPointerLostCapture"
                          @click.stop
                          @dblclick.stop
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                          </svg>
                        </button>
                      </div>

                      <div
                        v-for="preview in getTimelineFillPreviewsForTrack(trackIndex)"
                        :key="preview.key"
                        class="timeline-clip-fill-preview"
                        :style="{
                          left: `${getTimelinePositionPercent(preview.startTime)}%`,
                          width: `max(16px, ${getTimelineSpanPercent(preview.durationSeconds)}%)`,
                          '--clip-color': preview.color
                        }"
                        aria-hidden="true"
                      />
                    </div>
                </div>
              </div>

              <div
                v-if="timelineMarqueeRect"
                class="timeline-marquee"
                :style="{
                  left: `${timelineMarqueeRect.left}px`,
                  top: `${timelineMarqueeRect.top}px`,
                  width: `${timelineMarqueeRect.width}px`,
                  height: `${timelineMarqueeRect.height}px`
                }"
                aria-hidden="true"
              />

              </div>

              <div
                ref="timelinePlayheadRef"
                class="timeline-playhead"
                :class="{ 'is-preset-dragging': presetDragPointerOffsetX !== null }"
                @pointerdown.stop="startTimelinePlayheadDrag"
                @click.stop="handleTimelineRulerClick"
              />
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
                :disabled="isTimelineAtMaxZoom"
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
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.presets-window-container {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background-color: var(--md-sys-color-surface, #1c1f26);
  color: var(--md-sys-color-on-surface, #e8edf2);
  user-select: none;
  overflow: hidden;
}

/* 网格滚动容器 */
.presets-grid-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
}

.presets-grid-scroll::-webkit-scrollbar {
  width: 6px;
}

.presets-grid-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.presets-grid-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.14);
  border-radius: 3px;
}

.presets-grid-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}

/* 正方形网格布局 */
.presets-grid {
  display: grid;
  grid-template-columns: repeat(
    auto-fill,
    minmax(var(--preset-card-size, 96px), 1fr)
  );
  gap: 12px;
}

.preset-card.presets-list-enter-active {
  transition: opacity 0.24s cubic-bezier(0.2, 0, 0, 1);
}

.preset-card.presets-list-enter-from {
  opacity: 0;
}

/* 单个正方形预设卡片 */
.preset-card {
  position: relative;
  aspect-ratio: 1 / 1;
  border-radius: 10px;
  background-color: var(--md-sys-color-surface-container-high, #282c35);
  background-color: color-mix(
    in srgb,
    var(--preset-color, #ffffff) 32%,
    var(--md-sys-color-surface-container-high, #282c35)
  );
  border: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08));
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 8px;
  cursor: pointer;
  user-select: none;
  -webkit-user-drag: element;
  box-sizing: border-box;
  isolation: isolate;
  transition: background-color 0.15s ease, border-color 0.1s ease;
}

.preset-trigger-flash {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background-color: color-mix(
    in srgb,
    var(--preset-color, #ffffff) 62%,
    white
  );
  opacity: 0;
  pointer-events: none;
  z-index: -1;
}

.preset-card.is-dragging {
  opacity: 0.45;
}

.preset-card.presets-list-move {
  transition: transform 260ms cubic-bezier(0.2, 0, 0, 1);
}

.preset-card.is-drag-before::before,
.preset-card.is-drag-after::after {
  content: '';
  position: absolute;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 2px;
  background-color: var(--md-sys-color-primary, #8ab4f8);
  box-shadow: 0 0 6px rgba(138, 180, 248, 0.55);
  pointer-events: none;
  z-index: 5;
}

.preset-card.is-drag-before::before {
  left: -7px;
}

.preset-card.is-drag-after::after {
  right: -7px;
}

.preset-card:hover {
  background-color: var(--md-sys-color-surface-container-highest, #323843);
  background-color: color-mix(
    in srgb,
    var(--preset-color, #ffffff) 48%,
    var(--md-sys-color-surface-container-highest, #323843)
  );
}

.preset-card.is-selected {
  border-color: var(--md-sys-color-primary, #8ab4f8);
}

.preset-card.is-pending-deselect {
  border-color: color-mix(
    in srgb,
    var(--md-sys-color-primary, #8ab4f8) 45%,
    transparent
  );
}

/* 左上角 ID 数字 */
.preset-id {
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
  font-family: 'Google Sans', sans-serif;
  font-size: 11px;
  font-weight: 700;
  color: var(--md-sys-color-primary, #8ab4f8);
  background-color: rgba(138, 180, 248, 0.12);
  border-radius: 4px;
  line-height: 1;
  pointer-events: none;
}

/* 右上角快捷键标记 (原垃圾桶位置) */
.preset-shortcut-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: 'Google Sans', sans-serif;
  font-size: 11px;
  font-weight: 700;
  border-radius: 4px;
  border: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.12));
  background-color: var(--md-sys-color-surface-container, #1f232b);
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  transition: all 0.15s ease;
  z-index: 2;
  opacity: 0;
  line-height: 1;
}

.preset-shortcut-badge.has-shortcut {
  opacity: 0.9;
  background-color: rgba(138, 180, 248, 0.14);
  border-color: rgba(138, 180, 248, 0.35);
  color: var(--md-sys-color-primary, #8ab4f8);
}

.preset-card:hover .preset-shortcut-badge,
.preset-card.is-selected .preset-shortcut-badge {
  opacity: 1;
}

.preset-shortcut-badge:hover {
  opacity: 1;
  background-color: rgba(138, 180, 248, 0.25);
  border-color: var(--md-sys-color-primary, #8ab4f8);
  color: #fff;
}

.preset-shortcut-badge.is-binding {
  opacity: 1;
  background-color: var(--md-sys-color-primary, #8ab4f8);
  color: var(--md-sys-color-on-primary, #042a59);
  border-color: var(--md-sys-color-primary, #8ab4f8);
}

.binding-text {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.shortcut-placeholder {
  font-size: 11px;
  line-height: 1;
  font-weight: 700;
  opacity: 0.8;
}

.shortcut-key {
  line-height: 1;
}

/* 预设名称区域 */
.preset-name-area {
  width: 100%;
  padding: 2px 2px;
  display: flex;
  justify-content: center;
  box-sizing: border-box;
  transform-origin: center;
}

.preset-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface, #e8edf2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: center;
}

.preset-delete-btn {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  min-width: 16px;
  height: 16px;
  padding: 0;
  box-sizing: border-box;
  border: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.12));
  border-radius: 4px;
  background-color: var(--md-sys-color-surface-container, #1f232b);
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease,
    transform 0.12s ease;
}

.preset-edit-btn {
  position: absolute;
  left: 6px;
  bottom: 6px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  min-width: 16px;
  height: 16px;
  padding: 0;
  box-sizing: border-box;
  border: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.12));
  border-radius: 4px;
  background-color: var(--md-sys-color-surface-container, #1f232b);
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.15s ease,
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    transform 0.12s ease;
}

.preset-card:hover .preset-edit-btn,
.preset-card:hover .preset-delete-btn {
  opacity: 1;
  pointer-events: auto;
}

.preset-edit-btn:hover {
  border-color: var(--md-sys-color-primary, #8ab4f8);
  background-color: rgba(138, 180, 248, 0.2);
  color: var(--md-sys-color-primary, #8ab4f8);
}

.preset-edit-btn:active {
  transform: scale(0.92);
}

.preset-delete-btn:hover {
  border-color: transparent;
  background-color: rgba(255, 82, 82, 0.2);
  color: var(--md-sys-color-error, #f28b82);
}

.preset-delete-btn.is-confirming {
  border-color: rgba(242, 184, 181, 0.7);
  background-color: rgba(242, 184, 181, 0.24);
  color: var(--md-sys-color-error, #f2b8b5);
  opacity: 1;
  pointer-events: auto;
}

.preset-delete-btn:active {
  transform: scale(0.92);
}

.preset-action-icon {
  width: 13px;
  height: 13px;
}

/* 空状态 */
.presets-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 220px;
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
  margin-bottom: 16px;
}

/* 底部状态 */
.presets-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  min-height: 28px;
  padding: 0 12px;
  background-color: var(--md-sys-color-surface-container, #22262e);
  border-top: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08));
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

.presets-footer-summary {
  min-width: 0;
  display: inline-flex;
  align-items: center;
}

.preset-zoom-controls {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.preset-zoom-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background-color: transparent;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  outline: none;
}

.preset-zoom-btn:hover:not(:disabled) {
  background-color: rgba(255, 255, 255, 0.08);
  color: #ffffff;
}

.preset-zoom-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.preset-zoom-icon {
  width: 14px;
  height: 14px;
}

.preset-zoom-value {
  min-width: 44px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.preset-editor-panel {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background-color: var(--md-sys-color-surface, #1c1f26);
}

.preset-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 36px;
  min-height: 36px;
  padding: 0 8px 0 12px;
  box-sizing: border-box;
  background-color: var(--md-sys-color-surface-container, #22262e);
  border-bottom: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08));
}

.preset-editor-title {
  min-width: 0;
  overflow: hidden;
  color: var(--md-sys-color-on-surface, #e8edf2);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-editor-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.preset-editor-play,
.preset-editor-save {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background-color: transparent;
  color: var(--md-sys-color-primary, #8ab4f8);
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    transform 0.12s ease;
}

.preset-editor-play:hover,
.preset-editor-save:hover {
  background-color: rgba(138, 180, 248, 0.16);
}

.preset-editor-play:active,
.preset-editor-save:active {
  transform: scale(0.92);
}

.preset-editor-play svg,
.preset-editor-save svg {
  width: 18px;
  height: 18px;
}

.preset-editor-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.preset-editor-panel-enter-active,
.preset-editor-panel-leave-active {
  transition:
    opacity 180ms cubic-bezier(0.2, 0, 0, 1),
    transform 180ms cubic-bezier(0.2, 0, 0, 1);
}

.preset-editor-panel-enter-from,
.preset-editor-panel-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

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

.design-empty-state .empty-icon {
  width: 44px;
  height: 44px;
  color: var(--md-sys-color-outline, #727b8c);
  margin-bottom: 12px;
  opacity: 0.6;
}

.design-empty-state .empty-title {
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
  flex: 1 1 auto;
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
  grid-template-columns: repeat(auto-fill, 18px);
  gap: 5px;
  width: 100%;
  min-height: 41px;
  position: relative;
}

.history-colors-content {
  position: relative;
  min-height: 41px;
}

.history-palette-layer {
  width: 100%;
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
  transform-origin: center;
}

.history-color-enter-active,
.history-color-leave-active {
  transition:
    opacity 180ms cubic-bezier(0.2, 0, 0, 1),
    transform 180ms cubic-bezier(0.2, 0, 0, 1);
}

.history-color-leave-active {
  position: absolute;
  z-index: 1;
}

.history-color-enter-from,
.history-color-leave-to {
  opacity: 0;
  transform: scale(0.25);
}

.history-color-move {
  transition: transform 200ms cubic-bezier(0.2, 0, 0, 1);
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
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px dashed rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  background-color: rgba(168, 199, 250, 0.04);
}

.history-palette-enter-active,
.history-palette-leave-active,
.history-empty-enter-active,
.history-empty-leave-active {
  transition: opacity 220ms cubic-bezier(0.2, 0, 0, 1);
}

.history-palette-enter-from,
.history-palette-leave-to,
.history-empty-enter-from,
.history-empty-leave-to {
  opacity: 0;
}

.history-palette-leave-active,
.history-empty-leave-active {
  pointer-events: none;
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

.hex-wrapper {
  position: relative;
  z-index: 20;
}

/* 十六进制 # 左侧颜色小方块预览 */
.color-preview-swatch {
  width: 12px;
  height: 12px;
  padding: 0;
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

.color-palette-popover {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  width: 204px;
  padding: 10px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background-color: var(--md-sys-color-surface-container-high, #282c35);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
  transform-origin: top left;
  user-select: none;
  z-index: 60;
}

.color-palette-spectrum {
  position: relative;
  width: 100%;
  height: 116px;
  border-radius: 6px;
  overflow: hidden;
  background:
    linear-gradient(to bottom, transparent, #000000),
    linear-gradient(
      to right,
      #ffffff,
      hsl(var(--palette-hue) 100% 50%)
    );
  cursor: crosshair;
  touch-action: none;
}

.color-palette-cursor {
  position: absolute;
  width: 14px;
  height: 14px;
  border: 2px solid #ffffff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.color-palette-hue {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  height: 10px;
  margin: 11px 0 0;
  border: none;
  border-radius: 5px;
  outline: none;
  background: linear-gradient(
    to right,
    #ff0000,
    #ffff00,
    #00ff00,
    #00ffff,
    #0000ff,
    #ff00ff,
    #ff0000
  );
  cursor: pointer;
}

.color-palette-hue::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border: 2px solid #ffffff;
  border-radius: 50%;
  background-color: transparent;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55);
}

.color-palette-hue::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: 2px solid #ffffff;
  border-radius: 50%;
  background-color: transparent;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55);
}

.color-palette-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 9px;
}

.color-palette-current {
  width: 22px;
  height: 22px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 5px;
  flex-shrink: 0;
}

.color-palette-value {
  font-family: 'Google Sans', sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface, #e8edf2);
}

.color-palette-enter-active,
.color-palette-leave-active {
  transition:
    opacity 180ms cubic-bezier(0.2, 0, 0, 1),
    transform 180ms cubic-bezier(0.2, 0, 0, 1);
}

.color-palette-enter-from,
.color-palette-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.96);
}

.color-palette-leave-active {
  pointer-events: none;
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
  margin-left: auto;
  flex-shrink: 0;
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

/* -------------------------------------------------------------
   下半窗口：统一效果曲线主画框区域
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

.timeline-waveform-layer {
  position: absolute;
  top: var(--timeline-thumbnail-lane-height);
  left: 0;
  width: 100%;
  height: var(--timeline-waveform-lane-height);
  z-index: 4;
  pointer-events: none;
  transform-origin: 0 0;
}

.timeline-waveform-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: block;
  background: transparent;
  pointer-events: none;
  will-change: opacity, transform;
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
    opacity: 0;
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

.timeline-scroll.is-middle-panning .timeline-tracks-viewport,
.timeline-scroll.is-middle-panning .timeline-tracks-viewport * {
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

.timeline-track.is-clip-dragging .timeline-tracks-viewport {
  z-index: 8;
  overflow: visible;
}

.timeline-track.is-clip-dragging {
  overflow: visible;
}

.timeline-tracks-content {
  position: relative;
  width: 100%;
  min-height: 0;
  background-color: var(--md-sys-color-surface, #1c1f26);
}

.timeline-beat-line {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  width: 1px;
  background-color: var(--md-sys-color-primary, #8ab4f8);
  opacity: 0.28;
  pointer-events: none;
  transform: translateX(-50%);
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

.timeline-marquee {
  position: absolute;
  z-index: 30;
  box-sizing: border-box;
  border: 1px solid var(--md-sys-color-primary, #8ab4f8);
  border-radius: 4px;
  background-color: rgba(138, 180, 248, 0.14);
  pointer-events: none;
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
  container-name: timeline-clip;
  container-type: inline-size;
  top: 8px;
  bottom: 8px;
  min-width: 16px;
  border: 1px solid color-mix(in srgb, var(--clip-color) 42%, #596170 58%);
  border-radius: 5px;
  background-color: color-mix(in srgb, var(--clip-color) 36%, #242a34 64%);
  cursor: grab;
  overflow: visible;
  z-index: 3;
  touch-action: none;
  user-select: none;
  transform-origin: center;
  transition:
    border-color 0.12s ease,
    background-color 0.12s ease,
    opacity 0.12s ease;
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
  z-index: 6;
}

.timeline-clip.is-duplicating {
  pointer-events: none;
  z-index: 7;
}

.timeline-clip.is-fill-dragging {
  cursor: ew-resize;
  z-index: 7;
}

.timeline-clip.is-fill-remove-preview {
  border-color: var(--md-sys-color-error, #ffb4ab);
  background-color: color-mix(
    in srgb,
    var(--md-sys-color-error, #ffb4ab) 18%,
    #242a34 82%
  );
  opacity: 0.38;
  pointer-events: none;
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

.timeline-clip-content {
  position: relative;
  z-index: 1;
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  padding: 4px 9px;
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
  top: -7px;
  right: -7px;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background-color: var(--md-sys-color-error, #ffb4ab);
  color: var(--md-sys-color-on-error, #690005);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  z-index: 4;
  touch-action: none;
  transition:
    opacity 160ms cubic-bezier(0.2, 0, 0, 1),
    background-color 140ms cubic-bezier(0.2, 0, 0, 1),
    color 140ms cubic-bezier(0.2, 0, 0, 1);
}

.timeline-clip:hover .timeline-clip-remove {
  opacity: 1;
  pointer-events: auto;
}

.timeline-clip-remove:hover {
  background-color: color-mix(
    in srgb,
    var(--md-sys-color-error, #ffb4ab) 88%,
    #ffffff
  );
}

.timeline-clip-remove svg {
  display: block;
  width: 14px;
  height: 14px;
}

.timeline-clip-fill-preview {
  position: absolute;
  top: 8px;
  bottom: 8px;
  min-width: 16px;
  box-sizing: border-box;
  border: 1px solid color-mix(
    in srgb,
    var(--clip-color) 42%,
    #596170 58%
  );
  border-radius: 5px;
  background-color: color-mix(
    in srgb,
    var(--clip-color) 36%,
    #242a34 64%
  );
  opacity: 0.5;
  pointer-events: none;
  z-index: 2;
}

.timeline-clip-fill-handle {
  position: absolute;
  right: -7px;
  bottom: -7px;
  width: 17px;
  height: 17px;
  padding: 0;
  box-sizing: border-box;
  border: none;
  border-radius: 50%;
  background-color: var(--md-sys-color-primary, #8ab4f8);
  color: var(--md-sys-color-on-primary, #102a43);
  cursor: ew-resize;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  z-index: 5;
  touch-action: none;
  transition:
    opacity 160ms cubic-bezier(0.2, 0, 0, 1),
    background-color 140ms cubic-bezier(0.2, 0, 0, 1),
    transform 140ms cubic-bezier(0.2, 0, 0, 1);
}

.timeline-clip:hover .timeline-clip-fill-handle,
.timeline-clip.is-fill-dragging .timeline-clip-fill-handle {
  opacity: 1;
  pointer-events: auto;
}

.timeline-clip-fill-handle:hover {
  background-color: color-mix(
    in srgb,
    var(--md-sys-color-primary, #8ab4f8) 88%,
    #ffffff
  );
  transform: scale(1.08);
}

.timeline-clip-fill-handle:active {
  transform: scale(0.94);
}

.timeline-clip-fill-handle svg {
  display: block;
  width: 12px;
  height: 12px;
}

@container timeline-clip (max-width: 56px) {
  .timeline-clip-name {
    display: none;
  }
}

@container timeline-clip (max-width: 40px) {
  .timeline-clip-id {
    display: none;
  }
}

.timeline-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  display: none;
  width: 1px;
  background-color: var(--md-sys-color-primary, #8ab4f8);
  box-shadow: 0 0 0 1px rgba(138, 180, 248, 0.2);
  cursor: grab;
  pointer-events: auto;
  z-index: 20;
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

.timeline-playhead.is-preset-dragging {
  pointer-events: none;
}

.timeline-playhead:active {
  cursor: grabbing;
}

</style>
