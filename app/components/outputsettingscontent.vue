<script setup lang="ts">
import { ref } from 'vue'
import { outputsettingsManager } from '~/composables/outputsettingsmanager'

const { globalBrightness, setGlobalBrightness } = outputsettingsManager()

const trackRef = ref<HTMLElement | null>(null)
const isDragging = ref(false)

// 指针移动计算亮度 (0 ~ 100，底部为 0，顶部为 100)
const updateBrightness = (e: PointerEvent) => {
  if (!trackRef.value) return
  const rect = trackRef.value.getBoundingClientRect()
  const offsetY = rect.bottom - e.clientY
  const ratio = Math.max(0, Math.min(1, offsetY / rect.height))
  setGlobalBrightness(Math.round(ratio * 100))
}

const handlePointerDown = (e: PointerEvent) => {
  isDragging.value = true
  ;(e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId)
  updateBrightness(e)
}

const handlePointerMove = (e: PointerEvent) => {
  if (isDragging.value) {
    updateBrightness(e)
  }
}

const handlePointerUp = (e: PointerEvent) => {
  if (isDragging.value) {
    isDragging.value = false
    try {
      ;(e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId)
    } catch {}
  }
}

// 滚轮微调
const handleWheel = (e: WheelEvent) => {
  e.preventDefault()
  const step = e.shiftKey ? 5 : 1
  const delta = e.deltaY < 0 ? step : -step
  setGlobalBrightness(globalBrightness.value + delta)
}

// 键盘控制
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
    e.preventDefault()
    setGlobalBrightness(globalBrightness.value + (e.shiftKey ? 5 : 1))
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
    e.preventDefault()
    setGlobalBrightness(globalBrightness.value - (e.shiftKey ? 5 : 1))
  } else if (e.key === 'PageUp') {
    e.preventDefault()
    setGlobalBrightness(globalBrightness.value + 10)
  } else if (e.key === 'PageDown') {
    e.preventDefault()
    setGlobalBrightness(globalBrightness.value - 10)
  } else if (e.key === 'Home') {
    e.preventDefault()
    setGlobalBrightness(100)
  } else if (e.key === 'End') {
    e.preventDefault()
    setGlobalBrightness(0)
  }
}
</script>

<template>
  <div class="output-settings-content">
    <div class="slider-panel">
      <!-- 实时数值 -->
      <div class="value-display font-mono">
        {{ globalBrightness }}%
      </div>

      <!-- 纵向滑条 -->
      <div
        ref="trackRef"
        class="slider-track-area"
        tabindex="0"
        role="slider"
        aria-label="全局亮度"
        :aria-valuenow="globalBrightness"
        aria-valuemin="0"
        aria-valuemax="100"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerup="handlePointerUp"
        @pointercancel="handlePointerUp"
        @wheel="handleWheel"
        @keydown="handleKeydown"
      >
        <!-- 轨道底槽 -->
        <div class="slider-groove">
          <div
            class="slider-fill"
            :style="{ height: `${globalBrightness}%` }"
          />
        </div>

        <!-- 滑块按钮 -->
        <div
          class="slider-thumb"
          :class="{ 'is-dragging': isDragging }"
          :style="{ bottom: `calc(${globalBrightness}% - 9px)` }"
        />
      </div>

      <!-- 标签 -->
      <div class="label-text">
        亮度
      </div>
    </div>
  </div>
</template>

<style scoped>
.output-settings-content {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: #14171f;
  color: #e8edf2;
  box-sizing: border-box;
  user-select: none;
  padding: 16px;
}

.slider-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
}

.value-display {
  font-size: 14px;
  font-weight: 600;
  color: #8ab4f8;
  letter-spacing: 0.5px;
  min-height: 20px;
}

/* 纵向滑条可触控区域 */
.slider-track-area {
  position: relative;
  width: 36px;
  flex: 1;
  max-height: 220px;
  min-height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: none;
  outline: none;
}

.slider-track-area:focus-visible .slider-groove {
  box-shadow: 0 0 0 2px rgba(138, 180, 248, 0.5);
}

/* 轨道槽 */
.slider-groove {
  position: relative;
  width: 8px;
  height: 100%;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  overflow: hidden;
}

/* 激活填充条 */
.slider-fill {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: #8ab4f8;
  border-radius: 4px;
  transition: height 0.05s ease-out;
}

/* 圆形滑块 (Thumb) */
.slider-thumb {
  position: absolute;
  left: 0;
  right: 0;
  margin: 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid #8ab4f8;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  cursor: grab;
  transition: transform 0.1s ease, box-shadow 0.1s ease;
  z-index: 2;
}

.slider-thumb:hover {
  transform: scale(1.15);
  box-shadow: 0 2px 8px rgba(138, 180, 248, 0.5);
}

.slider-thumb.is-dragging {
  cursor: grabbing;
  transform: scale(1.2);
  box-shadow: 0 3px 10px rgba(138, 180, 248, 0.7);
}

.label-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  letter-spacing: 0.5px;
}

.font-mono {
  font-family: 'Google Sans', sans-serif;
}
</style>
