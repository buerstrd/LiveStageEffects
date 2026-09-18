import { computed } from 'vue'
import { eventsManager } from '~/composables/eventsmanager'

export interface WindowItem {
  id: string
  title: string
  type?: 'default' | 'settings' | 'bpm' | 'presets' | 'events' | 'project-manager' | 'design' | 'video' | 'terminal'
  x: number
  y: number
  width: number
  height: number
  prevX?: number
  prevY?: number
  prevWidth?: number
  prevHeight?: number
  isMaximized: boolean
  isCollapsed: boolean
  zIndex: number
  isInitialProjectManager?: boolean
}

export type ProjectManagerCloseBehavior = 'default-layout' | 'preserve-layout'

export interface ProjectManagerCloseRequest {
  sequence: number
  behavior: ProjectManagerCloseBehavior
}

export type WorkspaceQuadrantWindowId =
  | 'win-video'
  | 'win-presets'
  | 'win-events'
  | 'win-design'

export type WorkspaceQuadrant = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export type DesignViewMode = 'curve' | 'timeline'

const getWorkspaceSize = () => {
  let width = 1280
  let height = 752

  if (typeof window !== 'undefined') {
    width = window.innerWidth || document.documentElement.clientWidth || width
    height = (window.innerHeight || document.documentElement.clientHeight || 800) - 48
  }

  if (typeof document !== 'undefined') {
    const workspaceElement = document.querySelector('.workspace-area')
    if (workspaceElement) {
      const rect = workspaceElement.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        width = rect.width
        height = rect.height
      }
    }
  }

  return {
    width: Math.max(1, width),
    height: Math.max(1, height)
  }
}

// 计算普通窗口在工作区中间的默认弹出位置
export const getCenteredWindowPos = (width: number, height: number) => {
  const workspace = getWorkspaceSize()
  return {
    x: Math.max(0, Math.round((workspace.width - width) / 2)),
    y: Math.max(0, Math.round((workspace.height - height) / 2)),
    width,
    height
  }
}

// 计算普通窗口在工作区右上角的默认弹出位置
export const getTopRightWindowPos = (width: number, height: number) => {
  const workspace = getWorkspaceSize()
  const margin = 12
  const maxY = Math.max(0, workspace.height - height - margin)
  return {
    x: Math.max(0, Math.round(workspace.width - width - margin)),
    y: Math.min(margin, maxY),
    width,
    height
  }
}

// 计算指定象限的位置与尺寸
export const getWorkspaceQuadrantLayout = (quadrant: WorkspaceQuadrant) => {
  const workspace = getWorkspaceSize()
  const leftWidth = Math.max(1, Math.floor(workspace.width / 2))
  const topHeight = Math.max(1, Math.floor(workspace.height / 2))
  const rightWidth = Math.max(1, workspace.width - leftWidth)
  const bottomHeight = Math.max(1, workspace.height - topHeight)

  const layouts: Record<WorkspaceQuadrant, {
    x: number
    y: number
    width: number
    height: number
  }> = {
    'top-left': { x: 0, y: 0, width: leftWidth, height: topHeight },
    'top-right': { x: leftWidth, y: 0, width: rightWidth, height: topHeight },
    'bottom-left': { x: 0, y: topHeight, width: leftWidth, height: bottomHeight },
    'bottom-right': { x: leftWidth, y: topHeight, width: rightWidth, height: bottomHeight }
  }

  return layouts[quadrant]
}

const WINDOW_QUADRANTS: Record<WorkspaceQuadrantWindowId, WorkspaceQuadrant> = {
  'win-video': 'top-left',
  'win-events': 'top-right',
  'win-design': 'bottom-left',
  'win-presets': 'bottom-right'
}

// 计算四个工作区窗口各自所在象限的位置与尺寸
export const getQuadrantWindowLayout = (windowId: WorkspaceQuadrantWindowId) => {
  return getWorkspaceQuadrantLayout(WINDOW_QUADRANTS[windowId])
}

export const getProjectManagerCenterPos = () => getCenteredWindowPos(560, 400)

// 正在关闭并播放退出动画的窗口 ID 及焦点切换定时器引用
const closingWindowId = ref<string | null>(null)
let closeFocusTimer: ReturnType<typeof setTimeout> | null = null
let projectManagerCloseSequence = 0

export const windowsManager = () => {
  const { isEventRecording } = eventsManager()
  const maxZIndex = useState<number>('max_window_z_index', () => 10)
  const focusedWindowId = useState<string | null>('focused_window_id', () => null)
  const designViewMode = useState<DesignViewMode>('app_design_view_mode', () => 'curve')
  const timelineFollowEnabled = useState<boolean>(
    'design_timeline_follow_enabled',
    () => true
  )
  const windows = useState<WindowItem[]>('app_windows', () => [])
  const isInitialProjectManagerOpen = useState<boolean>(
    'is_initial_project_manager_open',
    () => windows.value.length === 0 || windows.value.some(
      (w) => w.id === 'win-project-manager' && w.isInitialProjectManager
    )
  )
  const projectManagerCloseRequest = useState<ProjectManagerCloseRequest | null>(
    'project_manager_close_request',
    () => null
  )
  const resetWorkspaceLayoutRequest = useState<number>(
    'reset_workspace_layout_request',
    () => 0
  )

  const requestResetWorkspaceLayout = () => {
    resetWorkspaceLayoutRequest.value += 1
  }

  const setDesignViewMode = (mode: DesignViewMode) => {
    designViewMode.value = mode
  }

  const setTimelineFollowEnabled = (enabled: boolean) => {
    timelineFollowEnabled.value = enabled
  }

  const toggleTimelineFollow = () => {
    timelineFollowEnabled.value = !timelineFollowEnabled.value
  }

  // 确保移除历史残留的工作区窗口 1 (支持 HMR 热更新无刷新清除)
  const win1Index = windows.value.findIndex((w) => w.id === 'win-1')
  if (win1Index !== -1) {
    windows.value.splice(win1Index, 1)
  }

  // 设备连接管理与输出设置已迁移至系统设置，清除历史残留窗口 (支持 HMR 热更新无刷新清除)
  const migratedWinIds = ['win-device', 'win-output-settings', 'win-quick-settings']
  if (windows.value.some((w) => migratedWinIds.includes(w.id))) {
    windows.value = windows.value.filter((w) => !migratedWinIds.includes(w.id))
  }

  // 窗口关闭动画播放完成后的焦点顺延结算
  const settleFocusAfterClose = (closedId?: string) => {
    if (closeFocusTimer) {
      clearTimeout(closeFocusTimer)
      closeFocusTimer = null
    }

    if (closedId && closingWindowId.value && closingWindowId.value !== closedId) {
      return
    }

    const currentClosing = closingWindowId.value
    closingWindowId.value = null

    // 仅在焦点依旧停留在刚关闭的窗口上时（即动画播放期间用户未主动切换焦点），才顺延切换给下一层窗口
    if (currentClosing && focusedWindowId.value === currentClosing) {
      if (windows.value.length > 0) {
        const topWin = windows.value.reduce((prev, curr) => (curr.zIndex > prev.zIndex ? curr : prev))
        focusWindow(topWin.id)
      } else {
        focusedWindowId.value = null
      }
    }
  }

  const focusWindow = (id: string) => {
    // 若用户主动点击聚焦了某个窗口，且不是当前退出动画中的窗口，立即结算关闭状态
    if (closeFocusTimer && closingWindowId.value !== id) {
      clearTimeout(closeFocusTimer)
      closeFocusTimer = null
      closingWindowId.value = null
    }

    if (id === 'win-events') {
      setDesignViewMode('timeline')
    } else if (id === 'win-presets' && !isEventRecording.value) {
      setDesignViewMode('curve')
    }

    focusedWindowId.value = id
    const win = windows.value.find((w) => w.id === id)
    if (!win) return
    if (win.zIndex !== maxZIndex.value) {
      maxZIndex.value += 1
      win.zIndex = maxZIndex.value
    }
  }

  const closeWindow = (
    winOrId: WindowItem | string,
    options: { projectManagerCloseBehavior?: ProjectManagerCloseBehavior } = {}
  ) => {
    const id = typeof winOrId === 'string' ? winOrId : winOrId.id
    const index = windows.value.findIndex((w) => w.id === id)
    if (index !== -1) {
      const win = windows.value[index]
      const wasFocused = focusedWindowId.value === id
      if (id === 'win-project-manager' && win?.isInitialProjectManager) {
        isInitialProjectManagerOpen.value = false
        projectManagerCloseRequest.value = {
          sequence: ++projectManagerCloseSequence,
          behavior: options.projectManagerCloseBehavior ?? 'default-layout'
        }
      }
      windows.value.splice(index, 1)

      if (wasFocused) {
        // 记录正在关闭并播放退出动效的窗口，保持其视觉焦点状态，等待关闭动画播放完成后再顺延焦点
        if (closeFocusTimer) {
          clearTimeout(closeFocusTimer)
        }
        closingWindowId.value = id

        // 设置兜底定时器（对应关闭动画 0.16s，兜底 200ms），在动画播放完成后平滑顺延焦点
        closeFocusTimer = setTimeout(() => {
          settleFocusAfterClose(id)
        }, 200)
      }
    }
  }

  const clearProjectManagerCloseRequest = (sequence: number) => {
    if (projectManagerCloseRequest.value?.sequence === sequence) {
      projectManagerCloseRequest.value = null
    }
  }

  const closeProjectManagerWindow = (
    behavior: ProjectManagerCloseBehavior = 'default-layout'
  ) => {
    closeWindow('win-project-manager', {
      projectManagerCloseBehavior: behavior
    })
  }

  const isSettingsOpen = computed(() => {
    return windows.value.some((w) => w.id === 'win-settings')
  })

  const isBpmOpen = computed(() => {
    return windows.value.some((w) => w.id === 'win-bpm')
  })

  const isPresetsOpen = computed(() => {
    return windows.value.some((w) => w.id === 'win-presets')
  })

  const isEventsOpen = computed(() => {
    return windows.value.some((w) => w.id === 'win-events')
  })

  const isProjectManagerOpen = computed(() => {
    return windows.value.some((w) => w.id === 'win-project-manager')
  })

  const isDesignOpen = computed(() => {
    return windows.value.some((w) => w.id === 'win-design')
  })

  const isVideoOpen = computed(() => {
    return windows.value.some((w) => w.id === 'win-video')
  })

  const isTerminalOpen = computed(() => {
    return windows.value.some((w) => w.id === 'win-terminal' || w.type === 'terminal')
  })

  const openSettingsWindow = () => {
    if (isInitialProjectManagerOpen.value) return
    const existing = windows.value.find((w) => w.id === 'win-settings')
    if (existing) {
      if (existing.isCollapsed) {
        existing.isCollapsed = false
      }
      focusWindow('win-settings')
    } else {
      const width = 740
      const height = 520
      const layout = getCenteredWindowPos(width, height)
      maxZIndex.value += 1
      windows.value.push({
        id: 'win-settings',
        title: '设置',
        type: 'settings',
        x: layout.x,
        y: layout.y,
        width,
        height,
        isMaximized: false,
        isCollapsed: false,
        zIndex: maxZIndex.value
      })
      focusWindow('win-settings')
    }
  }

  const openBpmWindow = () => {
    if (isInitialProjectManagerOpen.value) return
    const existing = windows.value.find((w) => w.id === 'win-bpm')
    if (existing) {
      if (existing.isCollapsed) {
        existing.isCollapsed = false
      }
      existing.width = Math.max(existing.width, 400)
      existing.height = Math.max(existing.height, 280)
      focusWindow('win-bpm')
    } else {
      const width = 420
      const height = 300
      const layout = getTopRightWindowPos(width, height)
      maxZIndex.value += 1
      windows.value.push({
        id: 'win-bpm',
        title: 'BPM 识别',
        type: 'bpm',
        x: layout.x,
        y: layout.y,
        width,
        height,
        isMaximized: false,
        isCollapsed: false,
        zIndex: maxZIndex.value
      })
      focusWindow('win-bpm')
    }
  }

  const openPresetsWindow = () => {
    if (isInitialProjectManagerOpen.value) return
    const existing = windows.value.find((w) => w.id === 'win-presets')
    if (existing) {
      if (existing.isCollapsed) {
        existing.isCollapsed = false
      }
      focusWindow('win-presets')
    } else {
      const layout = getQuadrantWindowLayout('win-presets')
      maxZIndex.value += 1
      windows.value.push({
        id: 'win-presets',
        title: '预设',
        type: 'presets',
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        isMaximized: false,
        isCollapsed: false,
        zIndex: maxZIndex.value
      })
      focusWindow('win-presets')
    }
  }

  const openEventsWindow = () => {
    if (isInitialProjectManagerOpen.value) return
    const existing = windows.value.find((w) => w.id === 'win-events')
    if (existing) {
      if (existing.isCollapsed) {
        existing.isCollapsed = false
      }
      focusWindow('win-events')
    } else {
      const layout = getQuadrantWindowLayout('win-events')
      maxZIndex.value += 1
      windows.value.push({
        id: 'win-events',
        title: '事件',
        type: 'events',
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        isMaximized: false,
        isCollapsed: false,
        zIndex: maxZIndex.value
      })
      focusWindow('win-events')
    }
  }

  const openProjectManagerWindow = (options: { center?: boolean; initial?: boolean } = {}) => {
    const centerPos = getProjectManagerCenterPos()
    const existing = windows.value.find((w) => w.id === 'win-project-manager')
    if (existing) {
      if (options.initial) {
        existing.isInitialProjectManager = true
        isInitialProjectManagerOpen.value = true
      }
      if (existing.isCollapsed) {
        existing.isCollapsed = false
      }
      if (options.center) {
        existing.x = centerPos.x
        existing.y = centerPos.y
      }
      focusWindow('win-project-manager')
    } else {
      const layout = centerPos
      if (options.initial) {
        isInitialProjectManagerOpen.value = true
      }
      maxZIndex.value += 1
      windows.value.push({
        id: 'win-project-manager',
        title: '项目',
        type: 'project-manager',
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        isMaximized: false,
        isCollapsed: false,
        zIndex: maxZIndex.value,
        isInitialProjectManager: options.initial === true
      })
      focusWindow('win-project-manager')
    }
  }

  const openDesignWindow = () => {
    if (isInitialProjectManagerOpen.value) return
    const existing = windows.value.find((w) => w.id === 'win-design')
    if (existing) {
      if (existing.isCollapsed) {
        existing.isCollapsed = false
      }
      focusWindow('win-design')
    } else {
      const layout = getQuadrantWindowLayout('win-design')
      maxZIndex.value += 1
      windows.value.push({
        id: 'win-design',
        title: '设计',
        type: 'design',
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        isMaximized: false,
        isCollapsed: false,
        zIndex: maxZIndex.value
      })
      focusWindow('win-design')
    }
  }

  const openVideoWindow = () => {
    if (isInitialProjectManagerOpen.value) return
    const existing = windows.value.find((w) => w.id === 'win-video')
    if (existing) {
      if (existing.isCollapsed) {
        existing.isCollapsed = false
      }
      focusWindow('win-video')
    } else {
      const layout = getQuadrantWindowLayout('win-video')
      maxZIndex.value += 1
      windows.value.push({
        id: 'win-video',
        title: '视频',
        type: 'video',
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        isMaximized: false,
        isCollapsed: false,
        zIndex: maxZIndex.value
      })
      focusWindow('win-video')
    }
  }

  const openTerminalWindow = () => {
    if (isInitialProjectManagerOpen.value) return
    const existing = windows.value.find((w) => w.id === 'win-terminal' || w.type === 'terminal')
    if (existing) {
      if (existing.isCollapsed) {
        existing.isCollapsed = false
      }
      focusWindow(existing.id)
    } else {
      const width = 680
      const height = 440
      const layout = getCenteredWindowPos(width, height)
      maxZIndex.value += 1
      windows.value.push({
        id: 'win-terminal',
        title: '指令',
        type: 'terminal',
        x: layout.x,
        y: layout.y,
        width,
        height,
        isMaximized: false,
        isCollapsed: false,
        zIndex: maxZIndex.value
      })
      focusWindow('win-terminal')
    }
  }

  return {
    windows,
    maxZIndex,
    focusedWindowId,
    designViewMode,
    timelineFollowEnabled,
    setDesignViewMode,
    setTimelineFollowEnabled,
    toggleTimelineFollow,
    closingWindowId,
    focusWindow,
    closeWindow,
    closeProjectManagerWindow,
    projectManagerCloseRequest,
    clearProjectManagerCloseRequest,
    resetWorkspaceLayoutRequest,
    requestResetWorkspaceLayout,
    settleFocusAfterClose,
    isSettingsOpen,
    isBpmOpen,
    isPresetsOpen,
    isEventsOpen,
    isProjectManagerOpen,
    isInitialProjectManagerOpen,
    isDesignOpen,
    isVideoOpen,
    isTerminalOpen,
    openSettingsWindow,
    openBpmWindow,
    openPresetsWindow,
    openEventsWindow,
    openProjectManagerWindow,
    openDesignWindow,
    openVideoWindow,
    openTerminalWindow
  }
}

export const useWindows = windowsManager
