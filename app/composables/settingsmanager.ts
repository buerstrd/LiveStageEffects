import { ref } from 'vue'

export const settingsManager = () => {
  // 是否在状态栏时间中显示秒数
  const showSeconds = useState<boolean>('settings_time_show_seconds', () => false)

  // 切换显示秒数
  const toggleShowSeconds = () => {
    showSeconds.value = !showSeconds.value
  }

  // 显式设置显示秒数
  const setShowSeconds = (val: boolean) => {
    showSeconds.value = val
  }

  // 是否使用整条状态栏显示 BPM 节拍提示
  const statusBarBeatIndicator = useState<boolean>(
    'settings_status_bar_beat_indicator',
    () => true
  )

  const toggleStatusBarBeatIndicator = () => {
    statusBarBeatIndicator.value = !statusBarBeatIndicator.value
  }

  const setStatusBarBeatIndicator = (val: boolean) => {
    statusBarBeatIndicator.value = val
  }

  // 是否关闭所有界面动画效果
  const disableAnimations = useState<boolean>('settings_disable_animations', () => false)

  const toggleDisableAnimations = () => {
    disableAnimations.value = !disableAnimations.value
  }

  const setDisableAnimations = (val: boolean) => {
    disableAnimations.value = val
  }

  return {
    showSeconds,
    toggleShowSeconds,
    setShowSeconds,
    statusBarBeatIndicator,
    toggleStatusBarBeatIndicator,
    setStatusBarBeatIndicator,
    disableAnimations,
    toggleDisableAnimations,
    setDisableAnimations
  }
}

export const useSettings = settingsManager
