import { computed, onUnmounted, ref, watch } from 'vue'

export interface StatusBarNoticeState {
  buttonId: string
  message: string
  token: number
  backgroundColor: string
  textColor: string
  flash: boolean
}

export interface StatusBarNoticeStyle {
  backgroundColor?: string
  textColor?: string
  flash?: boolean
}

const DEFAULT_NOTICE_DURATION_MS = 2000
const NOTICE_COLLAPSE_DURATION_MS = 300

const noticeTimers = new Map<string, ReturnType<typeof setTimeout>>()
let noticeSequence = 0

export const statusBarNoticeManager = () => {
  const activeNotices = useState<Record<string, StatusBarNoticeState>>(
    'status_bar_notices',
    () => ({})
  )

  const showStatusBarNotice = (
    buttonId: string,
    message: string,
    duration = DEFAULT_NOTICE_DURATION_MS,
    style: StatusBarNoticeStyle = {}
  ) => {
    const normalizedButtonId = buttonId.trim()
    const normalizedMessage = message.trim()
    if (!normalizedButtonId || !normalizedMessage) return

    noticeSequence += 1
    const token = noticeSequence
    activeNotices.value = {
      ...activeNotices.value,
      [normalizedButtonId]: {
        buttonId: normalizedButtonId,
        message: normalizedMessage,
        token,
        backgroundColor: style.backgroundColor?.trim() || '',
        textColor: style.textColor?.trim() || '',
        flash: style.flash === true
      }
    }

    const previousTimer = noticeTimers.get(normalizedButtonId)
    if (previousTimer) {
      clearTimeout(previousTimer)
    }
    noticeTimers.set(normalizedButtonId, setTimeout(() => {
      const currentNotice = activeNotices.value[normalizedButtonId]
      if (currentNotice?.token !== token) return

      const nextNotices = { ...activeNotices.value }
      delete nextNotices[normalizedButtonId]
      activeNotices.value = nextNotices
      noticeTimers.delete(normalizedButtonId)
    }, Math.max(0, duration)))
  }

  const clearStatusBarNotice = (buttonId?: string) => {
    if (buttonId) {
      const timer = noticeTimers.get(buttonId)
      if (timer) {
        clearTimeout(timer)
        noticeTimers.delete(buttonId)
      }

      if (!activeNotices.value[buttonId]) return
      const nextNotices = { ...activeNotices.value }
      delete nextNotices[buttonId]
      activeNotices.value = nextNotices
      return
    }

    noticeTimers.forEach(timer => clearTimeout(timer))
    noticeTimers.clear()
    activeNotices.value = {}
  }

  const useStatusBarNotice = (buttonId: string) => {
    return computed(() => {
      return activeNotices.value[buttonId]?.message ?? ''
    })
  }

  const useStatusBarNoticeState = (buttonId: string) => {
    return computed(() => {
      return activeNotices.value[buttonId] ?? null
    })
  }

  return {
    activeNotices,
    showStatusBarNotice,
    clearStatusBarNotice,
    useStatusBarNotice,
    useStatusBarNoticeState
  }
}

export const useStatusBarNoticeView = (buttonId: string) => {
  const {
    useStatusBarNotice,
    useStatusBarNoticeState
  } = statusBarNoticeManager()
  const message = useStatusBarNotice(buttonId)
  const activeState = useStatusBarNoticeState(buttonId)
  const lastState = ref<StatusBarNoticeState | null>(null)
  const isCollapsing = ref(false)
  let collapseTimer: ReturnType<typeof setTimeout> | null = null

  watch(
    activeState,
    (state) => {
      if (state) {
        lastState.value = state
      }
    },
    { immediate: true }
  )

  watch(message, (nextMessage, previousMessage) => {
    if (collapseTimer) {
      clearTimeout(collapseTimer)
      collapseTimer = null
    }

    if (nextMessage) {
      isCollapsing.value = false
      return
    }
    if (!previousMessage) return

    isCollapsing.value = true
    collapseTimer = setTimeout(() => {
      isCollapsing.value = false
      collapseTimer = null
    }, NOTICE_COLLAPSE_DURATION_MS)
  })

  const isExpanded = computed(() => {
    return Boolean(message.value) || isCollapsing.value
  })
  const noticeState = computed(() => {
    return activeState.value
      ?? (isCollapsing.value ? lastState.value : null)
  })

  onUnmounted(() => {
    if (collapseTimer) {
      clearTimeout(collapseTimer)
    }
  })

  return {
    message,
    noticeState,
    isExpanded,
    isCollapsing
  }
}

export const useStatusBarNoticeManager = statusBarNoticeManager
