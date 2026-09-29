import { computed } from 'vue'
import { createDefaultColorCalibration, type RgbColorCalibration } from '~/composables/outputsettingsmanager'
import {
  normalizeCurveTemplate,
  normalizePresetItem,
  type PresetCurveTemplate,
  type PresetItem
} from '~/utils/presetcurve'
import { videoManager } from '~/composables/videomanager'

export const PROJECT_FORMAT_VERSION = '1.0'

export interface ProjectWindowLayout {
  items: any[]
  focusedWindowId: string | null
  maxZIndex: number
}

export interface ProjectVideoData {
  path: string
  fileName: string
  currentTime: number
  volume: number
  muted: boolean
}

export interface ProjectSettingsData {
  showSeconds?: boolean
  statusBarBeatIndicator?: boolean
  globalBrightness?: number
  colorCalibration?: RgbColorCalibration
  wirelessDelayCompensation?: number
  compatibilityMode?: boolean
  [key: string]: any
}

export interface ProjectWorkspaceData {
  selectedEventId?: number | null
  selectedPresetId?: number | null
  timelineFollowEnabled?: boolean
  presetCardSize?: number
  timelineZoom?: number
  timelineVerticalZoom?: number
  historyColors?: string[]
  curveTemplates?: PresetCurveTemplate[]
  settingsCategoryId?: string
  presetGridScrollTop?: number
  timelineScrollLeft?: number
  timelineTracksScrollTop?: number
}

export interface ProjectDataPayload {
  events?: any[]
  windows?: ProjectWindowLayout
  video?: ProjectVideoData
  settings?: ProjectSettingsData
  workspace?: ProjectWorkspaceData
  [key: string]: any
}

export interface ProjectData {
  format: 'lseproj'
  version: typeof PROJECT_FORMAT_VERSION
  name: string
  createdAt: string
  updatedAt: string
  data: ProjectDataPayload
}

const normalizeCurveTemplateList = (templates: unknown[]): PresetCurveTemplate[] => (
  templates
    .map((template, index) => normalizeCurveTemplate(template, index))
    .filter((template): template is PresetCurveTemplate => template !== null)
)

export const projectManager = () => {
  const currentProject = useState<ProjectData | null>('current_project', () => null)
  const isProjectLoaded = computed(() => !!currentProject.value)

  const cloneData = <T>(value: T): T => {
    return value == null ? value : JSON.parse(JSON.stringify(value))
  }

  const collectProjectData = (): ProjectDataPayload => {
    const events = useState<any[]>('app_events_list', () => [])
    const windows = useState<any[]>('app_windows', () => [])
    const focusedWindowId = useState<string | null>('focused_window_id', () => null)
    const maxZIndex = useState<number>('max_window_z_index', () => 10)
    const showSeconds = useState<boolean>('settings_time_show_seconds', () => false)
    const statusBarBeatIndicator = useState<boolean>(
      'settings_status_bar_beat_indicator',
      () => false
    )
    const globalBrightness = useState<number>('output_global_brightness', () => 100)
    const colorCalibration = useState<RgbColorCalibration>('output_color_calibration', createDefaultColorCalibration)
    const wirelessDelayCompensation = useState<number>('output_wireless_delay_compensation', () => 0)
    const compatibilityMode = useState<boolean>('output_compatibility_mode', () => false)
    const selectedEventId = useState<number | null>('app_selected_event_id', () => null)
    const selectedPresetId = useState<number | null>('app_selected_preset_id', () => null)
    const timelineFollowEnabled = useState<boolean>(
      'design_timeline_follow_enabled',
      () => true
    )
    const presetCardSize = useState<number>('presets_card_size', () => 96)
    const timelineZoom = useState<number>('design_timeline_zoom', () => 1)
    const timelineVerticalZoom = useState<number>('design_timeline_vertical_zoom', () => 1)
    const historyColors = useState<string[]>('design_history_colors', () => [])
    const curveTemplates = useState<PresetCurveTemplate[]>('design_curve_templates', () => [])
    const settingsCategoryId = useState<string>('settings_current_category', () => 'display')
    const presetGridScrollTop = useState<number>('presets_grid_scroll_top', () => 0)
    const timelineScrollLeft = useState<number>('design_timeline_scroll_left', () => 0)
    const timelineTracksScrollTop = useState<number>(
      'design_timeline_tracks_scroll_top',
      () => 0
    )
    const {
      videoFileName,
      videoFilePath,
      currentTime,
      volume,
      isMuted
    } = videoManager()

    const savedWindows = windows.value
      .filter(windowItem => windowItem.id !== 'win-project-manager')
      .map(windowItem => cloneData(windowItem))
    const savedFocusedWindowId = savedWindows.some(windowItem => windowItem.id === focusedWindowId.value)
      ? focusedWindowId.value
      : savedWindows[savedWindows.length - 1]?.id ?? null
    const normalizedEvents = events.value.map(eventItem => {
      const presetTriggers = Array.isArray(eventItem.presetTriggers)
        ? eventItem.presetTriggers
        : []
      const eventPresets = Array.isArray(eventItem.presets)
        ? eventItem.presets.map((preset: PresetItem, index: number) => {
            const normalized = normalizePresetItem(preset, index)
            return {
              ...normalized,
              name: `${eventItem.id}-${normalized.id}`
            }
          })
        : []
      return {
        id: eventItem.id,
        name: eventItem.name,
        time: typeof eventItem.time === 'string' ? eventItem.time : '',
        endTime: typeof eventItem.endTime === 'string' ? eventItem.endTime : '',
        presets: cloneData(eventPresets),
        presetTriggers: presetTriggers.map((trigger: any) => ({
          ...cloneData(trigger),
          ...(Number.isFinite(trigger?.duration)
            ? { duration: Math.round(Number(trigger.duration)) }
            : {})
        })),
        timelineTrackCount: Math.max(
          0,
          eventItem.timelineTrackCount ?? 0,
          ...presetTriggers.map((trigger: any) => (
            Number.isInteger(trigger?.track) && trigger.track >= 0
              ? trigger.track + 1
              : 0
          ))
        )
      }
    })

    return {
      events: normalizedEvents,
      windows: {
        items: savedWindows,
        focusedWindowId: savedFocusedWindowId,
        maxZIndex: maxZIndex.value
      },
      video: {
        path: videoFilePath.value,
        fileName: videoFileName.value,
        currentTime: currentTime.value,
        volume: volume.value,
        muted: isMuted.value
      },
      settings: {
        ...(currentProject.value?.data?.settings || {}),
        showSeconds: showSeconds.value,
        statusBarBeatIndicator: statusBarBeatIndicator.value,
        globalBrightness: globalBrightness.value,
        colorCalibration: cloneData(colorCalibration.value),
        wirelessDelayCompensation: wirelessDelayCompensation.value,
        compatibilityMode: compatibilityMode.value
      },
      workspace: {
        selectedEventId: selectedEventId.value,
        selectedPresetId: selectedPresetId.value,
        timelineFollowEnabled: timelineFollowEnabled.value,
        presetCardSize: presetCardSize.value,
        timelineZoom: timelineZoom.value,
        timelineVerticalZoom: timelineVerticalZoom.value,
        historyColors: cloneData(historyColors.value),
        curveTemplates: normalizeCurveTemplateList(curveTemplates.value),
        settingsCategoryId: settingsCategoryId.value,
        presetGridScrollTop: presetGridScrollTop.value,
        timelineScrollLeft: timelineScrollLeft.value,
        timelineTracksScrollTop: timelineTracksScrollTop.value
      }
    }
  }

  const restoreProjectData = (project: ProjectData) => {
    const data = project.data || {}
    const events = useState<any[]>('app_events_list', () => [])
    const windows = useState<any[]>('app_windows', () => [])
    const focusedWindowId = useState<string | null>('focused_window_id', () => null)
    const maxZIndex = useState<number>('max_window_z_index', () => 10)
    const showSeconds = useState<boolean>('settings_time_show_seconds', () => false)
    const statusBarBeatIndicator = useState<boolean>(
      'settings_status_bar_beat_indicator',
      () => false
    )
    const globalBrightness = useState<number>('output_global_brightness', () => 100)
    const colorCalibration = useState<RgbColorCalibration>('output_color_calibration', createDefaultColorCalibration)
    const wirelessDelayCompensation = useState<number>('output_wireless_delay_compensation', () => 0)
    const compatibilityMode = useState<boolean>('output_compatibility_mode', () => false)
    const selectedEventId = useState<number | null>('app_selected_event_id', () => null)
    const selectedPresetId = useState<number | null>('app_selected_preset_id', () => null)
    const timelineFollowEnabled = useState<boolean>(
      'design_timeline_follow_enabled',
      () => true
    )
    const presetCardSize = useState<number>('presets_card_size', () => 96)
    const timelineZoom = useState<number>('design_timeline_zoom', () => 1)
    const timelineVerticalZoom = useState<number>('design_timeline_vertical_zoom', () => 1)
    const historyColors = useState<string[]>('design_history_colors', () => [])
    const curveTemplates = useState<PresetCurveTemplate[]>('design_curve_templates', () => [])
    const settingsCategoryId = useState<string>('settings_current_category', () => 'display')
    const presetGridScrollTop = useState<number>('presets_grid_scroll_top', () => 0)
    const timelineScrollLeft = useState<number>('design_timeline_scroll_left', () => 0)
    const timelineTracksScrollTop = useState<number>(
      'design_timeline_tracks_scroll_top',
      () => 0
    )
    const workspaceRestoreVersion = useState<number>(
      'project_workspace_restore_version',
      () => 0
    )
    const {
      closeVideo,
      videoFileName,
      videoFilePath,
      currentTime,
      volume,
      isMuted
    } = videoManager()

    if (Array.isArray(data.events)) {
      events.value = cloneData(data.events).map((eventItem: any, index: number) => {
        const eventId = typeof eventItem?.id === 'number' ? eventItem.id : index + 1
        const eventPresets = Array.isArray(eventItem?.presets)
          ? eventItem.presets.map((preset: PresetItem, presetIndex: number) => {
              const normalized = normalizePresetItem(preset, presetIndex)
              return {
                ...normalized,
                name: `${eventId}-${normalized.id}`
              }
            })
          : []
        return {
          ...eventItem,
          id: eventId,
          presets: eventPresets,
          presetTriggers: Array.isArray(eventItem?.presetTriggers)
            ? cloneData(eventItem.presetTriggers)
            : []
        }
      })
    }
    if (data.settings) {
      showSeconds.value = typeof data.settings.showSeconds === 'boolean'
        ? data.settings.showSeconds
        : false
      statusBarBeatIndicator.value = typeof data.settings.statusBarBeatIndicator === 'boolean'
        ? data.settings.statusBarBeatIndicator
        : false
      globalBrightness.value = typeof data.settings.globalBrightness === 'number'
        ? Math.max(0, Math.min(100, Math.round(data.settings.globalBrightness)))
        : 100
      wirelessDelayCompensation.value = typeof data.settings.wirelessDelayCompensation === 'number'
        ? Math.max(-500, Math.min(500, Math.round(data.settings.wirelessDelayCompensation)))
        : 0
      compatibilityMode.value = typeof data.settings.compatibilityMode === 'boolean'
        ? data.settings.compatibilityMode
        : false
      const savedCalibration = data.settings.colorCalibration
      if (savedCalibration && typeof savedCalibration === 'object') {
        const defaults = createDefaultColorCalibration()
        colorCalibration.value = {
          r: Number.isFinite(savedCalibration.r)
            ? Math.max(0, Math.min(200, Math.round(savedCalibration.r)))
            : defaults.r,
          g: Number.isFinite(savedCalibration.g)
            ? Math.max(0, Math.min(200, Math.round(savedCalibration.g)))
            : defaults.g,
          b: Number.isFinite(savedCalibration.b)
            ? Math.max(0, Math.min(200, Math.round(savedCalibration.b)))
            : defaults.b
        }
      } else {
        colorCalibration.value = createDefaultColorCalibration()
      }
    } else {
      showSeconds.value = false
      statusBarBeatIndicator.value = false
      globalBrightness.value = 100
      colorCalibration.value = createDefaultColorCalibration()
      wirelessDelayCompensation.value = 0
      compatibilityMode.value = false
    }

    closeVideo()
    if (data.video) {
      videoFilePath.value = typeof data.video.path === 'string' ? data.video.path : ''
      videoFileName.value = typeof data.video.fileName === 'string' ? data.video.fileName : ''
      currentTime.value = Number.isFinite(data.video.currentTime) ? Math.max(0, data.video.currentTime) : 0
      volume.value = Number.isFinite(data.video.volume) ? Math.max(0, Math.min(1, data.video.volume)) : 1
      isMuted.value = Boolean(data.video.muted)
    } else {
      videoFilePath.value = ''
      videoFileName.value = ''
      currentTime.value = 0
      volume.value = 1
      isMuted.value = false
    }

    if (data.windows && Array.isArray(data.windows.items)) {
      const projectManagerWindow = windows.value.find(windowItem => windowItem.id === 'win-project-manager')
      const restoredWindows = data.windows.items
        .filter(windowItem => windowItem?.id && windowItem.id !== 'win-project-manager')
        .map(windowItem => cloneData(windowItem))
      const nextWindows = projectManagerWindow
        ? [...restoredWindows, projectManagerWindow]
        : restoredWindows

      windows.value = nextWindows
      focusedWindowId.value = projectManagerWindow
        ? projectManagerWindow.id
        : (typeof data.windows.focusedWindowId === 'string' && nextWindows.some(windowItem => windowItem.id === data.windows?.focusedWindowId)
            ? data.windows.focusedWindowId
            : nextWindows[nextWindows.length - 1]?.id ?? null)
      maxZIndex.value = Math.max(
        10,
        Number(data.windows.maxZIndex) || 0,
        ...nextWindows.map(windowItem => Number(windowItem.zIndex) || 0)
      )
    }

    const workspace = data.workspace
    const savedSelectedEventId = workspace?.selectedEventId
    selectedEventId.value = (
      typeof savedSelectedEventId === 'number' &&
      events.value.some(eventItem => eventItem.id === savedSelectedEventId)
    )
      ? savedSelectedEventId
      : null

    const savedSelectedPresetId = workspace?.selectedPresetId
    const selectedEvent = selectedEventId.value === null
      ? null
      : events.value.find(eventItem => eventItem.id === selectedEventId.value) ?? null
    selectedPresetId.value = (
      typeof savedSelectedPresetId === 'number' &&
      Array.isArray(selectedEvent?.presets) &&
      selectedEvent.presets.some((preset: PresetItem) => preset.id === savedSelectedPresetId)
    )
      ? savedSelectedPresetId
      : null

    const savedTimelineFollowEnabled = workspace?.timelineFollowEnabled
    timelineFollowEnabled.value = typeof savedTimelineFollowEnabled === 'boolean'
      ? savedTimelineFollowEnabled
      : true
    presetCardSize.value = Number.isFinite(workspace?.presetCardSize)
      ? Math.max(64, Math.min(160, Math.round(Number(workspace?.presetCardSize))))
      : 96
    timelineZoom.value = Number.isFinite(workspace?.timelineZoom)
      ? Math.max(1, Number(workspace?.timelineZoom))
      : 1
    timelineVerticalZoom.value = Number.isFinite(workspace?.timelineVerticalZoom)
      ? Math.max(0.75, Math.min(2.5, Number(workspace?.timelineVerticalZoom)))
      : 1
    const savedHistoryColors = workspace?.historyColors
    historyColors.value = Array.isArray(savedHistoryColors)
      ? savedHistoryColors
          .filter((color): color is string => typeof color === 'string')
          .slice(0, 15)
      : []
    const savedCurveTemplates = workspace?.curveTemplates
    curveTemplates.value = Array.isArray(savedCurveTemplates)
      ? normalizeCurveTemplateList(savedCurveTemplates)
      : []

    const savedSettingsCategoryId = workspace?.settingsCategoryId
    settingsCategoryId.value = (
      typeof savedSettingsCategoryId === 'string' &&
      ['display', 'presets', 'device', 'developer', 'about'].includes(savedSettingsCategoryId)
    )
      ? savedSettingsCategoryId
      : 'display'

    presetGridScrollTop.value = Number.isFinite(workspace?.presetGridScrollTop)
      ? Math.max(0, Number(workspace?.presetGridScrollTop))
      : 0
    timelineScrollLeft.value = Number.isFinite(workspace?.timelineScrollLeft)
      ? Math.max(0, Number(workspace?.timelineScrollLeft))
      : 0
    timelineTracksScrollTop.value = Number.isFinite(workspace?.timelineTracksScrollTop)
      ? Math.max(0, Number(workspace?.timelineTracksScrollTop))
      : 0
    workspaceRestoreVersion.value += 1

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('lse_history_colors', JSON.stringify(historyColors.value))
        localStorage.setItem('lse_curve_templates', JSON.stringify(curveTemplates.value))
      } catch {
        // Project loading should still succeed when browser storage is unavailable.
      }
    }
  }

  // 触发 .lseproj 文件下载
  const downloadProjectFile = (proj: ProjectData) => {
    if (typeof window === 'undefined') return

    const jsonContent = JSON.stringify(proj, null, 2)
    const blob = new Blob([jsonContent], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const filename = proj.name.trim().endsWith('.lseproj')
      ? proj.name.trim()
      : `${proj.name.trim()}.lseproj`

    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // 新建工程
  const createProject = (name: string): ProjectData => {
    const cleanName = name.trim() || '未命名工程'
    const now = new Date().toISOString()
    const newProj: ProjectData = {
      format: 'lseproj',
      version: PROJECT_FORMAT_VERSION,
      name: cleanName,
      createdAt: now,
      updatedAt: now,
      data: {
        events: [],
        settings: {}
      }
    }

    currentProject.value = newProj
    restoreProjectData(newProj)
    newProj.data = collectProjectData()
    newProj.updatedAt = now

    return newProj
  }

  // 保存当前工程状态并触发 .lseproj 文件下载
  const saveProject = (): ProjectData => {
    const now = new Date().toISOString()
    const baseProject: ProjectData = currentProject.value ?? {
      format: 'lseproj',
      version: PROJECT_FORMAT_VERSION,
      name: '未命名临时项目',
      createdAt: now,
      updatedAt: now,
      data: {}
    }
    const savedProject: ProjectData = {
      ...baseProject,
      version: PROJECT_FORMAT_VERSION,
      updatedAt: now,
      data: collectProjectData()
    }
    currentProject.value = savedProject
    downloadProjectFile(savedProject)
    return savedProject
  }

  // 从本地文件加载工程
  const openProjectFromFile = async (file: File): Promise<ProjectData> => {
    const text = await file.text()
    let parsed: any

    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('无法解析该文件，其内容不是有效的 JSON 格式')
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.format !== 'lseproj' ||
      !parsed.data ||
      typeof parsed.data !== 'object'
    ) {
      throw new Error('文件不是有效的 LiveStage 工程')
    }

    if (parsed.version !== PROJECT_FORMAT_VERSION) {
      throw new Error(`仅支持 ${PROJECT_FORMAT_VERSION} 格式工程`)
    }

    const defaultName = file.name.replace(/\.lseproj$/i, '')
    const proj: ProjectData = {
      format: 'lseproj',
      version: PROJECT_FORMAT_VERSION,
      name: parsed.name || defaultName || '已加载工程',
      createdAt: parsed.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: parsed.data || {}
    }

    currentProject.value = proj
    restoreProjectData(proj)
    return proj
  }

  // 关闭/重置当前工程
  const closeProject = () => {
    currentProject.value = null
  }

  return {
    currentProject,
    isProjectLoaded,
    createProject,
    saveProject,
    openProjectFromFile,
    downloadProjectFile,
    closeProject
  }
}

export const useProject = projectManager
