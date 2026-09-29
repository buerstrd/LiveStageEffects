<script setup lang="ts">
import DevicesContent from '~/components/devicescontent.vue'
import { outputsettingsManager } from '~/composables/outputsettingsmanager'
import { settingsManager } from '~/composables/settingsmanager'
import { windowsManager } from '~/composables/windowsmanager'

const {
  showSeconds,
  toggleShowSeconds,
  statusBarBeatIndicator,
  toggleStatusBarBeatIndicator,
  clearBrowserCacheOnStartup,
  toggleClearBrowserCacheOnStartup
} = settingsManager()
const { requestResetWorkspaceLayout } = windowsManager()
const {
  globalBrightness,
  setGlobalBrightness,
  colorCalibration,
  setColorCalibration,
  wirelessDelayCompensation,
  setWirelessDelayCompensation,
  compatibilityMode,
  toggleCompatibilityMode
} = outputsettingsManager()

// 全局输出亮度滑条
const handleBrightnessInput = (e: Event) => {
  setGlobalBrightness(Number((e.target as HTMLInputElement).value))
}

type ColorCalibrationChannel = 'r' | 'g' | 'b'

const calibrationChannels: Array<{
  key: ColorCalibrationChannel
  label: string
}> = [
  { key: 'r', label: 'R' },
  { key: 'g', label: 'G' },
  { key: 'b', label: 'B' }
]

const handleColorCalibrationInput = (channel: ColorCalibrationChannel, e: Event) => {
  setColorCalibration(channel, Number((e.target as HTMLInputElement).value))
}

const handleWirelessDelayInput = (e: Event) => {
  setWirelessDelayCompensation(Number((e.target as HTMLInputElement).value))
}

const formatWirelessDelay = (value: number) => {
  return value > 0 ? `+${value} ms` : `${value} ms`
}

interface CategoryItem {
  id: string
  title: string
  icon: string
}

const categories: CategoryItem[] = [
  { id: 'display', title: '显示', icon: 'display' },
  { id: 'presets', title: '效果', icon: 'presets' },
  { id: 'device', title: '连接', icon: 'device' },
  { id: 'developer', title: '开发', icon: 'developer' },
  { id: 'about', title: '关于', icon: 'about' }
]

const currentCategoryId = useState<string>('settings_current_category', () => 'display')
</script>

<template>
  <div class="android-settings-container">
    <!-- 左侧：设置分类列表 (Android 双列式导航轨) -->
    <nav class="settings-sidebar" aria-label="设置类别">
      <div class="category-list">
        <button
          v-for="cat in categories"
          :key="cat.id"
          class="category-item"
          :class="{ 'is-active': currentCategoryId === cat.id }"
          type="button"
          @click="currentCategoryId = cat.id"
        >
          <!-- 分类图标 -->
          <svg v-if="cat.icon === 'display'" class="cat-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h3l-1 1v2h12v-2l-1-1h3c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z"/>
          </svg>
          <svg v-else-if="cat.icon === 'presets'" class="cat-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 2v3H5V5h14zm-7 5h7v4h-7v-4zm-2 0v4H5v-4h5zm-5 6h5v3H5v-3zm7 3v-3h7v3h-7z"/>
          </svg>
          <svg v-else-if="cat.icon === 'device'" class="cat-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 5V4c0-.55-.45-1-1-1h-2c-.55 0-1 .45-1 1v1h-1v4c0 .55.45 1 1 1h1v7c0 1.1-.9 2-2 2s-2-.9-2-2V7c0-2.21-1.79-4-4-4S5 4.79 5 7v7H4c-.55 0-1 .45-1 1v4h1v1c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-1h1v-4c0-.55-.45-1-1-1H7V7c0-1.1.9-2 2-2s2 .9 2 2v10c0 2.21 1.79 4 4 4s4-1.79 4-4v-7h1c.55 0 1-.45 1-1V5H20z"/>
          </svg>
          <svg v-else-if="cat.icon === 'developer'" class="cat-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4Zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4Z"/>
          </svg>
          <svg v-else class="cat-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
          </svg>

          <span class="cat-name">{{ cat.title }}</span>
        </button>
      </div>
    </nav>

    <!-- 右侧：当前分类选项内容 -->
    <main class="settings-content-area">
      <Transition name="md3-section" mode="out-in">
        <!-- 1. 显示 -->
        <section v-if="currentCategoryId === 'display'" key="display" class="settings-section">
          <header class="section-header">
            <h2 class="section-title">显示</h2>
            <p class="section-desc">配置界面显示参数与顶部状态栏信息项</p>
          </header>

          <div class="settings-card">
            <!-- 选项行：时间是否显示秒 -->
            <div
              class="setting-item-row"
              role="button"
              tabindex="0"
              @click="toggleShowSeconds"
              @keydown.space.prevent="toggleShowSeconds"
              @keydown.enter.prevent="toggleShowSeconds"
            >
              <div class="item-leading-icon">
                <!-- Material Symbols schedule 时钟图标 -->
                <svg class="pref-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                </svg>
              </div>

              <div class="item-text">
                <span class="item-title">显示秒数</span>
                <span class="item-subtitle">在状态栏时间中显示实时秒数</span>
              </div>

              <!-- Material Design 3 拨动开关 -->
              <button
                class="md3-switch"
                :class="{ checked: showSeconds }"
                type="button"
                role="switch"
                :aria-checked="showSeconds"
                @click.stop="toggleShowSeconds"
              >
                <span class="md3-switch-thumb" />
              </button>
            </div>
          </div>

          <div class="settings-card status-beat-settings-card">
            <div
              class="setting-item-row"
              role="button"
              tabindex="0"
              @click="toggleStatusBarBeatIndicator"
              @keydown.space.prevent="toggleStatusBarBeatIndicator"
              @keydown.enter.prevent="toggleStatusBarBeatIndicator"
            >
              <div class="item-leading-icon">
                <svg class="pref-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 18h2V6H7v12zm4 4h2V2h-2v20zm-8-8h2v-4H3v4zm12 4h2V6h-2v12zm4-8v4h2v-4h-2z"/>
                </svg>
              </div>

              <div class="item-text">
                <span class="item-title">状态栏节拍提示</span>
                <span class="item-subtitle">在状态栏提示节拍</span>
              </div>

              <button
                class="md3-switch"
                :class="{ checked: statusBarBeatIndicator }"
                type="button"
                role="switch"
                :aria-checked="statusBarBeatIndicator"
                @click.stop="toggleStatusBarBeatIndicator"
              >
                <span class="md3-switch-thumb" />
              </button>
            </div>
          </div>

          <div class="settings-card reset-window-settings-card">
            <div
              class="setting-item-row"
              role="button"
              tabindex="0"
              @click="requestResetWorkspaceLayout"
              @keydown.space.prevent="requestResetWorkspaceLayout"
              @keydown.enter.prevent="requestResetWorkspaceLayout"
            >
              <div class="item-leading-icon">
                <!-- Material Symbols grid_view -->
                <svg class="pref-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" />
                </svg>
              </div>

              <div class="item-text">
                <span class="item-title">重置窗口布局</span>
                <span class="item-subtitle">自动将视频、事件、设计和预设排列为四宫格</span>
              </div>

              <svg class="item-action-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M9.29 6.71a.996.996 0 0 0 0 1.41L13.17 12l-3.88 3.88a.996.996 0 1 0 1.41 1.41l4.59-4.59a.996.996 0 0 0 0-1.41L10.7 6.7a.996.996 0 0 0-1.41 0z" />
              </svg>
            </div>
          </div>
        </section>

        <!-- 2. 连接 -->
        <section v-else-if="currentCategoryId === 'device'" key="device" class="settings-section device-section">
          <header class="section-header">
            <h2 class="section-title">连接</h2>
            <p class="section-desc">管理硬件连接与无线通信</p>
          </header>

          <DevicesContent />
        </section>

        <!-- 3. 效果 -->
        <section v-else-if="currentCategoryId === 'presets'" key="presets" class="settings-section presets-section">
          <header class="section-header">
            <h2 class="section-title">效果</h2>
            <p class="section-desc">配置输出亮度等全局效果参数</p>
          </header>

          <div class="settings-card">
            <div class="setting-item-row is-static">
              <div class="item-leading-icon">
                <!-- Material Symbols brightness_6 -->
                <svg class="pref-icon" viewBox="0 -960 960 960" fill="currentColor">
                  <path d="M346-160H240q-33 0-56.5-23.5T160-240v-106l-77-78q-11-12-17-26.5T60-480q0-15 6-29.5T83-536l77-78v-106q0-33 23.5-56.5T240-800h106l78-77q12-11 26.5-17t29.5-6q15 0 29.5 6t26.5 17l78 77h106q33 0 56.5 23.5T800-720v106l77 78q11 12 17 26.5t6 29.5q0 15-6 29.5T877-424l-77 78v106q0 33-23.5 56.5T720-160H614l-78 77q-12 11-26.5 17T480-60q-15 0-29.5-6T424-83l-78-77Zm34-80 100 100 100-100h140v-140l100-100-100-100v-140H580L480-820 380-720H240v140L140-480l100 100v140h140Zm100-40q83 0 141.5-58.5T680-480q0-83-58.5-141.5T480-680v400Z" />
                </svg>
              </div>

              <div class="item-text">
                <span class="item-title">输出亮度</span>
                <span class="item-subtitle">调整设备输出的整体亮度</span>
              </div>

              <span class="brightness-value">{{ globalBrightness }}%</span>
            </div>

            <div class="brightness-slider-row">
              <input
                class="brightness-slider"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="globalBrightness"
                :style="{ '--brightness-fill': `${globalBrightness}%` }"
                aria-label="输出亮度"
                @input="handleBrightnessInput"
              >
            </div>
          </div>

          <div class="settings-card color-calibration-settings-card">
            <div class="setting-item-row is-static">
              <div class="item-leading-icon">
                <!-- Material Symbols palette -->
                <svg class="pref-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zM6.5 12C5.67 12 5 11.33 5 10.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5S18.33 12 17.5 12z" />
                </svg>
              </div>

              <div class="item-text">
                <span class="item-title">颜色校准</span>
                <span class="item-subtitle">调整 RGB 输出通道的色彩平衡</span>
              </div>
            </div>

            <div class="color-calibration-sliders">
              <div
                v-for="channel in calibrationChannels"
                :key="channel.key"
                class="color-calibration-row"
              >
                <span class="color-channel-label" :class="`is-${channel.key}`">{{ channel.label }}</span>
                <input
                  class="brightness-slider color-calibration-slider"
                  :class="`is-${channel.key}`"
                  type="range"
                  min="0"
                  max="200"
                  step="1"
                  :value="colorCalibration[channel.key]"
                  :style="{ '--brightness-fill': `${colorCalibration[channel.key] / 2}%` }"
                  :aria-label="`${channel.label} 通道颜色校准`"
                  @input="handleColorCalibrationInput(channel.key, $event)"
                >
                <span class="color-calibration-value">{{ colorCalibration[channel.key] }}%</span>
              </div>
            </div>
          </div>

          <div class="settings-card compatibility-settings-card">
            <div
              class="setting-item-row"
              role="button"
              tabindex="0"
              @click="toggleCompatibilityMode"
              @keydown.space.prevent="toggleCompatibilityMode"
              @keydown.enter.prevent="toggleCompatibilityMode"
            >
              <div class="item-leading-icon">
                <!-- Material Icons colorize -->
                <svg class="pref-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.66 5.41l.92.92-2.69 2.69-.92-.92 2.69-2.69M17.67 3c-.26 0-.51.1-.71.29l-3.12 3.12-1.93-1.91-1.41 1.41 1.42 1.42L3 16.25V21h4.75l8.92-8.92 1.42 1.42 1.41-1.41-1.92-1.92 3.12-3.12c.4-.4.4-1.03.01-1.42l-2.34-2.34c-.2-.19-.45-.29-.7-.29zM6.92 19L5 17.08l8.06-8.06 1.92 1.92L6.92 19z" />
                </svg>
              </div>

              <div class="item-text">
                <span class="item-title">兼容模式</span>
                <span class="item-subtitle">增强低数值 RGB 色彩</span>
              </div>

              <button
                class="md3-switch"
                :class="{ checked: compatibilityMode }"
                type="button"
                role="switch"
                :aria-checked="compatibilityMode"
                @click.stop="toggleCompatibilityMode"
              >
                <span class="md3-switch-thumb" />
              </button>
            </div>
          </div>

          <div class="settings-card wireless-delay-settings-card">
            <div class="setting-item-row is-static">
              <div class="item-leading-icon">
                <!-- Material Symbols timer -->
                <svg class="pref-icon" viewBox="0 -960 960 960" fill="currentColor">
                  <path d="M360-840v-80h240v80H360Zm80 500h80v-240h-80v240Zm40 300q-74 0-139.5-28.5T226-146q-49-49-77.5-114.5T120-400q0-74 28.5-139.5T226-654q49-49 114.5-77.5T480-760q62 0 116 20t100 56l58-58 56 56-58 58q36 46 56 100t20 118q0 74-28.5 139.5T772-146q-49 49-114.5 77.5T480-40Zm0-80q117 0 198.5-81.5T760-400q0-117-81.5-198.5T480-680q-117 0-198.5 81.5T200-400q0 117 81.5 198.5T480-120Zm0-280Z" />
                </svg>
              </div>

              <div class="item-text">
                <span class="item-title">延迟调整</span>
                <span class="item-subtitle">校准输出延迟</span>
              </div>

              <span class="wireless-delay-value">{{ formatWirelessDelay(wirelessDelayCompensation) }}</span>
            </div>

            <div class="wireless-delay-slider-row">
              <input
                class="brightness-slider wireless-delay-slider"
                type="range"
                min="-500"
                max="500"
                step="1"
                :value="wirelessDelayCompensation"
                :style="{ '--brightness-fill': `${(wirelessDelayCompensation + 500) / 10}%` }"
                aria-label="无线传输延迟调整"
                @input="handleWirelessDelayInput"
              >
            </div>
          </div>
        </section>

        <!-- 4. 开发 -->
        <section v-else-if="currentCategoryId === 'developer'" key="developer" class="settings-section developer-section">
          <header class="section-header">
            <h2 class="section-title">开发</h2>
            <p class="section-desc">用于调试和调整界面运行效果</p>
          </header>

          <div class="settings-card">
            <div
              class="setting-item-row"
              role="button"
              tabindex="0"
              @click="toggleClearBrowserCacheOnStartup"
              @keydown.space.prevent="toggleClearBrowserCacheOnStartup"
              @keydown.enter.prevent="toggleClearBrowserCacheOnStartup"
            >
              <div class="item-leading-icon">
                <!-- Material Icons delete_sweep -->
                <svg class="pref-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15 16h4v2h-4v-2zm0-8h7v2h-7V8zm0 4h6v2h-6v-2zM3 18c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2V8H3v10zM14 5h-3l-1-1H6L5 5H2v2h12V5z" />
                </svg>
              </div>

              <div class="item-text">
                <span class="item-title">不保留缓存</span>
                <span class="item-subtitle">启动时自动清理浏览器缓存，保持干净状态</span>
              </div>

              <button
                class="md3-switch"
                :class="{ checked: clearBrowserCacheOnStartup }"
                type="button"
                role="switch"
                :aria-checked="clearBrowserCacheOnStartup"
                @click.stop="toggleClearBrowserCacheOnStartup"
              >
                <span class="md3-switch-thumb" />
              </button>
            </div>
          </div>
        </section>

        <!-- 5. 关于 -->
        <section v-else-if="currentCategoryId === 'about'" key="about" class="settings-section about-section">
          <h1 class="about-title">LiveStage Effects</h1>
          <span class="about-version">1.0 公开测试版@buerstrd</span>
          <span class="about-team">Powered by LiveStage Team</span>
          <a
            class="about-github"
            href="https://github.com/buerstrd/LiveStageEffects"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg class="about-github-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            GitHub
          </a>
        </section>

        <!-- 6. 预留其他分类空态占位 -->
        <section v-else key="empty" class="settings-section empty-category">
          <div class="empty-cat-box">
            <span class="empty-cat-title">{{ categories.find(c => c.id === currentCategoryId)?.title }}</span>
            <span class="empty-cat-desc">该分类设置项即将推出</span>
          </div>
        </section>
      </Transition>
    </main>
  </div>
</template>

<style scoped>
.android-settings-container {
  width: 100%;
  height: 100%;
  display: flex;
  background-color: var(--md-sys-color-surface, #1c1f26);
  color: var(--md-sys-color-on-surface, #e8edf2);
  user-select: none;
  overflow: hidden;
}

/* 左侧分类导航栏 (类似安卓平板多列式设置) */
.settings-sidebar {
  width: auto;
  height: 100%;
  background-color: var(--md-sys-color-surface-container-low, #1c2027);
  border-right: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08));
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding: 12px 10px;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.category-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 9999px; /* 安卓 MD3 经典药丸状胶囊项 */
  background: transparent;
  border: none;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  outline: none;
  text-align: center;
  transition: all 0.15s cubic-bezier(0.2, 0, 0, 1);
}

.category-item:hover:not(.is-active) {
  background-color: var(--md-sys-color-surface-container-highest, rgba(255, 255, 255, 0.06));
  color: var(--md-sys-color-on-surface, #e8edf2);
}

.category-item.is-active {
  background-color: var(--md-sys-color-secondary-container, #3a4658);
  color: var(--md-sys-color-on-secondary-container, #d8e2f3);
  font-weight: 600;
}

.category-item.is-active .cat-icon {
  color: var(--md-sys-color-primary, #8ab4f8);
}

.cat-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.cat-name {
  font-size: 13px;
  white-space: nowrap;
}

/* 右侧内容区域 */
.settings-content-area {
  flex: 1;
  height: 100%;
  padding: 20px 24px;
  overflow-y: auto;
  background-color: var(--md-sys-color-surface, #1c1f26);
}

.settings-section {
  display: flex;
  flex-direction: column;
  max-width: 580px;
}

/* MD3 分类切换过渡：纯渐变淡入淡出 */
.md3-section-enter-active {
  transition: opacity 0.22s cubic-bezier(0.2, 0, 0, 1);
}

.md3-section-leave-active {
  transition: opacity 0.15s cubic-bezier(0.4, 0, 1, 1);
}

.md3-section-enter-from,
.md3-section-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .md3-section-enter-active,
  .md3-section-leave-active {
    transition: none;
  }
}

/* 设备与互联：复用设备管理组件并适配设置页排版 */
.device-section :deep(.device-row-container) {
  padding: 0;
  max-height: none;
  overflow: visible;
}

.section-header {
  margin-bottom: 16px;
}

.section-title {
  margin: 0 0 4px 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface, #e8edf2);
}

.section-desc {
  margin: 0;
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

/* 安卓风格设置卡片容器 */
.settings-card {
  background-color: var(--md-sys-color-surface-container-high, #282c35);
  border: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08));
  border-radius: 16px;
  overflow: hidden;
}

.color-calibration-settings-card,
.compatibility-settings-card,
.wireless-delay-settings-card,
.status-beat-settings-card,
.reset-window-settings-card {
  margin-top: 12px;
}

/* 设置项单行 */
.setting-item-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  cursor: pointer;
  transition: background-color 0.15s ease;
  outline: none;
}

.setting-item-row:hover {
  background-color: rgba(255, 255, 255, 0.04);
}

/* 非可点击的设置项行 */
.setting-item-row.is-static,
.setting-item-row.is-static:hover {
  cursor: default;
  background-color: transparent;
}

.brightness-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--md-sys-color-primary, #8ab4f8);
  font-variant-numeric: tabular-nums;
  min-width: 42px;
  text-align: right;
}

/* 横向简单滑条（无额外动画） */
.brightness-slider-row {
  padding: 2px 16px 16px;
}

.wireless-delay-slider-row {
  padding: 2px 16px 16px;
}

.wireless-delay-value {
  min-width: 66px;
  color: var(--md-sys-color-primary, #8ab4f8);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.color-calibration-sliders {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 2px 16px 16px;
}

.color-calibration-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 42px;
  align-items: center;
  gap: 10px;
}

.color-channel-label {
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}

.color-channel-label.is-r,
.color-calibration-slider.is-r {
  --slider-accent: #f28b82;
}

.color-channel-label.is-g,
.color-calibration-slider.is-g {
  --slider-accent: #81c995;
}

.color-channel-label.is-b,
.color-calibration-slider.is-b {
  --slider-accent: #8ab4f8;
}

.color-channel-label.is-r {
  color: #f28b82;
}

.color-channel-label.is-g {
  color: #81c995;
}

.color-channel-label.is-b {
  color: #8ab4f8;
}

.color-calibration-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.brightness-slider {
  -webkit-appearance: none;
  appearance: none;
  display: block;
  width: 100%;
  height: 16px;
  margin: 0;
  /* 已填充部分（0 → 当前值）使用主题色，其余保持轨道底色 */
  background-image: linear-gradient(
    to right,
    var(--slider-accent, var(--md-sys-color-primary, #8ab4f8)) 0%,
    var(--slider-accent, var(--md-sys-color-primary, #8ab4f8)) var(--brightness-fill, 0%),
    var(--md-sys-color-surface-container-highest, #323843) var(--brightness-fill, 0%),
    var(--md-sys-color-surface-container-highest, #323843) 100%
  );
  background-size: 100% 4px;
  background-position: center;
  background-repeat: no-repeat;
  background-color: transparent;
  cursor: pointer;
  outline: none;
}

.brightness-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background-color: transparent;
}

.brightness-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -6px;
  border: none;
  border-radius: 50%;
  background-color: var(--slider-accent, var(--md-sys-color-primary, #8ab4f8));
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--slider-accent, #8ab4f8) 0%, transparent);
  transition: box-shadow 0.12s cubic-bezier(0.2, 0, 0, 1);
}

/* MD3 状态层：悬停时浮现固定大小的淡色轮廓 */
.brightness-slider:hover::-webkit-slider-thumb {
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--slider-accent, #8ab4f8) 12%, transparent);
}

.brightness-slider::-moz-range-track {
  height: 4px;
  border-radius: 2px;
  background-color: transparent;
}

.brightness-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background-color: var(--slider-accent, var(--md-sys-color-primary, #8ab4f8));
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--slider-accent, #8ab4f8) 0%, transparent);
  transition: box-shadow 0.12s cubic-bezier(0.2, 0, 0, 1);
}

.brightness-slider:hover::-moz-range-thumb {
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--slider-accent, #8ab4f8) 12%, transparent);
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

.item-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface, #e8edf2);
}

.item-subtitle {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

.item-action-icon {
  width: 20px;
  height: 20px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  flex-shrink: 0;
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

/* 关于 */
.about-section {
  align-items: center;
  justify-content: center;
  min-height: 260px;
  text-align: center;
}

.about-title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  color: var(--md-sys-color-on-surface, #e8edf2);
}

.about-version {
  margin-top: 10px;
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

.about-team {
  margin-top: 6px;
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  opacity: 0.8;
}

.about-github {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 18px;
  padding: 8px 16px;
  border-radius: 9999px;
  border: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.12));
  background-color: var(--md-sys-color-surface-container-high, #282c35);
  color: var(--md-sys-color-on-surface, #e8edf2);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  outline: none;
}

.about-github:hover {
  background-color: var(--md-sys-color-surface-container-highest, #323843);
}

.about-github-icon {
  width: 18px;
  height: 18px;
}

/* 空分类占位 */
.empty-category {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 180px;
}

.empty-cat-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

.empty-cat-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface, #e8edf2);
}

.empty-cat-desc {
  font-size: 12px;
}
</style>
