export interface RgbColorCalibration {
  r: number
  g: number
  b: number
}

export const createDefaultColorCalibration = (): RgbColorCalibration => ({
  r: 100,
  g: 100,
  b: 100
})

export const outputsettingsManager = () => {
  // 全局亮度：0 ~ 100，默认 100
  const globalBrightness = useState<number>('output_global_brightness', () => 100)

  // 设置全局亮度
  const setGlobalBrightness = (val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)))
    globalBrightness.value = clamped
  }

  // 重置为默认值 100
  const resetGlobalBrightness = () => {
    globalBrightness.value = 100
  }

  // RGB 颜色校准：各通道默认 100%，范围 0 ~ 200%
  const colorCalibration = useState<RgbColorCalibration>('output_color_calibration', createDefaultColorCalibration)

  const setColorCalibration = (channel: keyof RgbColorCalibration, val: number) => {
    const clamped = Math.max(0, Math.min(200, Math.round(val)))
    colorCalibration.value = {
      ...colorCalibration.value,
      [channel]: clamped
    }
  }

  const resetColorCalibration = () => {
    colorCalibration.value = createDefaultColorCalibration()
  }

  // 无线延迟补偿：正值提前输出，负值延后输出，范围 -500 ~ 500 ms
  const wirelessDelayCompensation = useState<number>('output_wireless_delay_compensation', () => 0)

  const setWirelessDelayCompensation = (val: number) => {
    wirelessDelayCompensation.value = Math.max(-500, Math.min(500, Math.round(val)))
  }

  const resetWirelessDelayCompensation = () => {
    wirelessDelayCompensation.value = 0
  }

  // 兼容模式：输出前将 RGB 中等于 1 的通道替换为 2
  const compatibilityMode = useState<boolean>('output_compatibility_mode', () => false)

  const toggleCompatibilityMode = () => {
    compatibilityMode.value = !compatibilityMode.value
  }

  const setCompatibilityMode = (val: boolean) => {
    compatibilityMode.value = val
  }

  return {
    globalBrightness,
    setGlobalBrightness,
    resetGlobalBrightness,
    colorCalibration,
    setColorCalibration,
    resetColorCalibration,
    wirelessDelayCompensation,
    setWirelessDelayCompensation,
    resetWirelessDelayCompensation,
    compatibilityMode,
    toggleCompatibilityMode,
    setCompatibilityMode
  }
}

export const useOutputSettings = outputsettingsManager
