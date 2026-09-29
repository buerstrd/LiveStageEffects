export const presetsManager = () => {
  const selectedPresetId = useState<number | null>('app_selected_preset_id', () => null)
  const editingPresetId = useState<number | null>('presets_editing_id', () => null)
  const presetDragPointerOffsetX = useState<number | null>(
    'preset_drag_pointer_offset_x',
    () => null
  )

  // 播放状态与播放进度
  const isPlaying = useState<boolean>('design_is_playing', () => false)
  const isPlaybackPaused = useState<boolean>('design_playback_paused', () => false)
  const playProgress = useState<number>('design_play_progress', () => 0) // 0.0 ~ 1.0
  const playTriggerTime = useState<number>('design_play_trigger_time', () => 0)
  const playSeekProgress = useState<number>('design_play_seek_progress', () => 0)
  const playSeekVersion = useState<number>('design_play_seek_version', () => 0)

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
    selectedPresetId,
    editingPresetId,
    presetDragPointerOffsetX,
    isPlaying,
    isPlaybackPaused,
    playProgress,
    playTriggerTime,
    playSeekProgress,
    playSeekVersion,
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
