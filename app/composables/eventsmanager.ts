import { computed, watch } from 'vue'
import { projectManager } from '~/composables/projectmanager'
import { presetsManager, type PresetItem } from '~/composables/presetsmanager'
import { devicesManager } from '~/composables/devicesmanager'
import { videoManager } from '~/composables/videomanager'

export interface EventPresetTrigger {
  id: number
  presetId: number
  time?: string // 相对事件开始时间，例如 "00:00.00"
  track?: number // 时间线轨道索引，从 0 开始
}

export interface EventItem {
  id: number
  name: string
  time?: string // 开始时间，例如 "00:00.00" 或 "01:23.45"
  endTime?: string // 终止时间；留空时按全部预设触发器自动计算
  presetTriggers: EventPresetTrigger[]
  timelineTrackCount?: number
}

export type EventMovePosition = 'before' | 'after'

const DEFAULT_EVENT_DURATION_SECONDS = 30

// 解析时间字符串（如 "01:23" 或 "83"）为秒数
export const parseTimeToSeconds = (input: string | number | undefined | null): number => {
  if (typeof input === 'number') return Math.max(0, isNaN(input) ? 0 : input)
  if (!input || typeof input !== 'string') return 0
  const trimmed = input.trim()
  if (!trimmed) return 0

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':')
    if (parts.length === 2) {
      const [minsText, secsText] = parts
      if (minsText === undefined || secsText === undefined) return 0

      const mins = parseFloat(minsText) || 0
      const secs = parseFloat(secsText) || 0
      return Math.max(0, mins * 60 + secs)
    } else if (parts.length === 3) {
      const [hrsText, minsText, secsText] = parts
      if (hrsText === undefined || minsText === undefined || secsText === undefined) return 0

      const hrs = parseFloat(hrsText) || 0
      const mins = parseFloat(minsText) || 0
      const secs = parseFloat(secsText) || 0
      return Math.max(0, hrs * 3600 + mins * 60 + secs)
    }
  }
  const num = parseFloat(trimmed)
  return isNaN(num) ? 0 : Math.max(0, num)
}

// 校验事件时间，允许 0 表示视频开始
export const isValidTriggerTime = (input: string | number | undefined | null): boolean => {
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0
  if (typeof input !== 'string') return false

  const trimmed = input.trim()
  if (!trimmed) return false

  const partPattern = /^\d+(?:\.\d+)?$/
  if (!trimmed.includes(':')) return partPattern.test(trimmed)

  const parts = trimmed.split(':')
  if (parts.length !== 2 && parts.length !== 3) return false
  return parts.every(part => partPattern.test(part))
}

// 格式化秒数为两位小数时间：不足 1 小时为 "分:秒.小数"，达到 1 小时为 "时:分:秒.小数"
export const formatTriggerTime = (seconds: number, forceHours = false): string => {
  if (isNaN(seconds) || seconds < 0) return forceHours ? '00:00:00.00' : '00:00.00'
  const totalHundredths = Math.floor(seconds * 100)
  const h = Math.floor(totalHundredths / 360000)
  const m = Math.floor((totalHundredths % 360000) / 6000)
  const s = Math.floor((totalHundredths % 6000) / 100)
  const fraction = totalHundredths % 100
  const mm = String(m).padStart(2, '0')
  const ss = `${String(s).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`
  if (h > 0 || forceHours) {
    const hh = String(h).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }
  return `${mm}:${ss}`
}

export const getEventPresetTriggers = (event: EventItem): EventPresetTrigger[] => {
  if (Array.isArray(event.presetTriggers)) return event.presetTriggers

  const legacyPresetId = (event as EventItem & { presetId?: number | null }).presetId
  return typeof legacyPresetId === 'number' && legacyPresetId > 0
    ? [{ id: 1, presetId: legacyPresetId, time: '00:00.00' }]
    : []
}

export const normalizeTimelineTrackIndex = (value: unknown): number => {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0
}

export const normalizeEventTimelineTrackCount = (
  value: unknown,
  triggers: EventPresetTrigger[]
): number => {
  const storedCount = typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0
  const highestTriggerTrack = triggers.reduce(
    (highest, trigger) => Math.max(highest, normalizeTimelineTrackIndex(trigger.track)),
    -1
  )
  return Math.max(storedCount, highestTriggerTrack + 1)
}

export const normalizeEventPresetTriggers = (
  input: unknown,
  legacyPresetId?: number | null
): EventPresetTrigger[] => {
  const source = Array.isArray(input) ? input : []
  const triggers: EventPresetTrigger[] = []
  const usedIds = new Set<number>()

  for (const item of source) {
    const trigger = item as Partial<EventPresetTrigger>
    if (
      typeof trigger.presetId !== 'number' ||
      !Number.isInteger(trigger.presetId) ||
      trigger.presetId < 1
    ) continue

    let id = typeof trigger.id === 'number' && Number.isInteger(trigger.id)
      ? trigger.id
      : triggers.length + 1
    while (usedIds.has(id)) id++
    usedIds.add(id)
    triggers.push({
      id,
      presetId: trigger.presetId,
      time: typeof trigger.time === 'string' && isValidTriggerTime(trigger.time)
        ? formatTriggerTime(parseTimeToSeconds(trigger.time))
        : '00:00.00',
      track: normalizeTimelineTrackIndex(trigger.track)
    })
  }

  if (
    triggers.length === 0 &&
    typeof legacyPresetId === 'number' &&
    Number.isInteger(legacyPresetId) &&
    legacyPresetId > 0
  ) {
    triggers.push({ id: 1, presetId: legacyPresetId, time: '00:00.00', track: 0 })
  }

  return triggers
}

const ensureEventPresetTriggers = (event: EventItem): EventPresetTrigger[] => {
  if (!Array.isArray(event.presetTriggers)) {
    event.presetTriggers = getEventPresetTriggers(event).map(trigger => ({ ...trigger }))
  }
  return event.presetTriggers
}

export const getPresetPlaybackDurationMs = (preset: PresetItem): number => {
  const effectDuration = preset.effect?.duration || 2000
  const effectRepeat = typeof preset.effect?.repeat === 'number'
    ? preset.effect.repeat
    : 1
  return Math.max(200, effectDuration * (effectRepeat > 0 ? effectRepeat : 1))
}

export const getEventAutoEndTimeSeconds = (
  event: EventItem,
  availablePresets?: PresetItem[]
): number | null => {
  if (!isValidTriggerTime(event.time)) return null

  const presets = availablePresets ?? presetsManager().presets.value
  const eventStartTime = parseTimeToSeconds(event.time)
  let latestEndTime = eventStartTime

  for (const trigger of getEventPresetTriggers(event)) {
    const preset = presets.find(item => item.id === trigger.presetId)
    if (!preset) continue

    const triggerStartTime = eventStartTime + (
      isValidTriggerTime(trigger.time) ? parseTimeToSeconds(trigger.time) : 0
    )
    latestEndTime = Math.max(
      latestEndTime,
      triggerStartTime + getPresetPlaybackDurationMs(preset) / 1000
    )
  }

  return latestEndTime > eventStartTime ? latestEndTime : null
}

export const getEventEndTimeSeconds = (
  event: EventItem,
  availablePresets?: PresetItem[]
): number | null => {
  if (!isValidTriggerTime(event.time)) return null
  const startTime = parseTimeToSeconds(event.time)
  const explicitEndTime = typeof event.endTime === 'string' ? event.endTime.trim() : ''

  if (explicitEndTime) {
    if (!isValidTriggerTime(explicitEndTime)) return null
    const endTime = parseTimeToSeconds(explicitEndTime)
    return endTime > startTime ? endTime : null
  }

  return getEventAutoEndTimeSeconds(event, availablePresets)
}

export const getEventRangeDurationMs = (
  event: EventItem,
  availablePresets?: PresetItem[]
): number | null => {
  if (!isValidTriggerTime(event.time)) return null
  const endTime = getEventEndTimeSeconds(event, availablePresets)
  if (endTime === null) return null

  const startTime = parseTimeToSeconds(event.time)
  return Math.max(0, (endTime - startTime) * 1000)
}

export interface EventPresetPlayback {
  eventId: number
  triggerId: number
  preset: PresetItem
  startTime: number
  endTime: number
  durationMs: number
  totalRepeat: number
  track: number
}

export const getEventPresetPlaybacks = (
  event: EventItem,
  availablePresets?: PresetItem[]
): EventPresetPlayback[] => {
  if (!isValidTriggerTime(event.time)) return []

  const presets = availablePresets ?? presetsManager().presets.value
  const eventStartTime = parseTimeToSeconds(event.time)
  const eventEndTime = getEventEndTimeSeconds(event, presets)
  if (eventEndTime === null || eventEndTime <= eventStartTime) return []

  const playbacks: EventPresetPlayback[] = []
  for (const trigger of getEventPresetTriggers(event)) {
    const preset = presets.find(item => item.id === trigger.presetId)
    if (!preset) continue

    const triggerStartTime = eventStartTime + (
      isValidTriggerTime(trigger.time) ? parseTimeToSeconds(trigger.time) : 0
    )
    const triggerEndTime = Math.min(
      eventEndTime,
      triggerStartTime + getPresetPlaybackDurationMs(preset) / 1000
    )
    if (triggerEndTime <= triggerStartTime) continue

    const presetRepeat = typeof preset.effect?.repeat === 'number' ? preset.effect.repeat : 1
    playbacks.push({
      eventId: event.id,
      triggerId: trigger.id,
      preset,
      startTime: triggerStartTime,
      endTime: triggerEndTime,
      durationMs: (triggerEndTime - triggerStartTime) * 1000,
      totalRepeat: presetRepeat === 0 ? 0 : Math.max(1, presetRepeat),
      track: normalizeTimelineTrackIndex(trigger.track)
    })
  }

  return playbacks.sort((a, b) => (
    a.startTime - b.startTime ||
    b.durationMs - a.durationMs ||
    a.triggerId - b.triggerId
  ))
}

export const getEventPresetPlaybacksAtTime = (
  event: EventItem,
  time: number,
  availablePresets?: PresetItem[]
): EventPresetPlayback[] => {
  return getEventPresetPlaybacks(event, availablePresets)
    .filter(playback => time >= playback.startTime && time < playback.endTime)
}

export const isEventTimeInRange = (
  event: EventItem,
  time: number,
  availablePresets?: PresetItem[]
): boolean => {
  if (!isValidTriggerTime(event.time)) return false
  const startTime = parseTimeToSeconds(event.time)
  const endTime = getEventEndTimeSeconds(event, availablePresets)
  return endTime !== null && time >= startTime && time < endTime
}

// 当前预设触发器栈，最后一项优先级最高；短触发器结束后恢复之前的长触发器
let activeEventStack: EventPresetPlayback[] = []
let activeEventPaused = false

export const eventsManager = () => {
  const { currentProject } = projectManager()
  const events = useState<EventItem[]>('app_events_list', () => [])
  const selectedEventId = useState<number | null>('app_selected_event_id', () => null)
  const {
    currentTime: videoCurrentTime,
    isVideoPlaying,
    seekVersion: videoSeekVersion,
    isScrubbing: isVideoScrubbing
  } = videoManager()

  const playingEventId = useState<number | null>('playlist_playing_event_id', () => null)
  const playingEventTriggerId = useState<number | null>(
    'playlist_playing_event_trigger_id',
    () => null
  )
  const eventPlayProgress = useState<number>('playlist_event_progress', () => 0) // 0.0 ~ 1.0
  const isEventRecording = useState<boolean>('events_recording_active', () => false)

  // 若已载入工程且本地为空，优先同步工程内事件
  if (
    currentProject.value?.data?.events &&
    Array.isArray(currentProject.value.data.events) &&
    events.value.length === 0 &&
    currentProject.value.data.events.length > 0
  ) {
    events.value = currentProject.value.data.events.map((e: any, idx: number) => {
      const presetTriggers = normalizeEventPresetTriggers(e.presetTriggers, e.presetId)
      return {
        id: typeof e.id === 'number' ? e.id : idx + 1,
        name: e.name || `事件 ${idx + 1}`,
        time: typeof e.time === 'string' && isValidTriggerTime(e.time) ? e.time : '',
        endTime: typeof e.endTime === 'string' ? e.endTime.trim() : '',
        presetTriggers,
        timelineTrackCount: normalizeEventTimelineTrackCount(
          e.timelineTrackCount,
          presetTriggers
        )
      }
    })
  }

  const syncToProject = () => {
    if (currentProject.value?.data) {
      currentProject.value.data.events = events.value.map(e => ({
        id: e.id,
        name: e.name,
        time: typeof e.time === 'string' ? e.time.trim() : '',
        endTime: typeof e.endTime === 'string' ? e.endTime.trim() : '',
        presetTriggers: getEventPresetTriggers(e).map(trigger => ({
          id: trigger.id,
          presetId: trigger.presetId,
          time: typeof trigger.time === 'string' ? trigger.time.trim() : '00:00.00',
          track: normalizeTimelineTrackIndex(trigger.track)
        })),
        timelineTrackCount: normalizeEventTimelineTrackCount(
          e.timelineTrackCount,
          getEventPresetTriggers(e)
        )
      }))
    }
  }

  const toggleEventRecording = () => {
    if (!isEventRecording.value && selectedEventId.value === null) return
    isEventRecording.value = !isEventRecording.value
  }

  const addEvent = (): EventItem => {
    const nextId = events.value.length > 0
      ? Math.max(...events.value.map(event => event.id)) + 1
      : 1
    const startTime = Math.max(0, videoCurrentTime.value)
    const newEvent: EventItem = {
      id: nextId,
      name: `事件 ${nextId}`,
      time: formatTriggerTime(startTime),
      endTime: formatTriggerTime(startTime + DEFAULT_EVENT_DURATION_SECONDS),
      presetTriggers: [],
      timelineTrackCount: 0
    }

    events.value.push(newEvent)
    selectedEventId.value = newEvent.id
    syncToProject()
    return newEvent
  }

  watch(selectedEventId, (id) => {
    if (id === null && isEventRecording.value) {
      isEventRecording.value = false
    }
  })

  const removeEvent = (id: number) => {
    const index = events.value.findIndex(e => e.id === id)
    if (index !== -1) {
      const wasActive = playingEventId.value === id
      events.value.splice(index, 1)
      activeEventStack = activeEventStack.filter(item => item.eventId !== id)
      if (selectedEventId.value === id) {
        selectedEventId.value = events.value[index]?.id ?? events.value[index - 1]?.id ?? null
      }
      if (wasActive) {
        activeEventPaused = false
        if (activeEventStack.length > 0) {
          syncActiveEventToVideoTime(videoCurrentTime.value, true)
        } else {
          playingEventId.value = null
          playingEventTriggerId.value = null
          eventPlayProgress.value = 0
          const { stopDevicePlayback } = devicesManager()
          stopDevicePlayback()
        }
      }
      syncToProject()
    }
  }

  const updateEventName = (id: number, name: string) => {
    const event = events.value.find(e => e.id === id)
    if (event) {
      event.name = name.trim() || `事件 ${id}`
      syncToProject()
    }
  }

  const updateEventTime = (id: number, timeStr: string) => {
    const event = events.value.find(e => e.id === id)
    if (event) {
      event.time = timeStr.trim()
      syncToProject()
    }
  }

  const updateEventEndTime = (id: number, timeStr: string) => {
    const event = events.value.find(e => e.id === id)
    if (!event) return

    event.endTime = timeStr.trim()
    syncToProject()
  }

  const addEventPresetTrigger = (
    eventId: number,
    presetId: number,
    offsetSeconds?: number,
    trackIndex = 0
  ): EventPresetTrigger | null => {
    const event = events.value.find(e => e.id === eventId)
    if (
      !event ||
      !Number.isInteger(presetId) ||
      presetId < 1
    ) {
      return null
    }

    const triggers = ensureEventPresetTriggers(event)
    const eventStartTime = isValidTriggerTime(event.time)
      ? parseTimeToSeconds(event.time)
      : 0
    const hasExplicitEndTime = typeof event.endTime === 'string' && !!event.endTime.trim()
    const eventEndTime = hasExplicitEndTime ? getEventEndTimeSeconds(event) : null
    const requestedOffset = typeof offsetSeconds === 'number' && Number.isFinite(offsetSeconds)
      ? Math.max(0, offsetSeconds)
      : Math.max(0, videoCurrentTime.value - eventStartTime)
    const offsetLimit = eventEndTime === null
      ? requestedOffset
      : Math.max(0, eventEndTime - eventStartTime - 0.01)
    const nextId = triggers.length > 0
      ? Math.max(...triggers.map(trigger => trigger.id)) + 1
      : 1
    const trigger: EventPresetTrigger = {
      id: nextId,
      presetId,
      time: formatTriggerTime(Math.min(requestedOffset, offsetLimit)),
      track: normalizeTimelineTrackIndex(trackIndex)
    }

    triggers.push(trigger)
    event.timelineTrackCount = normalizeEventTimelineTrackCount(
      event.timelineTrackCount,
      triggers
    )
    syncToProject()
    return trigger
  }

  const addEventTimelineTrack = (eventId: number): number => {
    const event = events.value.find(e => e.id === eventId)
    if (!event) return 0

    event.timelineTrackCount = normalizeEventTimelineTrackCount(
      event.timelineTrackCount,
      getEventPresetTriggers(event)
    ) + 1
    syncToProject()
    return event.timelineTrackCount
  }

  const removeEventTimelineTrack = (eventId: number): number => {
    const event = events.value.find(e => e.id === eventId)
    if (!event) return 0

    const triggers = ensureEventPresetTriggers(event)
    const currentTrackCount = normalizeEventTimelineTrackCount(
      event.timelineTrackCount,
      triggers
    )
    if (currentTrackCount <= 0) return 0

    const nextTrackCount = currentTrackCount - 1
    for (let index = triggers.length - 1; index >= 0; index--) {
      const trigger = triggers[index]
      if (trigger && normalizeTimelineTrackIndex(trigger.track) >= nextTrackCount) {
        triggers.splice(index, 1)
      }
    }

    event.timelineTrackCount = nextTrackCount
    syncToProject()
    return nextTrackCount
  }

  const updateEventPresetTriggerTime = (
    eventId: number,
    triggerId: number,
    offsetSeconds: number
  ) => {
    const event = events.value.find(e => e.id === eventId)
    const trigger = event
      ? ensureEventPresetTriggers(event).find(item => item.id === triggerId)
      : null
    if (!event || !trigger) return

    const eventStartTime = isValidTriggerTime(event.time)
      ? parseTimeToSeconds(event.time)
      : 0
    const hasExplicitEndTime = typeof event.endTime === 'string' && !!event.endTime.trim()
    const eventEndTime = hasExplicitEndTime ? getEventEndTimeSeconds(event) : null
    const offsetLimit = eventEndTime === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, eventEndTime - eventStartTime - 0.01)
    trigger.time = formatTriggerTime(Math.min(
      Math.max(0, offsetSeconds),
      offsetLimit
    ))
    syncToProject()
  }

  const removeEventPresetTrigger = (eventId: number, triggerId: number) => {
    const event = events.value.find(e => e.id === eventId)
    if (!event) return

    const triggers = ensureEventPresetTriggers(event)
    const triggerIndex = triggers.findIndex(trigger => trigger.id === triggerId)
    if (triggerIndex === -1) return

    triggers.splice(triggerIndex, 1)
    syncToProject()
  }

  const updateEventPresetTriggerTrack = (
    eventId: number,
    triggerId: number,
    trackIndex: number
  ) => {
    const event = events.value.find(e => e.id === eventId)
    const trigger = event
      ? ensureEventPresetTriggers(event).find(item => item.id === triggerId)
      : null
    if (!event || !trigger) return

    trigger.track = normalizeTimelineTrackIndex(trackIndex)
    event.timelineTrackCount = normalizeEventTimelineTrackCount(
      event.timelineTrackCount,
      getEventPresetTriggers(event)
    )
    syncToProject()
  }

  const recordPresetEvent = (preset: Pick<PresetItem, 'id' | 'name'>): EventItem | null => {
    if (!isEventRecording.value || selectedEventId.value === null) return null

    const { currentTime } = videoManager()
    const selectedEvent = events.value.find(event => event.id === selectedEventId.value)
    if (!selectedEvent) return null

    const eventStartTime = isValidTriggerTime(selectedEvent.time)
      ? parseTimeToSeconds(selectedEvent.time)
      : currentTime.value
    addEventPresetTrigger(
      selectedEvent.id,
      preset.id,
      Math.max(0, currentTime.value - eventStartTime)
    )
    return selectedEvent
  }

  const moveEvent = (draggedId: number, targetId: number, position: EventMovePosition) => {
    const fromIndex = events.value.findIndex(event => event.id === draggedId)
    const targetIndex = events.value.findIndex(event => event.id === targetId)
    if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) return

    const insertionIndex = position === 'after' ? targetIndex + 1 : targetIndex
    const nextEvents = [...events.value]
    const [movedEvent] = nextEvents.splice(fromIndex, 1)
    if (!movedEvent) return
    const adjustedIndex = fromIndex < insertionIndex ? insertionIndex - 1 : insertionIndex
    nextEvents.splice(adjustedIndex, 0, movedEvent)

    const selectedEvent = selectedEventId.value === null
      ? null
      : nextEvents.find(event => event.id === selectedEventId.value)
    const playingEvent = playingEventId.value === null
      ? null
      : nextEvents.find(event => event.id === playingEventId.value)

    // 拖动后按实际顺序重新编排连续 ID
    nextEvents.forEach((event, index) => {
      event.id = index + 1
    })
    events.value = nextEvents

    selectedEventId.value = selectedEvent?.id ?? null
    if (playingEventId.value !== null) {
      playingEventId.value = playingEvent?.id ?? null
    }
    syncToProject()
  }

  const selectEvent = (id: number | null) => {
    selectedEventId.value = id
  }

  const getTopActiveEventPlayback = (): EventPresetPlayback | null => {
    return activeEventStack.length > 0
      ? activeEventStack[activeEventStack.length - 1] ?? null
      : null
  }

  const sendActiveEventPlaybackToDevice = (playback: EventPresetPlayback, elapsedMs: number) => {
    const { sendPresetToDevice, seekDevicePlayback } = devicesManager()
    sendPresetToDevice({
      ...playback.preset,
      effect: playback.preset.effect
        ? { ...playback.preset.effect, repeat: playback.totalRepeat }
        : playback.preset.effect
    })
    seekDevicePlayback(Math.max(0, elapsedMs))
  }

  const syncActiveEventToVideoTime = (time: number, seekOutput = false) => {
    const presets = presetsManager().presets.value
    const previousTopPlayback = getTopActiveEventPlayback()
    const nextStack = events.value
      .flatMap(event => getEventPresetPlaybacksAtTime(event, time, presets))
      .sort((a, b) => (
        a.startTime - b.startTime ||
        b.durationMs - a.durationMs ||
        a.eventId - b.eventId ||
        a.triggerId - b.triggerId
      ))
    activeEventStack = nextStack

    const activePlayback = getTopActiveEventPlayback()
    if (!activePlayback) {
      activeEventPaused = false
      eventPlayProgress.value = 0
      playingEventId.value = null
      playingEventTriggerId.value = null
      const previousEvent = previousTopPlayback
        ? events.value.find(event => event.id === previousTopPlayback.eventId)
        : null
      const isPreviousEventStillActive = previousEvent
        ? isEventTimeInRange(previousEvent, time, presets)
        : false
      if (previousTopPlayback && !isPreviousEventStillActive) {
        const { stopDevicePlayback } = devicesManager()
        stopDevicePlayback()
      }
      return
    }

    const elapsedMs = Math.max(0, (time - activePlayback.startTime) * 1000)
    const progress = Math.max(0, Math.min(1, elapsedMs / activePlayback.durationMs))
    const activeEventChanged = (
      previousTopPlayback?.eventId !== activePlayback.eventId ||
      previousTopPlayback?.triggerId !== activePlayback.triggerId ||
      previousTopPlayback?.durationMs !== activePlayback.durationMs ||
      previousTopPlayback?.totalRepeat !== activePlayback.totalRepeat
    )

    eventPlayProgress.value = progress
    playingEventId.value = activePlayback.eventId
    playingEventTriggerId.value = activePlayback.triggerId

    if (activeEventChanged) {
      sendActiveEventPlaybackToDevice(
        activePlayback,
        Math.min(activePlayback.durationMs, elapsedMs)
      )
      return
    }

    if (seekOutput) {
      const { seekDevicePlayback } = devicesManager()
      seekDevicePlayback(Math.min(activePlayback.durationMs, elapsedMs))
    }
  }

  // 双击事件时按当前视频位置重新同步时间线触发器。
  const triggerEventEffect = (event: EventItem) => {
    selectedEventId.value = event.id
    activeEventPaused = false
    syncActiveEventToVideoTime(videoCurrentTime.value, true)
  }

  const pauseEventEffect = () => {
    if (activeEventStack.length === 0 || activeEventPaused) return

    syncActiveEventToVideoTime(videoCurrentTime.value, true)
    if (activeEventStack.length === 0) return
    activeEventPaused = true

    const { pauseDevicePlayback } = devicesManager()
    pauseDevicePlayback()
  }

  const resumeEventEffect = () => {
    if (activeEventStack.length === 0 || !activeEventPaused) return

    syncActiveEventToVideoTime(videoCurrentTime.value, true)
    if (activeEventStack.length === 0) return
    activeEventPaused = false
    const { resumeDevicePlayback } = devicesManager()
    resumeDevicePlayback()
  }

  const stopEventEffect = () => {
    const activeEventId = playingEventId.value
    if (activeEventId === null && activeEventStack.length === 0) return

    activeEventStack = []
    activeEventPaused = false
    playingEventId.value = null
    playingEventTriggerId.value = null
    eventPlayProgress.value = 0
    if (selectedEventId.value === activeEventId) {
      selectedEventId.value = null
    }

    const { stopDevicePlayback } = devicesManager()
    stopDevicePlayback()
  }

  // 监听视频窗口当前播放时间与播放状态，按事件时间区域同步触发
  let handledVideoSeekVersion = videoSeekVersion.value

  watch(
    () => [
      videoCurrentTime.value,
      isVideoPlaying.value,
      videoSeekVersion.value,
      isVideoScrubbing.value
    ] as const,
    ([currTime, isPlaying]) => {
      if (isVideoScrubbing.value) return

      const didSeek = videoSeekVersion.value !== handledVideoSeekVersion
      if (isPlaying || didSeek) {
        syncActiveEventToVideoTime(currTime, !isPlaying || didSeek)
      }
      handledVideoSeekVersion = videoSeekVersion.value
    }
  )

  return {
    events,
    selectedEventId,
    playingEventId,
    playingEventTriggerId,
    eventPlayProgress,
    isEventRecording,
    toggleEventRecording,
    recordPresetEvent,
    addEvent,
    addEventTimelineTrack,
    removeEventTimelineTrack,
    removeEvent,
    updateEventName,
    updateEventTime,
    updateEventEndTime,
    addEventPresetTrigger,
    updateEventPresetTriggerTime,
    updateEventPresetTriggerTrack,
    removeEventPresetTrigger,
    moveEvent,
    selectEvent,
    triggerEventEffect,
    pauseEventEffect,
    resumeEventEffect,
    stopEventEffect
  }
}

export const useEvents = eventsManager
