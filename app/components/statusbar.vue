<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  watch,
  type CSSProperties
} from 'vue'
import { devicesManager } from '~/composables/devicesmanager'
import { useRealtimeBpm } from '~/composables/bpmanalyzer'
import { projectManager } from '~/composables/projectmanager'
import { renderStatusManager } from '~/composables/renderstatusmanager'
import { settingsManager } from '~/composables/settingsmanager'
import { videoManager } from '~/composables/videomanager'
import {
  statusBarNoticeManager,
  useStatusBarNoticeView,
  type StatusBarNoticeState
} from '~/composables/statusbarnotice'
import { windowsManager } from '~/composables/windowsmanager'

// 设备管理器
const {
  hasConnectedDevice,
  unexpectedDisconnectToken
} = devicesManager()

// 项目管理器
const { currentProject } = projectManager()
const { videoSrc, isOfflineMedia } = videoManager()

// 设置管理器
const {
  showSeconds,
  statusBarBeatIndicator
} = settingsManager()
const {
  bpm: realtimeBpm,
  status: bpmStatus,
  beatPulse
} = useRealtimeBpm()
const {
  showStatusBarNotice,
  clearStatusBarNotice
} = statusBarNoticeManager()
const {
  status: renderStatus,
  progress: renderProgress
} = renderStatusManager()
const {
  message: bpmStatusNotice,
  noticeState: bpmStatusNoticeState,
  isExpanded: isBpmStatusNoticeExpanded,
  isCollapsing: isBpmStatusNoticeCollapsing
} = useStatusBarNoticeView('bpm')
const {
  message: settingsStatusNotice,
  noticeState: settingsStatusNoticeState,
  isExpanded: isSettingsStatusNoticeExpanded,
  isCollapsing: isSettingsStatusNoticeCollapsing
} = useStatusBarNoticeView('settings')
const {
  message: timeStatusNotice,
  noticeState: timeStatusNoticeState,
  isExpanded: isTimeStatusNoticeExpanded,
  isCollapsing: isTimeStatusNoticeCollapsing
} = useStatusBarNoticeView('time')
const {
  message: projectStatusNotice,
  noticeState: projectStatusNoticeState,
  isExpanded: isProjectStatusNoticeExpanded,
  isCollapsing: isProjectStatusNoticeCollapsing
} = useStatusBarNoticeView('project')
const {
  message: videoStatusNotice,
  noticeState: videoStatusNoticeState,
  isExpanded: isVideoStatusNoticeExpanded,
  isCollapsing: isVideoStatusNoticeCollapsing
} = useStatusBarNoticeView('video')
const {
  message: exitStatusNotice,
  noticeState: exitStatusNoticeState,
  isExpanded: isExitStatusNoticeExpanded,
  isCollapsing: isExitStatusNoticeCollapsing
} = useStatusBarNoticeView('exit')
const {
  message: renderStatusNotice,
  noticeState: renderStatusNoticeState,
  isExpanded: isRenderStatusNoticeExpanded,
  isCollapsing: isRenderStatusNoticeCollapsing
} = useStatusBarNoticeView('render')
const hasAutoShownRenderStatusNotice = useState<boolean>(
  'render_status_auto_notice_shown',
  () => false
)
const isAutoRenderStatusNoticeActive = ref(false)
const projectButtonRef = ref<HTMLButtonElement | null>(null)
const projectButtonNaturalWidth = ref(192)

const renderRingDash = computed(() => {
  const progress = Math.max(0, Math.min(1, renderProgress.value))
  return `${progress} ${1 - progress}`
})

const RENDER_ETA_TICK_MS = 250
const renderEtaVisible = ref(false)
const renderEtaSeconds = ref<number | null>(null)
const renderEtaDeadlineAt = ref<number | null>(null)
const renderEtaAutoAllowed = ref(false)
const renderEtaRequested = ref(false)
let renderStartedAt = 0
let renderEtaTimer: ReturnType<typeof setInterval> | null = null

const clearRenderEtaTimer = () => {
  if (renderEtaTimer) {
    clearInterval(renderEtaTimer)
    renderEtaTimer = null
  }
}

const updateRenderEta = () => {
  const now = Date.now()
  if (!renderStartedAt) return

  const elapsedSeconds = Math.max(0, (now - renderStartedAt) / 1000)
  const progress = Math.max(0, Math.min(1, renderProgress.value))
  if (progress > 0.01) {
    const estimatedSeconds = Math.max(
      0,
      elapsedSeconds * (1 - progress) / progress
    )
    const estimatedDeadline = now + estimatedSeconds * 1000
    const currentDeadline = renderEtaDeadlineAt.value
    if (currentDeadline === null) {
      renderEtaDeadlineAt.value = estimatedDeadline
    } else if (renderEtaVisible.value) {
      const remainingMs = Math.max(0, currentDeadline - now)
      const adjustmentThreshold = Math.max(5000, remainingMs * 0.3)
      if (
        currentDeadline <= now ||
        Math.abs(estimatedDeadline - currentDeadline) > adjustmentThreshold
      ) {
        renderEtaDeadlineAt.value = estimatedDeadline
      }
    } else {
      renderEtaDeadlineAt.value = estimatedDeadline
    }
    if (renderEtaAutoAllowed.value || renderEtaRequested.value) {
      renderEtaVisible.value = true
    }
  }

  const deadline = renderEtaDeadlineAt.value
  if (deadline !== null) {
    renderEtaSeconds.value = Math.max(0, (deadline - now) / 1000)
  }
}

const startRenderEtaTracking = () => {
  clearRenderEtaTimer()
  renderStartedAt = Date.now()
  renderEtaVisible.value = false
  renderEtaSeconds.value = null
  renderEtaDeadlineAt.value = null
  renderEtaAutoAllowed.value = false
  renderEtaRequested.value = false
  updateRenderEta()
  renderEtaTimer = setInterval(updateRenderEta, RENDER_ETA_TICK_MS)
}

const stopRenderEtaTracking = () => {
  clearRenderEtaTimer()
  renderStartedAt = 0
  renderEtaVisible.value = false
  renderEtaSeconds.value = null
  renderEtaDeadlineAt.value = null
  renderEtaAutoAllowed.value = false
  renderEtaRequested.value = false
}

watch(
  renderStatus,
  (status) => {
    if (status === 'rendering') {
      if (!renderEtaTimer) startRenderEtaTracking()
      return
    }
    stopRenderEtaTracking()
  },
  { immediate: true }
)

const renderRemainingParts = computed(() => {
  const estimatedSeconds = renderEtaSeconds.value
  if (estimatedSeconds === null) {
    return { value: '--', unit: '' }
  }

  const remainingSeconds = Math.max(0, Math.ceil(estimatedSeconds))
  if (remainingSeconds < 60) {
    return { value: String(remainingSeconds), unit: '秒' }
  }
  if (remainingSeconds < 3600) {
    return {
      value: String(Math.ceil(remainingSeconds / 60)),
      unit: '分'
    }
  }
  return {
    value: String(Math.ceil(remainingSeconds / 3600)),
    unit: '时'
  }
})

const renderRemainingValueText = computed(() => {
  const { value, unit } = renderRemainingParts.value
  return `${value}${unit}`
})

const renderStatusDisplayText = computed(() => {
  if (renderStatus.value === 'rendering' && renderEtaVisible.value) {
    return `剩余 ${renderRemainingValueText.value}`
  }
  return renderStatusNotice.value
})

const isRenderStatusExpanded = computed(() => {
  return isRenderStatusNoticeExpanded.value || renderEtaVisible.value
})

// 窗口管理器
const {
  openPresetsWindow,
  openEventsWindow,
  openDesignWindow,
  openVideoWindow,
  isVideoOpen,
  openTerminalWindow,
  openBpmWindow,
  openSettingsWindow,
  openProjectManagerWindow,
  isBpmOpen,
  isInitialProjectManagerOpen
} = windowsManager()

// 返回浏览器上一级
const EXIT_CONFIRMATION_DURATION_MS = 2000
const exitConfirmationArmed = ref(false)
let exitConfirmationTimer: ReturnType<typeof setTimeout> | null = null

const resetExitConfirmation = () => {
  if (exitConfirmationTimer) {
    clearTimeout(exitConfirmationTimer)
    exitConfirmationTimer = null
  }
  exitConfirmationArmed.value = false
}

const handleExitClick = () => {
  if (!exitConfirmationArmed.value) {
    exitConfirmationArmed.value = true
    showStatusBarNotice(
      'exit',
      '再按一次退出',
      EXIT_CONFIRMATION_DURATION_MS
    )

    if (exitConfirmationTimer) {
      clearTimeout(exitConfirmationTimer)
    }
    exitConfirmationTimer = setTimeout(() => {
      exitConfirmationArmed.value = false
      exitConfirmationTimer = null
    }, EXIT_CONFIRMATION_DURATION_MS)
    return
  }

  resetExitConfirmation()
  clearStatusBarNotice('exit')
  if (typeof window !== 'undefined') {
    window.history.back()
  }
}

// 全屏控制
const isFullscreen = ref(false)

const updateFullscreenState = () => {
  if (typeof document !== 'undefined') {
    isFullscreen.value = Boolean(document.fullscreenElement)
  }
}

const toggleFullscreen = async () => {
  if (typeof document === 'undefined') return

  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  } catch (err) {
    console.error('全屏模式切换失败:', err)
  }
}

// 中央项目管理标题显示
const projectDisplayName = computed(() => {
  if (currentProject.value?.name?.trim()) {
    return currentProject.value.name.trim()
  }
  return 'LiveStage Effects'
})

const handleProjectClick = () => {
  openProjectManagerWindow()
}

const handleRenderStatusClick = () => {
  if (renderStatus.value === 'rendering') {
    renderEtaRequested.value = true
    if (renderEtaDeadlineAt.value !== null) {
      renderEtaVisible.value = true
    }
    showStatusBarNotice('render', '正在渲染', null)
    return
  }
  if (renderStatus.value === 'completed') {
    showStatusBarNotice('render', '渲染完成')
    return
  }
  showStatusBarNotice('render', '当前未渲染')
}

const bpmButtonText = computed(() => {
  return realtimeBpm.value === null ? '' : realtimeBpm.value.toFixed(1)
})

const BPM_COLLAPSE_ICON_DURATION_MS = 120
const bpmCollapseShowsIcon = ref(false)
let bpmCollapseIconTimer: ReturnType<typeof setTimeout> | null = null

watch(
  isBpmStatusNoticeCollapsing,
  (isCollapsing) => {
    if (bpmCollapseIconTimer) {
      clearTimeout(bpmCollapseIconTimer)
      bpmCollapseIconTimer = null
    }

    bpmCollapseShowsIcon.value = isCollapsing
    if (!isCollapsing) return

    bpmCollapseIconTimer = setTimeout(() => {
      bpmCollapseShowsIcon.value = false
      bpmCollapseIconTimer = null
    }, BPM_COLLAPSE_ICON_DURATION_MS)
  },
  { immediate: true }
)

const bpmButtonShowsIcon = computed(() => {
  return realtimeBpm.value === null
    || (
      isBpmStatusNoticeCollapsing.value
      && bpmCollapseShowsIcon.value
    )
})

const bpmButtonIconState = computed(() => {
  if (bpmStatus.value === 'filtering') return 'filtering'
  if (bpmStatus.value === 'non-music') return 'non-music'
  return 'default'
})

const STARTUP_CONNECTION_NOTICE_DURATION_MS = 5000
const TEMPORARY_PROJECT_NOTICE_DELAY_MS = 2000
const CONNECTION_SUCCESS_NOTICE_DURATION_MS = 2000
const CONNECTION_NOTICE_DELAY_MS = 420
const UNEXPECTED_DISCONNECT_NOTICE_DURATION_MS = 5000
const NOT_CONNECTED_NOTICE_BACKGROUND = '#ffb300'
const NOT_CONNECTED_NOTICE_TEXT_COLOR = '#2b1b00'
const OFFLINE_MEDIA_NOTICE_BACKGROUND = '#ffb300'
const OFFLINE_MEDIA_NOTICE_TEXT_COLOR = '#2b1b00'
const DISCONNECT_WARNING_BACKGROUND = 'rgba(198, 40, 40, 0.45)'
const DISCONNECT_WARNING_TEXT_COLOR = '#ffffff'

watch(
  renderStatus,
  (status, previousStatus) => {
    const isNoticeOpen = Boolean(renderStatusNotice.value)

    if (status === 'rendering') {
      renderEtaAutoAllowed.value = !hasAutoShownRenderStatusNotice.value
      if (renderEtaAutoAllowed.value) {
        hasAutoShownRenderStatusNotice.value = true
        isAutoRenderStatusNoticeActive.value = true
        showStatusBarNotice('render', '正在渲染', null)
        return
      }
      if (isNoticeOpen) {
        clearStatusBarNotice('render')
      }
      return
    }
    if (status === 'completed') {
      if (isAutoRenderStatusNoticeActive.value || isNoticeOpen) {
        showStatusBarNotice('render', '渲染完成')
      }
      isAutoRenderStatusNoticeActive.value = false
      return
    }
    if (previousStatus !== 'idle') {
      isAutoRenderStatusNoticeActive.value = false
      if (isNoticeOpen) {
        clearStatusBarNotice('render')
      }
    }
  },
  { immediate: true }
)

const getStatusBarNoticeStyle = (notice: StatusBarNoticeState | null) => {
  if (!notice) return undefined

  const style: CSSProperties = {}
  if (notice.backgroundColor) {
    style['--status-bar-notice-background'] = notice.backgroundColor
    style.backgroundColor = notice.backgroundColor
  }
  if (notice.textColor) {
    style.color = notice.textColor
  }
  return style
}

const projectButtonStyle = computed<CSSProperties>(() => ({
  ...(getStatusBarNoticeStyle(projectStatusNoticeState.value) || {}),
  '--project-button-natural-width': `${projectButtonNaturalWidth.value}px`
}))

const cacheProjectButtonNaturalWidth = () => {
  if (projectStatusNotice.value || isProjectStatusNoticeCollapsing.value) return
  const width = projectButtonRef.value?.getBoundingClientRect().width ?? 0
  if (width > 0) {
    projectButtonNaturalWidth.value = width
  }
}

watch(
  [projectDisplayName, isProjectStatusNoticeExpanded],
  () => nextTick(cacheProjectButtonNaturalWidth)
)

const getBpmStatusNotice = (status: string) => {
  switch (status) {
    case 'idle':
      return '等待音频'
    case 'waiting':
      return '正在等待节拍'
    case 'analyzing':
      return '实时识别中'
    case 'paused':
      return '识别已暂停'
    case 'filtering':
      return '正在判断音频'
    case 'non-music':
      return '检测到非音乐'
    case 'unavailable':
      return '音频不可用'
    default:
      return ''
  }
}

const shownBpmStatusNotices = new Set<string>()

const resetBpmNoticeHistory = () => {
  shownBpmStatusNotices.clear()
}

const showBpmStatusNotice = (status: string) => {
  const notice = getBpmStatusNotice(status)
  if (!notice || shownBpmStatusNotices.has(status)) return
  shownBpmStatusNotices.add(status)
  showStatusBarNotice('bpm', notice)
}

watch(() => bpmStatus.value, showBpmStatusNotice)
watch(() => videoSrc.value, () => {
  resetBpmNoticeHistory()
})

let startupConnectionNoticeShown = false
let connectionNoticeTimer: ReturnType<typeof setTimeout> | null = null
let temporaryProjectNoticeTimer: ReturnType<typeof setTimeout> | null = null

const showStartupConnectionNotice = () => {
  if (startupConnectionNoticeShown || hasConnectedDevice.value) return
  startupConnectionNoticeShown = true
  showStatusBarNotice(
    'settings',
    '未连接设备',
    STARTUP_CONNECTION_NOTICE_DURATION_MS,
    {
      backgroundColor: NOT_CONNECTED_NOTICE_BACKGROUND,
      textColor: NOT_CONNECTED_NOTICE_TEXT_COLOR
    }
  )
}

watch(
  () => isInitialProjectManagerOpen.value,
  (isOpen) => {
    if (!isOpen) {
      if (temporaryProjectNoticeTimer) {
        clearTimeout(temporaryProjectNoticeTimer)
        temporaryProjectNoticeTimer = null
      }
      if (!currentProject.value) {
        temporaryProjectNoticeTimer = setTimeout(() => {
          temporaryProjectNoticeTimer = null
          if (currentProject.value || isInitialProjectManagerOpen.value) return
          showStatusBarNotice('project', '当前为临时项目')
        }, TEMPORARY_PROJECT_NOTICE_DELAY_MS)
      }
      showStartupConnectionNotice()
    }
  },
  { flush: 'post' }
)

watch(
  () => hasConnectedDevice.value,
  (isConnected, wasConnected) => {
    if (connectionNoticeTimer) {
      clearTimeout(connectionNoticeTimer)
      connectionNoticeTimer = null
    }
    clearStatusBarNotice('settings')

    if (!isConnected || wasConnected) return

    connectionNoticeTimer = setTimeout(() => {
      connectionNoticeTimer = null
      if (!hasConnectedDevice.value) return

      showStatusBarNotice(
        'settings',
        '设备已连接',
        CONNECTION_SUCCESS_NOTICE_DURATION_MS
      )
    }, CONNECTION_NOTICE_DELAY_MS)
  }
)

let lastUnexpectedDisconnectToken = unexpectedDisconnectToken.value

watch(
  () => unexpectedDisconnectToken.value,
  (token) => {
    if (token <= lastUnexpectedDisconnectToken) return
    lastUnexpectedDisconnectToken = token

    showStatusBarNotice(
      'settings',
      '设备已断开',
      UNEXPECTED_DISCONNECT_NOTICE_DURATION_MS,
      {
        backgroundColor: DISCONNECT_WARNING_BACKGROUND,
        textColor: DISCONNECT_WARNING_TEXT_COLOR
      }
    )
  }
)

watch(
  () => isOfflineMedia.value,
  (isOffline, wasOffline) => {
    if (!isOffline || wasOffline) return
    showStatusBarNotice('video', '需要处理', undefined, {
      backgroundColor: OFFLINE_MEDIA_NOTICE_BACKGROUND,
      textColor: OFFLINE_MEDIA_NOTICE_TEXT_COLOR
    })
  },
  { immediate: true }
)

// 右侧时钟显示
const hours = ref('')
const minutes = ref('')
const seconds = ref('')
const hasTime = computed(() => Boolean(hours.value && minutes.value))
let timeTimer: ReturnType<typeof setInterval> | null = null

const updateTime = () => {
  const now = new Date()
  hours.value = String(now.getHours()).padStart(2, '0')
  minutes.value = String(now.getMinutes()).padStart(2, '0')
  seconds.value = String(now.getSeconds()).padStart(2, '0')
}

onMounted(() => {
  updateFullscreenState()
  document.addEventListener('fullscreenchange', updateFullscreenState)
  updateTime()
  timeTimer = setInterval(updateTime, 1000)
  nextTick(cacheProjectButtonNaturalWidth)
  if (!isInitialProjectManagerOpen.value) {
    showStartupConnectionNotice()
  }
})

onUnmounted(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('fullscreenchange', updateFullscreenState)
  }
  if (timeTimer) {
    clearInterval(timeTimer)
  }
  if (connectionNoticeTimer) {
    clearTimeout(connectionNoticeTimer)
  }
  if (temporaryProjectNoticeTimer) {
    clearTimeout(temporaryProjectNoticeTimer)
  }
  if (bpmCollapseIconTimer) {
    clearTimeout(bpmCollapseIconTimer)
  }
  if (exitConfirmationTimer) {
    clearTimeout(exitConfirmationTimer)
  }
  clearRenderEtaTimer()
})
</script>

<template>
  <header
    class="status-bar"
    :class="{ 'connected-blue': hasConnectedDevice }"
  >
    <span
      v-if="statusBarBeatIndicator && realtimeBpm !== null"
      :key="beatPulse"
      class="status-bar-beat-flash"
      aria-hidden="true"
    />
    <div class="status-bar-start">
      <!-- 返回浏览器上一级 -->
      <button
        class="md3-icon-button md3-exit-button"
        :class="{
          'is-status-notice': isExitStatusNoticeExpanded,
          'is-status-notice-collapsing': isExitStatusNoticeCollapsing,
          'has-notice-background': Boolean(exitStatusNoticeState?.backgroundColor),
          'is-notice-flash': Boolean(exitStatusNoticeState?.flash)
        }"
        :style="getStatusBarNoticeStyle(exitStatusNoticeState)"
        type="button"
        :aria-label="exitStatusNotice ? `返回上一级，${exitStatusNotice}` : '返回上一级'"
        @click="handleExitClick"
      >
        <span class="exit-button-content">
          <svg class="icon icon-exit" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path
              d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
            />
          </svg>
          <span
            v-if="exitStatusNotice"
            class="exit-confirm-text"
          >
            {{ exitStatusNotice }}
          </span>
        </span>
      </button>

      <!-- 全屏模式切换 -->
      <button
        class="md3-icon-button"
        type="button"
        :aria-label="isFullscreen ? '退出全屏' : '进入全屏'"
        @click="toggleFullscreen"
      >
        <svg v-if="!isFullscreen" class="icon icon-fullscreen" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
        </svg>
        <svg v-else class="icon icon-fullscreen" viewBox="0 0 24 24" fill="currentColor">
          <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
        </svg>
      </button>

      <!-- 预设窗口 -->
      <button
        class="md3-icon-button"
        type="button"
        aria-label="预设窗口"
        :disabled="isInitialProjectManagerOpen"
        @click="openPresetsWindow"
      >
        <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 2v3H5V5h14zm-7 5h7v4h-7v-4zm-2 0v4H5v-4h5zm-5 6h5v3H5v-3zm7 3v-3h7v3h-7z"
          />
        </svg>
      </button>

      <!-- 事件窗口 -->
      <button
        class="md3-icon-button"
        type="button"
        aria-label="事件窗口"
        :disabled="isInitialProjectManagerOpen"
        @click="openEventsWindow"
      >
        <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"
          />
        </svg>
      </button>

      <!-- 设计窗口 -->
      <button
        class="md3-icon-button"
        type="button"
        aria-label="设计窗口"
        :disabled="isInitialProjectManagerOpen"
        @click="openDesignWindow"
      >
        <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="m16.24 11.51 1.57-1.57-3.75-3.75-1.57 1.57-4.14-4.13c-.78-.78-2.05-.78-2.83 0l-1.9 1.9c-.78.78-.78 2.05 0 2.83l4.13 4.13L3 17.25V21h3.75l4.76-4.76 4.13 4.13c.95.95 2.23.6 2.83 0l1.9-1.9c.78-.78.78-2.05 0-2.83l-4.13-4.13zm-7.06-.44L5.04 6.94l1.89-1.9L8.2 6.31 7.02 7.5l1.41 1.41 1.19-1.19 1.45 1.45-1.89 1.9zm7.88 7.89-4.13-4.13 1.9-1.9 1.45 1.45-1.19 1.19 1.41 1.41 1.19-1.19 1.27 1.27-1.9 1.9zm3.65-11.92a.996.996 0 0 0 0-1.41l-2.34-2.34c-.47-.47-1.12-.29-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
          />
        </svg>
      </button>

      <!-- 视频 (Animated Images) -->
      <button
        class="md3-icon-button"
        :class="{
          'is-active': isVideoOpen,
          'is-status-notice': isVideoStatusNoticeExpanded,
          'is-status-notice-collapsing': isVideoStatusNoticeCollapsing,
          'has-notice-background': Boolean(videoStatusNoticeState?.backgroundColor),
          'is-notice-flash': Boolean(videoStatusNoticeState?.flash)
        }"
        :style="getStatusBarNoticeStyle(videoStatusNoticeState)"
        type="button"
        :aria-label="videoStatusNotice ? `视频，${videoStatusNotice}` : '视频 (Animated Images)'"
        :disabled="isInitialProjectManagerOpen"
        @click="openVideoWindow"
      >
        <span
          v-if="videoStatusNotice"
          class="status-bar-notice"
        >
          <svg
            class="status-bar-notice-icon"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
          </svg>
          <span>{{ videoStatusNotice }}</span>
        </span>
        <svg v-else class="icon" viewBox="0 -960 960 960" fill="currentColor">
          <path
            d="m480-420 240-160-240-160v320Zm33 220h219q-6 24-24 41.5T664-138L228-85q-33 4-59.5-16T138-154L86-592q-4-33 16.5-59t53.5-30l45-5v80l-36 4 54 438 294-36Zm-152-80q-33 0-56.5-23.5T281-360v-440q0-33 23.5-56.5T361-880h440q33 0 56.5 23.5T881-800v440q0 33-23.5 56.5T801-280H361Zm0-80h440v-440H361v440ZM219-164Zm362-416Z"
          />
        </svg>
      </button>

      <slot />
    </div>

    <!-- 中间项目管理按钮（显示当前项目名或 LiveStage Effects） -->
    <div class="status-bar-center">
      <button
        ref="projectButtonRef"
        class="md3-project-button"
        :class="{
          'is-status-notice': isProjectStatusNoticeExpanded,
          'is-status-notice-collapsing': isProjectStatusNoticeCollapsing,
          'has-notice-background': Boolean(projectStatusNoticeState?.backgroundColor),
          'is-notice-flash': Boolean(projectStatusNoticeState?.flash)
        }"
        :style="projectButtonStyle"
        type="button"
        :aria-label="projectStatusNotice ? `项目，${projectStatusNotice}` : projectDisplayName"
        @click="handleProjectClick"
      >
        <span
          v-if="projectStatusNotice"
          class="status-bar-notice"
        >
          <svg
            class="status-bar-notice-icon"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
          </svg>
          <span>{{ projectStatusNotice }}</span>
        </span>
        <span v-else class="project-title">{{ projectDisplayName }}</span>
      </button>
    </div>

    <div class="status-bar-end">
      <!-- 指令 -->
      <button
        class="md3-icon-button"
        type="button"
        aria-label="指令"
        :disabled="isInitialProjectManagerOpen"
        @click="openTerminalWindow"
      >
        <svg class="icon" viewBox="0 -960 960 960" fill="currentColor">
          <path
            d="M260-120q-58 0-99-41t-41-99q0-58 41-99t99-41h60v-160h-60q-58 0-99-41t-41-99q0-58 41-99t99-41q58 0 99 41t41 99v60h160v-60q0-58 41-99t99-41q58 0 99 41t41 99q0 58-41 99t-99 41h-60v160h60q58 0 99 41t41 99q0 58-41 99t-99 41q-58 0-99-41t-41-99v-60H400v60q0 58-41 99t-99 41Zm0-80q25 0 42.5-17.5T320-260v-60h-60q-25 0-42.5 17.5T200-260q0 25 17.5 42.5T260-200Zm440 0q25 0 42.5-17.5T760-260q0-25-17.5-42.5T700-320h-60v60q0 25 17.5 42.5T700-200ZM400-400h160v-160H400v160ZM260-640h60v-60q0-25-17.5-42.5T260-760q-25 0-42.5 17.5T200-700q0 25 17.5 42.5T260-640Zm380 0h60q25 0 42.5-17.5T760-700q0-25-17.5-42.5T700-760q-25 0-42.5 17.5T640-700v60Z"
          />
        </svg>
      </button>

      <!-- 设置 -->
      <button
        class="md3-icon-button"
        :class="{
          'is-status-notice': isSettingsStatusNoticeExpanded,
          'is-status-notice-collapsing': isSettingsStatusNoticeCollapsing,
          'has-notice-background': Boolean(settingsStatusNoticeState?.backgroundColor),
          'is-notice-flash': Boolean(settingsStatusNoticeState?.flash)
        }"
        :style="getStatusBarNoticeStyle(settingsStatusNoticeState)"
        type="button"
        :aria-label="settingsStatusNotice ? `设置，${settingsStatusNotice}` : '设置'"
        :disabled="isInitialProjectManagerOpen"
        @click="openSettingsWindow"
      >
        <span
          v-if="settingsStatusNotice"
          class="status-bar-notice"
        >
          <svg
            class="status-bar-notice-icon"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2.4h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.73 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.08.63-.08.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
            />
          </svg>
          <span>{{ settingsStatusNotice }}</span>
        </span>
        <svg v-else class="icon" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.92 2.4h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.73 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.08.63-.08.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
          />
        </svg>
      </button>

      <!-- 渲染状态 -->
      <button
        class="md3-icon-button render-status-button"
        :class="{
          'is-rendering': renderStatus === 'rendering',
          'is-render-completed': renderStatus === 'completed',
          'is-status-notice': isRenderStatusExpanded,
          'is-status-notice-collapsing': isRenderStatusNoticeCollapsing,
          'has-notice-background': Boolean(renderStatusNoticeState?.backgroundColor),
          'is-notice-flash': Boolean(renderStatusNoticeState?.flash)
        }"
        :style="getStatusBarNoticeStyle(renderStatusNoticeState)"
        type="button"
        :aria-label="
          renderStatusDisplayText
            ? `渲染状态，${renderStatusDisplayText}`
            : renderStatus === 'rendering'
              ? '渲染状态，正在渲染'
              : renderStatus === 'completed'
                ? '渲染状态，渲染完成'
                : '渲染状态，当前未渲染'
        "
        :disabled="isInitialProjectManagerOpen"
        @click="handleRenderStatusClick"
      >
        <span
          class="render-status-content"
          :class="{ 'has-notice': Boolean(renderStatusDisplayText) }"
        >
          <span
            class="render-status-icon"
            :class="`is-${renderStatus}`"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24">
              <circle
                class="render-ring-track"
                cx="12"
                cy="12"
                r="8"
              />
              <circle
                v-if="renderProgress > 0"
                class="render-ring-progress"
                cx="12"
                cy="12"
                r="8"
                pathLength="1"
                :stroke-dasharray="renderRingDash"
              />
              <path
                class="render-complete-check"
                d="M9.2 16.2 5 12l-1.4 1.4L9.2 19 21 7.2 19.6 5.8 9.2 16.2Z"
              />
            </svg>
          </span>
          <span
            v-if="renderStatus === 'rendering' && renderEtaVisible"
            class="render-status-eta"
          >
            <span class="render-status-eta-label">剩余</span>
            <span class="render-status-eta-value">
              {{ renderRemainingValueText }}
            </span>
          </span>
          <Transition v-else name="render-status-text" mode="out-in">
            <span
              v-if="renderStatusNotice"
              :key="renderStatusNotice"
              class="render-status-text"
            >
              {{ renderStatusNotice }}
            </span>
          </Transition>
        </span>
      </button>

      <!-- BPM 指示器 -->
      <button
        class="md3-icon-button md3-bpm-button"
        :class="{
          'is-active': isBpmOpen,
          'has-bpm': realtimeBpm !== null,
          'is-status-notice': isBpmStatusNoticeExpanded,
          'is-status-notice-collapsing': isBpmStatusNoticeCollapsing,
          'has-notice-background': Boolean(bpmStatusNoticeState?.backgroundColor),
          'is-notice-flash': Boolean(bpmStatusNoticeState?.flash)
        }"
        :style="getStatusBarNoticeStyle(bpmStatusNoticeState)"
        type="button"
        :aria-label="
          bpmStatusNotice
            ? `BPM 指示器，${bpmStatusNotice}`
            : realtimeBpm === null
              ? 'BPM 指示器，等待节拍'
              : `BPM 指示器，当前 ${bpmButtonText}`
        "
        :disabled="isInitialProjectManagerOpen"
        @click="openBpmWindow"
      >
        <span
          v-if="
            !statusBarBeatIndicator
            && realtimeBpm !== null
          "
          :key="beatPulse"
          class="bpm-beat-flash"
          aria-hidden="true"
        />
        <span
          v-if="bpmStatusNotice"
          class="status-bar-notice"
        >
          <svg
            class="status-bar-notice-icon"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M7 18h2V6H7v12zm4 4h2V2h-2v20zm-8-8h2v-4H3v4zm12 4h2V6h-2v12zm4-8v4h2v-4h-2z" />
          </svg>
          <span>{{ bpmStatusNotice }}</span>
        </span>
        <Transition
          v-else
          name="bpm-button-content"
          mode="out-in"
        >
          <svg
            v-if="bpmButtonShowsIcon"
            :key="bpmButtonIconState"
            class="bpm-button-icon"
            :class="{
              'is-filtering': bpmButtonIconState === 'filtering'
            }"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              v-if="bpmButtonIconState === 'non-music'"
              d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.3 1.41 1.41 6.3-6.3 6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.3-1.41-1.41Z"
            />
            <path
              v-else-if="bpmButtonIconState === 'filtering'"
              d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"
            />
            <path
              v-else
              d="M7 18h2V6H7v12zm4 4h2V2h-2v20zm-8-8h2v-4H3v4zm12 4h2V6h-2v12zm4-8v4h2v-4h-2z"
            />
          </svg>
          <span
            v-else
            key="value"
            class="bpm-button-value"
          >
            {{ bpmButtonText }}
          </span>
        </Transition>
      </button>

      <!-- 当前时间显示 -->
      <Transition name="status-time">
        <button
          v-if="hasTime"
          class="md3-time-button"
          :class="{
            'has-seconds': showSeconds,
            'is-status-notice': isTimeStatusNoticeExpanded,
            'is-status-notice-collapsing': isTimeStatusNoticeCollapsing,
            'has-notice-background': Boolean(timeStatusNoticeState?.backgroundColor),
            'is-notice-flash': Boolean(timeStatusNoticeState?.flash)
          }"
          :style="getStatusBarNoticeStyle(timeStatusNoticeState)"
          type="button"
          :aria-label="timeStatusNotice ? `当前时间，${timeStatusNotice}` : '当前时间'"
        >
          <template v-if="timeStatusNotice">
            <span class="status-bar-notice">
              <svg
                class="status-bar-notice-icon"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
              </svg>
              <span>{{ timeStatusNotice }}</span>
            </span>
          </template>
          <template v-else>
            <span class="time-text">
              <span class="time-part">{{ hours }}</span>
              <span class="time-colon">:</span>
              <span class="time-part">{{ minutes }}</span>
              <template v-if="showSeconds">
                <span class="time-colon">:</span>
                <span class="time-part">{{ seconds }}</span>
              </template>
            </span>
          </template>
        </button>
      </Transition>
    </div>
  </header>
</template>

<style scoped>
.status-bar {
  --status-bar-notice-default-background: var(--md-sys-color-primary, #8ab4f8);
  --status-bar-notice-default-text-color: var(--md-sys-color-on-primary, #042a59);
  --status-bar-button-default-color: var(--md-sys-color-on-surface-variant, #aab3bf);
  position: relative;
  height: 48px;
  width: 100%;
  box-sizing: border-box;
  background-color: var(--md-sys-color-surface-container-high, #282c35);
  border-bottom: 1px solid var(--md-sys-color-outline-variant, #3a404c);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px;
  overflow: hidden;
  transition:
    background-color 0.4s cubic-bezier(0.2, 0, 0, 1),
    border-color 0.4s cubic-bezier(0.2, 0, 0, 1),
    box-shadow 0.4s cubic-bezier(0.2, 0, 0, 1);
}

.status-bar-beat-flash {
  position: absolute;
  inset: 0;
  z-index: 0;
  background-color: var(--md-sys-color-primary, #a8c7fa);
  pointer-events: none;
  animation: status-bar-beat-flash 170ms cubic-bezier(0.2, 0, 0, 1) both;
}

@keyframes status-bar-beat-flash {
  0% {
    opacity: 0.42;
  }

  100% {
    opacity: 0;
  }
}

.status-bar.connected-blue {
  --md-sys-color-on-surface: #ffffff;
  --status-bar-button-default-color: #ffffff;
  background-color: rgb(96, 147, 185); /* r0.375 g0.576 b0.725 (#6093b9) */
  border-bottom: 1px solid rgba(255, 255, 255, 0.25);
  box-shadow: 0 2px 14px rgba(96, 147, 185, 0.4);
}

.status-bar-start {
  display: flex;
  align-items: center;
  gap: 4px;
  z-index: 1;
}

/* 状态栏中央项目管理显示（绝对居中容器） */
.status-bar-center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: calc(100% - 520px);
  z-index: 2;
  pointer-events: auto;
}

.status-bar-end {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  z-index: 1;
}

/* 默认未连接状态：状态栏图标与按钮采用常规冷静的灰白/冷灰色，与所有按钮保持一致颜色 */
.md3-icon-button {
  --status-bar-notice-collapsed-width: 40px;
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  border-radius: var(--md-sys-shape-corner-full, 9999px);
  background-color: transparent;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  border: none;
  cursor: pointer;
  user-select: none;
  outline: none;
  padding: 0;
  transition:
    color 0.3s cubic-bezier(0.2, 0, 0, 1),
    background-color 0.2s cubic-bezier(0.2, 0, 0, 1),
    flex-basis 0.3s cubic-bezier(0.2, 0, 0, 1),
    width 0.3s cubic-bezier(0.2, 0, 0, 1),
    min-width 0.3s cubic-bezier(0.2, 0, 0, 1),
    transform 0.1s cubic-bezier(0.2, 0, 0, 1);
}

.md3-icon-button:hover {
  color: var(--md-sys-color-on-surface, #e8edf2);
  background-color: var(--md-sys-color-surface-container-highest, rgba(255, 255, 255, 0.08));
}

.md3-icon-button:active {
  transform: scale(0.92);
}

.icon {
  width: 24px;
  height: 24px;
}

.icon.icon-exit {
  width: 26px;
  height: 26px;
  transform: scaleX(-1);
}

.exit-button-content {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: inherit;
}

.exit-confirm-text {
  color: inherit;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0;
  white-space: nowrap;
}

.icon.icon-fullscreen {
  width: 26px;
  height: 26px;
}

.md3-bpm-button {
  flex: 0 0 40px;
  width: 40px;
  min-width: 40px;
  padding: 0;
  transition:
    color 0.3s cubic-bezier(0.2, 0, 0, 1),
    background-color 0.2s cubic-bezier(0.2, 0, 0, 1),
    flex-basis 0.3s cubic-bezier(0.2, 0, 0, 1),
    width 0.3s cubic-bezier(0.2, 0, 0, 1),
    min-width 0.3s cubic-bezier(0.2, 0, 0, 1),
    transform 0.1s cubic-bezier(0.2, 0, 0, 1);
}

.md3-bpm-button.has-bpm {
  --status-bar-notice-collapsed-width: 72px;
  flex-basis: 72px;
  width: 72px;
  min-width: 72px;
}

.md3-icon-button.is-status-notice {
  flex: 0 0 124px;
  flex-basis: 124px;
  width: 124px;
  min-width: 124px;
  background-color: var(
    --status-bar-notice-background,
    var(--status-bar-notice-default-background)
  );
  color: var(
    --status-bar-notice-text-color,
    var(--status-bar-notice-default-text-color)
  );
  animation: status-bar-notice-expand 0.3s cubic-bezier(0.2, 0, 0, 1) both;
}

@keyframes status-bar-notice-expand {
  from {
    flex-basis: var(--status-bar-notice-collapsed-width);
    width: var(--status-bar-notice-collapsed-width);
    min-width: var(--status-bar-notice-collapsed-width);
  }

  to {
    flex-basis: 124px;
    width: 124px;
    min-width: 124px;
  }
}

.md3-icon-button.is-status-notice.is-status-notice-collapsing {
  animation: status-bar-notice-collapse 0.3s cubic-bezier(0.2, 0, 0, 1) both;
}

@keyframes status-bar-notice-collapse {
  from {
    flex-basis: 124px;
    width: 124px;
    min-width: 124px;
    background-color: var(
      --status-bar-notice-background,
      var(--status-bar-notice-default-background)
    );
    color: var(
      --status-bar-notice-text-color,
      var(--status-bar-notice-default-text-color)
    );
  }

  to {
    flex-basis: var(--status-bar-notice-collapsed-width);
    width: var(--status-bar-notice-collapsed-width);
    min-width: var(--status-bar-notice-collapsed-width);
    background-color: transparent;
    color: var(--status-bar-button-default-color);
  }
}

.md3-icon-button.is-notice-flash {
  animation: status-bar-notice-warning-flash 0.42s ease-in-out 3;
}

.render-status-content {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: inherit;
}

.render-status-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
}

.render-status-icon svg {
  display: block;
  width: 24px;
  height: 24px;
  transform-origin: center;
}

.render-ring-track,
.render-ring-progress,
.render-complete-check {
  display: none;
}

.render-ring-track,
.render-ring-progress {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
}

.render-ring-track {
  opacity: 0.24;
}

.render-ring-progress {
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: center;
  transition: stroke-dasharray 0.12s linear;
}

.render-status-icon.is-idle .render-ring-track,
.render-status-icon.is-rendering .render-ring-track,
.render-status-icon.is-rendering .render-ring-progress {
  display: block;
}

.render-status-icon.is-completed .render-complete-check {
  display: block;
  fill: currentColor;
  transform-origin: center;
  animation: render-status-check 0.34s cubic-bezier(0.2, 0, 0, 1) both;
}

.render-status-text {
  display: inline-block;
  color: inherit;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}

.render-status-eta {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  color: inherit;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}

.render-status-eta-label {
  flex: 0 0 auto;
}

.render-status-eta-value {
  display: inline-block;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.render-status-text-enter-active,
.render-status-text-leave-active {
  transition: opacity 160ms cubic-bezier(0.2, 0, 0, 1);
}

.render-status-text-enter-from {
  opacity: 0;
}

.render-status-text-leave-to {
  opacity: 0;
}

@keyframes render-status-check {
  from {
    opacity: 0;
    transform: scale(0.55);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes status-bar-notice-warning-flash {
  0%,
  100% {
    background-color: transparent;
  }

  50% {
    background-color: var(--status-bar-notice-background, #c62828);
  }
}

.bpm-button-value {
  position: relative;
  z-index: 1;
  display: block;
  color: inherit;
  font-family: inherit;
  font-size: 18px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.5px;
  font-variant-numeric: tabular-nums;
}

.bpm-button-content-enter-active,
.bpm-button-content-leave-active {
  transition: opacity 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.bpm-button-content-enter-from,
.bpm-button-content-leave-to {
  opacity: 0;
}

.status-bar-notice {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: inherit;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0;
  white-space: nowrap;
}

.status-bar-notice-icon {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
}

.bpm-button-icon {
  position: relative;
  z-index: 1;
  width: 22px;
  height: 22px;
  display: block;
}

.bpm-button-icon.is-filtering {
  animation: bpm-status-breathe 1.25s ease-in-out infinite;
}

@keyframes bpm-status-breathe {
  0%,
  100% {
    opacity: 0.35;
  }

  50% {
    opacity: 1;
  }
}

.bpm-beat-flash {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  background-color: var(--md-sys-color-primary, #a8c7fa);
  pointer-events: none;
  animation: bpm-beat-flash 170ms cubic-bezier(0.2, 0, 0, 1) both;
}

@keyframes bpm-beat-flash {
  0% {
    opacity: 0.38;
  }

  100% {
    opacity: 0;
  }
}

/* 状态栏中央项目管理按钮 */
.md3-project-button {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 0 16px;
  border-radius: var(--md-sys-shape-corner-full, 9999px);
  background-color: transparent;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  border: none;
  font-family: inherit;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  user-select: none;
  outline: none;
  min-width: 0;
  max-width: 100%;
  line-height: normal;
  transition:
    color 0.3s cubic-bezier(0.2, 0, 0, 1),
    background-color 0.2s cubic-bezier(0.2, 0, 0, 1),
    transform 0.1s cubic-bezier(0.2, 0, 0, 1);
}

.md3-project-button:hover {
  color: var(--md-sys-color-on-surface, #e8edf2);
  background-color: var(--md-sys-color-surface-container-highest, rgba(255, 255, 255, 0.08));
}

.md3-project-button:active {
  transform: scale(0.95);
}

.md3-project-button.is-status-notice {
  flex: 0 0 auto;
  width: 192px;
  background-color: var(
    --status-bar-notice-background,
    var(--status-bar-notice-default-background)
  );
  color: var(
    --status-bar-notice-text-color,
    var(--status-bar-notice-default-text-color)
  );
  animation: project-status-notice-expand 0.3s cubic-bezier(0.2, 0, 0, 1) both;
}

.md3-project-button.is-status-notice.is-status-notice-collapsing {
  animation: project-status-notice-collapse 0.3s cubic-bezier(0.2, 0, 0, 1) both;
}

@keyframes project-status-notice-expand {
  from {
    width: var(--project-button-natural-width, 192px);
    background-color: transparent;
    color: var(--md-sys-color-on-surface, #e8edf2);
    opacity: 0.8;
  }

  to {
    width: 192px;
    background-color: var(
      --status-bar-notice-background,
      var(--status-bar-notice-default-background)
    );
    color: var(
      --status-bar-notice-text-color,
      var(--status-bar-notice-default-text-color)
    );
    opacity: 1;
  }
}

@keyframes project-status-notice-collapse {
  from {
    width: 192px;
    background-color: var(
      --status-bar-notice-background,
      var(--status-bar-notice-default-background)
    );
    color: var(
      --status-bar-notice-text-color,
      var(--status-bar-notice-default-text-color)
    );
    opacity: 1;
  }

  to {
    width: var(--project-button-natural-width, 192px);
    background-color: transparent;
    color: var(--md-sys-color-on-surface-variant, #aab3bf);
    opacity: 1;
  }
}

.project-title {
  display: inline-block;
  line-height: 1.35;
  padding: 2px 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 状态栏时间按钮 */
.md3-time-button {
  --status-time-normal-width: 72px;
  --status-time-button-width: var(--status-time-normal-width);
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 var(--status-time-button-width);
  width: var(--status-time-button-width);
  max-width: var(--status-time-button-width);
  height: 40px;
  padding: 0 12px;
  border-radius: var(--md-sys-shape-corner-full, 9999px);
  background-color: transparent;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  border: none;
  font-family: inherit;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  user-select: none;
  outline: none;
  transition:
    color 0.3s cubic-bezier(0.2, 0, 0, 1),
    background-color 0.2s cubic-bezier(0.2, 0, 0, 1),
    flex-basis 0.3s cubic-bezier(0.2, 0, 0, 1),
    width 0.3s cubic-bezier(0.2, 0, 0, 1),
    max-width 0.3s cubic-bezier(0.2, 0, 0, 1),
    transform 0.1s cubic-bezier(0.2, 0, 0, 1);
}

.md3-time-button:hover {
  color: var(--md-sys-color-on-surface, #e8edf2);
  background-color: var(--md-sys-color-surface-container-highest, rgba(255, 255, 255, 0.08));
}

.md3-time-button:active {
  transform: scale(0.95);
}

.md3-time-button.has-seconds {
  --status-time-normal-width: 100px;
}

.md3-time-button.is-status-notice {
  --status-time-button-width: 144px;
  background-color: var(
    --status-bar-notice-background,
    var(--status-bar-notice-default-background)
  );
  color: var(
    --status-bar-notice-text-color,
    var(--status-bar-notice-default-text-color)
  );
}

.md3-time-button.is-status-notice.is-status-notice-collapsing {
  --status-time-button-width: var(--status-time-normal-width);
}

.time-text {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.time-part {
  display: inline-block;
  font-variant-numeric: tabular-nums;
}

.time-colon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 8px;
  line-height: 1;
  transform: translateY(-1.5px);
  user-select: none;
}

.status-time-enter-active,
.status-time-leave-active {
  transition: opacity 0.3s cubic-bezier(0.2, 0, 0, 1);
}

.status-time-enter-from,
.status-time-leave-to {
  opacity: 0;
}

/* 仅在连接设备时：图标与文字变纯白色 (#ffffff) */
.status-bar.connected-blue .md3-icon-button,
.status-bar.connected-blue .md3-time-button,
.status-bar.connected-blue .md3-project-button {
  color: #ffffff;
}

.status-bar.connected-blue .md3-icon-button:hover,
.status-bar.connected-blue .md3-time-button:hover,
.status-bar.connected-blue .md3-project-button:hover {
  background-color: rgba(255, 255, 255, 0.16);
  color: #ffffff;
}

.status-bar.connected-blue .bpm-beat-flash {
  background-color: #ffffff;
}

.status-bar.connected-blue .status-bar-beat-flash {
  background-color: #ffffff;
}

.status-bar.connected-blue .md3-icon-button.is-status-notice,
.status-bar.connected-blue .md3-icon-button.is-status-notice:hover,
.status-bar.connected-blue .md3-time-button.is-status-notice,
.status-bar.connected-blue .md3-time-button.is-status-notice:hover {
  background-color: var(
    --status-bar-notice-background,
    var(--status-bar-notice-default-background)
  );
  color: var(
    --status-bar-notice-text-color,
    var(--status-bar-notice-default-text-color)
  );
}

/* 启动项目窗口未关闭时，禁止打开其他窗口 */
.md3-icon-button:disabled,
.status-bar.connected-blue .md3-icon-button:disabled {
  color: transparent !important;
  background-color: transparent !important;
  cursor: default;
  pointer-events: none;
  transform: none;
}

.md3-icon-button:disabled .icon {
  opacity: 0;
}
</style>
