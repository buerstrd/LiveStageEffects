import { computed } from 'vue'
import type { PresetItem, PresetLightEffect, PresetPoint, PresetColorPoint } from '~/composables/presetsmanager'
import { presetsManager } from '~/composables/presetsmanager'
import { outputsettingsManager } from '~/composables/outputsettingsmanager'
import {
  encodeSerialProtocolFrame,
  SERIAL_PROTOCOL_COLOR,
  SERIAL_PROTOCOL_MAX_PAYLOAD_LENGTH,
  SERIAL_PROTOCOL_WIRELESS
} from '~/utils/serialprotocol'

export interface DevicePlayingState {
  presetId: number
  presetName: string
  effect: PresetLightEffect
  startedAt: number
}

// 默认 Gamma 校正系数 (γ = 2.2，贴合人眼对可见光的非线性亮度感知)
export const DEFAULT_GAMMA = 2.2

/**
 * 亮度 Gamma 校正函数
 * 人眼对暗部变化敏锐、对亮部变化迟钝，对亮度输出进行 Gamma 校正以符合人眼视觉特性
 * @param linear 0.0 ~ 1.0 的线性感知亮度输入
 * @param gamma 伽马系数，默认 2.2
 * @returns 0.0 ~ 1.0 经校正后的物理输出亮度
 */
export const applyGamma = (linear: number, gamma: number = DEFAULT_GAMMA): number => {
  const clamped = Math.max(0, Math.min(1, linear))
  return Math.pow(clamped, gamma)
}

/**
 * 8 位单通道 Gamma 校正 (0 ~ 255)
 */
export const applyGamma8 = (val: number, gamma: number = DEFAULT_GAMMA): number => {
  const normalized = Math.max(0, Math.min(255, val)) / 255
  return Math.round(Math.pow(normalized, gamma) * 255)
}

// 颜色曲线插值辅助函数 (Y轴数值表示颜色的程度，依此参数进行渐变并进行 Gamma 校正)
export const sampleCurveColor = (
  colorPoints: PresetColorPoint[] | undefined,
  progress: number,
  fallbackColor: string
): { r: number; g: number; b: number } => {
  if (!colorPoints || colorPoints.length === 0) {
    return hexToRgb(fallbackColor)
  }
  if (colorPoints.length === 1) {
    const cp = colorPoints[0]
    if (!cp) return hexToRgb(fallbackColor)

    const degree = typeof cp.y === 'number' ? Math.max(0, Math.min(1, cp.y)) : 1.0
    const correctedDegree = applyGamma(degree)
    const rgb = hexToRgb(cp.color)
    return {
      r: Math.round(rgb.r * correctedDegree),
      g: Math.round(rgb.g * correctedDegree),
      b: Math.round(rgb.b * correctedDegree)
    }
  }

  const sorted = [...colorPoints].sort((a, b) => a.x - b.x)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (!first || !last) return hexToRgb(fallbackColor)

  if (progress <= first.x) {
    const degree = typeof first.y === 'number' ? Math.max(0, Math.min(1, first.y)) : 1.0
    const correctedDegree = applyGamma(degree)
    const rgb = hexToRgb(first.color)
    return {
      r: Math.round(rgb.r * correctedDegree),
      g: Math.round(rgb.g * correctedDegree),
      b: Math.round(rgb.b * correctedDegree)
    }
  }
  if (progress >= last.x) {
    const degree = typeof last.y === 'number' ? Math.max(0, Math.min(1, last.y)) : 1.0
    const correctedDegree = applyGamma(degree)
    const rgb = hexToRgb(last.color)
    return {
      r: Math.round(rgb.r * correctedDegree),
      g: Math.round(rgb.g * correctedDegree),
      b: Math.round(rgb.b * correctedDegree)
    }
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const cp1 = sorted[i]
    const cp2 = sorted[i + 1]
    if (!cp1 || !cp2) continue

    if (progress >= cp1.x && progress <= cp2.x) {
      const span = cp2.x - cp1.x
      const y1 = typeof cp1.y === 'number' ? cp1.y : 1.0
      const y2 = typeof cp2.y === 'number' ? cp2.y : 1.0
      if (span <= 0.0001) {
        const degree = Math.max(0, Math.min(1, y1))
        const correctedDegree = applyGamma(degree)
        const rgb = hexToRgb(cp1.color)
        return {
          r: Math.round(rgb.r * correctedDegree),
          g: Math.round(rgb.g * correctedDegree),
          b: Math.round(rgb.b * correctedDegree)
        }
      }
      const t = (progress - cp1.x) / span
      const ratio = t
      const rgb1 = hexToRgb(cp1.color)
      const rgb2 = hexToRgb(cp2.color)
      const degree = Math.max(0, Math.min(1, y1 + ratio * (y2 - y1)))
      const correctedDegree = applyGamma(degree)

      const blendedR = rgb1.r + ratio * (rgb2.r - rgb1.r)
      const blendedG = rgb1.g + ratio * (rgb2.g - rgb1.g)
      const blendedB = rgb1.b + ratio * (rgb2.b - rgb1.b)

      return {
        r: Math.round(blendedR * correctedDegree),
        g: Math.round(blendedG * correctedDegree),
        b: Math.round(blendedB * correctedDegree)
      }
    }
  }
  return hexToRgb(fallbackColor)
}

// 曲线亮度插值辅助函数（输出经 Gamma 校正，符合人眼视觉特性）
export const sampleCurveBrightness = (
  points: PresetPoint[],
  progress: number,
  gamma: number = DEFAULT_GAMMA
): number => {
  if (!points || points.length === 0) return 1
  let y = 1
  if (points.length === 1) {
    const point = points[0]
    if (point) {
      y = Math.max(0, Math.min(1, point.y))
    }
  } else {
    const sorted = [...points].sort((a, b) => a.x - b.x)
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    if (!first || !last) return applyGamma(y, gamma)

    if (progress <= first.x) {
      y = Math.max(0, Math.min(1, first.y))
    } else if (progress >= last.x) {
      y = Math.max(0, Math.min(1, last.y))
    } else {
      for (let i = 0; i < sorted.length - 1; i++) {
        const p1 = sorted[i]
        const p2 = sorted[i + 1]
        if (!p1 || !p2) continue

        if (progress >= p1.x && progress <= p2.x) {
          const span = p2.x - p1.x
          if (span <= 0.0001) {
            y = p1.y
          } else {
            const ratio = (progress - p1.x) / span
            y = p1.y + ratio * (p2.y - p1.y)
          }
          break
        }
      }
    }
  }
  return applyGamma(y, gamma)
}

// 十六进制颜色转 RGB
export const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  let clean = (hex || '').replace('#', '').trim()
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('')
  }
  if (clean.length !== 6) return { r: 138, g: 180, b: 248 }
  const num = parseInt(clean, 16)
  if (isNaN(num)) return { r: 138, g: 180, b: 248 }
  return {
    r: (num >> 16) & 0xFF,
    g: (num >> 8) & 0xFF,
    b: num & 0xFF
  }
}

// 模块级单例变量（避免 Web Serial Stream 放入 Vue 响应式代理引发序列化问题）
let serialPortInstance: any = null
let serialWriterInstance: any = null
let streamTimerInstance: any = null
let serialWriteInFlight = false
let lastFrameSentAt = 0
let smoothedFrameIntervalMs = 0
let devicePlaybackPausedAt = 0
// 最近一次手动发送的无线数据：存在时持续发送，出现新的颜色后再切回颜色数据
let streamWirelessPayload: Uint8Array | null = null

export const devicesManager = () => {
  const { activePreset, isPlaying, isPlaybackPaused, playTriggerTime } = presetsManager()

  // Web Serial 硬件连接状态
  const isSerialConnected = useState<boolean>('app_serial_connected', () => false)
  const unexpectedDisconnectToken = useState<number>(
    'device_unexpected_disconnect_token',
    () => 0
  )
  const serialPortInfo = useState<string>('app_serial_port_info', () => '')

  // 射频流式发射状态与统计指标
  const isRfStreaming = useState<boolean>('rf_is_streaming', () => false)
  const rfTxFrameCount = useState<number>('rf_tx_frame_count', () => 0)
  const rfTxFps = useState<number>('rf_tx_fps', () => 0)
  const currentStreamRGB = useState<{ r: number; g: number; b: number; hex: string }>('rf_current_rgb', () => ({
    r: 0,
    g: 0,
    b: 0,
    hex: '#000000'
  }))
  // 当前持续发送的无线数据（为空表示当前发送的是颜色数据）
  const currentWirelessData = useState<string>('serial_current_wireless_data', () => '')

  // 设备当前接收并播放的灯效信息
  const devicePlayingEffect = useState<DevicePlayingState | null>('device_playing_effect', () => null)
  // 设备端播放激活状态
  const isDevicePlaying = useState<boolean>('device_is_playing', () => false)

  const getFrameTimestamp = () => {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  const recordFrameSent = () => {
    rfTxFrameCount.value++

    const now = getFrameTimestamp()
    if (lastFrameSentAt > 0) {
      const intervalMs = now - lastFrameSentAt
      if (intervalMs > 0 && intervalMs <= 2000) {
        smoothedFrameIntervalMs = smoothedFrameIntervalMs === 0
          ? intervalMs
          : smoothedFrameIntervalMs * 0.9 + intervalMs * 0.1
        rfTxFps.value = Number((1000 / smoothedFrameIntervalMs).toFixed(1))
      }
    }
    lastFrameSentAt = now
  }

  const writeSerialPacket = async (packet: Uint8Array): Promise<boolean> => {
    const writer = serialWriterInstance
    if (!writer || serialWriteInFlight) return false

    serialWriteInFlight = true
    try {
      await writer.write(packet)
      recordFrameSent()
      return true
    } catch (err) {
      console.error('[WebSerial] Write error:', err)
      return false
    } finally {
      serialWriteInFlight = false
    }
  }

  // 是否有设备处于连接状态（仅统计物理串口连接）
  const hasConnectedDevice = computed(() => isSerialConnected.value)

  // 已连接设备计数
  const connectedCount = computed(() => (hasConnectedDevice.value ? 1 : 0))

  // 记录最后输出的色彩（没有颜色时，默认颜色为黑色）
  const lastActiveColor = useState<{ r: number; g: number; b: number; hex: string }>('rf_last_active_color', () => ({
    r: 0,
    g: 0,
    b: 0,
    hex: '#000000'
  }))

  // 生成自定义协议数据帧并写入串口
  const sendCurrentFrameToSerial = async (): Promise<boolean> => {
    if (!serialWriterInstance) return false
    const {
      globalBrightness,
      compatibilityMode,
      colorCalibration,
      wirelessDelayCompensation
    } = outputsettingsManager()

    // 最近一次手动发送的是无线数据时持续发送，直至出现新的颜色
    if (streamWirelessPayload) {
      const packet = encodeSerialProtocolFrame(SERIAL_PROTOCOL_WIRELESS, streamWirelessPayload)
      return writeSerialPacket(packet)
    }

    let r = lastActiveColor.value.r
    let g = lastActiveColor.value.g
    let b = lastActiveColor.value.b

    // 优先采用活跃播放中的效果参数
    const targetEffect = !isPlaybackPaused.value
      ? isDevicePlaying.value && devicePlayingEffect.value?.effect
        ? devicePlayingEffect.value.effect
        : isPlaying.value && activePreset.value?.effect
          ? activePreset.value.effect
          : null
      : null

    if (targetEffect) {
      const duration = Math.max(50, targetEffect.duration ?? 500)
      const repeat = typeof targetEffect.repeat === 'number' ? targetEffect.repeat : 1
      const isInfinite = repeat === 0
      const totalDuration = duration * (isInfinite ? 1 : repeat)

      const now = Date.now()
      const startTime = isDevicePlaying.value && devicePlayingEffect.value?.startedAt
        ? devicePlayingEffect.value.startedAt
        : (playTriggerTime.value || now)

      const totalElapsed = now - startTime + wirelessDelayCompensation.value

      if (!isInfinite && totalElapsed >= totalDuration) {
        // 重复次数已满：最后必须严格采样曲线终点帧 (progress = 1.0)，确保终点颜色与亮度完全呈现，严禁吞色
        const brightness = sampleCurveBrightness(targetEffect.points, 1.0)
        const currentRgb = sampleCurveColor(targetEffect.colorPoints, 1.0, targetEffect.color)

        r = Math.round(currentRgb.r * brightness)
        g = Math.round(currentRgb.g * brightness)
        b = Math.round(currentRgb.b * brightness)

        const hexR = r.toString(16).padStart(2, '0')
        const hexG = g.toString(16).padStart(2, '0')
        const hexB = b.toString(16).padStart(2, '0')
        lastActiveColor.value = {
          r,
          g,
          b,
          hex: `#${hexR}${hexG}${hexB}`
        }

        // 停止动态播放状态
        if (isDevicePlaying.value) {
          isDevicePlaying.value = false
        }
        if (isPlaying.value) {
          isPlaying.value = false
        }
      } else {
        // 在有效单次或多次周期内，按波形曲线采样发光
        const cycleElapsed = totalElapsed % duration
        const progress = Math.max(0, Math.min(1, cycleElapsed / duration))
        const brightness = sampleCurveBrightness(targetEffect.points, progress)
        const currentRgb = sampleCurveColor(targetEffect.colorPoints, progress, targetEffect.color)

        r = Math.round(currentRgb.r * brightness)
        g = Math.round(currentRgb.g * brightness)
        b = Math.round(currentRgb.b * brightness)

        const hexR = r.toString(16).padStart(2, '0')
        const hexG = g.toString(16).padStart(2, '0')
        const hexB = b.toString(16).padStart(2, '0')
        lastActiveColor.value = {
          r,
          g,
          b,
          hex: `#${hexR}${hexG}${hexB}`
        }
      }
    } else {
      // 未播放动态灯效时：保持最后一个颜色（没有颜色时默认颜色为黑色）
      r = lastActiveColor.value.r
      g = lastActiveColor.value.g
      b = lastActiveColor.value.b
    }

    // 全局主调光倍率 (0.0 ~ 1.0)，经 Gamma 校正符合人眼视觉特性
    const calibration = colorCalibration.value
    r = Math.max(0, Math.min(255, Math.round(r * Math.max(0, Math.min(200, calibration.r)) / 100)))
    g = Math.max(0, Math.min(255, Math.round(g * Math.max(0, Math.min(200, calibration.g)) / 100)))
    b = Math.max(0, Math.min(255, Math.round(b * Math.max(0, Math.min(200, calibration.b)) / 100)))

    const rawDimmer = Math.max(0, Math.min(100, typeof globalBrightness.value === 'number' ? globalBrightness.value : 100)) / 100
    const masterDimmer = applyGamma(rawDimmer)

    let outR = Math.max(0, Math.min(255, Math.round(r * masterDimmer)))
    let outG = Math.max(0, Math.min(255, Math.round(g * masterDimmer)))
    let outB = Math.max(0, Math.min(255, Math.round(b * masterDimmer)))

    if (compatibilityMode.value) {
      if (outR === 1) outR = 2
      if (outG === 1) outG = 2
      if (outB === 1) outB = 2
    }

    const payload = new Uint8Array([outR, outG, outB])
    const packet = encodeSerialProtocolFrame(SERIAL_PROTOCOL_COLOR, payload)

    const didWrite = await writeSerialPacket(packet)
    if (!didWrite) return false

    const hexR = outR.toString(16).padStart(2, '0')
    const hexG = outG.toString(16).padStart(2, '0')
    const hexB = outB.toString(16).padStart(2, '0')
    currentStreamRGB.value = {
      r: outR,
      g: outG,
      b: outB,
      hex: `#${hexR}${hexG}${hexB}`
    }
    return true
  }

  // 启动高频持续流式发射定时器 (~46.5 ms 周期，约 21.5 FPS)
  const startStreaming = () => {
    if (streamTimerInstance) return
    isRfStreaming.value = true
    lastFrameSentAt = 0
    smoothedFrameIntervalMs = 0
    rfTxFps.value = 0

    // 每 46.5 ms 产生并发射一帧
    streamTimerInstance = setInterval(() => {
      void sendCurrentFrameToSerial()
    }, 46)
  }

  // 停止流式发射
  const stopStreaming = () => {
    if (streamTimerInstance) {
      clearInterval(streamTimerInstance)
      streamTimerInstance = null
    }
    isRfStreaming.value = false
    lastFrameSentAt = 0
    smoothedFrameIntervalMs = 0
    rfTxFps.value = 0
  }

  // 连接 Web Serial 串口设备
  const connectSerial = async (): Promise<boolean> => {
    try {
      const navSerial = (navigator as any).serial
      const port = await navSerial.requestPort()
      await port.open({ baudRate: 115200 })

      serialPortInstance = port
      serialWriterInstance = port.writable.getWriter()
      serialWriteInFlight = false

      const info = port.getInfo ? port.getInfo() : {}
      const usbVendor = info.usbVendorId ? `VID:0x${info.usbVendorId.toString(16)}` : ''
      const usbProduct = info.usbProductId ? `PID:0x${info.usbProductId.toString(16)}` : ''
      serialPortInfo.value = [usbVendor, usbProduct].filter(Boolean).join(' ') || 'USB 串口设备 (115200 bps)'

      isSerialConnected.value = true

      // 监听硬件拔出事件
      port.addEventListener?.('disconnect', () => {
        disconnectSerial({ unexpected: true })
      })

      // 连接成功后立即启动持续流式发射
      startStreaming()

      return true
    } catch (err: any) {
      // 用户取消选择或连接失败时静默处理，不向界面提示
      console.warn('[WebSerial] Connection cancelled or failed:', err)
      return false
    }
  }

  // 断开 Web Serial 串口连接
  const disconnectSerial = async (
    options: { unexpected?: boolean } = {}
  ) => {
    const wasConnected = isSerialConnected.value
    stopStreaming()

    // 连接结束后不再保留指令数据，下次连接从颜色数据开始
    streamWirelessPayload = null
    currentWirelessData.value = ''

    if (serialWriterInstance) {
      try {
        await serialWriterInstance.close()
      } catch {}
      try {
        serialWriterInstance.releaseLock()
      } catch {}
      serialWriterInstance = null
    }

    if (serialPortInstance) {
      try {
        await serialPortInstance.close()
      } catch {}
      serialPortInstance = null
    }
    serialWriteInFlight = false

    isSerialConnected.value = false
    serialPortInfo.value = ''
    isDevicePlaying.value = false

    if (options.unexpected && wasConnected) {
      unexpectedDisconnectToken.value += 1
    }
  }

  // 同步发送预设效果至设备（若设备已连接则下发硬件；不自动连接设备，连接只能在设备管理器中手动操作）
  const sendPresetToDevice = (preset: PresetItem | null) => {
    if (!preset) return false

    // 出现新的颜色：结束指令持续发送，切回颜色数据
    streamWirelessPayload = null
    currentWirelessData.value = ''
    devicePlaybackPausedAt = 0

    const effectData: PresetLightEffect = preset.effect
      ? JSON.parse(JSON.stringify(preset.effect))
      : {
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
        }

    devicePlayingEffect.value = {
      presetId: preset.id,
      presetName: preset.name,
      effect: effectData,
      startedAt: Date.now()
    }

    // 仅在设备已被用户手动连接时激活硬件播放
    if (hasConnectedDevice.value) {
      isDevicePlaying.value = true

      // 重启并重置流式发射定时器相位，确保以严格 46ms 间隔自 0ms 均匀下发，杜绝与原有背景定时器相位错位导致的丢帧
      if (isSerialConnected.value) {
        if (streamTimerInstance) {
          clearInterval(streamTimerInstance)
          streamTimerInstance = null
        }
        void sendCurrentFrameToSerial()
        streamTimerInstance = setInterval(() => {
          void sendCurrentFrameToSerial()
        }, 46)
      }
    } else {
      isDevicePlaying.value = false
    }

    return true
  }

  const stopDevicePlayback = () => {
    isDevicePlaying.value = false
    devicePlaybackPausedAt = 0
  }

  const pauseDevicePlayback = () => {
    if (devicePlaybackPausedAt > 0) return
    devicePlaybackPausedAt = Date.now()
  }

  const resumeDevicePlayback = () => {
    if (devicePlaybackPausedAt <= 0) return

    const pausedDuration = Date.now() - devicePlaybackPausedAt
    if (devicePlayingEffect.value) {
      devicePlayingEffect.value = {
        ...devicePlayingEffect.value,
        startedAt: devicePlayingEffect.value.startedAt + pausedDuration
      }
    }
    if (playTriggerTime.value > 0) {
      playTriggerTime.value += pausedDuration
    }
    devicePlaybackPausedAt = 0
  }

  const seekDevicePlayback = (elapsedMs: number) => {
    const now = Date.now()
    const elapsed = Math.max(0, elapsedMs)

    if (devicePlayingEffect.value) {
      devicePlayingEffect.value = {
        ...devicePlayingEffect.value,
        startedAt: now - elapsed
      }
    }
    playTriggerTime.value = now - elapsed
    if (devicePlaybackPausedAt > 0) {
      devicePlaybackPausedAt = now
    }
  }

  // 发送 1 到 32 字节无线数据；Client 计算并追加最后一位 CRC
  const sendWirelessData = async (data: Uint8Array): Promise<boolean> => {
    if (!serialWriterInstance) return false
    if (data.length < 1 || data.length > SERIAL_PROTOCOL_MAX_PAYLOAD_LENGTH) return false

    streamWirelessPayload = new Uint8Array(data)
    currentWirelessData.value = Array.from(streamWirelessPayload)
      .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
      .join(' ')

    // 高频流式发送正在进行时，命令已切换为当前持续数据，下一帧会自动发出。
    if (serialWriteInFlight) return true

    try {
      const packet = encodeSerialProtocolFrame(SERIAL_PROTOCOL_WIRELESS, streamWirelessPayload)
      return writeSerialPacket(packet)
    } catch (err) {
      console.error('[WebSerial] Wireless write error:', err)
      return false
    }
  }

  return {
    isSerialConnected,
    unexpectedDisconnectToken,
    serialPortInfo,
    isRfStreaming,
    rfTxFrameCount,
    rfTxFps,
    currentStreamRGB,
    currentWirelessData,
    lastActiveColor,
    devicePlayingEffect,
    isDevicePlaying,
    hasConnectedDevice,
    connectedCount,
    connectSerial,
    disconnectSerial,
    sendPresetToDevice,
    stopDevicePlayback,
    pauseDevicePlayback,
    resumeDevicePlayback,
    seekDevicePlayback,
    startStreaming,
    stopStreaming,
    sendWirelessData
  }
}

export const useDevices = devicesManager
