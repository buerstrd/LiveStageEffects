<script setup lang="ts">
import { computed } from 'vue'
import { useRealtimeBpm } from '~/composables/bpmanalyzer'
import { videoManager } from '~/composables/videomanager'

const {
  bpm,
  status,
  source,
  modelStatus,
  modelError,
  modelHops,
  modelBeats,
  modelSilent,
  musicScore,
  musicDetected,
  manualBpmCanHalve,
  manualBpmCanDouble,
  manualBpmResetAvailable,
  applyManualBpmFactor,
  resetManualBpm
} = useRealtimeBpm()
const { videoSrc, isVideoPlaying } = videoManager()

const bpmValueText = computed(() => {
  return bpm.value === null ? '--' : bpm.value.toFixed(1)
})

const statusText = computed(() => {
  if (!videoSrc.value) return '未读取视频'
  if (status.value === 'unavailable') return '音频不可用'
  if (!isVideoPlaying.value) return '等待播放'
  if (status.value === 'non-music') return '检测到非音乐音频'
  if (status.value === 'filtering') return '正在判断音频类型'
  if (status.value === 'analyzing') return '实时更新'
  return '正在识别节拍...'
})

const musicProbabilityText = computed(() => {
  if (modelStatus.value !== 'ready') return '--'
  return `${Math.round(musicScore.value * 100)}%`
})

const sourceText = computed(() => {
  const musicProbability = `音乐概率 ${musicProbabilityText.value}`
  if (source.value === 'manual') {
    return `${musicProbability} · 手动校准`
  }
  if (modelStatus.value === 'ready' && musicDetected.value === false) {
    return `${musicProbability} · 非音乐音频`
  }
  if (modelStatus.value === 'ready' && musicDetected.value === null) {
    return `${musicProbability} · 判断中`
  }
  if (source.value === 'model') return `${musicProbability} · 神经模型`
  if (source.value === 'spectrum') {
    if (modelStatus.value === 'loading') {
      return `${musicProbability} · 模型加载中`
    }
    if (modelStatus.value === 'error') {
      return `${musicProbability} · 模型不可用`
    }
    if (modelStatus.value === 'ready') {
      if (modelHops.value <= 0) return `${musicProbability} · 未收到音频`
      if (modelSilent.value) return `${musicProbability} · 音频能量不足`
      if (modelBeats.value <= 0) return `${musicProbability} · 正在分析音频`
      return `${musicProbability} · 正在校准节拍`
    }
    return `${musicProbability} · 模型未启动`
  }
  if (modelStatus.value === 'loading') return '模型加载中'
  if (modelStatus.value === 'ready') {
    return `${musicProbability} · 联合判断`
  }
  if (modelStatus.value === 'error') return '模型不可用'
  return '--'
})
</script>

<template>
  <div class="bpm-content">
    <div class="bpm-top">
      <div class="bpm-source-row">
        <span class="bpm-source-label">数据来源</span>
        <span class="bpm-source-value">{{ sourceText }}</span>
      </div>
      <span
        v-if="modelStatus === 'error' && modelError"
        class="bpm-source-error"
      >
        {{ modelError }}
      </span>
    </div>
    <div class="bpm-main">
      <div class="bpm-readout">
        <span class="bpm-value">{{ bpmValueText }}</span>
        <span class="bpm-unit">BPM</span>
      </div>
      <div class="bpm-controls" @pointerdown.stop>
        <button
          type="button"
          class="bpm-control-button"
          :disabled="!manualBpmCanHalve"
          @pointerdown.stop
          @click.stop="applyManualBpmFactor(0.5)"
        >
          减半
        </button>
        <button
          type="button"
          class="bpm-control-button is-reset"
          :disabled="!manualBpmResetAvailable"
          @pointerdown.stop
          @click.stop="resetManualBpm"
        >
          重置
        </button>
        <button
          type="button"
          class="bpm-control-button"
          :disabled="!manualBpmCanDouble"
          @pointerdown.stop
          @click.stop="applyManualBpmFactor(2)"
        >
          翻倍
        </button>
      </div>
    </div>
    <span
      class="bpm-status"
      :class="{ 'is-error': status === 'unavailable' }"
    >
      {{ statusText }}
    </span>
  </div>
</template>

<style scoped>
.bpm-content {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-sizing: border-box;
  padding: 16px 20px 18px;
  background-color: var(--md-sys-color-surface, #1c1f26);
  color: var(--md-sys-color-on-surface, #e8edf2);
  user-select: none;
}

.bpm-top {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.bpm-source-row {
  max-width: 100%;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid color-mix(
    in srgb,
    var(--md-sys-color-outline, #8f9099) 48%,
    transparent
  );
  border-radius: 999px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  background-color: color-mix(
    in srgb,
    var(--md-sys-color-surface-container-high, #282a2f) 82%,
    transparent
  );
  font-size: 11px;
  line-height: 1;
}

.bpm-source-label {
  opacity: 0.72;
}

.bpm-source-value {
  min-width: 0;
  overflow: hidden;
  color: var(--md-sys-color-on-surface, #e8edf2);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bpm-source-error {
  display: -webkit-box;
  overflow: hidden;
  max-width: 100%;
  color: var(--md-sys-color-error, #ffb4ab);
  font-size: 10px;
  line-height: 1.35;
  text-align: center;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  line-clamp: 2;
  -webkit-line-clamp: 2;
}

.bpm-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.bpm-readout {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
  min-height: 72px;
}

.bpm-value {
  color: var(--md-sys-color-on-surface, #e8edf2);
  font-size: 64px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.bpm-unit {
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  font-size: 14px;
  font-weight: 600;
}

.bpm-controls {
  width: 100%;
  max-width: 330px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.bpm-control-button {
  width: 100%;
  min-width: 0;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  padding: 0 8px;
  border: 1px solid color-mix(
    in srgb,
    var(--md-sys-color-outline, #8f9099) 56%,
    transparent
  );
  border-radius: 999px;
  background-color: color-mix(
    in srgb,
    var(--md-sys-color-surface-container-high, #282a2f) 88%,
    transparent
  );
  color: var(--md-sys-color-on-surface, #e8edf2);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
  transition: background-color 160ms ease, border-color 160ms ease;
}

.bpm-control-button:not(:disabled):hover {
  border-color: color-mix(
    in srgb,
    var(--md-sys-color-primary, #a8c7fa) 68%,
    transparent
  );
  background-color: color-mix(
    in srgb,
    var(--md-sys-color-primary, #a8c7fa) 14%,
    var(--md-sys-color-surface-container-high, #282a2f)
  );
}

.bpm-control-button:not(:disabled):active {
  border-color: color-mix(
    in srgb,
    var(--md-sys-color-primary, #a8c7fa) 82%,
    transparent
  );
  background-color: color-mix(
    in srgb,
    var(--md-sys-color-primary, #a8c7fa) 24%,
    var(--md-sys-color-surface-container-high, #282a2f)
  );
}

.bpm-control-button:focus-visible {
  outline: 2px solid var(--md-sys-color-primary, #a8c7fa);
  outline-offset: 2px;
}

.bpm-control-button:disabled {
  opacity: 0.38;
  cursor: default;
}

.bpm-control-button.is-reset {
  border-color: color-mix(
    in srgb,
    var(--md-sys-color-outline, #8f9099) 42%,
    transparent
  );
  background-color: color-mix(
    in srgb,
    var(--md-sys-color-surface-container, #22262e) 92%,
    transparent
  );
}

.bpm-status {
  display: block;
  min-height: 17px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
}

.bpm-status.is-error {
  color: var(--md-sys-color-error, #ffb4ab);
}

</style>
