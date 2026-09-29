import { computed } from 'vue'

export type RenderStatus = 'idle' | 'rendering' | 'completed'
export type RenderTask = 'thumbnail' | 'waveform'

interface RenderTaskState {
  active: boolean
  finished: boolean
  progress: number
  token: number
}

type RenderTaskStates = Record<RenderTask, RenderTaskState>
type SettleAction = 'complete' | 'cancel'

const RENDER_SETTLE_DELAY_MS = 360
let renderTaskToken = 0
let settleTimer: ReturnType<typeof setTimeout> | null = null
let settleAction: SettleAction | null = null

const clampProgress = (progress: number) => {
  return Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
}

const createTaskState = (): RenderTaskState => ({
  active: false,
  finished: false,
  progress: 0,
  token: 0
})

const createTaskStates = (): RenderTaskStates => ({
  thumbnail: createTaskState(),
  waveform: createTaskState()
})

export const renderStatusManager = () => {
  const status = useState<RenderStatus>('timeline_render_status', () => 'idle')
  const tasks = useState<RenderTaskStates>(
    'timeline_render_tasks',
    createTaskStates
  )

  const clearSettleTimer = () => {
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
    settleAction = null
  }

  const hasActiveTasks = () => {
    return tasks.value.thumbnail.active || tasks.value.waveform.active
  }

  const settleRenderStatus = (action: SettleAction) => {
    clearSettleTimer()
    settleAction = action
    settleTimer = setTimeout(() => {
      settleTimer = null
      if (hasActiveTasks()) return

      status.value = settleAction === 'complete' ? 'completed' : 'idle'
      settleAction = null
    }, RENDER_SETTLE_DELAY_MS)
  }

  const beginRenderTask = (task: RenderTask) => {
    clearSettleTimer()
    const token = ++renderTaskToken
    tasks.value = {
      ...tasks.value,
      [task]: {
        active: true,
        finished: false,
        progress: 0,
        token
      }
    }
    status.value = 'rendering'
    return token
  }

  const updateRenderTask = (
    task: RenderTask,
    token: number,
    progress: number
  ) => {
    const current = tasks.value[task]
    if (!current.active || current.token !== token) return

    tasks.value = {
      ...tasks.value,
      [task]: {
        ...current,
        progress: clampProgress(progress)
      }
    }
  }

  const finishRenderTask = (task: RenderTask, token: number) => {
    const current = tasks.value[task]
    if (!current.active || current.token !== token) return

    tasks.value = {
      ...tasks.value,
      [task]: {
        ...current,
        active: false,
        finished: true,
        progress: 1,
        token: 0
      }
    }
    if (!hasActiveTasks()) {
      settleRenderStatus('complete')
    }
  }

  const cancelRenderTask = (task: RenderTask, token?: number) => {
    const current = tasks.value[task]
    if (token !== undefined && current.token !== token) return
    if (!current.active && !current.finished && current.progress === 0) return

    tasks.value = {
      ...tasks.value,
      [task]: createTaskState()
    }
    if (status.value === 'rendering' && !hasActiveTasks()) {
      settleRenderStatus('cancel')
    }
  }

  const progress = computed(() => {
    if (status.value === 'completed') return 1

    const thumbnailProgress = tasks.value.thumbnail.progress
    const waveformProgress = tasks.value.waveform.progress
    return clampProgress((thumbnailProgress + waveformProgress) / 2)
  })
  const isRendering = computed(() => {
    return tasks.value.thumbnail.active || tasks.value.waveform.active
  })

  return {
    status,
    tasks,
    progress,
    isRendering,
    beginRenderTask,
    updateRenderTask,
    finishRenderTask,
    cancelRenderTask
  }
}

export const useRenderStatus = renderStatusManager
