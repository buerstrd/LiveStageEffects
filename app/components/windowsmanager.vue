<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import {
  getCenteredWindowPos,
  getQuadrantWindowLayout,
  getWorkspaceQuadrantLayout,
  type WindowItem,
  type WorkspaceQuadrant,
  type WorkspaceQuadrantWindowId
} from '~/composables/windowsmanager'
import DesignContent from '~/components/designcontent.vue'
import BpmContent from '~/components/bpmcontent.vue'
import EventsContent from '~/components/eventscontent.vue'
import PresetsContent from '~/components/presetscontent.vue'
import ProjectManagerContent from '~/components/projectmanagercontent.vue'
import VideoContent from '~/components/videocontent.vue'
import TerminalContent from '~/components/terminalcontent.vue'
import WindowTitle from '~/components/windowtitle.vue'
import { useRealtimeBpm } from '~/composables/bpmanalyzer'
import { eventsManager } from '~/composables/eventsmanager'
import { presetsManager } from '~/composables/presetsmanager'
import { videoManager } from '~/composables/videomanager'
import { windowsManager } from '~/composables/windowsmanager'

const {
  windows,
  maxZIndex,
  focusedWindowId,
  timelineFollowEnabled,
  focusWindow,
  closeWindow,
  projectManagerCloseRequest,
  clearProjectManagerCloseRequest,
  resetWorkspaceLayoutRequest,
  isInitialProjectManagerOpen,
  settleFocusAfterClose,
  toggleTimelineFollow,
  openProjectManagerWindow
} = windowsManager()
const {
  events,
  selectedEventId,
  isEventRecording,
  toggleEventRecording,
  addEvent,
  addEventPreset,
  addEventTimelineTrack,
  removeEventTimelineTrack,
  stopEventEffect
} = eventsManager()
const {
  editingPresetId
} = presetsManager()
const { resetBeatGridAnalysis } = useRealtimeBpm()
const isPresetCurveEditing = computed(() => editingPresetId.value !== null)
const {
  videoTitle,
  videoSrc,
  isVideoPlaying,
  isVideoStopped,
  isMuted: isVideoMuted,
  currentTime,
  seekVideo,
  beginScrubSeek,
  seekVideoScrub,
  endScrubSeek,
  cancelScrubSeek,
  toggleVideoPlay,
  stopVideo,
  closeVideo,
  openFileDialog: openVideoFileDialog,
  toggleVideoMute
} = videoManager()

const getWindowTitle = (win: WindowItem) => {
  if (win.type === 'design') {
    const selectedEvent = selectedEventId.value === null
      ? null
      : events.value.find(event => event.id === selectedEventId.value)
    return selectedEvent
      ? `设计 - ${selectedEvent.name || '事件'}`
      : '设计'
  }
  if (win.type === 'video') {
    return videoTitle.value
  }
  return win.title
}

const getWindowTitleMeasureText = (win: WindowItem) => {
  const title = getWindowTitle(win)
  if (win.type !== 'video') return title
  return title.replace(/\d/g, '0')
}

const hasDesignSelection = computed(() => selectedEventId.value !== null)

const handleResetBeatGrid = (win: WindowItem) => {
  if (win.isCollapsed) {
    win.isCollapsed = false
  }
  focusWindow(win.id)
  resetBeatGridAnalysis()
}

const handleToggleVideoPlay = (win: WindowItem) => {
  if (win.isCollapsed) {
    win.isCollapsed = false
  }
  focusWindow(win.id)
  toggleVideoPlay()
}

const handleStopVideo = (win: WindowItem) => {
  focusWindow(win.id)
  stopEventEffect()
  if (isVideoStopped.value) {
    closeVideo()
    return
  }
  stopVideo()
}

const handleOpenVideoFile = (win: WindowItem) => {
  if (win.isCollapsed) {
    win.isCollapsed = false
  }
  focusWindow(win.id)
  openVideoFileDialog()
}

const VIDEO_SEEK_STEP_SECONDS = 0.5

const handleSeekVideoBy = (win: WindowItem, offsetSeconds: number) => {
  if (win.isCollapsed) {
    win.isCollapsed = false
  }
  focusWindow(win.id)
  seekVideo(currentTime.value + offsetSeconds)
}

let videoSeekRepeatTimer: ReturnType<typeof setInterval> | null = null
let videoSeekScrubTarget = 0
let isVideoSeekScrubbing = false

const stopVideoSeekRepeat = () => {
  if (videoSeekRepeatTimer !== null) {
    clearInterval(videoSeekRepeatTimer)
    videoSeekRepeatTimer = null
  }
}

const finishVideoSeekRepeat = () => {
  stopVideoSeekRepeat()
  if (!isVideoSeekScrubbing) return

  isVideoSeekScrubbing = false
  endScrubSeek(videoSeekScrubTarget)
}

const handleSeekVideoRepeatStart = (
  win: WindowItem,
  offsetSeconds: number,
  event: PointerEvent
) => {
  if (event.button !== 0) return

  stopVideoSeekRepeat()
  if (isVideoSeekScrubbing) {
    isVideoSeekScrubbing = false
    cancelScrubSeek()
  }

  if (win.isCollapsed) {
    win.isCollapsed = false
  }
  focusWindow(win.id)

  videoSeekScrubTarget = beginScrubSeek(currentTime.value + offsetSeconds)
  isVideoSeekScrubbing = true
  videoSeekRepeatTimer = setInterval(() => {
    videoSeekScrubTarget = seekVideoScrub(videoSeekScrubTarget + offsetSeconds)
  }, 100)
}

const handleSeekVideoClick = (
  win: WindowItem,
  offsetSeconds: number,
  event: MouseEvent
) => {
  // Pointer presses are handled by pointerdown; only keyboard-triggered clicks seek here.
  if (event.detail !== 0) return
  handleSeekVideoBy(win, offsetSeconds)
}

const handleToggleVideoMute = (win: WindowItem) => {
  focusWindow(win.id)
  toggleVideoMute()
}

const handleToggleEventRecording = (win: WindowItem) => {
  if (selectedEventId.value === null) return
  if (win.isCollapsed) {
    win.isCollapsed = false
  }
  focusWindow(win.id)
  toggleEventRecording()
}

const handleAddTimelineTrack = (win: WindowItem) => {
  if (selectedEventId.value === null) return
  if (win.isCollapsed) {
    win.isCollapsed = false
  }
  focusWindow(win.id)
  addEventTimelineTrack(selectedEventId.value)
}

const handleRemoveTimelineTrack = (win: WindowItem) => {
  if (selectedEventId.value === null) return
  if (win.isCollapsed) {
    win.isCollapsed = false
  }
  focusWindow(win.id)
  removeEventTimelineTrack(selectedEventId.value)
}

const handleToggleTimelineFollow = (win: WindowItem) => {
  if (win.isCollapsed) {
    win.isCollapsed = false
  }
  focusWindow(win.id)
  toggleTimelineFollow()
}

const handleAddPreset = (win: WindowItem) => {
  if (isPresetCurveEditing.value) return
  if (win.isCollapsed) {
    win.isCollapsed = false
  }
  focusWindow(win.id)
  if (selectedEventId.value === null) return
  addEventPreset(selectedEventId.value)
}

const handleAddEvent = (win: WindowItem) => {
  if (win.isCollapsed) {
    win.isCollapsed = false
  }
  focusWindow(win.id)
  addEvent()
}

const SNAP_THRESHOLD = 14
const SNAP_STICK_THRESHOLD = 16 // 贴上吸住后的脱离阻力阈值
const COLLAPSED_HEIGHT = 45 // 窗口折叠收起时的像素高度（与 44px 标题栏+1px 边框完全对齐，杜绝 1px 位移）
const workspaceRef = ref<HTMLDivElement | null>(null)

// 用户拖拽窗口移动与拉伸调整大小时，零延迟跟手状态跟踪
const draggingWinId = ref<string | null>(null)
const resizingWinId = ref<string | null>(null)
const isQuadrantLayoutActive = ref(false)
const dragCornerPreview = ref<WorkspaceQuadrant | null>(null)

// 拖拽窗口移动
let activeDragWin: WindowItem | null = null
let dragStartX = 0
let dragStartY = 0
let winStartX = 0
let winStartY = 0
let hasDragged = false

// 记录当前拖拽窗口吸附住的坐标偏移锚点（粘性磁吸）
let lockedSnapOffsetX: number | null = null
let lockedSnapOffsetY: number | null = null

const startDrag = (event: PointerEvent, win: WindowItem) => {
  // 最大化时禁止拖拽
  if (win.isMaximized) return

  isQuadrantLayoutActive.value = false
  focusWindow(win.id)
  activeDragWin = win
  draggingWinId.value = win.id
  dragStartX = event.clientX
  dragStartY = event.clientY
  winStartX = win.x
  winStartY = win.y
  hasDragged = false
  dragCornerPreview.value = null
  lockedSnapOffsetX = null
  lockedSnapOffsetY = null

  window.addEventListener('pointermove', onDragging)
  window.addEventListener('pointerup', stopDrag)
}

// 检查轴向区间是否重合（相交或相切）
const isRangeOverlap = (
  min1: number,
  max1: number,
  min2: number,
  max2: number,
  margin: number = 4
) => {
  return max1 >= min2 - margin && min1 <= max2 + margin
}

// 计算窗口位移时的磁吸位置（无隔空吸引，仅贴上/碰到后粘住）
const calculateSnapPosition = (
  rawX: number,
  rawY: number,
  currentWin: WindowItem,
  workspaceRect: DOMRect
) => {
  let nextX = rawX
  let nextY = rawY
  const stickThreshold = SNAP_STICK_THRESHOLD

  const winW = currentWin.width
  const winH = currentWin.isCollapsed ? COLLAPSED_HEIGHT : currentWin.height

  // 水平方向判断
  let candidateSnapX: number | null = null
  let minDiffX = Infinity

  // 垂直方向判断
  let candidateSnapY: number | null = null
  let minDiffY = Infinity

  // 1. 工作区四周边界：无隔空吸附，仅当碰到/穿过边界时吸附并维持粘性
  // 顶部边缘（y = 0）
  if (rawY <= 0 && rawY >= -stickThreshold) {
    minDiffY = Math.abs(rawY)
    candidateSnapY = 0
  }
  // 左侧边缘（x = 0）
  if (rawX <= 0 && rawX >= -stickThreshold) {
    minDiffX = Math.abs(rawX)
    candidateSnapX = 0
  }
  // 右侧边缘（x + winW = workspaceWidth）
  const diffRightEdge = (rawX + winW) - workspaceRect.width
  if (diffRightEdge >= 0 && diffRightEdge <= stickThreshold && Math.abs(diffRightEdge) < minDiffX) {
    minDiffX = Math.abs(diffRightEdge)
    candidateSnapX = workspaceRect.width - winW
  }
  // 底部边缘（y + winH = workspaceHeight）
  const diffBottomEdge = (rawY + winH) - workspaceRect.height
  if (diffBottomEdge >= 0 && diffBottomEdge <= stickThreshold && Math.abs(diffBottomEdge) < minDiffY) {
    minDiffY = Math.abs(diffBottomEdge)
    candidateSnapY = workspaceRect.height - winH
  }

  // 2. 窗口之间：无任何隔空吸引与对齐吸引，仅当两窗口边沿碰上/贴紧时吸住
  const otherWindows = windows.value.filter(
    (w) => w.id !== currentWin.id && !w.isMaximized
  )

  for (const other of otherWindows) {
    const oLeft = other.x
    const oRight = other.x + other.width
    const oTop = other.y
    const oH = other.isCollapsed ? COLLAPSED_HEIGHT : other.height
    const oBottom = other.y + oH

    // 垂直方向有正向重叠或相切投影时，检测水平方向碰边
    if (isRangeOverlap(rawY, rawY + winH, oTop, oBottom)) {
      // 当前窗口右边贴在近邻窗口左边 (rawX + winW >= oLeft 且未深穿)
      const diffR2L = rawX + winW - oLeft
      if (diffR2L >= 0 && diffR2L <= stickThreshold && diffR2L < minDiffX) {
        minDiffX = diffR2L
        candidateSnapX = oLeft - winW
      }

      // 当前窗口左边贴在近邻窗口右边 (rawX <= oRight 且未深穿)
      const diffL2R = oRight - rawX
      if (diffL2R >= 0 && diffL2R <= stickThreshold && diffL2R < minDiffX) {
        minDiffX = diffL2R
        candidateSnapX = oRight
      }
    }

    // 水平方向有正向重叠或相切投影时，检测垂直方向碰边
    if (isRangeOverlap(rawX, rawX + winW, oLeft, oRight)) {
      // 当前窗口底边贴在近邻窗口顶边 (rawY + winH >= oTop 且未深穿)
      const diffB2T = rawY + winH - oTop
      if (diffB2T >= 0 && diffB2T <= stickThreshold && diffB2T < minDiffY) {
        minDiffY = diffB2T
        candidateSnapY = oTop - winH
      }

      // 当前窗口顶边贴在近邻窗口底边 (rawY <= oBottom 且未深穿)
      const diffT2B = oBottom - rawY
      if (diffT2B >= 0 && diffT2B <= stickThreshold && diffT2B < minDiffY) {
        minDiffY = diffT2B
        candidateSnapY = oBottom
      }
    }
  }

  // 粘性维持逻辑：一旦贴紧吸住，需要拖出力度超过阻力阈值才释放
  if (candidateSnapX !== null) {
    lockedSnapOffsetX = candidateSnapX
    nextX = candidateSnapX
  } else if (lockedSnapOffsetX !== null) {
    if (Math.abs(rawX - lockedSnapOffsetX) <= stickThreshold) {
      nextX = lockedSnapOffsetX
    } else {
      lockedSnapOffsetX = null
    }
  }

  if (candidateSnapY !== null) {
    lockedSnapOffsetY = candidateSnapY
    nextY = candidateSnapY
  } else if (lockedSnapOffsetY !== null) {
    if (Math.abs(rawY - lockedSnapOffsetY) <= stickThreshold) {
      nextY = lockedSnapOffsetY
    } else {
      lockedSnapOffsetY = null
    }
  }

  return { x: nextX, y: nextY }
}

const getPointerQuadrant = (event: PointerEvent, workspaceRect: DOMRect): WorkspaceQuadrant | null => {
  const leftDistance = event.clientX - workspaceRect.left
  const rightDistance = workspaceRect.right - event.clientX
  const topDistance = event.clientY - workspaceRect.top
  const bottomDistance = workspaceRect.bottom - event.clientY
  const threshold = Math.max(
    56,
    Math.min(96, Math.min(workspaceRect.width, workspaceRect.height) * 0.16)
  )

  if (
    Math.min(leftDistance, rightDistance) > threshold ||
    Math.min(topDistance, bottomDistance) > threshold
  ) {
    return null
  }

  const vertical = topDistance < bottomDistance ? 'top' : 'bottom'
  const horizontal = leftDistance < rightDistance ? 'left' : 'right'
  return `${vertical}-${horizontal}` as WorkspaceQuadrant
}

const onDragging = (event: PointerEvent) => {
  if (!activeDragWin || !workspaceRef.value) return

  const deltaX = event.clientX - dragStartX
  const deltaY = event.clientY - dragStartY
  if (Math.hypot(deltaX, deltaY) > 4) {
    hasDragged = true
  }

  const rect = workspaceRef.value.getBoundingClientRect()
  workspaceWidth.value = rect.width
  workspaceHeight.value = rect.height
  dragCornerPreview.value = getPointerQuadrant(event, rect)
  const rawX = winStartX + deltaX
  const rawY = winStartY + deltaY

  // 应用贴近磁吸计算
  const snapped = calculateSnapPosition(rawX, rawY, activeDragWin, rect)

  // 允许窗口自由拖拽出工作区/浏览器边界（不锁定），保留最小边缘把手防止窗口彻底丢失
  const currentWinW = activeDragWin.width
  const currentWinH = activeDragWin.isCollapsed ? COLLAPSED_HEIGHT : activeDragWin.height
  const minVisibleX = 60
  const minVisibleY = COLLAPSED_HEIGHT

  const minX = -(currentWinW - minVisibleX)
  const maxX = rect.width - minVisibleX
  const minY = 0
  const maxY = rect.height - minVisibleY

  activeDragWin.x = Math.max(minX, Math.min(snapped.x, maxX))
  activeDragWin.y = Math.max(minY, Math.min(snapped.y, maxY))
}

const snapWindowToQuadrant = (win: WindowItem, quadrant: WorkspaceQuadrant) => {
  const layout = getWorkspaceQuadrantLayout(quadrant)

  win.x = layout.x
  win.y = layout.y
  win.width = layout.width
  win.height = layout.height
  win.prevX = layout.x
  win.prevY = layout.y
  win.prevWidth = layout.width
  win.prevHeight = layout.height
  win.isMaximized = false
  win.isCollapsed = false

  isQuadrantLayoutActive.value = false
  if (matchesQuadrantLayout()) {
    isQuadrantLayoutActive.value = true
  }
}

const stopDrag = (event: PointerEvent) => {
  if (hasDragged && activeDragWin && workspaceRef.value) {
    const quadrant = getPointerQuadrant(event, workspaceRef.value.getBoundingClientRect())
    if (quadrant) {
      snapWindowToQuadrant(activeDragWin, quadrant)
    }
  }

  activeDragWin = null
  hasDragged = false
  draggingWinId.value = null
  dragCornerPreview.value = null
  lockedSnapOffsetX = null
  lockedSnapOffsetY = null
  window.removeEventListener('pointermove', onDragging)
  window.removeEventListener('pointerup', stopDrag)
}

// 边框/角拖拽改变窗口大小 (Resize)
interface ActiveResize {
  win: WindowItem
  direction: string
  startX: number
  startY: number
  initX: number
  initY: number
  initW: number
  initH: number
}

let activeResize: ActiveResize | null = null
// 记录拉伸时吸附住的边缘坐标（粘性磁吸）
let lockedResizeSnapX: number | null = null  // 锁定的水平边缘坐标（右边或左边的绝对位置）
let lockedResizeSnapY: number | null = null  // 锁定的垂直边缘坐标（底边或顶边的绝对位置）
let lastResizeRawEdgeX: number | null = null // 上一帧未吸附的水平边缘坐标（用于碰撞穿越检测）
let lastResizeRawEdgeY: number | null = null // 上一帧未吸附的垂直边缘坐标（用于碰撞穿越检测）
const MIN_WIDTH = 320
const MIN_HEIGHT = 120

const startResize = (event: PointerEvent, win: WindowItem, direction: string) => {
  if (win.isMaximized || win.isCollapsed) return
  isQuadrantLayoutActive.value = false
  focusWindow(win.id)

  resizingWinId.value = win.id
  activeResize = {
    win,
    direction,
    startX: event.clientX,
    startY: event.clientY,
    initX: win.x,
    initY: win.y,
    initW: win.width,
    initH: win.height
  }

  lockedResizeSnapX = null
  lockedResizeSnapY = null
  lastResizeRawEdgeX = null
  lastResizeRawEdgeY = null

  window.addEventListener('pointermove', onResizing)
  window.addEventListener('pointerup', stopResize)
}

const onResizing = (event: PointerEvent) => {
  if (!activeResize || !workspaceRef.value) return

  const { win, direction, startX, startY, initX, initY, initW, initH } = activeResize
  const deltaX = event.clientX - startX
  const deltaY = event.clientY - startY
  const rect = workspaceRef.value.getBoundingClientRect()
  workspaceWidth.value = rect.width
  workspaceHeight.value = rect.height

  const stickThreshold = SNAP_STICK_THRESHOLD

  let newW = initW
  let newH = initH
  let newX = initX
  let newY = initY

  // 收集其他窗口（共用）
  const otherWindows = windows.value.filter(
    (w) => w.id !== win.id && !w.isMaximized
  )

  // ====== 水平方向拉伸（e 或 w）======
  const hasE = direction.includes('e')
  const hasW = direction.includes('w')

  if (hasE || hasW) {
    let rawEdgeX: number
    if (hasE) {
      rawEdgeX = initX + Math.max(MIN_WIDTH, initW + deltaX)
    } else {
      rawEdgeX = initX + deltaX
    }

    const prevEdgeX = lastResizeRawEdgeX ?? (hasE ? initX + initW : initX)

    // 收集所有潜在的水平吸附目标线
    const targetsX: number[] = []
    if (hasE) {
      // 工作区右边界
      targetsX.push(rect.width)
      // 其他窗口边缘（Y轴有投影重叠时）
      for (const other of otherWindows) {
        const otherH = other.isCollapsed ? COLLAPSED_HEIGHT : other.height
        if (isRangeOverlap(newY, newY + newH, other.y, other.y + otherH)) {
          targetsX.push(other.x) // 相邻（对准其左侧）
          targetsX.push(other.x + other.width) // 对齐（对准其右侧）
        }
      }
    } else {
      // 工作区左边界
      targetsX.push(0)
      // 其他窗口边缘（Y轴有投影重叠时）
      for (const other of otherWindows) {
        const otherH = other.isCollapsed ? COLLAPSED_HEIGHT : other.height
        if (isRangeOverlap(newY, newY + newH, other.y, other.y + otherH)) {
          targetsX.push(other.x + other.width) // 相邻（对准其右侧）
          targetsX.push(other.x) // 对齐（对准其左侧）
        }
      }
    }

    let finalEdgeX = rawEdgeX

    // 粘性判断：如果已经吸附住，检测是否在脱离阻力阈值内
    if (lockedResizeSnapX !== null) {
      if (Math.abs(rawEdgeX - lockedResizeSnapX) <= stickThreshold) {
        finalEdgeX = lockedResizeSnapX
      } else {
        lockedResizeSnapX = null
      }
    }

    // 如果未吸附，检测本次移动是否物理碰撞/穿越了某个目标线（无隔空吸引）
    if (lockedResizeSnapX === null) {
      let bestTarget: number | null = null
      let minDistanceToPrev = Infinity

      for (const target of targetsX) {
        // 穿越检测：上一帧在 target 一侧（或正好在 target），本帧到达或越过了 target
        const crossed = (prevEdgeX <= target && rawEdgeX >= target) || (prevEdgeX >= target && rawEdgeX <= target)
        if (crossed) {
          const dist = Math.abs(prevEdgeX - target)
          if (dist < minDistanceToPrev) {
            minDistanceToPrev = dist
            bestTarget = target
          }
        }
      }

      if (bestTarget !== null) {
        lockedResizeSnapX = bestTarget
        finalEdgeX = bestTarget
      }
    }

    lastResizeRawEdgeX = rawEdgeX

    // 应用到宽度与位置
    if (hasE) {
      newW = Math.max(MIN_WIDTH, Math.min(finalEdgeX - newX, rect.width - newX))
    } else {
      const maxAllowedX = initX + initW - MIN_WIDTH
      newX = Math.max(0, Math.min(finalEdgeX, maxAllowedX))
      newW = initX + initW - newX
    }
  }

  // ====== 垂直方向拉伸（s 或 n）======
  const hasS = direction.includes('s')
  const hasN = direction.includes('n')

  if (hasS || hasN) {
    let rawEdgeY: number
    if (hasS) {
      rawEdgeY = initY + Math.max(MIN_HEIGHT, initH + deltaY)
    } else {
      rawEdgeY = initY + deltaY
    }

    const prevEdgeY = lastResizeRawEdgeY ?? (hasS ? initY + initH : initY)

    // 收集所有潜在的垂直吸附目标线
    const targetsY: number[] = []
    if (hasS) {
      // 工作区底边界
      targetsY.push(rect.height)
      // 其他窗口边缘（X轴有投影重叠时）
      for (const other of otherWindows) {
        if (isRangeOverlap(newX, newX + newW, other.x, other.x + other.width)) {
          const otherH = other.isCollapsed ? COLLAPSED_HEIGHT : other.height
          targetsY.push(other.y) // 相邻（对准其顶边）
          targetsY.push(other.y + otherH) // 对齐（对准其底边）
        }
      }
    } else {
      // 工作区顶边界
      targetsY.push(0)
      // 其他窗口边缘（X轴有投影重叠时）
      for (const other of otherWindows) {
        if (isRangeOverlap(newX, newX + newW, other.x, other.x + other.width)) {
          const otherH = other.isCollapsed ? COLLAPSED_HEIGHT : other.height
          targetsY.push(other.y + otherH) // 相邻（对准其底边）
          targetsY.push(other.y) // 对齐（对准其顶边）
        }
      }
    }

    let finalEdgeY = rawEdgeY

    // 粘性判断：如果已经吸附住，检测是否在脱离阻力阈值内
    if (lockedResizeSnapY !== null) {
      if (Math.abs(rawEdgeY - lockedResizeSnapY) <= stickThreshold) {
        finalEdgeY = lockedResizeSnapY
      } else {
        lockedResizeSnapY = null
      }
    }

    // 如果未吸附，检测本次移动是否物理碰撞/穿越了某个目标线（无隔空吸引）
    if (lockedResizeSnapY === null) {
      let bestTarget: number | null = null
      let minDistanceToPrev = Infinity

      for (const target of targetsY) {
        // 穿越检测：上一帧在 target 一侧，本帧到达或越过了 target
        const crossed = (prevEdgeY <= target && rawEdgeY >= target) || (prevEdgeY >= target && rawEdgeY <= target)
        if (crossed) {
          const dist = Math.abs(prevEdgeY - target)
          if (dist < minDistanceToPrev) {
            minDistanceToPrev = dist
            bestTarget = target
          }
        }
      }

      if (bestTarget !== null) {
        lockedResizeSnapY = bestTarget
        finalEdgeY = bestTarget
      }
    }

    lastResizeRawEdgeY = rawEdgeY

    // 应用到高度与位置
    if (hasS) {
      newH = Math.max(MIN_HEIGHT, Math.min(finalEdgeY - newY, rect.height - newY))
    } else {
      const maxAllowedY = initY + initH - MIN_HEIGHT
      newY = Math.max(0, Math.min(finalEdgeY, maxAllowedY))
      newH = initY + initH - newY
    }
  }

  win.x = newX
  win.y = newY
  win.width = newW
  win.height = newH
}

const stopResize = () => {
  activeResize = null
  resizingWinId.value = null
  lockedResizeSnapX = null
  lockedResizeSnapY = null
  lastResizeRawEdgeX = null
  lastResizeRawEdgeY = null
  window.removeEventListener('pointermove', onResizing)
  window.removeEventListener('pointerup', stopResize)
}

onUnmounted(() => {
  stopVideoSeekRepeat()
  window.removeEventListener('pointermove', onDragging)
  window.removeEventListener('pointerup', stopDrag)
  window.removeEventListener('pointermove', onResizing)
  window.removeEventListener('pointerup', stopResize)
})

// 最大化 / 还原
const toggleMaximize = (win: WindowItem) => {
  isQuadrantLayoutActive.value = false
  focusWindow(win.id)
  if (win.isMaximized) {
    // 还原
    win.x = win.prevX ?? 60
    win.y = win.prevY ?? 40
    win.width = win.prevWidth ?? 540
    win.height = win.prevHeight ?? 380
    win.isMaximized = false
    win.isCollapsed = false
  } else {
    // 最大化之前记录原位置和尺寸
    win.prevX = win.x
    win.prevY = win.y
    win.prevWidth = win.width
    win.prevHeight = win.height
    win.isCollapsed = false
    win.isMaximized = true
  }
}

// 收起 / 展开窗口
const toggleCollapse = (win: WindowItem) => {
  isQuadrantLayoutActive.value = false
  focusWindow(win.id)
  if (win.isCollapsed) {
    // 展开窗口
    win.isCollapsed = false
    if (!win.isMaximized && workspaceRef.value) {
      const rect = workspaceRef.value.getBoundingClientRect()
      if (win.y + win.height > rect.height) {
        win.y = Math.max(0, rect.height - win.height)
      }
    }
  } else {
    // 收起窗口：保持当前的 isMaximized 状态不变（支持最大化状态下折叠收起）
    win.isCollapsed = true
  }
}

// 标题栏双击：仅用于展开已收起的窗口，不触发最大化/还原
const onHeaderDblClick = (win: WindowItem) => {
  if (win.isCollapsed) {
    toggleCollapse(win)
  }
}


// 新建窗口
const createWindow = () => {
  if (isInitialProjectManagerOpen.value) return
  const id = `win-${Date.now()}`
  const width = 540
  const height = 380
  const layout = getCenteredWindowPos(width, height)
  maxZIndex.value += 1
  windows.value.push({
    id,
    title: `工作区窗口 ${windows.value.length + 1}`,
    x: layout.x,
    y: layout.y,
    width,
    height,
    isMaximized: false,
    isCollapsed: false,
    zIndex: maxZIndex.value
  })
  focusWindow(id)
}

// 工作区尺寸跟踪（用于边缘磁吸贴靠检测）
const workspaceWidth = ref(0)
const workspaceHeight = ref(0)

const updateWorkspaceSize = () => {
  if (workspaceRef.value) {
    const rect = workspaceRef.value.getBoundingClientRect()
    workspaceWidth.value = rect.width
    workspaceHeight.value = rect.height
  }
}

const DEFAULT_LAYOUT_WINDOWS: Array<{
  id: WorkspaceQuadrantWindowId
  title: string
  type: NonNullable<WindowItem['type']>
}> = [
  { id: 'win-video', title: '视频', type: 'video' },
  { id: 'win-events', title: '事件', type: 'events' },
  { id: 'win-design', title: '设计', type: 'design' },
  { id: 'win-presets', title: '预设', type: 'presets' }
]

const dragQuadrantFillStyle = computed(() => {
  if (!dragCornerPreview.value) return {}

  const layout = getWorkspaceQuadrantLayout(dragCornerPreview.value)
  return {
    left: `${layout.x}px`,
    top: `${layout.y}px`,
    width: `${layout.width}px`,
    height: `${layout.height}px`
  }
})

const QUADRANT_LAYOUT_TOLERANCE = 2
const quadrantWindowPresence = computed(() => {
  return DEFAULT_LAYOUT_WINDOWS
    .map((item) => windows.value.some((win) => win.id === item.id))
    .join('|')
})

const matchesQuadrantLayout = () => {
  const fallbackBounds = getQuadrantWindowLayout('win-design')
  const workspaceRight = workspaceWidth.value > 0
    ? workspaceWidth.value
    : fallbackBounds.x + fallbackBounds.width
  const workspaceBottom = workspaceHeight.value > 0
    ? workspaceHeight.value
    : fallbackBounds.y + fallbackBounds.height

  return DEFAULT_LAYOUT_WINDOWS.every((item) => {
    const win = windows.value.find((candidate) => candidate.id === item.id)
    if (!win || win.isMaximized || win.isCollapsed) return false

    const expected = getQuadrantWindowLayout(item.id)
    const touchesHorizontalEdge = expected.x === 0
      ? win.x <= QUADRANT_LAYOUT_TOLERANCE
      : Math.abs(win.x + win.width - workspaceRight) <= QUADRANT_LAYOUT_TOLERANCE
    const touchesVerticalEdge = expected.y === 0
      ? win.y <= QUADRANT_LAYOUT_TOLERANCE
      : Math.abs(win.y + win.height - workspaceBottom) <= QUADRANT_LAYOUT_TOLERANCE

    return touchesHorizontalEdge && touchesVerticalEdge
  })
}

watch(quadrantWindowPresence, () => {
  if (isQuadrantLayoutActive.value || draggingWinId.value || resizingWinId.value) return
  if (matchesQuadrantLayout()) {
    isQuadrantLayoutActive.value = true
  }
}, { immediate: true })

const applyDefaultWorkspaceLayout = (
  options: { focus?: boolean; replaceWorkspace?: boolean } = {}
) => {
  updateWorkspaceSize()
  const placements = DEFAULT_LAYOUT_WINDOWS.map((item) => getQuadrantWindowLayout(item.id))
  const allowedWindowIds = new Set<string>(DEFAULT_LAYOUT_WINDOWS.map((item) => item.id))

  isQuadrantLayoutActive.value = false
  if (options.replaceWorkspace !== false) {
    windows.value = windows.value.filter((win) => allowedWindowIds.has(win.id))
  }

  DEFAULT_LAYOUT_WINDOWS.forEach((spec, index) => {
    const placement = placements[index]
    if (!placement) return

    let win = windows.value.find((item) => item.id === spec.id)

    if (!win) {
      maxZIndex.value += 1
      win = {
        id: spec.id,
        title: spec.title,
        type: spec.type,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        isMaximized: false,
        isCollapsed: false,
        zIndex: maxZIndex.value
      }
      windows.value.push(win)
    }

    win.title = spec.title
    win.type = spec.type
    win.x = placement.x
    win.y = placement.y
    win.width = placement.width
    win.height = placement.height
    win.prevX = placement.x
    win.prevY = placement.y
    win.prevWidth = placement.width
    win.prevHeight = placement.height
    win.isMaximized = false
    win.isCollapsed = false
    maxZIndex.value += 1
    win.zIndex = maxZIndex.value
  })

  if (options.focus !== false) {
    focusWindow('win-design')
  }
  isQuadrantLayoutActive.value = true
  return true
}

let resizeObserver: ResizeObserver | null = null

const reflowQuadrantLayout = () => {
  if (!isQuadrantLayoutActive.value) return
  nextTick(() => {
    if (isQuadrantLayoutActive.value) {
      applyDefaultWorkspaceLayout({ focus: false, replaceWorkspace: false })
    }
  })
}

const centerProjectManagerWindow = () => {
  const projectManagerWin = windows.value.find((w) => w.id === 'win-project-manager')
  if (!projectManagerWin || projectManagerWin.isMaximized) return

  let w = workspaceWidth.value
  let h = workspaceHeight.value
  if (workspaceRef.value) {
    const rect = workspaceRef.value.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      w = rect.width
      h = rect.height
    }
  }
  if (w <= 0 && typeof window !== 'undefined') {
    w = window.innerWidth
    h = window.innerHeight - 48
  }

  if (w > 0 && h > 0) {
    projectManagerWin.x = Math.max(0, Math.round((w - projectManagerWin.width) / 2))
    projectManagerWin.y = Math.max(0, Math.round((h - projectManagerWin.height) / 2))
  }
}

// 浏览器窗口自身调整尺寸时临时禁用过渡，避免最大化窗口滞后
const isWindowResizing = ref(false)
let resizeTimer: ReturnType<typeof setTimeout> | null = null

const onWindowResize = () => {
  isWindowResizing.value = true
  updateWorkspaceSize()
  reflowQuadrantLayout()
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    isWindowResizing.value = false
  }, 100)
}

onMounted(() => {
  updateWorkspaceSize()
  openProjectManagerWindow({ center: true, initial: true })
  if (workspaceRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      updateWorkspaceSize()
      reflowQuadrantLayout()
    })
    resizeObserver.observe(workspaceRef.value)
  }
  window.addEventListener('resize', onWindowResize)
})

watch(projectManagerCloseRequest, (request) => {
  if (!request) return

  nextTick(() => {
    if (projectManagerCloseRequest.value?.sequence !== request.sequence) return

    if (request.behavior === 'default-layout' || windows.value.length === 0) {
      applyDefaultWorkspaceLayout()
    } else {
      isQuadrantLayoutActive.value = false
    }
    clearProjectManagerCloseRequest(request.sequence)
  })
})

watch(resetWorkspaceLayoutRequest, () => {
  nextTick(() => {
    applyDefaultWorkspaceLayout()
  })
})

onUnmounted(() => {
  stopVideoSeekRepeat()
  if (isVideoSeekScrubbing) {
    isVideoSeekScrubbing = false
    cancelScrubSeek()
  }
  resizeObserver?.disconnect()
  window.removeEventListener('resize', onWindowResize)
  if (resizeTimer) clearTimeout(resizeTimer)
})

// 计算窗口贴靠状态（贴靠工作区边框或与其他窗口相邻时消除对应圆角）
const getWindowSnapClasses = (win: WindowItem) => {
  if (win.isMaximized) {
    return {}
  }

  const winW = win.width
  const winH = win.isCollapsed ? COLLAPSED_HEIGHT : win.height
  const winX = win.x
  const winY = win.y

  let touchTop = false
  let touchBottom = false
  let touchLeft = false
  let touchRight = false

  const TOLERANCE = 2 // 容差像素阈值

  // 1. 贴靠工作区边框检测
  if (winY <= TOLERANCE) {
    touchTop = true
  }
  if (winX <= TOLERANCE) {
    touchLeft = true
  }
  if (workspaceHeight.value > 0 && Math.abs(winY + winH - workspaceHeight.value) <= TOLERANCE) {
    touchBottom = true
  }
  if (workspaceWidth.value > 0 && Math.abs(winX + winW - workspaceWidth.value) <= TOLERANCE) {
    touchRight = true
  }

  // 2. 窗口相互贴靠检测 (与其他非最大化窗口相邻)
  const otherWindows = windows.value.filter(
    (w) => w.id !== win.id && !w.isMaximized
  )

  for (const other of otherWindows) {
    const oW = other.width
    const oH = other.isCollapsed ? COLLAPSED_HEIGHT : other.height
    const oX = other.x
    const oY = other.y

    // 检查在投影轴上是否有正向重叠接触
    const isOverlapY = Math.max(winY, oY) < Math.min(winY + winH, oY + oH)
    const isOverlapX = Math.max(winX, oX) < Math.min(winX + winW, oX + oW)

    // 当前窗口右边贴在近邻窗口左边
    if (isOverlapY && Math.abs(winX + winW - oX) <= TOLERANCE) {
      touchRight = true
    }
    // 当前窗口左边贴在近邻窗口右边
    if (isOverlapY && Math.abs(winX - (oX + oW)) <= TOLERANCE) {
      touchLeft = true
    }
    // 当前窗口底边贴在近邻窗口顶边
    if (isOverlapX && Math.abs(winY + winH - oY) <= TOLERANCE) {
      touchBottom = true
    }
    // 当前窗口顶边贴在近邻窗口底边
    if (isOverlapX && Math.abs(winY - (oY + oH)) <= TOLERANCE) {
      touchTop = true
    }
  }

  return {
    'touch-top': touchTop,
    'touch-bottom': touchBottom,
    'touch-left': touchLeft,
    'touch-right': touchRight
  }
}

// 监听窗口退出动画播放完毕，平滑交接焦点
const onWindowAfterLeave = (el: Element) => {
  const winId = (el as HTMLElement)?.dataset?.windowId || el.getAttribute('data-window-id') || undefined
  settleFocusAfterClose(winId)
}

const handleCloseWindow = (win: WindowItem) => {
  if (win.id !== 'win-project-manager') {
    isQuadrantLayoutActive.value = false
  }
  closeWindow(win)
}
</script>

<template>
  <div ref="workspaceRef" class="workspace-area">
    <!-- 浮动工作区窗口列表 -->
    <TransitionGroup
      name="window-anim"
      appear
      @after-leave="onWindowAfterLeave"
    >
      <div
        v-for="win in windows"
        :key="win.id"
        class="md3-window"
        :data-window-id="win.id"
        :class="[
          {
            maximized: win.isMaximized,
            collapsed: win.isCollapsed,
            focused: focusedWindowId === win.id,
            'is-dragging': draggingWinId === win.id,
            'is-resizing': resizingWinId === win.id,
            'is-window-resizing': isWindowResizing
          },
          getWindowSnapClasses(win)
        ]"
        :style="{
          left: win.isMaximized ? '0px' : `${win.x}px`,
          top: win.isMaximized ? '0px' : `${win.y}px`,
          width: win.isMaximized
            ? (workspaceWidth > 0 ? `${workspaceWidth}px` : '100%')
            : `${win.width}px`,
          height: win.isCollapsed
            ? (win.isMaximized ? '44px' : `${COLLAPSED_HEIGHT}px`)
            : (win.isMaximized ? (workspaceHeight > 0 ? `${workspaceHeight}px` : '100%') : `${win.height}px`),
          zIndex: win.zIndex
        }"
        @pointerdown="focusWindow(win.id)"
      >
        <!-- 窗口标题栏（可拖拽） -->
        <div
          class="window-header"
          :class="{ draggable: !win.isMaximized }"
          @pointerdown.stop="startDrag($event, win)"
          @dblclick="onHeaderDblClick(win)"
        >
          <div class="window-title-area">
            <svg
              v-if="win.type === 'settings'"
              class="window-type-icon"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path
                d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2.4h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.73 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.08.63-.08.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-3.6 3.6-3.6 3.6z"
              />
            </svg>
            <svg
              v-else-if="win.type === 'bpm'"
              class="window-type-icon"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M7 18h2V6H7v12zm4 4h2V2h-2v20zm-8-8h2v-4H3v4zm12 4h2V6h-2v12zm4-8v4h2v-4h-2z" />
            </svg>
            <svg
              v-else-if="win.type === 'presets'"
              class="window-type-icon"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path
                d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 2v3H5V5h14zm-7 5h7v4h-7v-4zm-2 0v4H5v-4h5zm-5 6h5v3H5v-3zm7 3v-3h7v3h-7z"
              />
            </svg>
            <svg
              v-else-if="win.type === 'events'"
              class="window-type-icon"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path
                d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"
              />
            </svg>
            <svg
              v-else-if="win.type === 'project-manager'"
              class="window-type-icon"
              viewBox="0 -960 960 960"
              fill="currentColor"
            >
              <!-- Material Symbols description -->
              <path
                d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z"
              />
            </svg>
            <svg
              v-else-if="win.type === 'design'"
              class="window-type-icon"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path
                d="m16.24 11.51 1.57-1.57-3.75-3.75-1.57 1.57-4.14-4.13c-.78-.78-2.05-.78-2.83 0l-1.9 1.9c-.78.78-.78 2.05 0 2.83l4.13 4.13L3 17.25V21h3.75l4.76-4.76 4.13 4.13c.95.95 2.23.6 2.83 0l1.9-1.9c.78-.78.78-2.05 0-2.83l-4.13-4.13zm-7.06-.44L5.04 6.94l1.89-1.9L8.2 6.31 7.02 7.5l1.41 1.41 1.19-1.19 1.45 1.45-1.89 1.9zm7.88 7.89-4.13-4.13 1.9-1.9 1.45 1.45-1.19 1.19 1.41 1.41 1.19-1.19 1.27 1.27-1.9 1.9zm3.65-11.92a.996.996 0 0 0 0-1.41l-2.34-2.34c-.47-.47-1.12-.29-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
              />
            </svg>
            <svg
              v-else-if="win.type === 'video'"
              class="window-type-icon"
              viewBox="0 -960 960 960"
              fill="currentColor"
            >
              <path
                d="m480-420 240-160-240-160v320Zm33 220h219q-6 24-24 41.5T664-138L228-85q-33 4-59.5-16T138-154L86-592q-4-33 16.5-59t53.5-30l45-5v80l-36 4 54 438 294-36Zm-152-80q-33 0-56.5-23.5T281-360v-440q0-33 23.5-56.5T361-880h440q33 0 56.5 23.5T881-800v440q0 33-23.5 56.5T801-280H361Zm0-80h440v-440H361v440ZM219-164Zm362-416Z"
              />
            </svg>
            <svg
              v-else-if="win.type === 'terminal'"
              class="window-type-icon"
              viewBox="0 -960 960 960"
              fill="currentColor"
            >
              <path
                d="M260-120q-58 0-99-41t-41-99q0-58 41-99t99-41h60v-160h-60q-58 0-99-41t-41-99q0-58 41-99t99-41q58 0 99 41t41 99v60h160v-60q0-58 41-99t99-41q58 0 99 41t41 99q0 58-41 99t-99 41h-60v160h60q58 0 99 41t41 99q0 58-41 99t-99 41q-58 0-99-41t-41-99v-60H400v60q0 58-41 99t-99 41Zm0-80q25 0 42.5-17.5T320-260v-60h-60q-25 0-42.5 17.5T200-260q0 25 17.5 42.5T260-200Zm440 0q25 0 42.5-17.5T760-260q0-25-17.5-42.5T700-320h-60v60q0 25 17.5 42.5T700-200ZM400-400h160v-160H400v160ZM260-640h60v-60q0-25-17.5-42.5T260-760q-25 0-42.5 17.5T200-700q0 25 17.5 42.5T260-640Zm380 0h60q25 0 42.5-17.5T760-700q0-25-17.5-42.5T700-760q-25 0-42.5 17.5T640-700v60Z"
              />
            </svg>
            <WindowTitle
              :class="{ 'video-window-title': win.type === 'video' }"
              :text="getWindowTitle(win)"
              :measure-text="getWindowTitleMeasureText(win)"
            />

            <!-- 标题栏左侧操作按钮组 -->
            <div class="header-actions">
              <!-- 视频窗口标题名称右侧基础播放控件 -->
              <template v-if="win.type === 'video'">
                <!-- 打开本地视频文件 -->
                <button
                  class="header-action-btn"
                  type="button"
                  aria-label="打开本地视频"
                  @pointerdown.stop
                  @dblclick.stop
                  @click.stop="handleOpenVideoFile(win)"
                >
                  <svg class="header-action-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" />
                  </svg>
                </button>

                <Transition name="design-toolbar-action">
                  <div
                    v-if="videoSrc"
                    class="video-playback-controls"
                  >
                    <!-- 快退 / 快进 500ms -->
                    <button
                      class="header-action-btn"
                      type="button"
                      aria-label="快退 500 毫秒"
                      @pointerdown.stop="handleSeekVideoRepeatStart(win, -VIDEO_SEEK_STEP_SECONDS, $event)"
                      @pointerup.stop="finishVideoSeekRepeat"
                      @pointercancel.stop="finishVideoSeekRepeat"
                      @pointerleave.stop="finishVideoSeekRepeat"
                      @dblclick.stop
                      @click.stop="handleSeekVideoClick(win, -VIDEO_SEEK_STEP_SECONDS, $event)"
                    >
                      <svg class="header-action-icon" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M11 18V6l-8.5 6 8.5 6zm.5-6 8.5 6V6l-8.5 6z" />
                      </svg>
                    </button>
                    <button
                      class="header-action-btn"
                      type="button"
                      aria-label="快进 500 毫秒"
                      @pointerdown.stop="handleSeekVideoRepeatStart(win, VIDEO_SEEK_STEP_SECONDS, $event)"
                      @pointerup.stop="finishVideoSeekRepeat"
                      @pointercancel.stop="finishVideoSeekRepeat"
                      @pointerleave.stop="finishVideoSeekRepeat"
                      @dblclick.stop
                      @click.stop="handleSeekVideoClick(win, VIDEO_SEEK_STEP_SECONDS, $event)"
                    >
                      <svg class="header-action-icon" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
                      </svg>
                    </button>

                    <!-- 播放 / 暂停 -->
                    <button
                      class="header-action-btn play-btn"
                      type="button"
                      :aria-label="isVideoPlaying ? '暂停' : '播放'"
                      @pointerdown.stop
                      @dblclick.stop
                      @click.stop="handleToggleVideoPlay(win)"
                    >
                      <svg v-if="!isVideoPlaying" class="header-action-icon" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      <svg v-else class="header-action-icon" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                      </svg>
                    </button>

                    <!-- 停止；已停止时变为关闭视频 -->
                    <button
                      class="header-action-btn"
                      type="button"
                      :aria-label="isVideoStopped ? '关闭视频' : '停止'"
                      @pointerdown.stop
                      @dblclick.stop
                      @click.stop="handleStopVideo(win)"
                    >
                      <svg
                        v-if="!isVideoStopped"
                        class="header-action-icon"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M6 6h12v12H6z" />
                      </svg>
                      <svg
                        v-else
                        class="header-action-icon"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="9"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.6"
                        />
                        <path
                          d="M9 9l6 6M15 9l-6 6"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.6"
                          stroke-linecap="round"
                        />
                      </svg>
                    </button>

                    <!-- 静音 / 恢复音量 -->
                    <button
                      class="header-action-btn"
                      type="button"
                      :aria-label="isVideoMuted ? '取消静音' : '静音'"
                      @pointerdown.stop
                      @dblclick.stop
                      @click.stop="handleToggleVideoMute(win)"
                    >
                      <svg v-if="isVideoMuted" class="header-action-icon" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27l4.73 4.73H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                      </svg>
                      <svg v-else class="header-action-icon" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                      </svg>
                    </button>
                  </div>
                </Transition>

              </template>

              <!-- 预设窗口标题名称右侧新增Add Box图标，用于添加预设 -->
              <button
                v-if="win.type === 'presets'"
                class="header-action-btn"
                type="button"
                aria-label="添加预设"
                :disabled="isPresetCurveEditing || selectedEventId === null"
                @pointerdown.stop
                @dblclick.stop
                @click.stop="handleAddPreset(win)"
              >
                <svg class="header-action-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"
                  />
                </svg>
              </button>

              <!-- 事件窗口标题栏新增事件 -->
              <button
                v-if="win.type === 'events'"
                class="header-action-btn"
                type="button"
                aria-label="新增事件"
                @pointerdown.stop
                @dblclick.stop
                @click.stop="handleAddEvent(win)"
              >
                <svg class="header-action-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"
                  />
                </svg>
              </button>

              <!-- 设计窗口标题栏切换时间线是否跟随播放头 -->
              <button
                v-if="win.type === 'design'"
                class="header-action-btn"
                type="button"
                :aria-label="timelineFollowEnabled ? '暂停时间线跟随' : '开启时间线跟随'"
                :aria-pressed="timelineFollowEnabled"
                @pointerdown.stop
                @dblclick.stop
                @click.stop="handleToggleTimelineFollow(win)"
              >
                <svg class="header-action-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" />
                </svg>
              </button>

              <!-- 设计窗口时间线操作 -->
              <div
                v-if="win.type === 'design' && hasDesignSelection"
                class="design-mode-actions"
              >
                <!-- 重置BPM提示线并重新识别 -->
                <button
                  class="header-action-btn"
                  type="button"
                  aria-label="重置BPM提示线"
                  title="重置BPM提示线"
                  @pointerdown.stop
                  @dblclick.stop
                  @click.stop="handleResetBeatGrid(win)"
                >
                  <svg class="header-action-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                  </svg>
                </button>

                <!-- 添加时间线轨道 -->
                <button
                  class="header-action-btn"
                  type="button"
                  aria-label="添加时间线轨道"
                  :disabled="selectedEventId === null"
                  @pointerdown.stop
                  @dblclick.stop
                  @click.stop="handleAddTimelineTrack(win)"
                >
                  <svg class="header-action-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z" />
                  </svg>
                </button>

                <!-- 删除最后一条时间线轨道 -->
                <button
                  class="header-action-btn"
                  type="button"
                  aria-label="删除最后一条时间线轨道"
                  :disabled="selectedEventId === null || !(events.find(event => event.id === selectedEventId)?.timelineTrackCount)"
                  @pointerdown.stop
                  @dblclick.stop
                  @click.stop="handleRemoveTimelineTrack(win)"
                >
                  <svg class="header-action-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19-2v-2h-8v2h8z" />
                  </svg>
                </button>

                <!-- 录制当前事件时间线 -->
                <button
                  class="header-action-btn"
                  :class="{ 'is-recording': isEventRecording }"
                  type="button"
                  :aria-label="isEventRecording ? '停止录制事件' : '开始录制事件'"
                  :disabled="selectedEventId === null"
                  @pointerdown.stop
                  @dblclick.stop
                  @click.stop="handleToggleEventRecording(win)"
                >
                  <svg class="header-action-icon" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="5" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- 右上角控制按钮组：收起/展开、最大化/还原、关闭 -->
          <div class="window-controls" @pointerdown.stop>
            <!-- 收起 / 展开窗口按钮 -->
            <button
              class="control-btn collapse-btn"
              type="button"
              :aria-label="win.isCollapsed ? '展开' : '收起'"
              @click="toggleCollapse(win)"
            >
              <!-- 展开图标：Keyboard Arrow Down (收起状态下显示) -->
              <svg
                v-if="win.isCollapsed"
                class="control-icon"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
              </svg>
              <!-- 收起图标：Keyboard Arrow Up (展开状态下显示) -->
              <svg
                v-else
                class="control-icon"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
              </svg>
            </button>

            <!-- 最大化 / 还原窗口按钮 -->
            <button
              class="control-btn maximize-btn"
              type="button"
              :aria-label="win.isMaximized ? '还原' : '最大化'"
              @click="toggleMaximize(win)"
            >
              <!-- open in full 图标 -->
              <svg
                v-if="!win.isMaximized"
                class="control-icon"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z" />
              </svg>
              <!-- close fullscreen (还原) 图标 -->
              <svg
                v-else
                class="control-icon"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path
                  d="M22 3.41l-5.29 5.29L20 12h-8V4l3.29 3.29L20.59 2 22 3.41zM3.41 22l5.29-5.29L12 20v-8H4l3.29 3.29L2 20.59 3.41 22z"
                />
              </svg>
            </button>

            <!-- 关闭按钮 -->
            <button
              class="control-btn close-btn"
              type="button"
              aria-label="关闭"
              @click="handleCloseWindow(win)"
            >
              <svg class="control-icon" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                />
              </svg>
            </button>
          </div>
        </div>

        <!-- 窗口主体内容 -->
        <div
          class="window-content"
          :class="{
            'is-settings': win.type === 'settings',
            'is-bpm': win.type === 'bpm',
            'is-presets': win.type === 'presets',
            'is-events': win.type === 'events',
            'is-project-manager': win.type === 'project-manager',
            'is-design': win.type === 'design',
            'is-video': win.type === 'video',
            'is-terminal': win.type === 'terminal'
          }"
        >
          <SettingsContent v-if="win.type === 'settings'" />
          <BpmContent v-else-if="win.type === 'bpm'" />
          <PresetsContent v-else-if="win.type === 'presets'" />
          <EventsContent v-else-if="win.type === 'events'" />
          <ProjectManagerContent v-else-if="win.type === 'project-manager'" />
          <DesignContent v-else-if="win.type === 'design'" />
          <VideoContent v-else-if="win.type === 'video'" />
          <TerminalContent v-else-if="win.type === 'terminal'" />
        </div>

        <!-- 窗口尺寸调整边框与角落把手 (8-Direction Resize Handles) -->
        <template v-if="!win.isMaximized && !win.isCollapsed">
          <!-- 4 条边框 -->
          <div
            class="resize-handle handle-top"
            @pointerdown.stop="startResize($event, win, 'n')"
          />
          <div
            class="resize-handle handle-bottom"
            @pointerdown.stop="startResize($event, win, 's')"
          />
          <div
            class="resize-handle handle-left"
            @pointerdown.stop="startResize($event, win, 'w')"
          />
          <div
            class="resize-handle handle-right"
            @pointerdown.stop="startResize($event, win, 'e')"
          />
          <!-- 4 个角 -->
          <div
            class="resize-handle handle-top-left"
            @pointerdown.stop="startResize($event, win, 'nw')"
          />
          <div
            class="resize-handle handle-top-right"
            @pointerdown.stop="startResize($event, win, 'ne')"
          />
          <div
            class="resize-handle handle-bottom-left"
            @pointerdown.stop="startResize($event, win, 'sw')"
          />
          <div
            class="resize-handle handle-bottom-right"
            @pointerdown.stop="startResize($event, win, 'se')"
          />
        </template>
      </div>
    </TransitionGroup>

    <!-- 四角吸附触发反馈 -->
    <div
      v-if="draggingWinId"
      class="quadrant-snap-layer"
      aria-hidden="true"
    >
      <div
        v-if="dragCornerPreview"
        :key="dragCornerPreview"
        class="quadrant-snap-fill"
        :style="dragQuadrantFillStyle"
      />
    </div>
  </div>
</template>

<style scoped>
.workspace-area {
  position: relative;
  width: 100%;
  height: 100%;
  flex: 1;
  overflow: hidden;
}

/* 拖动窗口时的四角触发区域与目标象限预览 */
.quadrant-snap-layer {
  position: absolute;
  inset: 0;
  z-index: 10000;
  overflow: hidden;
  pointer-events: none;
}

.quadrant-snap-fill {
  position: absolute;
  border: 1px solid rgba(138, 180, 248, 0.36);
  background-color: rgba(138, 180, 248, 0.16);
  animation: quadrant-fill-in 0.18s cubic-bezier(0.2, 0, 0, 1) both;
}

@keyframes quadrant-fill-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

/* MD3 浮动窗口 */
.md3-window {
  position: absolute;
  display: flex;
  flex-direction: column;
  background-color: var(--md-sys-color-surface-container, #22262e);
  border: 1px solid var(--md-sys-color-outline-variant, #3a404c);
  border-radius: var(--md-sys-shape-corner-large, 16px);
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.4),
    0 2px 6px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  transform-origin: center center;
  will-change: transform, opacity, left, top, width, height;
  clip-path: inset(
    var(--clip-top, -60px)
    var(--clip-right, -60px)
    var(--clip-bottom, -60px)
    var(--clip-left, -60px)
  );
  transition:
    left 0.22s cubic-bezier(0.2, 0, 0, 1),
    top 0.22s cubic-bezier(0.2, 0, 0, 1),
    width 0.22s cubic-bezier(0.2, 0, 0, 1),
    height 0.22s cubic-bezier(0.2, 0, 0, 1),
    border-radius 0.22s cubic-bezier(0.2, 0, 0, 1),
    box-shadow 0.22s cubic-bezier(0.2, 0, 0, 1),
    border-color 0.2s cubic-bezier(0.2, 0, 0, 1),
    clip-path 0.2s ease;
  user-select: none;
}

/* 用户手动鼠标拖拽或边框调整大小时，零延迟 60/120fps 跟手 */
.md3-window.is-dragging,
.md3-window.is-resizing,
.md3-window.is-window-resizing {
  transition: none !important;
}

/* 焦点窗口边框高亮（仅高亮原有 1px 边框，无额外外加边框） */
.md3-window.focused {
  border-color: var(--md-sys-color-primary, #8ab4f8);
  box-shadow:
    0 16px 36px rgba(0, 0, 0, 0.55),
    0 4px 12px rgba(0, 0, 0, 0.35);
}

.md3-window.focused .window-header {
  background-color: var(--md-sys-color-surface-container-highest, #323843);
}

.md3-window.focused .window-title,
.md3-window.focused .window-type-icon {
  color: var(--md-sys-color-on-surface, #e8edf2);
}

.md3-window:not(.focused) .window-title,
.md3-window:not(.focused) .window-type-icon {
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

/* 最大化窗口（与平滑尺寸动画配合，移除硬性 top/left 覆盖） */
.md3-window.maximized {
  border-radius: 0;
  border: none;
  box-shadow: none;
  --clip-top: 0px;
  --clip-right: 0px;
  --clip-bottom: 0px;
  --clip-left: 0px;
}

/* 窗口贴靠边框或相互贴合时消除对应边的圆角与向外溢出的阴影 */
.md3-window.touch-top {
  border-top-left-radius: 0 !important;
  border-top-right-radius: 0 !important;
  --clip-top: 0px;
}

.md3-window.touch-bottom {
  border-bottom-left-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
  --clip-bottom: 0px;
}

.md3-window.touch-left {
  border-top-left-radius: 0 !important;
  border-bottom-left-radius: 0 !important;
  --clip-left: 0px;
}

.md3-window.touch-right {
  border-top-right-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
  --clip-right: 0px;
}

/* 窗口顶部标题栏 */
.window-header {
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 0 8px 0 16px;
  background-color: var(--md-sys-color-surface-container-high, #282c35);
  border-bottom: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08));
  transition:
    background-color 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.window-header.draggable {
  cursor: grab;
}

.window-header.draggable:active {
  cursor: grabbing;
}

.window-title-area {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
}

.window-type-icon {
  width: 18px;
  height: 18px;
  color: var(--md-sys-color-on-surface, #e8edf2);
  flex-shrink: 0;
  transition: color 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.window-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface, #e6e0e9);
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
}

.video-window-title {
  flex: 0 1 auto;
  min-width: 0;
  text-overflow: clip;
  transition: none;
}

.window-title + .header-actions {
  margin-left: 0;
}

/* 标题栏操作按钮组（左侧） */
.header-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.video-playback-controls {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* 标题栏操作按钮（如事件添加按钮、预设添加、吸色、预览播放） */
.header-action-btn {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--md-sys-shape-corner-full, 9999px);
  border: none;
  background-color: transparent;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  outline: none;
  flex-shrink: 0;
  transition:
    background-color 0.2s cubic-bezier(0.2, 0, 0, 1),
    color 0.2s cubic-bezier(0.2, 0, 0, 1),
    transform 0.1s cubic-bezier(0.2, 0, 0, 1);
}

.header-action-btn:hover {
  background-color: rgba(255, 255, 255, 0.12);
  color: var(--md-sys-color-on-surface, #ffffff);
}

.header-action-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.header-action-btn:disabled:hover {
  background-color: transparent;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

.header-action-btn.is-active,
.header-action-btn.is-recording {
  color: var(--md-sys-color-primary, #8ab4f8);
  background-color: rgba(138, 180, 248, 0.14);
}

.header-action-btn:active {
  background-color: rgba(255, 255, 255, 0.2);
  transform: scale(0.92);
}

.header-action-icon {
  width: 18px;
  height: 18px;
}

.design-mode-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.design-toolbar-action-enter-active,
.design-toolbar-action-leave-active {
  transition: opacity 0.18s cubic-bezier(0.2, 0, 0, 1);
}

.design-toolbar-action-enter-from,
.design-toolbar-action-leave-to {
  opacity: 0;
}

/* 窗口控制按钮（右上角：收起/展开、最大化/还原、关闭） */
.window-controls {
  position: relative;
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.control-btn {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--md-sys-shape-corner-full, 9999px);
  border: none;
  background-color: transparent;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  outline: none;
  transition:
    background-color 0.2s cubic-bezier(0.2, 0, 0, 1),
    color 0.2s cubic-bezier(0.2, 0, 0, 1),
    transform 0.1s cubic-bezier(0.2, 0, 0, 1);
}

.control-btn:hover {
  background-color: rgba(255, 255, 255, 0.12);
  color: var(--md-sys-color-on-surface, #ffffff);
}

.control-btn:active {
  background-color: rgba(255, 255, 255, 0.2);
  transform: scale(0.92);
}

.control-icon {
  width: 18px;
  height: 18px;
}

/* 箭头图标包含较多内部留白，提升至 22px 以与全屏、关闭等图标视觉大小统一 */
.control-btn.collapse-btn .control-icon {
  width: 22px;
  height: 22px;
}

/* 窗口主体 */
.window-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  background-color: var(--md-sys-color-surface, #1c1f26);
}

.window-content.is-settings,
.window-content.is-bpm,
.window-content.is-presets,
.window-content.is-events,
.window-content.is-project-manager,
.window-content.is-design,
.window-content.is-video,
.window-content.is-terminal {
  padding: 0;
  overflow: hidden;
}

/* 窗口折叠收起与展开平滑过渡 */
.md3-window.collapsed .window-content {
  pointer-events: none;
  visibility: hidden;
  opacity: 0;
  height: 0 !important;
  min-height: 0 !important;
  flex: 0 0 0px !important;
  overflow: hidden !important;
  padding: 0 !important;
  margin: 0 !important;
  border: none !important;
  transition:
    visibility 0s linear 0.22s,
    opacity 0.18s cubic-bezier(0.2, 0, 0, 1);
}

.md3-window:not(.collapsed) .window-content {
  visibility: visible;
  opacity: 1;
  transition:
    visibility 0s linear 0s,
    opacity 0.22s cubic-bezier(0.2, 0, 0, 1);
}


/* 窗口四边与四角拖拽手柄样式 (Resize Handles) */
.resize-handle {
  position: absolute;
  z-index: 20;
  touch-action: none;
  user-select: none;
}

/* 4 条边缘边框手柄 */
.handle-top {
  top: 0;
  left: 14px;
  right: 14px;
  height: 6px;
  cursor: n-resize;
}

.handle-bottom {
  bottom: 0;
  left: 14px;
  right: 14px;
  height: 6px;
  cursor: s-resize;
}

.handle-left {
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 6px;
  cursor: w-resize;
}

.handle-right {
  right: 0;
  top: 14px;
  bottom: 14px;
  width: 6px;
  cursor: e-resize;
}

/* 4 个对角手柄 */
.handle-top-left {
  top: 0;
  left: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  z-index: 21;
}

.handle-top-right {
  top: 0;
  right: 0;
  width: 14px;
  height: 14px;
  cursor: nesw-resize;
  z-index: 21;
}

.handle-bottom-left {
  bottom: 0;
  left: 0;
  width: 14px;
  height: 14px;
  cursor: nesw-resize;
  z-index: 21;
}

.handle-bottom-right {
  bottom: 0;
  right: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  z-index: 21;
}

/* 窗口打开/关闭动效：以窗口自身几何中心为原点的平滑缩放与淡入淡出（严格原位，无任何朝向位移） */
.window-anim-enter-active,
.window-anim-appear-active {
  transition:
    opacity 0.16s cubic-bezier(0.05, 0.7, 0.1, 1),
    transform 0.16s cubic-bezier(0.05, 0.7, 0.1, 1);
}

.window-anim-leave-active {
  transition:
    opacity 0.16s cubic-bezier(0.2, 0, 0, 1),
    transform 0.16s cubic-bezier(0.2, 0, 0, 1);
  pointer-events: none;
  z-index: 10000 !important;
}

.window-anim-enter-from,
.window-anim-appear-from,
.window-anim-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

.window-anim-enter-to,
.window-anim-appear-to,
.window-anim-leave-from {
  opacity: 1;
  transform: scale(1);
}
</style>
