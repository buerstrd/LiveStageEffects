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
    () => false
  )

  const toggleStatusBarBeatIndicator = () => {
    statusBarBeatIndicator.value = !statusBarBeatIndicator.value
  }

  const setStatusBarBeatIndicator = (val: boolean) => {
    statusBarBeatIndicator.value = val
  }

  // 是否在程序启动时清理浏览器缓存
  const clearBrowserCacheOnStartup = useCookie<boolean>(
    'lse_clear_browser_cache_on_startup',
    {
      default: () => true,
      sameSite: 'lax',
      path: '/'
    }
  )

  const toggleClearBrowserCacheOnStartup = () => {
    clearBrowserCacheOnStartup.value = !clearBrowserCacheOnStartup.value
  }

  const setClearBrowserCacheOnStartup = (val: boolean) => {
    clearBrowserCacheOnStartup.value = val
  }

  return {
    showSeconds,
    toggleShowSeconds,
    setShowSeconds,
    statusBarBeatIndicator,
    toggleStatusBarBeatIndicator,
    setStatusBarBeatIndicator,
    clearBrowserCacheOnStartup,
    toggleClearBrowserCacheOnStartup,
    setClearBrowserCacheOnStartup
  }
}

export const useSettings = settingsManager
