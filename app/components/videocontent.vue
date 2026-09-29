<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { eventsManager } from '~/composables/eventsmanager'
import { formatVideoTime, videoManager } from '~/composables/videomanager'

const {
  videoSrc,
  videoFileName,
  videoFilePath,
  isOfflineMedia,
  isVideoPlaying,
  currentTime,
  duration,
  volume,
  isMuted,
  registerVideoElement,
  loadVideoFile,
  playVideo,
  pauseVideo,
  seekVideo,
  openFileDialog
} = videoManager()
const {
  pauseEventEffect,
  resumeEventEffect,
  stopEventEffect
} = eventsManager()

const videoRef = ref<HTMLVideoElement | null>(null)

const offlineMediaName = computed(() => {
  if (videoFileName.value) return videoFileName.value
  const path = videoFilePath.value.replace(/\\/g, '/')
  return path.split('/').filter(Boolean).pop() || '未知视频文件'
})

const isDraggingFile = ref(false)
const isSeeking = ref(false)
const isSeekPreviewVisible = ref(false)
let seekStartX = 0
let seekStartY = 0
let seekStartTime = 0
let lastSeekPointerX = 0
const seekPrecisionScale = ref(1)
let wasPlayingBeforeSeek = false
const pendingSeekTime = ref(0)
let seekRafId: number | null = null
let timeSyncRafId: number | null = null
let timeSyncAnchorMediaTime = 0
let timeSyncAnchorPerformanceTime = 0
let timeSyncAnchorPlaybackRate = 1
let didSeekDrag = false
let seekCaptureTarget: HTMLElement | null = null
let activeSeekPointerId: number | null = null

const SEEK_DRAG_THRESHOLD = 4
const SEEK_PRECISION_STEP_PX = 36
const SEEK_MAX_UP_STEPS = 6
const SEEK_MAX_DOWN_STEPS = 3

const seekPreviewText = computed(() => {
  const hasHours = duration.value >= 3600
  return `${formatVideoTime(pendingSeekTime.value, hasHours)} / ${formatVideoTime(duration.value, hasHours)}`
})

const seekPreviewPercent = computed(() => {
  if (duration.value <= 0) return 0
  return Math.max(0, Math.min(100, (pendingSeekTime.value / duration.value) * 100))
})

const seekPrecisionHint = computed(() => {
  const scale = seekPrecisionScale.value
  if (scale === 1) return '1X'
  return scale < 1
    ? `1/${Math.round(1 / scale)}X`
    : `${scale}X`
})

// 视频事件同步
const anchorVideoTimeSync = (videoElement: HTMLVideoElement) => {
  timeSyncAnchorMediaTime = Number.isFinite(videoElement.currentTime)
    ? videoElement.currentTime
    : currentTime.value
  timeSyncAnchorPerformanceTime = performance.now()
  timeSyncAnchorPlaybackRate = Math.max(0.01, videoElement.playbackRate || 1)
  currentTime.value = timeSyncAnchorMediaTime
}

const syncVideoTimeFromElement = (resetAnchor = true) => {
  const videoElement = videoRef.value
  if (!videoElement) return

  if (resetAnchor) {
    anchorVideoTimeSync(videoElement)
    return
  }

  const mediaTime = videoElement.currentTime
  const now = performance.now()
  const estimatedTime = timeSyncAnchorMediaTime
    + ((now - timeSyncAnchorPerformanceTime) / 1000) * timeSyncAnchorPlaybackRate
  const drift = mediaTime - estimatedTime

  if (
    videoElement.seeking ||
    videoElement.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ||
    Math.abs(drift) > 0.18 ||
    now - timeSyncAnchorPerformanceTime > 750
  ) {
    anchorVideoTimeSync(videoElement)
    return
  }

  if (Math.abs(drift) > 0.008) {
    timeSyncAnchorMediaTime += drift * 0.18
    timeSyncAnchorPerformanceTime = now
  }

  const nextTime = timeSyncAnchorMediaTime
    + ((now - timeSyncAnchorPerformanceTime) / 1000) * timeSyncAnchorPlaybackRate
  currentTime.value = Math.max(
    0,
    Math.min(duration.value > 0 ? duration.value : nextTime, nextTime)
  )
}

const stopTimeSyncLoop = () => {
  if (timeSyncRafId !== null) {
    cancelAnimationFrame(timeSyncRafId)
    timeSyncRafId = null
  }
}

const runTimeSyncLoop = () => {
  timeSyncRafId = null
  if (!videoRef.value || !isVideoPlaying.value) return

  syncVideoTimeFromElement(false)
  timeSyncRafId = requestAnimationFrame(runTimeSyncLoop)
}

const startTimeSyncLoop = () => {
  if (!videoRef.value) return
  syncVideoTimeFromElement(true)
  if (timeSyncRafId !== null) return
  timeSyncRafId = requestAnimationFrame(runTimeSyncLoop)
}

const handleTimeUpdate = () => {
  syncVideoTimeFromElement(false)
}

const handleDurationChange = () => {
  if (videoRef.value && !isNaN(videoRef.value.duration)) {
    duration.value = videoRef.value.duration
  }
}

const handleLoadedMetadata = () => {
  if (videoRef.value && !isNaN(videoRef.value.duration)) {
    duration.value = videoRef.value.duration
  }
}

const handlePlay = () => {
  isVideoPlaying.value = true
  resumeEventEffect()
  startTimeSyncLoop()
}

const handlePause = () => {
  isVideoPlaying.value = false
  pauseEventEffect()
  stopTimeSyncLoop()
  syncVideoTimeFromElement()
}

const handleEnded = () => {
  isVideoPlaying.value = false
  stopEventEffect()
  stopTimeSyncLoop()
  syncVideoTimeFromElement()
}

const handleVolumeChange = () => {
  if (videoRef.value) {
    volume.value = videoRef.value.volume
    isMuted.value = videoRef.value.muted
  }
}

// 拖拽文件支持
const handleDragOver = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  isDraggingFile.value = true
}

const handleDragLeave = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  isDraggingFile.value = false
}

const handleDrop = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  isDraggingFile.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) {
    loadVideoFile(file)
  }
}

const handleSeekPointerDown = (e: PointerEvent) => {
  if (!videoSrc.value || duration.value <= 0 || e.button !== 0) return

  isSeeking.value = true
  didSeekDrag = false
  wasPlayingBeforeSeek = false
  seekStartX = e.clientX
  seekStartY = e.clientY
  seekStartTime = currentTime.value
  lastSeekPointerX = e.clientX
  seekPrecisionScale.value = 1
  pendingSeekTime.value = seekStartTime

  const target = e.currentTarget as HTMLElement
  seekCaptureTarget = target
  activeSeekPointerId = e.pointerId
  target.setPointerCapture(e.pointerId)
  e.preventDefault()
}

const handleSeekPointerMove = (e: PointerEvent) => {
  if (!isSeeking.value || duration.value <= 0) return
  if (
    activeSeekPointerId !== null &&
    e.pointerId !== activeSeekPointerId
  ) {
    return
  }
  if (e.buttons === 0) {
    finishSeekDrag(e.pointerId)
    return
  }

  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0) return

  const deltaXFromStart = e.clientX - seekStartX
  const deltaYFromStart = e.clientY - seekStartY

  if (!didSeekDrag && (Math.abs(deltaXFromStart) > SEEK_DRAG_THRESHOLD || Math.abs(deltaYFromStart) > SEEK_DRAG_THRESHOLD)) {
    didSeekDrag = true
    isSeekPreviewVisible.value = true
    wasPlayingBeforeSeek = isVideoPlaying.value
    if (wasPlayingBeforeSeek) {
      pauseVideo()
    }
  }

  if (!didSeekDrag) {
    return
  }

  const upwardSteps = Math.round((seekStartY - e.clientY) / SEEK_PRECISION_STEP_PX)
  const clampedSteps = Math.max(-SEEK_MAX_DOWN_STEPS, Math.min(SEEK_MAX_UP_STEPS, upwardSteps))
  seekPrecisionScale.value = Math.pow(0.5, clampedSteps)

  const deltaX = e.clientX - lastSeekPointerX
  lastSeekPointerX = e.clientX
  const timeOffset = (deltaX / rect.width) * duration.value * seekPrecisionScale.value
  pendingSeekTime.value = Math.max(0, Math.min(duration.value, pendingSeekTime.value + timeOffset))

  if (seekRafId === null) {
    seekRafId = requestAnimationFrame(() => {
      seekRafId = null
      seekVideo(pendingSeekTime.value, true)
    })
  }
}

function finishSeekDrag(
  pointerId = activeSeekPointerId,
  commitSeek = true
) {
  if (!isSeeking.value) return

  isSeeking.value = false
  isSeekPreviewVisible.value = false
  if (seekRafId !== null) {
    cancelAnimationFrame(seekRafId)
    seekRafId = null
  }

  const target = seekCaptureTarget
  if (
    target &&
    pointerId !== null &&
    target.hasPointerCapture(pointerId)
  ) {
    target.releasePointerCapture(pointerId)
  }
  seekCaptureTarget = null
  activeSeekPointerId = null

  if (!didSeekDrag) {
    wasPlayingBeforeSeek = false
    return
  }
  if (!commitSeek) {
    wasPlayingBeforeSeek = false
    return
  }

  seekVideo(pendingSeekTime.value)
  if (wasPlayingBeforeSeek) {
    playVideo()
  }
  wasPlayingBeforeSeek = false
}

const handleSeekPointerUp = (e: PointerEvent) => {
  finishSeekDrag(e.pointerId)
}

const handleGlobalSeekPointerUp = (e: PointerEvent) => {
  if (e.pointerId !== activeSeekPointerId) return
  finishSeekDrag(e.pointerId)
}

const handleGlobalSeekPointerCancel = (e: PointerEvent) => {
  if (e.pointerId !== activeSeekPointerId) return
  finishSeekDrag(e.pointerId)
}

const handleGlobalSeekBlur = () => {
  finishSeekDrag()
}

onMounted(() => {
  window.addEventListener('pointerup', handleGlobalSeekPointerUp, true)
  window.addEventListener('pointercancel', handleGlobalSeekPointerCancel, true)
  window.addEventListener('blur', handleGlobalSeekBlur)

  if (videoRef.value) {
    registerVideoElement(videoRef.value)
    if (videoSrc.value) {
      videoRef.value.src = videoSrc.value
      videoRef.value.currentTime = currentTime.value
      if (isVideoPlaying.value) {
        videoRef.value.play().catch(() => {})
      }
    }
  }
})

onUnmounted(() => {
  window.removeEventListener('pointerup', handleGlobalSeekPointerUp, true)
  window.removeEventListener('pointercancel', handleGlobalSeekPointerCancel, true)
  window.removeEventListener('blur', handleGlobalSeekBlur)
  finishSeekDrag(undefined, false)
  stopTimeSyncLoop()
  if (seekRafId !== null) {
    cancelAnimationFrame(seekRafId)
    seekRafId = null
  }
  registerVideoElement(null)
})

watch(
  () => videoRef.value,
  (newEl) => {
    registerVideoElement(newEl)
  }
)
</script>

<template>
  <div
    class="video-content-container"
    :class="{
      'is-dragging': isDraggingFile,
      'is-empty': !videoSrc
    }"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- 空状态 -->
    <div v-show="!videoSrc" class="empty-state" :class="{ 'is-offline': isOfflineMedia }">
      <template v-if="isOfflineMedia">
        <svg class="empty-icon offline-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
        </svg>
        <h3 class="empty-title">媒体文件脱机</h3>
        <p class="offline-description">
          项目中对应的视频文件
          <span class="offline-file-name">{{ offlineMediaName }}</span>
          当前不可用，请选择该文件重新连接。
        </p>
        <button
          class="offline-select-btn"
          type="button"
          @click="openFileDialog"
        >
          选择视频文件
        </button>
      </template>
      <template v-else>
        <svg class="empty-icon" viewBox="0 -960 960 960" fill="currentColor">
          <path
            d="m480-420 240-160-240-160v320Zm33 220h219q-6 24-24 41.5T664-138L228-85q-33 4-59.5-16T138-154L86-592q-4-33 16.5-59t53.5-30l45-5v80l-36 4 54 438 294-36Zm-152-80q-33 0-56.5-23.5T281-360v-440q0-33 23.5-56.5T361-880h440q33 0 56.5 23.5T881-800v440q0 33-23.5 56.5T801-280H361Zm0-80h440v-440H361v440ZM219-164Zm362-416Z"
          />
        </svg>
        <h3 class="empty-title">未读取视频</h3>
      </template>
    </div>

    <!-- 视频播放区域 -->
    <div
      v-show="videoSrc"
      class="video-player-wrap"
      @pointerdown="handleSeekPointerDown"
      @pointermove="handleSeekPointerMove"
      @pointerup="handleSeekPointerUp"
      @pointercancel="handleSeekPointerUp"
      @lostpointercapture="handleSeekPointerUp"
    >
      <video
        ref="videoRef"
        class="video-element"
        playsinline
        @timeupdate="handleTimeUpdate"
        @durationchange="handleDurationChange"
        @loadedmetadata="handleLoadedMetadata"
        @play="handlePlay"
        @pause="handlePause"
        @ended="handleEnded"
        @volumechange="handleVolumeChange"
      />

      <Transition name="seek-preview">
        <div v-if="isSeekPreviewVisible" class="seek-preview" aria-hidden="true">
          <div class="seek-time-row">
            <span class="seek-time-field">{{ seekPreviewText }}</span>
            <span class="seek-precision-hint">{{ seekPrecisionHint }}</span>
          </div>
          <div class="seek-progress-track">
            <div
              class="seek-progress-fill"
              :style="{ width: `${seekPreviewPercent}%` }"
            />
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.video-content-container {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  background-color: #0b0d11;
  color: var(--md-sys-color-on-surface, #e8edf2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
}

.video-content-container.is-empty {
  background-color: var(--md-sys-color-surface, #1c1f26);
}

.video-content-container.is-dragging {
  outline: 2px dashed var(--md-sys-color-primary, #8ab4f8);
  outline-offset: -4px;
}

/* 空状态 */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
}

.empty-icon {
  width: 44px;
  height: 44px;
  color: var(--md-sys-color-outline, #727b8c);
  margin-bottom: 12px;
  opacity: 0.6;
}

.offline-icon {
  color: #ffcc80;
  opacity: 0.9;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--md-sys-color-on-surface, #e8edf2);
}

.offline-description {
  max-width: 420px;
  margin: 10px 0 18px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  font-size: 13px;
  line-height: 1.55;
}

.offline-file-name {
  color: var(--md-sys-color-on-surface, #e8edf2);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.offline-select-btn {
  height: 36px;
  padding: 0 18px;
  border: none;
  border-radius: 9999px;
  background-color: var(--md-sys-color-primary, #8ab4f8);
  color: var(--md-sys-color-on-primary, #042a59);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    transform 0.12s ease;
}

.offline-select-btn:hover {
  background-color: color-mix(
    in srgb,
    var(--md-sys-color-primary, #8ab4f8) 88%,
    white
  );
}

.offline-select-btn:active {
  transform: scale(0.97);
}

/* 视频播放器区域 */
.video-player-wrap {
  position: relative;
  flex: 1;
  width: 100%;
  height: 100%;
  background-color: #000000;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: none;
}

.video-element {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background-color: #000000;
}

/* 拖动定位时的目标时间与进度条 */
.seek-preview {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  width: min(70%, 420px);
  padding: 0;
  box-sizing: border-box;
  border: none;
  background-color: transparent;
  color: #ffffff;
  pointer-events: none;
}

.seek-time-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 9px;
}

.seek-time-field {
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
}

.seek-progress-track {
  width: 100%;
  height: 4px;
  overflow: hidden;
  border-radius: 9999px;
  background-color: rgba(255, 255, 255, 0.24);
}

.seek-progress-fill {
  height: 100%;
  border-radius: inherit;
  background-color: var(--md-sys-color-primary, #8ab4f8);
}

.seek-precision-hint {
  color: rgba(255, 255, 255, 0.82);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
}

.seek-preview-enter-active,
.seek-preview-leave-active {
  transition: opacity 0.16s cubic-bezier(0.2, 0, 0, 1);
}

.seek-preview-enter-from,
.seek-preview-leave-to {
  opacity: 0;
}
</style>
