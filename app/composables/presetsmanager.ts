import { computed } from 'vue'
import { projectManager } from '~/composables/projectmanager'

export interface PresetPoint {
  x: number
  y: number
}

export interface PresetColorPoint {
  x: number
  y: number
  color: string
}

export interface PresetLightEffect {
  color: string // 主颜色 (十六进制如 #8ab4f8)
  colorPoints?: PresetColorPoint[] // 颜色曲线关键采样点 (x: 0~1, y: 0~1, color: hex)
  repeat: number // 重复次数 (>= 1)
  duration: number // 单次时长 (ms, 默认 500)
  points: PresetPoint[] // 亮度曲线关键采样点 (x: 0~1, y: 0~1 亮度)
}

export interface PresetItem {
  id: number
  name: string
  shortcut?: string // 键盘快捷键 (如 '1', 'Q', 'Space' 等)
  effect?: PresetLightEffect
}

export const createDefaultEffect = (): PresetLightEffect => ({
  color: '#ffffff',
  colorPoints: [
    { x: 0, y: 1.0, color: '#ffffff' },
    { x: 1, y: 1.0, color: '#ffffff' }
  ],
  repeat: 1,
  duration: 500,
  points: [
    { x: 0, y: 0.5 },
    { x: 1, y: 0.5 }
  ]
})

const normalizePresetShortcut = (shortcut?: string | null): string => {
  return typeof shortcut === 'string' ? shortcut.trim() : ''
}

export const presetsManager = () => {
  const { currentProject } = projectManager()
  const presets = useState<PresetItem[]>('app_presets_list', () => [])
  const selectedPresetId = useState<number | null>('app_selected_preset_id', () => null)
  const isPresetDeleteMode = useState<boolean>('presets_delete_mode', () => false)

  const togglePresetDeleteMode = () => {
    isPresetDeleteMode.value = !isPresetDeleteMode.value
  }

  const setPresetDeleteMode = (val: boolean) => {
    isPresetDeleteMode.value = val
  }

  // 播放状态与播放进度
  const isPlaying = useState<boolean>('design_is_playing', () => false)
  const isPlaybackPaused = useState<boolean>('design_playback_paused', () => false)
  const playProgress = useState<number>('design_play_progress', () => 0) // 0.0 ~ 1.0
  const playTriggerTime = useState<number>('design_play_trigger_time', () => 0)
  const playSeekProgress = useState<number>('design_play_seek_progress', () => 0)
  const playSeekVersion = useState<number>('design_play_seek_version', () => 0)

  const ensureUniquePresetShortcuts = () => {
    const usedShortcuts = new Set<string>()
    presets.value.forEach((preset) => {
      const normalized = normalizePresetShortcut(preset.shortcut)
      const identity = normalized.toUpperCase()
      if (!normalized || usedShortcuts.has(identity)) {
        preset.shortcut = ''
        return
      }
      usedShortcuts.add(identity)
      preset.shortcut = normalized
    })
  }

  // 当前选中的预设对象
  const activePreset = computed(() => {
    if (selectedPresetId.value === null) return null
    return presets.value.find(p => p.id === selectedPresetId.value) || null
  })

  // 若已载入工程且本地为空，优先同步工程内预设
  if (
    currentProject.value?.data?.presets &&
    Array.isArray(currentProject.value.data.presets) &&
    presets.value.length === 0 &&
    currentProject.value.data.presets.length > 0
  ) {
    presets.value = currentProject.value.data.presets.map((p: any, idx: number) => {
      const effect = p.effect ? { ...p.effect } : createDefaultEffect()
      const firstColorPoint = effect.colorPoints?.[0]
      const secondColorPoint = effect.colorPoints?.[1]
      if (
        effect.colorPoints &&
        effect.colorPoints.length === 2 &&
        firstColorPoint &&
        secondColorPoint &&
        (firstColorPoint.y === 0.2 || firstColorPoint.y === 0.5) &&
        (secondColorPoint.y === 0.8 || secondColorPoint.y === 0.5)
      ) {
        effect.colorPoints = [
          { x: 0, y: 1.0, color: effect.color || '#ffffff' },
          { x: 1, y: 1.0, color: effect.color || '#ffffff' }
        ]
      }
      if (effect.color?.toLowerCase() === '#8ab4f8') {
        effect.color = '#ffffff'
        if (effect.colorPoints) {
          effect.colorPoints.forEach((cp: PresetColorPoint) => {
            if (cp.color?.toLowerCase() === '#8ab4f8') cp.color = '#ffffff'
          })
        }
      }
      return {
        id: typeof p.id === 'number' ? p.id : idx + 1,
        name: p.name || `预设 ${idx + 1}`,
        shortcut: p.shortcut || '',
        effect
      }
    })
  }

  // 对现有状态中的历史默认值平滑升级为 100% 纯白平直直线
  presets.value.forEach(p => {
    if (p.effect?.colorPoints && p.effect.colorPoints.length === 2) {
      const firstColorPoint = p.effect.colorPoints[0]
      const secondColorPoint = p.effect.colorPoints[1]
      if (
        firstColorPoint &&
        secondColorPoint &&
        (firstColorPoint.y === 0.2 || firstColorPoint.y === 0.5) &&
        (secondColorPoint.y === 0.8 || secondColorPoint.y === 0.5)
      ) {
        p.effect.colorPoints = [
          { x: 0, y: 1.0, color: p.effect.color || '#ffffff' },
          { x: 1, y: 1.0, color: p.effect.color || '#ffffff' }
        ]
      }
    }
    if (p.effect?.color?.toLowerCase() === '#8ab4f8') {
      p.effect.color = '#ffffff'
      if (p.effect.colorPoints) {
        p.effect.colorPoints.forEach((cp: PresetColorPoint) => {
          if (cp.color?.toLowerCase() === '#8ab4f8') cp.color = '#ffffff'
        })
      }
    }
  })
  ensureUniquePresetShortcuts()

  const syncToProject = () => {
    ensureUniquePresetShortcuts()
    if (currentProject.value?.data) {
      currentProject.value.data.presets = presets.value.map(p => ({
        ...p,
        shortcut: p.shortcut || '',
        effect: p.effect ? {
          ...p.effect,
          colorPoints: p.effect.colorPoints
            ? p.effect.colorPoints.map((cp: PresetColorPoint) => ({
                x: cp.x,
                y: typeof cp.y === 'number' ? cp.y : 0.5,
                color: cp.color
              }))
            : undefined,
          points: p.effect.points.map(pt => ({ ...pt }))
        } : createDefaultEffect()
      }))
    }
  }

  const addPreset = (name?: string): PresetItem => {
    const nextId = presets.value.length > 0
      ? Math.max(...presets.value.map(p => p.id)) + 1
      : 1
    const newPreset: PresetItem = {
      id: nextId,
      name: name?.trim() || `预设 ${nextId}`,
      effect: createDefaultEffect()
    }
    presets.value.push(newPreset)
    selectedPresetId.value = nextId
    syncToProject()
    return newPreset
  }

  const removePreset = (id: number) => {
    const index = presets.value.findIndex(p => p.id === id)
    if (index !== -1) {
      presets.value.splice(index, 1)
      if (selectedPresetId.value === id) {
        selectedPresetId.value = presets.value[index]?.id ?? presets.value[index - 1]?.id ?? null
      }
      syncToProject()
    }
    if (presets.value.length === 0) {
      isPresetDeleteMode.value = false
    }
  }

  const updatePresetName = (id: number, name: string) => {
    const preset = presets.value.find(p => p.id === id)
    if (preset) {
      preset.name = name.trim() || `预设 ${id}`
      syncToProject()
    }
  }

  const updatePresetEffect = (id: number, partialEffect: Partial<PresetLightEffect>) => {
    const preset = presets.value.find(p => p.id === id)
    if (preset) {
      if (!preset.effect) {
        preset.effect = createDefaultEffect()
      }
      Object.assign(preset.effect, partialEffect)
      syncToProject()
    }
  }

  const updatePresetShortcut = (id: number, shortcut: string) => {
    const normalized = normalizePresetShortcut(shortcut)
    // 若其他预设已绑定该快捷键，自动清除以防按键冲突
    if (normalized) {
      presets.value.forEach(p => {
        if (
          p.id !== id &&
          normalizePresetShortcut(p.shortcut).toUpperCase() === normalized.toUpperCase()
        ) {
          p.shortcut = ''
        }
      })
    }
    const preset = presets.value.find(p => p.id === id)
    if (preset) {
      preset.shortcut = normalized
      syncToProject()
    }
  }

  const movePreset = (
    draggedId: number,
    targetId: number,
    position: 'before' | 'after'
  ) => {
    if (draggedId === targetId) return

    const fromIndex = presets.value.findIndex(preset => preset.id === draggedId)
    if (fromIndex === -1) return

    const [movedPreset] = presets.value.splice(fromIndex, 1)
    if (!movedPreset) return

    const targetIndex = presets.value.findIndex(preset => preset.id === targetId)
    if (targetIndex === -1) {
      presets.value.splice(fromIndex, 0, movedPreset)
      return
    }

    const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
    presets.value.splice(insertIndex, 0, movedPreset)
    syncToProject()
  }

  const selectPreset = (id: number | null) => {
    selectedPresetId.value = id
    // 切换预设时停止当前播放（保留 playProgress 由设计窗口平滑执行渐变消退动画，不直接闪断）
    isPlaying.value = false
    isPlaybackPaused.value = false
  }

  const togglePlay = () => {
    isPlaying.value = !isPlaying.value
    isPlaybackPaused.value = false
  }

  const setPlaying = (val: boolean) => {
    isPlaying.value = val
    if (!val) {
      isPlaybackPaused.value = false
    }
  }

  const setPlayProgress = (progress: number) => {
    playProgress.value = progress
  }

  const triggerPlaySync = () => {
    playTriggerTime.value = Date.now()
    isPlaybackPaused.value = false
    isPlaying.value = true
  }

  const pausePlaySync = () => {
    if (isPlaying.value) {
      isPlaybackPaused.value = true
    }
  }

  const resumePlaySync = () => {
    isPlaybackPaused.value = false
  }

  const seekPlaySync = (progress: number) => {
    playSeekProgress.value = Math.max(0, Math.min(1, progress))
    playSeekVersion.value++
  }

  return {
    presets,
    selectedPresetId,
    activePreset,
    isPlaying,
    isPlaybackPaused,
    playProgress,
    playTriggerTime,
    playSeekProgress,
    playSeekVersion,
    isPresetDeleteMode,
    togglePresetDeleteMode,
    setPresetDeleteMode,
    addPreset,
    removePreset,
    updatePresetName,
    updatePresetEffect,
    updatePresetShortcut,
    movePreset,
    selectPreset,
    togglePlay,
    setPlaying,
    setPlayProgress,
    triggerPlaySync,
    pausePlaySync,
    resumePlaySync,
    seekPlaySync
  }
}

export const usePresets = presetsManager
