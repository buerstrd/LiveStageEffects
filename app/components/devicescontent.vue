<script setup lang="ts">
const {
  isSerialConnected,
  serialPortInfo,
  isRfStreaming,
  rfTxFrameCount,
  rfTxFps,
  currentStreamRGB,
  currentWirelessData,
  devicePlayingEffect,
  hasConnectedDevice,
  connectSerial,
  disconnectSerial
} = devicesManager()

const handleSerialClick = async () => {
  if (isSerialConnected.value) {
    await disconnectSerial()
  } else {
    await connectSerial()
  }
}
</script>

<template>
  <div class="device-row-container">
    <!-- USB 串口硬件连接 (Web Serial) 与无线通信监视器 -->
    <div class="device-card serial-card">
      <div
        class="serial-setting-row"
        role="button"
        tabindex="0"
        @click="handleSerialClick"
        @keydown.space.prevent="handleSerialClick"
        @keydown.enter.prevent="handleSerialClick"
      >
        <div class="item-leading-icon">
          <!-- USB 图标 -->
          <svg class="pref-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15 7v4h1v2h-3V5h2l-3-4-3 4h2v8H8v-2.07c.6-.34 1-.98 1-1.72a2 2 0 0 0-2-2 2 2 0 0 0-2 2c0 .74.4 1.38 1 1.72V13c0 1.1.9 2 2 2h3v4.07c-.6.34-1 .98-1 1.72a2 2 0 0 0 2 2 2 2 0 0 0 2-2c0-.74-.4-1.38-1-1.72V15h3c1.1 0 2-.9 2-2v-2h1V7h-4z" />
          </svg>
        </div>

        <div class="serial-text">
          <span class="serial-title">串行端口</span>
          <span class="serial-subtitle">
            {{ isSerialConnected
              ? `${serialPortInfo || 'ESP32 Dev Module'} (115200 bps)`
              : '通过串行端口连接到 LiveStage Client' }}
          </span>
        </div>

        <button
          class="md3-switch"
          :class="{ checked: isSerialConnected }"
          type="button"
          role="switch"
          :aria-checked="isSerialConnected"
          @click.stop="handleSerialClick"
        >
          <span class="md3-switch-thumb" />
        </button>
      </div>

      <!-- 无线通信监视器 -->
      <div v-if="hasConnectedDevice" class="rf-monitor">
        <div class="rf-details">
          <div class="rf-row">
            <span class="rf-key">当前数据</span>
            <div class="rf-val-wrap">
              <!-- 最近一次手动发送的数据 -->
              <span v-if="currentWirelessData" class="rf-val font-mono is-raw">{{ currentWirelessData }}</span>
              <!-- 否则显示当前发射的色彩数据 -->
              <template v-else>
                <span class="color-swatch" :style="{ backgroundColor: currentStreamRGB.hex }" />
                <span class="rf-val font-mono">{{ currentStreamRGB.hex }} ({{ currentStreamRGB.r }}, {{ currentStreamRGB.g }}, {{ currentStreamRGB.b }})</span>
              </template>
            </div>
          </div>
          <div class="rf-row">
            <span class="rf-key">发送帧数</span>
            <span class="rf-val font-mono rf-frame-count">{{ rfTxFrameCount }} 帧</span>
          </div>
          <div class="rf-row">
            <span class="rf-key">实时速率</span>
            <span class="rf-val font-mono rf-fps-value">
              <span class="rf-fps-number">{{ rfTxFps.toFixed(1) }}</span>
              <span>FPS</span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 设备当前同步效果卡片 -->
    <div v-if="hasConnectedDevice && devicePlayingEffect" class="device-card effect-card">
      <div class="card-header">
        <span class="card-title">当前发送预设</span>
      </div>
      <div class="effect-details">
        <div class="effect-row">
          <span class="effect-key">预设名称</span>
          <span class="effect-val">{{ devicePlayingEffect.presetName }} (ID: {{ devicePlayingEffect.presetId }})</span>
        </div>
        <div class="effect-row">
          <span class="effect-key">基准颜色</span>
          <div class="color-preview-wrap">
            <span class="color-swatch" :style="{ backgroundColor: devicePlayingEffect.effect.color }" />
            <span class="effect-val font-mono">{{ devicePlayingEffect.effect.color }}</span>
          </div>
        </div>
        <div class="effect-row">
          <span class="effect-key">周期时长</span>
          <span class="effect-val font-mono">{{ (devicePlayingEffect.effect.duration / 1000).toFixed(1) }}s</span>
        </div>
        <div class="effect-row">
          <span class="effect-key">循环方式</span>
          <span class="effect-val">
            {{ devicePlayingEffect.effect.repeat === 0 ? '无限循环' : `重复 ${devicePlayingEffect.effect.repeat} 次` }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.device-row-container {
  padding: 16px;
  color: var(--md-sys-color-on-surface, #e8edf2);
  user-select: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  max-height: 100%;
}

.device-card {
  padding: 14px 16px;
  background-color: var(--md-sys-color-surface-container-high, #282c35);
  border: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08));
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 8px;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--md-sys-color-primary, #8ab4f8);
  letter-spacing: 0.3px;
}

/* 串口连接开关行（与普通设置项一致） */
.serial-setting-row {
  display: flex;
  align-items: center;
  gap: 14px;
  cursor: pointer;
  outline: none;
}

.item-leading-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background-color: var(--md-sys-color-surface-container-highest, #323843);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--md-sys-color-primary, #8ab4f8);
}

.pref-icon {
  width: 20px;
  height: 20px;
}

.serial-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.serial-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface, #e8edf2);
}

.serial-subtitle {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

/* MD3 拨动开关 */
.md3-switch {
  position: relative;
  overflow: hidden;
  width: 48px;
  height: 28px;
  border-radius: 9999px;
  background-color: var(--md-sys-color-surface-container-highest, #323843);
  border: 2px solid var(--md-sys-color-outline, #727b8c);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
  display: inline-flex;
  align-items: center;
  padding: 0 2px;
  box-sizing: border-box;
  flex-shrink: 0;
  outline: none;
}

.md3-switch:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.md3-switch.checked {
  background-color: var(--md-sys-color-primary, #8ab4f8);
  border-color: var(--md-sys-color-primary, #8ab4f8);
}

.md3-switch-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background-color: var(--md-sys-color-outline, #727b8c);
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
  transform: translateX(2px);
}

.md3-switch.checked .md3-switch-thumb {
  width: 20px;
  height: 20px;
  background-color: rgb(25, 48, 108);
  transform: translateX(20px);
}

/* 无线通信监视器（与串口开关同处一张卡片） */
.rf-monitor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.rf-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rf-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}

.rf-key {
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  flex-shrink: 0;
}

.rf-val-wrap {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
}

.rf-val {
  color: var(--md-sys-color-on-surface, #e8edf2);
  font-weight: 500;
}

.rf-frame-count {
  display: inline-block;
  min-width: 7ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1, 'lnum' 1;
}

.rf-fps-value {
  display: inline-flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 0.4ch;
  min-width: 8ch;
}

.rf-fps-number {
  display: inline-block;
  min-width: 4ch;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace !important;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1, 'lnum' 1;
}

/* 指令数据可能较长，允许换行并右对齐 */
.rf-val.is-raw {
  word-break: break-all;
  text-align: right;
}

.effect-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.effect-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}

.effect-key {
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

.effect-val {
  color: var(--md-sys-color-on-surface, #e8edf2);
  font-weight: 500;
}

.font-mono {
  font-family: 'Google Sans', sans-serif;
}

.color-preview-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-swatch {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
}
</style>
