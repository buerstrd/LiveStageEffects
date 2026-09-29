import { computed } from 'vue'
import { outputsettingsManager } from '~/composables/outputsettingsmanager'
import {
  normalizePresetEffect,
  type PresetItem,
  type PresetLightEffect,
  type PresetPoint
} from '~/utils/presetcurve'
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
  playbackDurationMs: number
  source: DevicePlaybackSource
}

export type DevicePlaybackSource = 'timeline' | 'preview'

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

export interface SampledEffect {
  color: { r: number; g: number; b: number }
  brightness: number
}

// 统一曲线采样：X 为时间，Y 为亮度，节点颜色为当前时刻颜色
export const sampleEffectAtProgress = (
  points: PresetPoint[],
  progress: number,
  fallbackColor: string
): SampledEffect => {
  const fallbackRgb = hexToRgb(fallbackColor)
  if (points.length === 0) {
    return { color: fallbackRgb, brightness: 1 }
  }

  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) {
    return { color: fallbackRgb, brightness: 1 }
  }

  const x = Math.max(0, Math.min(1, progress))
  let left = first
  let right = first
  let ratio = 0

  if (x >= last.x) {
    left = last
    right = last
  } else if (x > first.x) {
    for (let index = 0; index < points.length - 1; index++) {
      const current = points[index]
      const next = points[index + 1]
      if (!current || !next || x < current.x || x > next.x) continue
      left = current
      right = next
      const span = next.x - current.x
      ratio = span > 0.0001 ? (x - current.x) / span : 0
      break
    }
  }

  const y = left.y + (right.y - left.y) * ratio
  const rgb1 = hexToRgb(left.color)
  const rgb2 = hexToRgb(right.color)

  return {
    color: {
      r: Math.round(rgb1.r + (rgb2.r - rgb1.r) * ratio),
      g: Math.round(rgb1.g + (rgb2.g - rgb1.g) * ratio),
      b: Math.round(rgb1.b + (rgb2.b - rgb1.b) * ratio)
    },
    brightness: applyGamma(y)
  }
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
let streamSchedulerActive = false
let streamNextFrameAt = 0
let serialWriteInFlight = false
let lastFrameSentAt = 0
let smoothedFrameIntervalMs = 0
let devicePlaybackPausedAt = 0
let timelinePlaybackElapsedMs = 0
let timelinePlaybackActive = false
// 最近一次手动发送的无线数据：存在时持续发送，出现新的颜色后再切回颜色数据
let streamWirelessPayload: Uint8Array | null = null

export const devicesManager = () => {
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
  const devicePlaybackSource = useState<DevicePlaybackSource | null>(
    'device_playback_source',
    () => null
  )

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

    // 统一采样设备播放状态，时间线与预设预览均通过该状态下发。
    const playbackState = devicePlayingEffect.value
    const targetEffect = isDevicePlaying.value
      ? playbackState?.effect
      : null

    if (targetEffect && playbackState) {
      const source = playbackState.source
      const effectDuration = Math.max(50, targetEffect.duration ?? 500)
      const playbackDuration = playbackState.playbackDurationMs
      const timelineDuration = source === 'timeline' && Number.isFinite(playbackDuration)
        ? Math.max(50, Math.round(Number(playbackDuration)))
        : null
      const duration = timelineDuration ?? effectDuration
      const repeat = timelineDuration !== null
        ? 1
        : (typeof targetEffect.repeat === 'number' ? targetEffect.repeat : 1)
      const isInfinite = repeat === 0
      const totalDuration = timelineDuration
        ?? playbackDuration
        ?? duration * (isInfinite ? 1 : repeat)

      const now = devicePlaybackPausedAt > 0
        ? devicePlaybackPausedAt
        : getFrameTimestamp()
      const startTime = Number.isFinite(playbackState.startedAt)
        ? playbackState.startedAt
        : now

      // 时间线进度由事件同步器显式提供，避免独立时钟漂移造成颜色跳变。
      const playbackElapsed = source === 'timeline' && timelinePlaybackActive
        ? timelinePlaybackElapsedMs
        : Math.max(0, now - startTime)
      const compensatedElapsed = playbackElapsed + wirelessDelayCompensation.value
      const playbackFinished = !isInfinite && playbackElapsed >= totalDuration
      const cycleElapsed = ((compensatedElapsed % duration) + duration) % duration
      const progress = playbackFinished
        ? 1
        : Math.max(0, Math.min(1, cycleElapsed / duration))
      const sampled = sampleEffectAtProgress(
        targetEffect.points,
        progress,
        targetEffect.color
      )

      r = Math.round(sampled.color.r * sampled.brightness)
      g = Math.round(sampled.color.g * sampled.brightness)
      b = Math.round(sampled.color.b * sampled.brightness)

      const hexR = r.toString(16).padStart(2, '0')
      const hexG = g.toString(16).padStart(2, '0')
      const hexB = b.toString(16).padStart(2, '0')
      lastActiveColor.value = {
        r,
        g,
        b,
        hex: `#${hexR}${hexG}${hexB}`
      }

      if (playbackFinished) {
        isDevicePlaying.value = false
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

  const runHighPriorityTask = (task: () => void) => {
    const scheduler = (globalThis as any).scheduler
    if (scheduler && typeof scheduler.postTask === 'function') {
      try {
        void scheduler.postTask(task, { priority: 'user-blocking' })
        return
      } catch {}
    }
    setTimeout(task, 0)
  }

  const scheduleStreamFrame = () => {
    if (!streamSchedulerActive) return

    const delay = Math.max(0, streamNextFrameAt - getFrameTimestamp())
    streamTimerInstance = setTimeout(() => {
      streamTimerInstance = null
      if (!streamSchedulerActive) return

      const now = getFrameTimestamp()
      streamNextFrameAt += 46
      if (streamNextFrameAt <= now) {
        streamNextFrameAt = now + 46
      }

      runHighPriorityTask(() => {
        if (streamSchedulerActive) {
          void sendCurrentFrameToSerial()
        }
      })
      scheduleStreamFrame()
    }, delay)
  }

  // 启动高优先级、漂移校正的颜色流式发送调度器。
  const startStreaming = () => {
    if (streamSchedulerActive) return

    streamSchedulerActive = true
    streamNextFrameAt = getFrameTimestamp()
    isRfStreaming.value = true
    lastFrameSentAt = 0
    smoothedFrameIntervalMs = 0
    rfTxFps.value = 0
    scheduleStreamFrame()
  }

  // 停止流式发射
  const stopStreaming = () => {
    streamSchedulerActive = false
    if (streamTimerInstance) {
      clearTimeout(streamTimerInstance)
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
    devicePlaybackSource.value = null

    if (options.unexpected && wasConnected) {
      unexpectedDisconnectToken.value += 1
    }
  }

  // 同步发送预设效果至设备（若设备已连接则下发硬件；不自动连接设备，连接只能在设备管理器中手动操作）
  const sendPresetToDevice = (
    preset: PresetItem | null,
    playbackDurationMs?: number,
    source: DevicePlaybackSource = 'timeline',
    initialElapsedMs = 0
  ) => {
    if (!preset) return false
    if (
      source === 'preview' &&
      devicePlaybackSource.value === 'timeline' &&
      isDevicePlaying.value &&
      devicePlaybackPausedAt <= 0
    ) {
      return false
    }

    // 出现新的颜色：结束指令持续发送，切回颜色数据
    streamWirelessPayload = null
    currentWirelessData.value = ''
    devicePlaybackPausedAt = 0

    const effectData: PresetLightEffect = normalizePresetEffect(preset.effect)
    timelinePlaybackActive = source === 'timeline'
    timelinePlaybackElapsedMs = timelinePlaybackActive
      ? Math.max(0, initialElapsedMs)
      : 0

    devicePlayingEffect.value = {
      presetId: preset.id,
      presetName: preset.name,
      effect: effectData,
      startedAt: getFrameTimestamp(),
      playbackDurationMs: Number.isFinite(playbackDurationMs)
        ? Math.max(50, Math.round(Number(playbackDurationMs)))
        : effectData.duration * (
            effectData.repeat === 0 ? 1 : Math.max(1, effectData.repeat)
          ),
      source
    }
    devicePlaybackSource.value = source

    // 仅在设备已被用户手动连接时激活硬件播放
    if (hasConnectedDevice.value) {
      isDevicePlaying.value = true

      // 保持连续发送节奏，切换效果时不重建调度器。
      if (isSerialConnected.value) {
        startStreaming()
        void sendCurrentFrameToSerial()
      }
    } else {
      isDevicePlaying.value = false
    }

    return true
  }

  const stopDevicePlayback = (source: DevicePlaybackSource = 'timeline') => {
    if (devicePlaybackSource.value !== source) return
    isDevicePlaying.value = false
    devicePlaybackPausedAt = 0
    devicePlaybackSource.value = null
    if (source === 'timeline') {
      timelinePlaybackActive = false
      timelinePlaybackElapsedMs = 0
    }
  }

  const syncDevicePlaybackTime = (
    elapsedMs: number,
    source: DevicePlaybackSource = 'timeline'
  ) => {
    if (devicePlaybackSource.value !== source || !Number.isFinite(elapsedMs)) {
      return
    }

    timelinePlaybackActive = true
    timelinePlaybackElapsedMs = Math.max(0, elapsedMs)
  }

  const pauseDevicePlayback = (source: DevicePlaybackSource = 'timeline') => {
    if (devicePlaybackSource.value !== source) return
    if (devicePlaybackPausedAt > 0) return
    devicePlaybackPausedAt = getFrameTimestamp()
  }

  const resumeDevicePlayback = (source: DevicePlaybackSource = 'timeline') => {
    if (devicePlaybackSource.value !== source) return
    if (devicePlaybackPausedAt <= 0) return

    const pausedDuration = getFrameTimestamp() - devicePlaybackPausedAt
    if (devicePlayingEffect.value) {
      devicePlayingEffect.value = {
        ...devicePlayingEffect.value,
        startedAt: devicePlayingEffect.value.startedAt + pausedDuration
      }
    }
    devicePlaybackPausedAt = 0
  }

  const seekDevicePlayback = (
    elapsedMs: number,
    source: DevicePlaybackSource = 'timeline'
  ) => {
    if (devicePlaybackSource.value !== source) return
    const now = getFrameTimestamp()
    const elapsed = Math.max(0, elapsedMs)

    if (devicePlayingEffect.value) {
      devicePlayingEffect.value = {
        ...devicePlayingEffect.value,
        startedAt: now - elapsed
      }
    }
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
    devicePlaybackSource,
    hasConnectedDevice,
    connectedCount,
    connectSerial,
    disconnectSerial,
    sendPresetToDevice,
    syncDevicePlaybackTime,
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
