<script setup lang="ts">
import { computed, ref, nextTick, watch, onMounted, onUnmounted } from 'vue'
import {
  eventsManager,
  formatTriggerTime,
  getEventEndTimeSeconds,
  getEventPresetPlaybacks,
  getEventPresetPlaybacksAtTime,
  getEventRangeDurationMs,
  isValidTriggerTime,
  parseTimeToSeconds,
  type EventItem,
  type EventMovePosition
} from '~/composables/eventsmanager'
import { applyGamma, sampleCurveBrightness, sampleCurveColor } from '~/composables/devicesmanager'
import { outputsettingsManager } from '~/composables/outputsettingsmanager'
import { presetsManager, type PresetItem, type PresetLightEffect } from '~/composables/presetsmanager'
import { videoManager } from '~/composables/videomanager'
import { windowsManager } from '~/composables/windowsmanager'

const {
  events,
  selectedEventId,
  playingEventId,
  eventPlayProgress,
  selectEvent,
  removeEvent,
  updateEventName,
  updateEventTime,
  updateEventEndTime,
  moveEvent,
  triggerEventEffect
} = eventsManager()
const {
  currentTime: videoCurrentTime,
  videoSrc,
  duration,
  seekVideo
} = videoManager()
const { focusWindow, setDesignViewMode } = windowsManager()

const TIME_INPUT_DIGITS = 8
const editingTimeId = ref<number | null>(null)
const editingEndTimeId = ref<number | null>(null)
const eventDeselectArmed = ref(false)
type TimeInputDragTarget = 'start' | 'end'
interface TimeInputDragState {
  pointerId: number
  inputEl: HTMLInputElement
  target: TimeInputDragTarget
  eventId: number
  startClientX: number
  initialSeconds: number
  moved: boolean
}
let timeInputDrag: TimeInputDragState | null = null
let suppressTimeInputClick = false
const isTimeInputInteracting = ref(false)
const timelinePreview = ref<{
  eventId: number
  event: EventItem
  preset: PresetItem
  progress: number
} | null>(null)
const eventProgressRefs = new Map<number, HTMLDivElement>()
const eventProgressHideTimers = new Map<HTMLDivElement, ReturnType<typeof setTimeout>>()
const lastEventProgressVisuals = new Map<
  number,
  { backgroundColor: string; opacity: number }
>()
let progressRenderRafId: number | null = null
let renderedProgressEventId: number | null = null
const EVENT_PROGRESS_FADE_MS = 200
const EVENT_LIST_FOLLOW_RESUME_DELAY = 5000
const eventListBodyRef = ref<HTMLDivElement | null>(null)
let eventListFollowPaused = false
let eventListFollowResumeTimer: ReturnType<typeof setTimeout> | null = null

const formatTimeDigits = (seconds: number) => {
  const totalHundredths = Math.floor(seconds * 100)
  const hours = Math.floor(totalHundredths / 360000)
  const minutes = Math.floor((totalHundredths % 360000) / 6000)
  const wholeSeconds = Math.floor((totalHundredths % 6000) / 100)
  const hundredths = totalHundredths % 100

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(wholeSeconds).padStart(2, '0'),
    String(hundredths).padStart(2, '0')
  ].join('')
}

const formatTimeInputDigits = (digits: string) => {
  const raw = digits.replace(/\D/g, '').slice(0, TIME_INPUT_DIGITS)
  if (!raw) return ''

  let formatted = raw.slice(0, 2)
  if (raw.length > 2) formatted += `:${raw.slice(2, 4)}`
  if (raw.length > 4) formatted += `:${raw.slice(4, 6)}`
  if (raw.length > 6) formatted += `.${raw.slice(6, 8)}`
  return formatted
}

const getTimeInputCaretPosition = (formatted: string, digitCount: number) => {
  if (digitCount <= 0) return 0

  let seenDigits = 0
  for (let index = 0; index < formatted.length; index++) {
    if (/\d/.test(formatted[index] ?? '')) {
      seenDigits++
      if (seenDigits === digitCount) return index + 1
    }
  }
  return formatted.length
}

const parseTimeDigits = (digits: string) => {
  const padded = digits.slice(0, TIME_INPUT_DIGITS).padStart(TIME_INPUT_DIGITS, '0')
  const hours = Number(padded.slice(0, 2))
  const minutes = Number(padded.slice(2, 4))
  const seconds = Number(padded.slice(4, 6))
  const hundredths = Number(padded.slice(6, 8))

  if (minutes > 59 || seconds > 59) return null
  return hours * 3600 + minutes * 60 + seconds + hundredths / 100
}

const normalizeDraggedTime = (seconds: number) => {
  return Math.round(Math.max(0, seconds) * 100) / 100
}

const startTimeInputDrag = (
  eventId: number,
  target: TimeInputDragTarget,
  pointerEvent: PointerEvent
) => {
  if (pointerEvent.button !== 0) return

  const eventItem = events.value.find(event => event.id === eventId)
  if (!eventItem) return

  const inputEl = pointerEvent.currentTarget as HTMLInputElement
  const startTime = isValidTriggerTime(eventItem.time)
    ? parseTimeToSeconds(eventItem.time)
    : 0
  const initialSeconds = target === 'start'
    ? startTime
    : getEventEndTimeSeconds(eventItem) ?? startTime + 0.01

  timeInputDrag = {
    pointerId: pointerEvent.pointerId,
    inputEl,
    target,
    eventId,
    startClientX: pointerEvent.clientX,
    initialSeconds,
    moved: false
  }
  isTimeInputInteracting.value = true
}

const cancelTimeInputDrag = () => {
  timeInputDrag = null
  suppressTimeInputClick = false
  isTimeInputInteracting.value = false
}

const handleTimeInputDragMove = (pointerEvent: PointerEvent) => {
  const drag = timeInputDrag
  if (!drag || pointerEvent.pointerId !== drag.pointerId) return
  if ((pointerEvent.buttons & 1) === 0) {
    cancelTimeInputDrag()
    return
  }

  const deltaX = pointerEvent.clientX - drag.startClientX
  if (!drag.moved && Math.abs(deltaX) < 3) return

  if (!drag.moved) {
    drag.inputEl.blur()
    suppressTimeInputClick = true
  }
  drag.moved = true
  pointerEvent.preventDefault()

  const eventItem = events.value.find(event => event.id === drag.eventId)
  if (!eventItem) return

  const nextSeconds = normalizeDraggedTime(
    drag.initialSeconds + deltaX * 0.02
  )
  const startTime = isValidTriggerTime(eventItem.time)
    ? parseTimeToSeconds(eventItem.time)
    : 0

  if (drag.target === 'start') {
    const endTime = getEventEndTimeSeconds(eventItem)
    const clampedSeconds = endTime === null
      ? nextSeconds
      : Math.min(nextSeconds, Math.max(0, endTime - 0.01))
    updateEventTime(drag.eventId, formatTriggerTime(clampedSeconds))
    if (videoSrc.value && duration.value > 0) {
      seekVideo(clampedSeconds, true)
    }
    return
  }

  const endSeconds = Math.max(startTime + 0.01, nextSeconds)
  updateEventEndTime(drag.eventId, formatTriggerTime(endSeconds))
  if (videoSrc.value && duration.value > 0) {
    seekVideo(endSeconds, true)
  }
}

const handleTimeInputDragEnd = (pointerEvent: PointerEvent) => {
  const drag = timeInputDrag
  if (!drag || pointerEvent.pointerId !== drag.pointerId) return

  timeInputDrag = null
  isTimeInputInteracting.value = false

  if (!drag.moved) {
    drag.inputEl.focus()
    drag.inputEl.select()
    return
  }

  const eventItem = events.value.find(event => event.id === drag.eventId)
  if (eventItem && videoSrc.value && duration.value > 0) {
    const finalSeconds = drag.target === 'start'
      ? (
          isValidTriggerTime(eventItem.time)
            ? parseTimeToSeconds(eventItem.time)
            : null
        )
      : getEventEndTimeSeconds(eventItem)

    if (finalSeconds !== null) {
      seekVideo(finalSeconds)
    }
  }

  suppressTimeInputClick = true
  setTimeout(() => {
    suppressTimeInputClick = false
  }, 0)
}

const handleTimeInputClick = (event: MouseEvent) => {
  if (!suppressTimeInputClick) return
  event.preventDefault()
  event.stopPropagation()
  suppressTimeInputClick = false
}

const handleTimeInput = (e: Event) => {
  const inputEl = e.target as HTMLInputElement
  const caret = inputEl.selectionStart ?? inputEl.value.length
  const digitsBeforeCaret = inputEl.value
    .slice(0, caret)
    .replace(/\D/g, '')
    .length
  const digits = inputEl.value.replace(/\D/g, '').slice(0, TIME_INPUT_DIGITS)
  const formatted = formatTimeInputDigits(digits)

  inputEl.value = formatted
  const nextCaret = getTimeInputCaretPosition(formatted, digitsBeforeCaret)
  inputEl.setSelectionRange(nextCaret, nextCaret)
}

const handleTimeKeydown = (e: KeyboardEvent) => {
  const inputEl = e.target as HTMLInputElement

  if (e.key === 'Enter') {
    inputEl.blur()
    return
  }

  if (e.key !== 'Backspace' && e.key !== 'Delete') return

  const selectionStart = inputEl.selectionStart
  const selectionEnd = inputEl.selectionEnd
  if (
    selectionStart === null ||
    selectionEnd === null ||
    selectionStart !== selectionEnd
  ) {
    return
  }

  const isBackspace = e.key === 'Backspace'
  const separatorIndex = isBackspace
    ? selectionStart - 1
    : selectionStart
  const separator = inputEl.value[separatorIndex]
  if (separator !== ':' && separator !== '.') return

  const adjacentDigitIndex = isBackspace
    ? separatorIndex - 1
    : separatorIndex + 1
  if (!/\d/.test(inputEl.value[adjacentDigitIndex] ?? '')) return

  e.preventDefault()
  const digits = inputEl.value.replace(/\D/g, '').slice(0, TIME_INPUT_DIGITS)
  const digitIndex = inputEl.value
    .slice(0, adjacentDigitIndex)
    .replace(/\D/g, '')
    .length
  const nextDigits = digits.slice(0, digitIndex) + digits.slice(digitIndex + 1)
  const formatted = formatTimeInputDigits(nextDigits)

  inputEl.value = formatted
  const nextCaret = getTimeInputCaretPosition(formatted, digitIndex)
  inputEl.setSelectionRange(nextCaret, nextCaret)
}

const handleTimeFocus = (id: number, time: string | undefined, e: FocusEvent) => {
  editingTimeId.value = id
  const inputEl = e.target as HTMLInputElement
  inputEl.value = isValidTriggerTime(time)
    ? formatTimeInputDigits(formatTimeDigits(parseTimeToSeconds(time)))
    : ''
  inputEl.select()
}

const handleTimeBlur = (id: number, e: FocusEvent) => {
  editingTimeId.value = null
  const inputEl = e.target as HTMLInputElement
  const digits = inputEl.value.replace(/\D/g, '').slice(0, TIME_INPUT_DIGITS)

  if (!digits) {
    inputEl.value = ''
    updateEventTime(id, '')
    return
  }

  const seconds = parseTimeDigits(digits)
  if (seconds === null) {
    inputEl.value = ''
    updateEventTime(id, '')
    return
  }

  inputEl.value = formatTriggerTime(seconds, true)
  updateEventTime(id, formatTriggerTime(seconds))
}

const getEventTimeInputValue = (id: number, time: string | undefined) => {
  if (!isValidTriggerTime(time)) return ''
  const seconds = parseTimeToSeconds(time)
  return editingTimeId.value === id
    ? formatTimeInputDigits(formatTimeDigits(seconds))
    : formatTriggerTime(seconds, true)
}

const handleEndTimeFocus = (event: EventItem, e: FocusEvent) => {
  editingEndTimeId.value = event.id
  const inputEl = e.target as HTMLInputElement
  const endTime = getEventEndTimeSeconds(event)
  inputEl.value = endTime === null
    ? ''
    : formatTimeInputDigits(formatTimeDigits(endTime))
  inputEl.select()
}

const handleEndTimeBlur = (event: EventItem, e: FocusEvent) => {
  editingEndTimeId.value = null
  const inputEl = e.target as HTMLInputElement
  const digits = inputEl.value.replace(/\D/g, '').slice(0, TIME_INPUT_DIGITS)

  if (!digits) {
    updateEventEndTime(event.id, '')
    const fallbackEndTime = getEventEndTimeSeconds(event)
    inputEl.value = fallbackEndTime === null ? '' : formatTriggerTime(fallbackEndTime, true)
    return
  }

  const seconds = parseTimeDigits(digits)
  const startTime = isValidTriggerTime(event.time) ? parseTimeToSeconds(event.time) : null
  if (seconds === null || startTime === null || seconds <= startTime) {
    const currentEndTime = getEventEndTimeSeconds(event)
    inputEl.value = currentEndTime === null ? '' : formatTriggerTime(currentEndTime, true)
    return
  }

  const formattedEndTime = formatTriggerTime(seconds)
  inputEl.value = formatTriggerTime(seconds, true)
  updateEventEndTime(event.id, formattedEndTime)
}

const getEventEndTimeInputValue = (event: EventItem) => {
  const endTime = getEventEndTimeSeconds(event)
  if (endTime === null) return ''
  return editingEndTimeId.value === event.id
    ? formatTimeInputDigits(formatTimeDigits(endTime))
    : formatTriggerTime(endTime, true)
}

const editingId = ref<number | null>(null)
const editingName = ref('')
const editInputRef = ref<HTMLInputElement | null>(null)
const draggingEventId = ref<number | null>(null)
const dragOverEventId = ref<number | null>(null)
const dragOverPosition = ref<EventMovePosition>('before')

const clearEventDragState = () => {
  draggingEventId.value = null
  dragOverEventId.value = null
  dragOverPosition.value = 'before'
}

const handleEventDragStart = (eventItem: EventItem, dragEvent: DragEvent) => {
  const target = dragEvent.target
  const row = dragEvent.currentTarget as HTMLElement
  const activeElement = typeof document !== 'undefined' ? document.activeElement : null
  const hasFocusedInput = activeElement instanceof HTMLInputElement && row.contains(activeElement)

  if (
    editingId.value === eventItem.id ||
    hasFocusedInput ||
    (target instanceof HTMLElement && target.closest('input, button'))
  ) {
    dragEvent.preventDefault()
    return
  }

  draggingEventId.value = eventItem.id
  dragOverEventId.value = null
  if (dragEvent.dataTransfer) {
    dragEvent.dataTransfer.effectAllowed = 'move'
    dragEvent.dataTransfer.setData('text/plain', String(eventItem.id))
  }
}

const handleEventDragOver = (eventItem: EventItem, dragEvent: DragEvent) => {
  if (draggingEventId.value === null || draggingEventId.value === eventItem.id) return

  dragEvent.preventDefault()
  const row = dragEvent.currentTarget as HTMLElement
  const rect = row.getBoundingClientRect()
  dragOverEventId.value = eventItem.id
  dragOverPosition.value = dragEvent.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  if (dragEvent.dataTransfer) {
    dragEvent.dataTransfer.dropEffect = 'move'
  }
}

const handleEventDragLeave = (eventItem: EventItem, dragEvent: DragEvent) => {
  const row = dragEvent.currentTarget as HTMLElement
  const nextTarget = dragEvent.relatedTarget
  if (nextTarget instanceof Node && row.contains(nextTarget)) return
  if (dragOverEventId.value === eventItem.id) {
    dragOverEventId.value = null
  }
}

const handleEventDrop = (eventItem: EventItem, dragEvent: DragEvent) => {
  dragEvent.preventDefault()
  const draggedId = draggingEventId.value
  if (draggedId === null || draggedId === eventItem.id) {
    clearEventDragState()
    return
  }

  moveEvent(draggedId, eventItem.id, dragOverPosition.value)
  clearEventDragState()
}

const eventById = computed(() => {
  return new Map(events.value.map(event => [event.id, event]))
})

const eventDisplayIdMap = computed(() => {
  const labels = new Map<number, string>()
  const ranges = events.value
    .filter(event => isValidTriggerTime(event.time))
    .map(event => ({
      event,
      startTime: parseTimeToSeconds(event.time),
      durationSeconds: Math.max(0.001, (getEventRangeDurationMs(event) ?? 0) / 1000)
    }))

  for (const range of ranges) {
    labels.set(range.event.id, String(range.event.id))
  }

  for (const shortEvent of ranges) {
    const containingLongEvent = ranges
      .filter(longEvent => (
        longEvent.event.id !== shortEvent.event.id &&
        longEvent.startTime <= shortEvent.startTime &&
        shortEvent.startTime < longEvent.startTime + longEvent.durationSeconds &&
        longEvent.durationSeconds > shortEvent.durationSeconds
      ))
      .sort((a, b) => (
        b.startTime - a.startTime ||
        b.durationSeconds - a.durationSeconds
      ))[0]

    if (containingLongEvent) {
      labels.set(
        shortEvent.event.id,
        `${containingLongEvent.event.id}-${shortEvent.event.id}`
      )
    }
  }

  return labels
})

const getEventDisplayId = (event: EventItem) => {
  return eventDisplayIdMap.value.get(event.id) ?? String(event.id)
}

const getEventEffectContext = (preset: PresetItem) => {
  const effect = preset.effect
  if (!effect) return null

  const effectRepeat = typeof effect.repeat === 'number' ? effect.repeat : 1
  const totalRepeat = effectRepeat === 0 ? 1 : Math.max(1, effectRepeat)
  const { globalBrightness } = outputsettingsManager()
  const dimmer = Math.max(0, Math.min(100, globalBrightness.value)) / 100
  const masterDimmer = applyGamma(dimmer)

  return {
    effect,
    masterDimmer,
    totalRepeat
  }
}

const sampleEventEffect = (
  effect: PresetLightEffect,
  totalRepeat: number,
  masterDimmer: number,
  progress: number
) => {
  const clampedProgress = Math.max(0, Math.min(1, progress))
  const cycleProgress = clampedProgress >= 1
    ? 1
    : (clampedProgress * totalRepeat) % 1
  const color = sampleCurveColor(effect.colorPoints, cycleProgress, effect.color)
  const brightness = sampleCurveBrightness(effect.points, cycleProgress)

  return {
    color,
    brightness: Math.max(0, Math.min(1, brightness * masterDimmer))
  }
}

const getEventEffectState = (preset: PresetItem, progress: number) => {
  const context = getEventEffectContext(preset)
  return context
    ? sampleEventEffect(context.effect, context.totalRepeat, context.masterDimmer, progress)
    : null
}

const updateTimelinePreview = (time: number) => {
  const activePlaybacks = events.value
    .flatMap(event => (
      getEventPresetPlaybacksAtTime(event, time)
        .map(playback => ({ event, playback }))
    ))
    .sort((a, b) => (
      a.playback.startTime - b.playback.startTime ||
      b.playback.durationMs - a.playback.durationMs ||
      a.event.id - b.event.id ||
      a.playback.triggerId - b.playback.triggerId
    ))
  const activeEntry = activePlaybacks[activePlaybacks.length - 1]

  timelinePreview.value = activeEntry
    ? {
        eventId: activeEntry.event.id,
        event: activeEntry.event,
        preset: activeEntry.playback.preset,
        progress: Math.max(
          0,
          Math.min(
            1,
            (time - activeEntry.playback.startTime) * 1000 / activeEntry.playback.durationMs
          )
        )
      }
    : null
}

watch(
  () => videoCurrentTime.value,
  (time) => {
    updateTimelinePreview(time)
  }
)

const getEventProgressVisual = (
  eventId: number,
  preset: PresetItem | null,
  progress: number
) => {
  if (!preset) {
    return lastEventProgressVisuals.get(eventId) ?? {
      backgroundColor: 'var(--md-sys-color-primary, #8ab4f8)',
      opacity: 0.38
    }
  }

  const clampedProgress = Math.max(0, Math.min(1, progress))
  const state = getEventEffectState(preset, clampedProgress)

  if (!state) {
    const fallbackVisual = {
      backgroundColor: 'var(--md-sys-color-primary, #8ab4f8)',
      opacity: 0.38
    }
    lastEventProgressVisuals.set(eventId, fallbackVisual)
    return fallbackVisual
  }

  const whiteMix = 0.2
  const r = Math.round(state.color.r * (1 - whiteMix) + 255 * whiteMix)
  const g = Math.round(state.color.g * (1 - whiteMix) + 255 * whiteMix)
  const b = Math.round(state.color.b * (1 - whiteMix) + 255 * whiteMix)

  const visual = {
    backgroundColor: `rgb(${r}, ${g}, ${b})`,
    opacity: 0.35 + state.brightness * 0.45
  }
  lastEventProgressVisuals.set(eventId, visual)
  return visual
}

const getEventTimeProgress = (event: EventItem) => {
  if (!isValidTriggerTime(event.time)) return 0

  const startTime = parseTimeToSeconds(event.time)
  const endTime = getEventEndTimeSeconds(event)
  if (endTime === null || endTime <= startTime) return 0

  return Math.max(
    0,
    Math.min(1, (videoCurrentTime.value - startTime) / (endTime - startTime))
  )
}

const getEventAtVideoTime = () => {
  const currentTime = videoCurrentTime.value
  let matchedEvent: EventItem | null = null
  let matchedStart = -1
  let matchedDuration = Number.POSITIVE_INFINITY

  for (const event of events.value) {
    if (!isValidTriggerTime(event.time)) continue

    const startTime = parseTimeToSeconds(event.time)
    const endTime = getEventEndTimeSeconds(event)
    if (endTime === null || endTime <= startTime) continue
    if (currentTime < startTime || currentTime >= endTime) continue

    const duration = endTime - startTime
    if (
      startTime > matchedStart ||
      (startTime === matchedStart && duration < matchedDuration)
    ) {
      matchedEvent = event
      matchedStart = startTime
      matchedDuration = duration
    }
  }

  return matchedEvent
}

const getEventProgressRenderState = () => {
  const createRenderState = (
    event: EventItem,
    preset: PresetItem | null,
    visualProgress: number
  ) => {
    const progress = getEventTimeProgress(event)
    if (progress >= 1) return null

    return {
      event,
      progress,
      visual: getEventProgressVisual(event.id, preset, visualProgress)
    }
  }

  const preview = timelinePreview.value
  if (preview) {
    return createRenderState(preview.event, preview.preset, preview.progress)
  }

  const activeEventId = playingEventId.value
  if (activeEventId !== null) {
    const activeEvent = eventById.value.get(activeEventId)
    if (activeEvent) {
      const activePlaybacks = getEventPresetPlaybacksAtTime(
        activeEvent,
        videoCurrentTime.value
      )
      const activePlayback = activePlaybacks[activePlaybacks.length - 1]
      return createRenderState(
        activeEvent,
        activePlayback?.preset ?? null,
        eventPlayProgress.value
      )
    }
  }

  const currentEvent = getEventAtVideoTime()
  return currentEvent
    ? createRenderState(currentEvent, null, eventPlayProgress.value)
    : null
}

const cancelEventProgressHide = (element: HTMLDivElement) => {
  const timer = eventProgressHideTimers.get(element)
  if (timer === undefined) return

  clearTimeout(timer)
  eventProgressHideTimers.delete(element)
}

const fadeOutEventProgress = (element: HTMLDivElement) => {
  cancelEventProgressHide(element)
  element.style.opacity = '0'

  const timer = setTimeout(() => {
    if (element.style.opacity === '0') {
      element.style.display = 'none'
    }
    eventProgressHideTimers.delete(element)
  }, EVENT_PROGRESS_FADE_MS)

  eventProgressHideTimers.set(element, timer)
}

const renderEventProgress = () => {
  progressRenderRafId = null
  const renderState = getEventProgressRenderState()

  if (renderedProgressEventId !== null && renderedProgressEventId !== renderState?.event.id) {
    const previousElement = eventProgressRefs.get(renderedProgressEventId)
    if (previousElement) fadeOutEventProgress(previousElement)
  }

  if (!renderState) {
    renderedProgressEventId = null
    return
  }

  const element = eventProgressRefs.get(renderState.event.id)
  if (!element) {
    renderedProgressEventId = null
    return
  }

  cancelEventProgressHide(element)
  element.style.display = 'block'
  element.style.transform = `scaleX(${renderState.progress})`
  element.style.backgroundColor = renderState.visual.backgroundColor || ''
  element.style.opacity = String(renderState.visual.opacity)
  renderedProgressEventId = renderState.event.id
}

const scheduleEventProgressRender = () => {
  if (typeof requestAnimationFrame === 'undefined') {
    renderEventProgress()
    return
  }
  if (progressRenderRafId === null) {
    progressRenderRafId = requestAnimationFrame(renderEventProgress)
  }
}

const setEventProgressRef = (id: number, element: Element | null) => {
  if (element instanceof HTMLDivElement) {
    eventProgressRefs.set(id, element)
  } else {
    const previousElement = eventProgressRefs.get(id)
    if (previousElement) cancelEventProgressHide(previousElement)
    eventProgressRefs.delete(id)
  }
  scheduleEventProgressRender()
}

watch(
  [
    () => playingEventId.value,
    () => eventPlayProgress.value,
    () => videoCurrentTime.value,
    () => timelinePreview.value
  ],
  scheduleEventProgressRender,
  { flush: 'post' }
)

watch(
  () => events.value.map(event => event.id).join(','),
  () => {
    lastEventProgressVisuals.clear()
    scheduleEventProgressRender()
  },
  { flush: 'post' }
)

onMounted(() => {
  window.addEventListener('pointermove', handleTimeInputDragMove, true)
  window.addEventListener('pointerup', handleTimeInputDragEnd, true)
  window.addEventListener('pointercancel', handleTimeInputDragEnd, true)
  window.addEventListener('blur', cancelTimeInputDrag)
})

onUnmounted(() => {
  window.removeEventListener('pointermove', handleTimeInputDragMove, true)
  window.removeEventListener('pointerup', handleTimeInputDragEnd, true)
  window.removeEventListener('pointercancel', handleTimeInputDragEnd, true)
  window.removeEventListener('blur', cancelTimeInputDrag)
  cancelTimeInputDrag()
  if (progressRenderRafId !== null && typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(progressRenderRafId)
  }
  progressRenderRafId = null
  eventProgressRefs.clear()
  eventProgressHideTimers.forEach(timer => clearTimeout(timer))
  eventProgressHideTimers.clear()
  lastEventProgressVisuals.clear()
  if (eventListFollowResumeTimer) {
    clearTimeout(eventListFollowResumeTimer)
    eventListFollowResumeTimer = null
  }
})

const currentEventOrdinal = computed(() => {
  if (selectedEventId.value === null) return null
  const index = events.value.findIndex(event => event.id === selectedEventId.value)
  return index === -1 ? null : index + 1
})

// 选中行
const handleRowClick = (event: EventItem) => {
  eventDeselectArmed.value = false
  selectEvent(event.id)
  setDesignViewMode('timeline')
  focusWindow('win-events')
}

const handleTableBackgroundClick = () => {
  if (selectedEventId.value === null) {
    eventDeselectArmed.value = false
    return
  }

  if (!eventDeselectArmed.value) {
    eventDeselectArmed.value = true
    return
  }

  eventDeselectArmed.value = false
  selectEvent(null)
}

watch(selectedEventId, () => {
  eventDeselectArmed.value = false
})

const handleEventIdDoubleClick = (event: EventItem) => {
  if (!isValidTriggerTime(event.time)) return

  const { videoSrc, duration, isVideoPlaying, seekVideo, playVideo } = videoManager()
  const targetTime = parseTimeToSeconds(event.time)

  if (videoSrc.value && duration.value > 0) {
    seekVideo(Math.min(targetTime, duration.value))
    if (!isVideoPlaying.value) {
      playVideo()
    }
  }
  triggerEventEffect(event)
}

// 开启编辑
const startEdit = (event: EventItem) => {
  editingId.value = event.id
  editingName.value = event.name
  nextTick(() => {
    editInputRef.value?.focus()
    editInputRef.value?.select()
  })
}

// 保存编辑
const saveEdit = (id: number) => {
  if (editingId.value !== id) return
  updateEventName(id, editingName.value)
  editingId.value = null
}

// 取消编辑
const cancelEdit = () => {
  editingId.value = null
}

// 处理删除
const handleDelete = (id: number, e: MouseEvent) => {
  e.stopPropagation()
  if (editingId.value === id) {
    editingId.value = null
  }
  removeEvent(id)
}

const followedPlaybackEventId = computed(() => {
  if (playingEventId.value !== null) {
    return playingEventId.value
  }
  return getEventAtVideoTime()?.id ?? null
})

const centerPlayingEventRow = (eventId = followedPlaybackEventId.value) => {
  const container = eventListBodyRef.value
  if (eventId === null || !container) return

  const rowEl = container.querySelector<HTMLElement>(`[data-event-id="${eventId}"]`)
  if (!rowEl) return

  const containerRect = container.getBoundingClientRect()
  const rowRect = rowEl.getBoundingClientRect()
  const centeredTop = (
    container.scrollTop
    + rowRect.top
    - containerRect.top
    - (container.clientHeight - rowRect.height) / 2
  )
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)

  container.scrollTo({
    top: Math.max(0, Math.min(maxScrollTop, centeredTop)),
    behavior: 'smooth'
  })
}

const scheduleCenterPlayingEventRow = (eventId = followedPlaybackEventId.value) => {
  nextTick(() => {
    if (typeof requestAnimationFrame === 'undefined') {
      centerPlayingEventRow(eventId)
      return
    }
    requestAnimationFrame(() => centerPlayingEventRow(eventId))
  })
}

const pauseEventListFollow = () => {
  eventListFollowPaused = true
  if (eventListFollowResumeTimer) {
    clearTimeout(eventListFollowResumeTimer)
  }

  eventListFollowResumeTimer = setTimeout(() => {
    eventListFollowResumeTimer = null
    eventListFollowPaused = false
    scheduleCenterPlayingEventRow()
  }, EVENT_LIST_FOLLOW_RESUME_DELAY)
}

const handleEventListPointerInteraction = (event: PointerEvent) => {
  const target = event.target
  if (target instanceof Element && target.closest('.events-table-row')) {
    return
  }
  pauseEventListFollow()
}

// 播放事件变更时自动居中；用户操作列表后暂停跟随 5 秒
watch(
  followedPlaybackEventId,
  (newId) => {
    if (newId === null || eventListFollowPaused) return
    scheduleCenterPlayingEventRow(newId)
  },
  { immediate: true }
)

</script>

<template>
  <div class="events-window-container" @click="handleTableBackgroundClick">
    <!-- 列表表头：从左到右分别为 ID 列、时间列、名称列 -->
    <div class="events-table-header" @click.stop>
      <div class="col-id">ID</div>
      <div class="col-time">区间</div>
      <div class="col-name">名称</div>
      <div class="col-actions">操作</div>
    </div>

    <!-- 列表主体 -->
    <div
      ref="eventListBodyRef"
      class="events-table-body"
      @wheel.passive="pauseEventListFollow"
      @keydown.capture="pauseEventListFollow"
      @pointerdown.capture="handleEventListPointerInteraction"
      @pointerup.capture="handleEventListPointerInteraction"
      @pointercancel.capture="handleEventListPointerInteraction"
      @touchstart.passive="pauseEventListFollow"
      @touchend.passive="pauseEventListFollow"
    >
      <TransitionGroup
        v-if="events.length > 0"
        name="events-list"
        appear
      >
        <div
          v-for="event in events"
          :id="`event-row-${event.id}`"
          :key="event.id"
          :data-event-id="event.id"
          class="events-table-row"
          :class="{
            'is-selected': selectedEventId === event.id,
            'is-pending-deselect': eventDeselectArmed && selectedEventId === event.id,
            'is-playing': playingEventId === event.id,
            'is-editing': editingId === event.id,
            'is-dragging': draggingEventId === event.id,
            'is-drag-before': dragOverEventId === event.id && dragOverPosition === 'before',
            'is-drag-after': dragOverEventId === event.id && dragOverPosition === 'after'
          }"
          :draggable="editingId !== event.id && !isTimeInputInteracting"
          @dragstart="handleEventDragStart(event, $event)"
          @dragover="handleEventDragOver(event, $event)"
          @dragleave="handleEventDragLeave(event, $event)"
          @drop="handleEventDrop(event, $event)"
          @dragend="clearEventDragState"
          @pointerdown.stop
          @click.stop="handleRowClick(event)"
        >
          <!-- 当前事件播放进度 -->
          <div
            :key="`event-progress-${event.id}`"
            :ref="(element) => setEventProgressRef(event.id, element as Element | null)"
            class="event-progress-fill"
          />

          <!-- ID 列 -->
          <div class="col-id">
            <button
              class="event-id-button"
              type="button"
              :aria-label="`跳转并触发事件 ${getEventDisplayId(event)}`"
              @click.stop="handleRowClick(event)"
              @dblclick.stop="handleEventIdDoubleClick(event)"
            >
              <span
                class="id-badge"
                :class="{ 'is-composite': getEventDisplayId(event).includes('-') }"
              >
                {{ getEventDisplayId(event) }}
              </span>
            </button>
          </div>

          <!-- 时间列 (对应视频触发时间) -->
          <div class="col-time" @click.stop>
            <div class="event-time-range">
              <input
                class="time-input"
                type="text"
                inputmode="numeric"
                draggable="false"
                placeholder="--:--:--.--"
                :value="getEventTimeInputValue(event.id, event.time)"
                @pointerdown.stop="startTimeInputDrag(event.id, 'start', $event)"
                @dragstart.stop.prevent
                @click.stop="handleTimeInputClick"
                @input="handleTimeInput"
                @focus="handleTimeFocus(event.id, event.time, $event)"
                @blur="handleTimeBlur(event.id, $event)"
                @keydown="handleTimeKeydown"
              />
              <span class="time-range-separator">-</span>
              <input
                class="time-input time-input-end"
                type="text"
                inputmode="numeric"
                draggable="false"
                placeholder="--:--:--.--"
                :value="getEventEndTimeInputValue(event)"
                @pointerdown.stop="startTimeInputDrag(event.id, 'end', $event)"
                @dragstart.stop.prevent
                @click.stop="handleTimeInputClick"
                @input="handleTimeInput"
                @focus="handleEndTimeFocus(event, $event)"
                @blur="handleEndTimeBlur(event, $event)"
                @keydown="handleTimeKeydown"
              />
            </div>
          </div>

          <!-- 名称列 -->
          <div
            class="col-name"
            @dblclick.stop="editingId !== event.id && startEdit(event)"
          >
            <Transition name="event-name-edit" mode="out-in">
              <input
                v-if="editingId === event.id"
                ref="editInputRef"
                key="edit"
                v-model="editingName"
                class="name-input"
                type="text"
                @click.stop
                @blur="saveEdit(event.id)"
                @keydown.enter="saveEdit(event.id)"
                @keydown.esc="cancelEdit"
              />
              <span v-else key="display" class="name-text">{{ event.name }}</span>
            </Transition>
          </div>

          <!-- 操作列：悬停显示删除，重命名时在左侧显示保存 -->
          <div class="col-actions" @click.stop>
            <button
              v-if="editingId === event.id"
              class="row-action-btn save-btn"
              type="button"
              aria-label="保存名称"
              @mousedown.prevent
              @click.stop="saveEdit(event.id)"
            >
              <svg class="action-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </button>
            <button
              class="row-action-btn delete-btn"
              type="button"
              aria-label="删除事件"
              @mousedown.prevent
              @click.stop="handleDelete(event.id, $event)"
            >
              <svg class="action-icon" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                />
              </svg>
            </button>
          </div>
        </div>
      </TransitionGroup>

      <!-- 空状态 -->
      <div v-else class="events-empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"
          />
        </svg>
        <span class="empty-title">暂无事件</span>
      </div>
    </div>

    <!-- 底部状态统计栏 (若有事件) -->
    <div v-if="events.length > 0" class="events-table-footer">
      <span v-if="currentEventOrdinal !== null" class="footer-current">
        当前第 {{ currentEventOrdinal }} 个事件，
      </span>
      <span class="footer-count">共 {{ events.length }} 个事件</span>
    </div>
  </div>
</template>

<style scoped>
.events-window-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background-color: var(--md-sys-color-surface, #1c1f26);
  color: var(--md-sys-color-on-surface, #e8edf2);
  user-select: none;
  overflow: hidden;
}

/* 表头 */
.events-table-header {
  display: flex;
  align-items: center;
  height: 36px;
  min-height: 36px;
  padding: 0 8px;
  background-color: var(--md-sys-color-surface-container-high, #282c35);
  border-bottom: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08));
  font-size: 12px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  letter-spacing: 0.3px;
}

.events-table-header .col-id,
.events-table-header .col-time,
.events-table-header .col-name,
.events-table-header .col-actions {
  justify-content: center;
  padding-right: 0;
  padding-left: 0;
  text-align: center;
}

/* 表格主体 */
.events-table-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overflow-anchor: none;
}

.events-table-body::-webkit-scrollbar {
  width: 6px;
}

.events-table-body::-webkit-scrollbar-track {
  background: transparent;
}

.events-table-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.14);
  border-radius: 3px;
}

.events-table-body::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}

/* 行样式 */
.events-table-row {
  display: flex;
  align-items: center;
  height: 40px;
  min-height: 40px;
  padding: 0 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
  position: relative;
  overflow: visible;
}

.events-table-row.events-list-enter-active {
  transition: opacity 0.24s cubic-bezier(0.2, 0, 0, 1);
}

.events-table-row.events-list-enter-from {
  opacity: 0;
}

.events-table-row:hover {
  background-color: var(--md-sys-color-surface-container-high, rgba(255, 255, 255, 0.04));
}

.events-table-row.is-selected,
.events-table-row.is-editing {
  background-color: rgba(138, 180, 248, 0.12);
  box-shadow: inset 0 0 0 1px var(--md-sys-color-primary, #8ab4f8);
}

.events-table-row.is-pending-deselect {
  box-shadow: inset 0 0 0 1px color-mix(
    in srgb,
    var(--md-sys-color-primary, #8ab4f8) 45%,
    transparent
  );
}

.events-table-row.is-playing {
  background-color: rgba(138, 180, 248, 0.08);
}

.events-table-row.is-dragging {
  opacity: 0.45;
}

.events-table-row.is-drag-before::after,
.events-table-row.is-drag-after::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  border-radius: 2px;
  background-color: var(--md-sys-color-primary, #8ab4f8);
  box-shadow: 0 0 6px rgba(138, 180, 248, 0.55);
  pointer-events: none;
  z-index: 6;
}

.events-table-row.is-drag-before::after {
  top: -1px;
}

.events-table-row.is-drag-after::after {
  bottom: -1px;
}

/* 播放进度填充动画 */
.event-progress-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  display: none;
  width: 100%;
  background-color: var(--md-sys-color-primary, #8ab4f8);
  transform: scaleX(0);
  transform-origin: left center;
  transition:
    background-color 180ms ease,
    opacity 180ms ease;
  will-change: transform, opacity;
  backface-visibility: hidden;
  pointer-events: none;
  z-index: 1;
}

/* 列定义 */
.col-id,
.col-time,
.col-name,
.col-actions {
  position: relative;
  z-index: 2;
}

.col-id {
  width: 46px;
  min-width: 46px;
  padding: 0 4px;
  display: flex;
  align-items: center;
}

.id-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 18px;
  box-sizing: border-box;
  padding: 0 3px;
  font-family: 'Google Sans', sans-serif;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--md-sys-color-primary, #8ab4f8);
  background-color: rgba(138, 180, 248, 0.1);
  border-radius: 4px;
}

.id-badge.is-composite {
  padding: 0 4px;
  font-size: 10px;
}

.event-id-button {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  outline: none;
}

.event-id-button:hover .id-badge {
  background-color: rgba(138, 180, 248, 0.22);
}

.event-id-button:focus-visible {
  box-shadow: 0 0 0 2px rgba(138, 180, 248, 0.55);
}

/* 时间列 */
.col-time {
  width: 192px;
  min-width: 192px;
  padding: 0 4px;
  display: flex;
  align-items: center;
}

.event-time-range {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
  min-width: 0;
}

.time-input {
  width: 78px;
  min-width: 78px;
  height: 22px;
  box-sizing: border-box;
  padding: 0 4px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: var(--md-sys-color-on-surface, #e8edf2);
  font-family: 'Google Sans', sans-serif;
  font-size: 11px;
  font-weight: 500;
  text-align: center;
  cursor: ew-resize;
  touch-action: none;
  outline: none;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}

.time-input:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.time-input:focus {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--md-sys-color-primary, #8ab4f8);
  box-shadow: 0 0 0 1px var(--md-sys-color-primary, #8ab4f8);
  animation: event-inline-input-in 120ms cubic-bezier(0.2, 0, 0, 1) both;
}

.time-range-separator {
  flex: none;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  font-family: 'Google Sans', sans-serif;
  font-size: 11px;
  line-height: 1;
}

.time-input-end {
  font-variant-numeric: tabular-nums;
}

.col-name {
  flex: 1;
  min-width: 0;
  padding: 0 12px 0 4px;
  display: flex;
  align-items: center;
}

.name-text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--md-sys-color-on-surface, #e8edf2);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.name-input {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  font-size: 13px;
  color: var(--md-sys-color-on-surface, #e8edf2);
  background-color: var(--md-sys-color-surface-container-highest, #323843);
  border: 1px solid var(--md-sys-color-primary, #8ab4f8);
  border-radius: 4px;
  outline: none;
  text-align: center;
  transform-origin: center;
}

.event-name-edit-enter-active,
.event-name-edit-leave-active {
  transition:
    opacity 120ms cubic-bezier(0.2, 0, 0, 1),
    transform 120ms cubic-bezier(0.2, 0, 0, 1);
}

.event-name-edit-enter-from,
.event-name-edit-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

.col-actions {
  width: 64px;
  min-width: 64px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding-right: 4px;
}

.row-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  outline: none;
  opacity: 0;
  pointer-events: none;
  transition: all 0.15s ease;
}

.events-table-row:hover .row-action-btn {
  opacity: 1;
  pointer-events: auto;
}

.events-table-row.is-editing .save-btn {
  opacity: 1;
  pointer-events: auto;
}

.row-action-btn:hover {
  background-color: var(--md-sys-color-surface-container-highest, rgba(255, 255, 255, 0.1));
  color: var(--md-sys-color-on-surface, #e8edf2);
}

.row-action-btn.delete-btn:hover {
  background-color: rgba(239, 107, 115, 0.18);
  color: #f2b8b5;
}

.row-action-btn.save-btn:hover {
  background-color: rgba(138, 180, 248, 0.18);
  color: var(--md-sys-color-primary, #8ab4f8);
}

.action-icon {
  width: 16px;
  height: 16px;
}

/* 空状态 */
.events-empty-state {
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

/* 底部状态 */
.events-table-footer {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  height: 28px;
  min-height: 28px;
  padding: 0 12px;
  background-color: var(--md-sys-color-surface-container, #22262e);
  border-top: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08));
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

</style>
