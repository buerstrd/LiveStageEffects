<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { presetsManager, type PresetItem } from '~/composables/presetsmanager'
import { eventsManager } from '~/composables/eventsmanager'
import { windowsManager } from '~/composables/windowsmanager'
import { devicesManager } from '~/composables/devicesmanager'
import { settingsManager } from '~/composables/settingsmanager'

const {
  presets,
  selectedPresetId,
  selectPreset,
  removePreset,
  updatePresetName,
  updatePresetShortcut,
  movePreset,
  triggerPlaySync
} = presetsManager()
const { isEventRecording, recordPresetEvent, selectEvent } = eventsManager()

const { focusWindow, setDesignViewMode } = windowsManager()
const { hasConnectedDevice, sendPresetToDevice } = devicesManager()
const { disableAnimations } = settingsManager()

const handleCardClick = (preset: PresetItem) => {
  presetDeselectArmed.value = false
  if (!isEventRecording.value) {
    selectEvent(null)
    setDesignViewMode('curve')
  }
  selectPreset(preset.id)
  if (isEventRecording.value) {
    recordPresetEvent(preset)
  }
  focusWindow('win-presets')
}

const editingId = ref<number | null>(null)
const editingName = ref('')
const editInputRef = ref<HTMLInputElement | null>(null)
const gridContainerRef = ref<HTMLDivElement | null>(null)
const draggingPresetId = ref<number | null>(null)
const dragOverPresetId = ref<number | null>(null)
const dragOverPresetPosition = ref<'before' | 'after'>('before')
const presetGridScrollTop = useState<number>('presets_grid_scroll_top', () => 0)
const workspaceRestoreVersion = useState<number>(
  'project_workspace_restore_version',
  () => 0
)
const PRESET_CARD_DEFAULT_SIZE = 96
const presetCardSize = useState<number>('presets_card_size', () => PRESET_CARD_DEFAULT_SIZE)
const presetZoomLabel = computed(() => {
  return `${(presetCardSize.value / PRESET_CARD_DEFAULT_SIZE).toFixed(2)}X`
})
const currentPresetOrdinal = computed(() => {
  if (selectedPresetId.value === null) return null
  const index = presets.value.findIndex(preset => preset.id === selectedPresetId.value)
  return index === -1 ? null : index + 1
})

const PRESET_DRAG_MIME = 'application/x-livestage-preset'
const PRESET_DRAG_META_MIME = 'application/x-livestage-preset-meta'
const PRESET_DRAG_TEXT_PREFIX = 'livestage-preset:'
const PRESET_CARD_MIN_SIZE = 64
const PRESET_CARD_MAX_SIZE = 160
const PRESET_CARD_SIZE_STEP = 16

const setPresetCardSizeAnimated = async (nextSize: number) => {
  if (nextSize === presetCardSize.value) return

  const cards = gridContainerRef.value
    ? Array.from(gridContainerRef.value.querySelectorAll<HTMLElement>('.preset-card'))
    : []
  const previousFrames = cards.map((card) => {
    const rect = card.getBoundingClientRect()
    card.getAnimations().forEach((animation) => {
      if (animation.id === 'preset-card-resize') {
        animation.cancel()
      }
    })
    return { card, rect }
  })

  presetCardSize.value = nextSize
  await nextTick()

  if (disableAnimations.value) return

  previousFrames.forEach(({ card, rect: previousRect }) => {
    if (!card.isConnected) return

    const nextRect = card.getBoundingClientRect()
    if (nextRect.width <= 0 || nextRect.height <= 0) return

    const translateX = previousRect.left - nextRect.left
    const translateY = previousRect.top - nextRect.top
    const sizeChanged = (
      Math.abs(previousRect.width - nextRect.width) > 0.5 ||
      Math.abs(previousRect.height - nextRect.height) > 0.5
    )

    if (
      !sizeChanged &&
      Math.abs(translateX) < 0.5 &&
      Math.abs(translateY) < 0.5
    ) {
      return
    }

    card.animate(
      [
        {
          transform: `translate(${translateX}px, ${translateY}px)`,
          width: `${previousRect.width}px`,
          height: `${previousRect.height}px`,
          transformOrigin: 'top left'
        },
        {
          transform: 'translate(0, 0)',
          width: `${nextRect.width}px`,
          height: `${nextRect.height}px`,
          transformOrigin: 'top left'
        }
      ],
      {
        id: 'preset-card-resize',
        duration: 240,
        easing: 'cubic-bezier(0.2, 0, 0, 1)'
      }
    )
  })
}

const zoomOutPresets = () => {
  void setPresetCardSizeAnimated(
    Math.max(
      PRESET_CARD_MIN_SIZE,
      presetCardSize.value - PRESET_CARD_SIZE_STEP
    )
  )
}

const zoomInPresets = () => {
  void setPresetCardSizeAnimated(
    Math.min(
      PRESET_CARD_MAX_SIZE,
      presetCardSize.value + PRESET_CARD_SIZE_STEP
    )
  )
}

const handlePresetGridScroll = () => {
  if (gridContainerRef.value) {
    presetGridScrollTop.value = gridContainerRef.value.scrollTop
  }
}

const restorePresetGridScroll = () => {
  nextTick(() => {
    requestAnimationFrame(() => {
      if (gridContainerRef.value) {
        gridContainerRef.value.scrollTop = presetGridScrollTop.value
      }
    })
  })
}

watch(workspaceRestoreVersion, () => {
  restorePresetGridScroll()
})

const handlePresetDragStart = (preset: PresetItem, event: DragEvent) => {
  if (
    editingId.value === preset.id ||
    !event.dataTransfer
  ) {
    event.preventDefault()
    return
  }

  event.dataTransfer.effectAllowed = 'copyMove'
  event.dataTransfer.setData(PRESET_DRAG_MIME, String(preset.id))
  event.dataTransfer.setData('text/plain', `${PRESET_DRAG_TEXT_PREFIX}${preset.id}`)
  const cardElement = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : null
  const cardRect = cardElement?.getBoundingClientRect()
  if (cardRect && cardRect.width > 0 && cardRect.height > 0) {
    event.dataTransfer.setData(PRESET_DRAG_META_MIME, JSON.stringify({
      id: preset.id,
      rect: {
        left: cardRect.left,
        top: cardRect.top,
        width: cardRect.width,
        height: cardRect.height
      },
      grabOffset: {
        x: event.clientX - cardRect.left,
        y: event.clientY - cardRect.top
      }
    }))
  }
  draggingPresetId.value = preset.id
}

const handlePresetDragEnd = () => {
  draggingPresetId.value = null
  dragOverPresetId.value = null
  dragOverPresetPosition.value = 'before'
}

const handlePresetDragOver = (preset: PresetItem, event: DragEvent) => {
  if (
    draggingPresetId.value === null ||
    draggingPresetId.value === preset.id ||
    !event.dataTransfer
  ) {
    return
  }

  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'

  const card = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : null
  if (!card) return

  const rect = card.getBoundingClientRect()
  dragOverPresetId.value = preset.id
  dragOverPresetPosition.value = event.clientX >= rect.left + rect.width / 2
    ? 'after'
    : 'before'
}

const handlePresetDragLeave = (preset: PresetItem, event: DragEvent) => {
  const card = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : null
  const nextTarget = event.relatedTarget
  if (card && nextTarget instanceof Node && card.contains(nextTarget)) return

  if (dragOverPresetId.value === preset.id) {
    dragOverPresetId.value = null
  }
}

const handlePresetDrop = (preset: PresetItem, event: DragEvent) => {
  if (draggingPresetId.value === null || !event.dataTransfer) return

  event.preventDefault()
  event.stopPropagation()
  movePreset(
    draggingPresetId.value,
    preset.id,
    dragOverPresetId.value === preset.id
      ? dragOverPresetPosition.value
      : 'before'
  )
  handlePresetDragEnd()
}

// 快捷键录制状态
const bindingPresetId = ref<number | null>(null)
const presetDeselectArmed = ref(false)

const handleBackgroundClick = () => {
  bindingPresetId.value = null
  if (selectedPresetId.value === null) {
    presetDeselectArmed.value = false
    return
  }

  if (!presetDeselectArmed.value) {
    presetDeselectArmed.value = true
    return
  }

  presetDeselectArmed.value = false
  selectPreset(null)
}

watch(selectedPresetId, () => {
  presetDeselectArmed.value = false
})

// 快捷键触发反馈状态 (卡片高亮闪烁)
const triggeredPresetId = ref<number | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | null = null

// 开始录制快捷键
const startBinding = (presetId: number) => {
  bindingPresetId.value = presetId
}

// 格式化按键名称
const formatKeyName = (e: KeyboardEvent): string => {
  if (e.key === ' ') return 'Space'
  if (e.code && e.code.startsWith('Digit')) {
    return e.code.replace('Digit', '')
  }
  if (e.code && e.code.startsWith('Key')) {
    return e.code.replace('Key', '')
  }
  if (e.key.length === 1) {
    return e.key.toUpperCase()
  }
  return e.key
}

// 全局按键监听：录制快捷键 / 捕获已绑定预设的按键触发
const handleGlobalKeyDown = (e: KeyboardEvent) => {
  // 1. 若处于快捷键录制模式
  if (bindingPresetId.value !== null) {
    const bindingId = bindingPresetId.value
    // 忽略单纯按下的修饰键
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
      return
    }

    e.preventDefault()
    e.stopPropagation()

    if (e.key === 'Escape') {
      // Esc 移除当前预设的按键绑定
      updatePresetShortcut(bindingId, '')
      bindingPresetId.value = null
      return
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      // Backspace / Delete 清除快捷键
      updatePresetShortcut(bindingId, '')
      bindingPresetId.value = null
      return
    }

    const keyName = formatKeyName(e)
    updatePresetShortcut(bindingId, keyName)
    bindingPresetId.value = null
    return
  }

  // 若焦点在可输入控件中，忽略快捷键触发
  const target = e.target as HTMLElement | null
  if (target) {
    const tagName = target.tagName.toLowerCase()
    if (tagName === 'input' || tagName === 'textarea' || target.isContentEditable) {
      return
    }
  }

  // 忽略单独的修饰键
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
    return
  }

  const pressedKey = formatKeyName(e).toUpperCase()
  const matchedPreset = presets.value.find(
    p => p.shortcut && p.shortcut.toUpperCase() === pressedKey
  )

  if (matchedPreset) {
    e.preventDefault()
    e.stopPropagation()

    presetDeselectArmed.value = false
    // 选中并同步播放效果
    if (!isEventRecording.value) {
      setDesignViewMode('curve')
      selectEvent(null)
    }
    selectPreset(matchedPreset.id)
    triggerPlaySync()

    // 若设备已连接，立即下发硬件
    if (hasConnectedDevice.value) {
      sendPresetToDevice(matchedPreset)
    }

    // 触发卡片闪烁反馈
    triggeredPresetId.value = matchedPreset.id
    if (!e.repeat) {
      recordPresetEvent(matchedPreset)
    }
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      if (triggeredPresetId.value === matchedPreset.id) {
        triggeredPresetId.value = null
      }
    }, 150)
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeyDown, true)
  restorePresetGridScroll()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeyDown, true)
  if (flashTimer) clearTimeout(flashTimer)
})

// 开启编辑名称
const startEdit = (preset: PresetItem) => {
  editingId.value = preset.id
  editingName.value = preset.name
  nextTick(() => {
    editInputRef.value?.focus()
    editInputRef.value?.select()
  })
}

// 保存编辑
const saveEdit = (id: number) => {
  if (editingId.value !== id) return
  updatePresetName(id, editingName.value)
  editingId.value = null
}

// 删除预设
const handleDeletePreset = (id: number) => {
  editingId.value = null
  removePreset(id)
}

// 取消编辑
const cancelEdit = () => {
  editingId.value = null
}

// 监听新增预设自动滚动至底部
watch(
  () => presets.value.length,
  (newLen, oldLen) => {
    if (newLen > (oldLen || 0)) {
      nextTick(() => {
        if (gridContainerRef.value) {
          gridContainerRef.value.scrollTop = gridContainerRef.value.scrollHeight
        }
      })
    }
  }
)
</script>

<template>
  <div
    class="presets-window-container"
    @click="handleBackgroundClick"
  >
    <!-- 网格滚动区 -->
    <div
      ref="gridContainerRef"
      class="presets-grid-scroll"
      @scroll="handlePresetGridScroll"
    >
      <!-- 正方形网格 -->
      <TransitionGroup
        v-if="presets.length > 0"
        name="presets-list"
        tag="div"
        appear
        class="presets-grid"
        :style="{ '--preset-card-size': `${presetCardSize}px` }"
      >
        <div
          v-for="preset in presets"
          :key="preset.id"
          class="preset-card"
          :class="{
            'is-selected': selectedPresetId === preset.id,
            'is-pending-deselect': presetDeselectArmed && selectedPresetId === preset.id,
            'is-triggered': triggeredPresetId === preset.id,
            'is-editing': editingId === preset.id,
            'is-dragging': draggingPresetId === preset.id,
            'is-drag-before': dragOverPresetId === preset.id && dragOverPresetPosition === 'before',
            'is-drag-after': dragOverPresetId === preset.id && dragOverPresetPosition === 'after'
          }"
          :style="{ '--preset-color': preset.effect?.color || '#ffffff' }"
          :draggable="editingId !== preset.id"
          @dragstart="handlePresetDragStart(preset, $event)"
          @dragover="handlePresetDragOver(preset, $event)"
          @dragleave="handlePresetDragLeave(preset, $event)"
          @drop="handlePresetDrop(preset, $event)"
          @dragend="handlePresetDragEnd"
          @pointerdown.stop
          @click.stop="handleCardClick(preset)"
          @dblclick.stop="startEdit(preset)"
        >
          <!-- 每一个预设左上角为 ID 数字 -->
          <span class="preset-id">{{ preset.id }}</span>

          <!-- 右上角快捷键标记/配置按钮 (原垃圾桶位置) -->
          <button
            v-if="editingId !== preset.id"
            class="preset-shortcut-badge"
            type="button"
            :class="{
              'is-binding': bindingPresetId === preset.id,
              'has-shortcut': !!preset.shortcut
            }"
            @click.stop="bindingPresetId === preset.id ? (bindingPresetId = null) : startBinding(preset.id)"
          >
            <span v-if="bindingPresetId === preset.id" class="binding-text">...</span>
            <span v-else-if="preset.shortcut" class="shortcut-key">{{ preset.shortcut }}</span>
            <span v-else class="shortcut-placeholder">+</span>
          </button>

          <!-- 预设名称区域 -->
          <div class="preset-name-area" :class="{ 'is-editing': editingId === preset.id }">
            <Transition name="preset-name-edit" mode="out-in">
              <div
                v-if="editingId === preset.id"
                key="edit"
                class="preset-edit-group"
              >
                <input
                  ref="editInputRef"
                  v-model="editingName"
                  class="preset-name-input"
                  type="text"
                  @click.stop
                  @dblclick.stop
                  @blur="saveEdit(preset.id)"
                  @keydown.enter="saveEdit(preset.id)"
                  @keydown.esc="cancelEdit"
                />
                <!-- 打钩完成保存图标 -->
                <span
                  class="save-preset-check"
                  aria-label="完成保存"
                  @mousedown.prevent
                  @click.stop="saveEdit(preset.id)"
                >
                  <svg class="preset-action-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                </span>
              </div>
              <span v-else key="display" class="preset-name">{{ preset.name }}</span>
            </Transition>
          </div>

          <!-- 右下角删除预设 -->
          <button
            class="preset-delete-btn"
            type="button"
            aria-label="删除预设"
            draggable="false"
            @pointerdown.stop
            @dragstart.stop.prevent
            @mousedown.prevent
            @click.stop="handleDeletePreset(preset.id)"
            @dblclick.stop
          >
            <svg class="preset-action-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
            </svg>
          </button>
        </div>
      </TransitionGroup>

      <!-- 空状态 -->
      <div v-else class="presets-empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 2v3H5V5h14zm-7 5h7v4h-7v-4zm-2 0v4H5v-4h5zm-5 6h5v3H5v-3zm7 3v-3h7v3h-7z"
          />
        </svg>
        <span class="empty-title">暂无预设</span>
      </div>
    </div>

    <!-- 底部统计栏 (若有预设) -->
    <div v-if="presets.length > 0" class="presets-footer">
      <div class="presets-footer-summary">
        <span v-if="currentPresetOrdinal !== null" class="footer-current">
          当前第 {{ currentPresetOrdinal }} 个预设，
        </span>
        <span class="footer-count">共 {{ presets.length }} 个预设</span>
      </div>
      <div class="preset-zoom-controls">
        <button
          class="preset-zoom-btn"
          type="button"
          aria-label="缩小预设"
          :disabled="presetCardSize <= PRESET_CARD_MIN_SIZE"
          @click.stop="zoomOutPresets"
        >
          <svg class="preset-zoom-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13H5v-2h14v2z" />
          </svg>
        </button>
        <span class="preset-zoom-value">{{ presetZoomLabel }}</span>
        <button
          class="preset-zoom-btn"
          type="button"
          aria-label="放大预设"
          :disabled="presetCardSize >= PRESET_CARD_MAX_SIZE"
          @click.stop="zoomInPresets"
        >
          <svg class="preset-zoom-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.presets-window-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background-color: var(--md-sys-color-surface, #1c1f26);
  color: var(--md-sys-color-on-surface, #e8edf2);
  user-select: none;
  overflow: hidden;
}

/* 网格滚动容器 */
.presets-grid-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
}

.presets-grid-scroll::-webkit-scrollbar {
  width: 6px;
}

.presets-grid-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.presets-grid-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.14);
  border-radius: 3px;
}

.presets-grid-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}

/* 正方形网格布局 */
.presets-grid {
  display: grid;
  grid-template-columns: repeat(
    auto-fill,
    minmax(var(--preset-card-size, 96px), 1fr)
  );
  gap: 12px;
}

.preset-card.presets-list-enter-active {
  transition: opacity 0.24s cubic-bezier(0.2, 0, 0, 1);
}

.preset-card.presets-list-enter-from {
  opacity: 0;
}

/* 单个正方形预设卡片 */
.preset-card {
  position: relative;
  aspect-ratio: 1 / 1;
  border-radius: 10px;
  background-color: var(--md-sys-color-surface-container-high, #282c35);
  background-color: color-mix(
    in srgb,
    var(--preset-color, #ffffff) 32%,
    var(--md-sys-color-surface-container-high, #282c35)
  );
  border: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08));
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 8px;
  cursor: pointer;
  user-select: none;
  -webkit-user-drag: element;
  box-sizing: border-box;
  transition: background-color 0.15s ease, border-color 0.1s ease;
}

.preset-card.is-dragging {
  opacity: 0.45;
}

.preset-card.presets-list-move {
  transition: transform 260ms cubic-bezier(0.2, 0, 0, 1);
}

.preset-card.is-drag-before::before,
.preset-card.is-drag-after::after {
  content: '';
  position: absolute;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 2px;
  background-color: var(--md-sys-color-primary, #8ab4f8);
  box-shadow: 0 0 6px rgba(138, 180, 248, 0.55);
  pointer-events: none;
  z-index: 5;
}

.preset-card.is-drag-before::before {
  left: -7px;
}

.preset-card.is-drag-after::after {
  right: -7px;
}

.preset-card:hover {
  background-color: var(--md-sys-color-surface-container-highest, #323843);
  background-color: color-mix(
    in srgb,
    var(--preset-color, #ffffff) 48%,
    var(--md-sys-color-surface-container-highest, #323843)
  );
}

.preset-card.is-selected,
.preset-card.is-editing {
  border-color: var(--md-sys-color-primary, #8ab4f8);
}

.preset-card.is-pending-deselect {
  border-color: color-mix(
    in srgb,
    var(--md-sys-color-primary, #8ab4f8) 45%,
    transparent
  );
}

.preset-card.is-editing {
  padding: 10px 4px;
}

.preset-card.is-triggered {
  background-color: color-mix(
    in srgb,
    var(--preset-color, #ffffff) 62%,
    white
  ) !important;
  transition: background-color 0.04s ease;
}

/* 左上角 ID 数字 */
.preset-id {
  position: absolute;
  top: 6px;
  left: 6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: 'Google Sans', sans-serif;
  font-size: 11px;
  font-weight: 700;
  color: var(--md-sys-color-primary, #8ab4f8);
  background-color: rgba(138, 180, 248, 0.12);
  border-radius: 4px;
  line-height: 1;
  pointer-events: none;
}

/* 右上角快捷键标记 (原垃圾桶位置) */
.preset-shortcut-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: 'Google Sans', sans-serif;
  font-size: 11px;
  font-weight: 700;
  border-radius: 4px;
  border: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.12));
  background-color: var(--md-sys-color-surface-container, #1f232b);
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  transition: all 0.15s ease;
  z-index: 2;
  opacity: 0;
  line-height: 1;
}

.preset-shortcut-badge.has-shortcut {
  opacity: 0.9;
  background-color: rgba(138, 180, 248, 0.14);
  border-color: rgba(138, 180, 248, 0.35);
  color: var(--md-sys-color-primary, #8ab4f8);
}

.preset-card:hover .preset-shortcut-badge,
.preset-card.is-selected .preset-shortcut-badge {
  opacity: 1;
}

.preset-shortcut-badge:hover {
  opacity: 1;
  background-color: rgba(138, 180, 248, 0.25);
  border-color: var(--md-sys-color-primary, #8ab4f8);
  color: #fff;
}

.preset-shortcut-badge.is-binding {
  opacity: 1;
  background-color: var(--md-sys-color-primary, #8ab4f8);
  color: var(--md-sys-color-on-primary, #042a59);
  border-color: var(--md-sys-color-primary, #8ab4f8);
}

.binding-text {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.shortcut-placeholder {
  font-size: 11px;
  line-height: 1;
  font-weight: 700;
  opacity: 0.8;
}

.shortcut-key {
  line-height: 1;
}

/* 预设名称区域 */
.preset-name-area {
  width: 100%;
  padding: 2px 2px;
  display: flex;
  justify-content: center;
  box-sizing: border-box;
  transform-origin: center;
}

.preset-name-area.is-editing {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 4px 0 6px;
  border-color: var(--md-sys-color-primary, #8ab4f8);
  background-color: var(--md-sys-color-surface-container-highest, #2c323d);
  border: 1px solid var(--md-sys-color-primary, #8ab4f8);
  border-radius: 4px;
  cursor: default;
  gap: 2px;
  width: 100%;
  box-sizing: border-box;
}

.preset-edit-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  min-width: 0;
  transform-origin: center;
}

.preset-name-edit-enter-active,
.preset-name-edit-leave-active {
  transition:
    opacity 120ms cubic-bezier(0.2, 0, 0, 1),
    transform 120ms cubic-bezier(0.2, 0, 0, 1);
}

.preset-name-edit-enter-from,
.preset-name-edit-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

.preset-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface, #e8edf2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: center;
}

.preset-name-input {
  background: transparent;
  border: none;
  outline: none;
  color: var(--md-sys-color-on-surface, #ffffff);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  height: 18px;
  min-width: 0;
  flex: 1;
  padding: 0 2px;
  box-sizing: border-box;
}

.preset-delete-btn {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  min-width: 16px;
  height: 16px;
  padding: 0;
  box-sizing: border-box;
  border: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.12));
  border-radius: 4px;
  background-color: var(--md-sys-color-surface-container, #1f232b);
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease,
    transform 0.12s ease;
}

.preset-card:hover .preset-delete-btn {
  opacity: 1;
  pointer-events: auto;
}

.preset-delete-btn:hover {
  border-color: transparent;
  background-color: rgba(255, 82, 82, 0.2);
  color: var(--md-sys-color-error, #f28b82);
}

.preset-delete-btn:active {
  transform: scale(0.92);
}

.save-preset-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  color: var(--md-sys-color-primary, #8ab4f8);
  cursor: pointer;
  transition: all 0.12s ease;
  flex-shrink: 0;
}

.save-preset-check:hover {
  background-color: rgba(138, 180, 248, 0.25);
  color: #ffffff;
}

.save-preset-check:active {
  transform: scale(0.92);
}

.preset-action-icon {
  width: 13px;
  height: 13px;
}

/* 空状态 */
.presets-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 220px;
  padding: 32px 16px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  text-align: center;
}

.empty-icon {
  width: 44px;
  height: 44px;
  color: var(--md-sys-color-outline, #727b8c);
  margin-bottom: 12px;
  opacity: 0.6;
}

.empty-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface, #e8edf2);
  margin-bottom: 16px;
}

/* 底部状态 */
.presets-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  min-height: 28px;
  padding: 0 12px;
  background-color: var(--md-sys-color-surface-container, #22262e);
  border-top: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08));
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

.presets-footer-summary {
  min-width: 0;
  display: inline-flex;
  align-items: center;
}

.preset-zoom-controls {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.preset-zoom-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background-color: transparent;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  cursor: pointer;
  outline: none;
}

.preset-zoom-btn:hover:not(:disabled) {
  background-color: rgba(255, 255, 255, 0.08);
  color: #ffffff;
}

.preset-zoom-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.preset-zoom-icon {
  width: 14px;
  height: 14px;
}

.preset-zoom-value {
  min-width: 44px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
</style>
