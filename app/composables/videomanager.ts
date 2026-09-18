import { computed } from 'vue'

export const formatVideoTime = (
  seconds: number,
  forceHours = false,
  includeFraction = true
): string => {
  if (isNaN(seconds) || seconds < 0) {
    if (!includeFraction) return forceHours ? '00:00:00' : '00:00'
    return forceHours ? '00:00:00.00' : '00:00.00'
  }
  const totalHundredths = Math.floor(seconds * 100)
  const h = Math.floor(totalHundredths / 360000)
  const m = Math.floor((totalHundredths % 360000) / 6000)
  const s = Math.floor((totalHundredths % 6000) / 100)
  const fraction = totalHundredths % 100

  const mm = String(m).padStart(2, '0')
  const ss = includeFraction
    ? `${String(s).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`
    : String(s).padStart(2, '0')

  if (h > 0 || forceHours) {
    const hh = String(h).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }
  return `${mm}:${ss}`
}

// 模块级保存当前视频 DOM 实例指针
let currentVideoElement: HTMLVideoElement | null = null
let fallbackFileInput: HTMLInputElement | null = null
let playbackRequestVersion = 0

// 连续定位只保留最新目标，避免浏览器堆叠 seek 请求。
let scrubPendingTarget: number | null = null
let scrubSeekInFlight = false
let scrubSeekFallbackTimer: ReturnType<typeof setTimeout> | null = null

const SCRUB_SEEK_FALLBACK_MS = 160

const invalidatePendingPlayback = () => {
  playbackRequestVersion++
}

const clearScrubSeekFallback = () => {
  if (scrubSeekFallbackTimer !== null) {
    clearTimeout(scrubSeekFallbackTimer)
    scrubSeekFallbackTimer = null
  }
}

const flushScrubSeek = () => {
  if (scrubSeekInFlight || scrubPendingTarget === null || !currentVideoElement) return

  const videoElement = currentVideoElement
  const target = scrubPendingTarget
  scrubPendingTarget = null
  scrubSeekInFlight = true
  clearScrubSeekFallback()

  scrubSeekFallbackTimer = setTimeout(() => {
    scrubSeekFallbackTimer = null
    scrubSeekInFlight = false
    flushScrubSeek()
  }, SCRUB_SEEK_FALLBACK_MS)

  const scrubbableVideo = videoElement as HTMLVideoElement & {
    fastSeek?: (time: number) => void
  }

  if (typeof scrubbableVideo.fastSeek === 'function') {
    try {
      scrubbableVideo.fastSeek(target)
      return
    } catch {
      // Fall back to precise seeking when fastSeek is unavailable for this media.
    }
  }

  videoElement.currentTime = target
}

const handleScrubSeeked = () => {
  scrubSeekInFlight = false
  clearScrubSeekFallback()
  flushScrubSeek()
}

const cancelPendingScrubSeek = () => {
  scrubPendingTarget = null
  scrubSeekInFlight = false
  clearScrubSeekFallback()
}

export const videoManager = () => {
  const videoSrc = useState<string | null>('video_player_src', () => null)
  const videoFileName = useState<string>('video_player_filename', () => '')
  const videoFilePath = useState<string>('video_player_file_path', () => '')
  const isVideoPlaying = useState<boolean>('video_player_is_playing', () => false)
  const currentTime = useState<number>('video_player_current_time', () => 0)
  const duration = useState<number>('video_player_duration', () => 0)
  const seekVersion = useState<number>('video_player_seek_version', () => 0)
  const isScrubbing = useState<boolean>('video_player_is_scrubbing', () => false)
  const volume = useState<number>('video_player_volume', () => 1)
  const isMuted = useState<boolean>('video_player_is_muted', () => false)

  // 视频当前播放时间秒数与剩余时间秒数
  const remainingTime = computed(() => {
    return Math.max(0, (duration.value || 0) - (currentTime.value || 0))
  })

  // 视频时间与剩余时间文本 (例如 "00:00.00/00:00.00")
  const videoTimeText = computed(() => {
    const hasHours = (duration.value || 0) >= 3600
    const curr = formatVideoTime(currentTime.value, hasHours)
    const rem = formatVideoTime(remainingTime.value, hasHours)
    return `${curr}/${rem}`
  })

  // 进度文本（例如 "00:00.00 / 00:00.00" 或 "01:23.45 / 03:45.67"）
  const progressText = computed(() => {
    const hasHours = (duration.value || 0) >= 3600
    return `${formatVideoTime(currentTime.value, hasHours)} / ${formatVideoTime(duration.value, hasHours)}`
  })

  // 视频窗口标题文本 (读取视频后显示 当前时间/总时间)
  const videoTitle = computed(() => {
    if (!videoSrc.value || duration.value <= 0) return '视频'
    const hasHours = (duration.value || 0) >= 3600
    const curr = formatVideoTime(currentTime.value, hasHours, false)
    const total = formatVideoTime(duration.value, hasHours, false)
    return `视频 - ${curr}/${total}`
  })

  const isOfflineMedia = computed(() => (
    !videoSrc.value &&
    Boolean(videoFileName.value || videoFilePath.value)
  ))

  // 播放进度百分比 (0.0 ~ 1.0)
  const progressPercent = computed(() => {
    if (duration.value <= 0) return 0
    return Math.max(0, Math.min(1, currentTime.value / duration.value))
  })

  const isVideoStopped = computed(() => {
    if (!videoSrc.value) return true
    if (isVideoPlaying.value) return false

    const atStart = currentTime.value <= 0.05
    const atEnd = duration.value > 0 && currentTime.value >= duration.value - 0.05
    return atStart || atEnd
  })

  // 注册/注销 DOM 元素绑定
  const registerVideoElement = (el: HTMLVideoElement | null) => {
    const previousElement = currentVideoElement
    if (previousElement && previousElement !== el) {
      previousElement.removeEventListener('seeked', handleScrubSeeked)
    }
    if (el && el !== previousElement) {
      el.addEventListener('seeked', handleScrubSeeked)
    }
    currentVideoElement = el
    if (el) {
      el.volume = volume.value
      el.muted = isMuted.value
    } else {
      cancelPendingScrubSeek()
    }
  }

  // 载入本地视频文件
  const loadVideoFile = (file: File) => {
    if (!file) return

    // 释放旧 Object URL 避免内存泄露
    if (videoSrc.value && videoSrc.value.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(videoSrc.value)
      } catch (err) {
        console.warn('Failed to revoke previous video URL:', err)
      }
    }

    const url = URL.createObjectURL(file)
    const fileWithPath = file as File & { path?: string }
    videoSrc.value = url
    videoFileName.value = file.name
    videoFilePath.value = fileWithPath.path || file.webkitRelativePath || file.name
    currentTime.value = 0
    duration.value = 0
    isVideoPlaying.value = false

    if (currentVideoElement) {
      invalidatePendingPlayback()
      currentVideoElement.pause()
      currentVideoElement.src = url
      currentVideoElement.load()
    }
  }

  // 唤起浏览器 API 打开本地视频
  const openFileDialog = async () => {
    // 优先尝试现代浏览器 File System Access API
    if (typeof window !== 'undefined' && 'showOpenFilePicker' in window) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [
            {
              description: '本地视频文件',
              accept: {
                'video/*': ['.mp4', '.webm', '.ogg', '.mov', '.mkv', '.m4v']
              }
            }
          ],
          multiple: false
        })
        if (handle) {
          const file = await handle.getFile()
          loadVideoFile(file)
          return
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return
        console.warn('showOpenFilePicker failed, falling back to input:', err)
      }
    }

    // 优雅回退：标准动态 <input type="file">
    if (typeof document !== 'undefined') {
      fallbackFileInput?.remove()
      fallbackFileInput = null

      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'video/*'
      input.style.display = 'none'

      const cleanup = () => {
        input.remove()
        if (fallbackFileInput === input) {
          fallbackFileInput = null
        }
      }

      input.addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement | null)?.files?.[0]
        if (file) {
          loadVideoFile(file)
        }
        cleanup()
      }, { once: true })
      input.addEventListener('cancel', cleanup, { once: true })

      fallbackFileInput = input
      document.body.appendChild(input)
      input.click()
    }
  }

  const playVideo = () => {
    if (!videoSrc.value) {
      openFileDialog()
      return
    }
    if (currentVideoElement) {
      const videoElement = currentVideoElement
      const requestVersion = ++playbackRequestVersion
      videoElement.play().then(() => {
        if (requestVersion !== playbackRequestVersion || videoElement !== currentVideoElement) return
        isVideoPlaying.value = !videoElement.paused && !videoElement.ended
      }).catch((err: unknown) => {
        const error = err as { name?: string }
        if (
          error?.name === 'AbortError' ||
          requestVersion !== playbackRequestVersion ||
          videoElement !== currentVideoElement
        ) return
        console.warn('Play video failed:', err)
      })
    } else {
      isVideoPlaying.value = true
    }
  }

  const pauseVideo = () => {
    invalidatePendingPlayback()
    if (currentVideoElement) {
      currentVideoElement.pause()
    }
    isVideoPlaying.value = false
  }

  const toggleVideoPlay = () => {
    if (!videoSrc.value) {
      openFileDialog()
      return
    }
    if (isVideoPlaying.value) {
      pauseVideo()
    } else {
      playVideo()
    }
  }

  const stopVideo = () => {
    invalidatePendingPlayback()
    if (currentVideoElement) {
      currentVideoElement.pause()
      currentVideoElement.currentTime = 0
    }
    currentTime.value = 0
    isVideoPlaying.value = false
  }

  const closeVideo = () => {
    invalidatePendingPlayback()
    if (videoSrc.value && videoSrc.value.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(videoSrc.value)
      } catch (err) {
        console.warn('Failed to revoke video URL:', err)
      }
    }

    if (currentVideoElement) {
      currentVideoElement.pause()
      currentVideoElement.removeAttribute('src')
      currentVideoElement.load()
    }

    videoSrc.value = null
    videoFileName.value = ''
    videoFilePath.value = ''
    currentTime.value = 0
    duration.value = 0
    isVideoPlaying.value = false
  }

  const clampVideoTime = (seconds: number) => {
    return Math.max(0, Math.min(duration.value || 0, seconds))
  }

  const seekVideo = (seconds: number, preview = false) => {
    const target = Math.max(0, Math.min(duration.value || 0, seconds))
    currentTime.value = target
    if (!preview) {
      isScrubbing.value = false
      cancelPendingScrubSeek()
    }
    seekVersion.value++
    if (currentVideoElement) {
      const videoElement = currentVideoElement as HTMLVideoElement & {
        fastSeek?: (time: number) => void
      }

      if (preview && typeof videoElement.fastSeek === 'function') {
        try {
          videoElement.fastSeek(target)
          return
        } catch {
          // Fall back to precise seeking when fastSeek is unavailable for this media.
        }
      }

      videoElement.currentTime = target
    }
  }

  const beginScrubSeek = (seconds: number) => {
    isScrubbing.value = true
    cancelPendingScrubSeek()
    return seekVideoScrub(seconds)
  }

  const seekVideoScrub = (seconds: number) => {
    const target = clampVideoTime(seconds)
    currentTime.value = target
    scrubPendingTarget = target
    flushScrubSeek()
    return target
  }

  const endScrubSeek = (seconds: number) => {
    isScrubbing.value = false
    seekVideo(seconds)
  }

  const cancelScrubSeek = () => {
    isScrubbing.value = false
    cancelPendingScrubSeek()
  }

  const toggleVideoMute = () => {
    isMuted.value = !isMuted.value
    if (currentVideoElement) {
      currentVideoElement.muted = isMuted.value
    }
  }

  const setVideoVolume = (val: number) => {
    const v = Math.max(0, Math.min(1, val))
    volume.value = v
    if (v === 0) {
      isMuted.value = true
    } else if (isMuted.value) {
      isMuted.value = false
    }
    if (currentVideoElement) {
      currentVideoElement.volume = v
      currentVideoElement.muted = isMuted.value
    }
  }

  return {
    videoSrc,
    videoFileName,
    videoFilePath,
    isVideoPlaying,
    currentTime,
    duration,
    seekVersion,
    isScrubbing,
    volume,
    isMuted,
    isVideoStopped,
    progressText,
    videoTimeText,
    videoTitle,
    progressPercent,
    isOfflineMedia,
    registerVideoElement,
    getVideoElement: () => currentVideoElement,
    loadVideoFile,
    openFileDialog,
    playVideo,
    pauseVideo,
    toggleVideoPlay,
    stopVideo,
    closeVideo,
    seekVideo,
    beginScrubSeek,
    seekVideoScrub,
    endScrubSeek,
    cancelScrubSeek,
    toggleVideoMute,
    setVideoVolume
  }
}

export const useVideo = videoManager
