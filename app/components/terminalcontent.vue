<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { devicesManager } from '~/composables/devicesmanager'
import { SERIAL_PROTOCOL_MAX_PAYLOAD_LENGTH } from '~/utils/serialprotocol'

const {
  isSerialConnected,
  sendWirelessData
} = devicesManager()

interface LogLine {
  id: number
  text: string
  isPrompt?: boolean
  isError?: boolean
  isSuccess?: boolean
  isDim?: boolean
}

const inputRaw = ref('')
const terminalLines = ref<LogLine[]>([])
const terminalBodyRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

// 历史命令 (Up / Down)
const history = ref<string[]>([])
const historyIdx = ref<number>(-1)
let lineId = 0

const appendLine = (text: string, options: Partial<LogLine> = {}) => {
  terminalLines.value.push({
    id: ++lineId,
    text,
    ...options
  })
  scrollToBottom()
}

const scrollToBottom = async () => {
  await nextTick()
  if (terminalBodyRef.value) {
    terminalBodyRef.value.scrollTop = terminalBodyRef.value.scrollHeight
  }
}

// 启动提示
const printStartupHint = () => {
  appendLine('LiveStage Client Command', { isDim: true })
}

// 统计指定位置之前有多少个 16 进制字符
const countHexBefore = (value: string, index: number) =>
  value.slice(0, index).replace(/[^0-9a-fA-F]/g, '').length

// 将 16 进制字符数量映射为格式化字符串中的位置（每两位之间有一个空格）
const hexCountToIndex = (count: number) => {
  if (count <= 0) return 0
  return count + Math.floor((count - 1) / 2)
}

// Vue 更新输入框内容后会重置光标，需在 DOM 更新后恢复选区
const restoreSelection = async (el: HTMLInputElement, start: number, end: number) => {
  await nextTick()
  if (!el.isConnected) return
  el.setSelectionRange(start, end)
}

// 格式化 16 进制字符串：过滤非 16 进制字符，每两位加一个空格
const handleInput = (e: Event) => {
  const inputEvent = e as InputEvent
  const target = e.target as HTMLInputElement
  const val = target.value
  const selectionStart = target.selectionStart ?? val.length
  const selectionEnd = target.selectionEnd ?? val.length

  // 退格删除操作保持原生流畅
  if (inputEvent.inputType && inputEvent.inputType.startsWith('delete')) {
    inputRaw.value = val.toUpperCase()
    restoreSelection(target, selectionStart, selectionEnd)
    return
  }

  // 过滤非 16 进制字符并按每两位以空格分开
  const clean = val.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  const chunks: string[] = []
  for (let i = 0; i < clean.length; i += 2) {
    chunks.push(clean.slice(i, i + 2))
  }
  inputRaw.value = chunks.join(' ')

  // 保持选中状态，可直接覆盖选中的 16 进制片段
  restoreSelection(
    target,
    hexCountToIndex(countHexBefore(val, selectionStart)),
    hexCountToIndex(countHexBefore(val, selectionEnd))
  )
}

const executeCommand = async () => {
  const raw = inputRaw.value.trim()
  if (!raw) return

  history.value.push(raw)
  historyIdx.value = -1

  // 命令行回显
  appendLine(`> ${raw}`, { isPrompt: true })
  inputRaw.value = ''

  // 仅接受 16 进制指令，提取其中的 16 进制数据
  const clean = raw.replace(/[^0-9a-fA-F]/g, '')
  if (clean.length === 0) {
    appendLine(`仅支持 16 进制指令: ${raw}`, { isError: true })
    return
  }

  // 串口未连接时不发送（不提供模拟发送）
  if (!isSerialConnected.value) {
    appendLine('设备未连接', { isError: true })
    return
  }

  const padded = clean.length % 2 !== 0 ? clean + '0' : clean
  const bytes: number[] = []
  for (let i = 0; i < padded.length; i += 2) {
    bytes.push(parseInt(padded.slice(i, i + 2), 16))
  }

  if (bytes.length < 1 || bytes.length > SERIAL_PROTOCOL_MAX_PAYLOAD_LENGTH) {
    appendLine(`无线数据长度必须为 1 到 ${SERIAL_PROTOCOL_MAX_PAYLOAD_LENGTH} 字节，CRC 将由 Client 计算`, { isError: true })
    return
  }

  const commandHex = bytes
    .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ')

  appendLine(`TX: ${commandHex}`, { isSuccess: true })

  // 串口下发
  const success = await sendWirelessData(new Uint8Array(bytes))
  if (!success) {
    appendLine('发送失败: 串口写入异常', { isError: true })
  }
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    executeCommand()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (history.value.length === 0) return
    if (historyIdx.value === -1) {
      historyIdx.value = history.value.length - 1
    } else if (historyIdx.value > 0) {
      historyIdx.value--
    }
    inputRaw.value = history.value[historyIdx.value] || ''
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (historyIdx.value === -1) return
    if (historyIdx.value < history.value.length - 1) {
      historyIdx.value++
      inputRaw.value = history.value[historyIdx.value] || ''
    } else {
      historyIdx.value = -1
      inputRaw.value = ''
    }
  }
}

const focusInput = () => {
  inputRef.value?.focus()
}

onMounted(() => {
  printStartupHint()
  focusInput()
})
</script>

<template>
  <div class="terminal-container font-mono" @click="focusInput">
    <div ref="terminalBodyRef" class="terminal-body">
      <!-- 终端输出行 -->
      <div
        v-for="line in terminalLines"
        :key="line.id"
        class="terminal-line"
        :class="{
          'is-prompt': line.isPrompt,
          'is-error': line.isError,
          'is-success': line.isSuccess,
          'is-dim': line.isDim
        }"
      >
        {{ line.text }}
      </div>

      <!-- 命令行交互输入行 -->
      <div class="input-line">
        <span class="prompt">></span>
        <input
          ref="inputRef"
          v-model="inputRaw"
          class="cmd-input font-mono"
          type="text"
          spellcheck="false"
          autofocus
          @input="handleInput"
          @keydown="handleKeydown"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.terminal-container {
  width: 100%;
  height: 100%;
  background: #0d1117;
  color: #c9d1d9;
  box-sizing: border-box;
  padding: 12px 14px;
  user-select: text;
  cursor: text;
}

.terminal-body {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  line-height: 1.5;
}

.terminal-line {
  word-break: break-all;
  white-space: pre-wrap;
}

.terminal-line.is-dim {
  color: #6e7681;
}

.terminal-line.is-prompt {
  color: #79c0ff;
}

.terminal-line.is-success {
  color: #7ee787;
}

.terminal-line.is-error {
  color: #f85149;
}

.input-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.prompt {
  color: #7ee787;
  font-weight: 600;
  user-select: none;
  white-space: nowrap;
}

.cmd-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #f0f6fc;
  font-size: 13px;
  padding: 0;
  letter-spacing: 0.5px;
}

.font-mono {
  font-family: 'Google Sans', sans-serif;
}
</style>
