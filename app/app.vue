<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { settingsManager } from '~/composables/settingsmanager'
import { bpmAnalyzer } from '~/composables/bpmanalyzer'
import { statusBarNoticeManager } from '~/composables/statusbarnotice'

const { disableAnimations } = settingsManager()
const { showStatusBarNotice } = statusBarNoticeManager()
bpmAnalyzer()

const isStatusBarVisible = ref(false)
let statusBarRevealTimer: ReturnType<typeof setTimeout> | null = null
let betaNoticeTimer: ReturnType<typeof setTimeout> | null = null

const handleContextMenu = (e: MouseEvent) => {
  e.preventDefault()
}

// 全局 MD3 按钮水波纹（Ripple）动画管理器
const createRipple = (
  button: HTMLElement,
  clientX?: number,
  clientY?: number
) => {
  if (disableAnimations.value) return

  const rect = button.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return

  // 计算可覆盖按钮所有角落的对角线直径
  const diameter = Math.hypot(rect.width, rect.height)
  const radius = diameter / 2

  const ripple = document.createElement('span')
  ripple.className = 'md3-ripple'
  ripple.style.width = `${diameter}px`
  ripple.style.height = `${diameter}px`

  const hasCoords = typeof clientX === 'number' && typeof clientY === 'number' && (clientX > 0 || clientY > 0)
  const clickX = hasCoords ? clientX! : rect.left + rect.width / 2
  const clickY = hasCoords ? clientY! : rect.top + rect.height / 2

  ripple.style.left = `${clickX - rect.left - radius}px`
  ripple.style.top = `${clickY - rect.top - radius}px`

  button.appendChild(ripple)

  setTimeout(() => {
    if (ripple.parentNode) {
      ripple.remove()
    }
  }, 650)
}

const handleGlobalPointerDown = (event: PointerEvent) => {
  const path = event.composedPath()
  const button = path.find(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      (el.tagName === 'BUTTON' ||
        el.getAttribute('role') === 'switch' ||
        el.getAttribute('role') === 'button' ||
        el.classList.contains('md3-ripple-surface'))
  )

  if (!button) return
  if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return

  createRipple(button, event.clientX, event.clientY)
}

const suppressNativeFocusActivation = (event: KeyboardEvent) => {
  const isActivationKey = event.key === 'Enter' || event.key === ' ' || event.code === 'Space'
  if (!isActivationKey) return

  const target = event.target
  if (!(target instanceof Element)) return

  const control = target.closest(
    'button, input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"], a[href], summary, select'
  )
  if (!control) return

  event.preventDefault()
}

const handleGlobalKeyDown = (event: KeyboardEvent) => {
  suppressNativeFocusActivation(event)

  if (event.key !== 'Enter' && event.key !== ' ') return

  const target = event.target as HTMLElement | null
  const button = target?.closest<HTMLElement>(
    'button, [role="button"], [role="switch"], .md3-ripple-surface'
  )

  if (!button) return
  if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return

  createRipple(button)
}

const handleGlobalKeyUp = (event: KeyboardEvent) => {
  suppressNativeFocusActivation(event)
}

onMounted(() => {
  window.addEventListener('contextmenu', handleContextMenu)
  // 使用 capture 捕获阶段监听，确保即便组件内部阻断了冒泡，也能正常触发水波纹
  window.addEventListener('pointerdown', handleGlobalPointerDown, { capture: true })
  window.addEventListener('keydown', handleGlobalKeyDown, { capture: true })
  window.addEventListener('keyup', handleGlobalKeyUp, { capture: true })

  statusBarRevealTimer = setTimeout(() => {
    isStatusBarVisible.value = true
    statusBarRevealTimer = null

    betaNoticeTimer = setTimeout(() => {
      showStatusBarNotice('time', '当前为测试版', 5000, {
        backgroundColor: 'var(--md-sys-color-primary, #8ab4f8)',
        textColor: 'var(--md-sys-color-on-primary, #042a59)'
      })
      betaNoticeTimer = null
    }, disableAnimations.value ? 0 : 400)
  }, 1000)
})

onUnmounted(() => {
  window.removeEventListener('contextmenu', handleContextMenu)
  window.removeEventListener('pointerdown', handleGlobalPointerDown, { capture: true })
  window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true })
  window.removeEventListener('keyup', handleGlobalKeyUp, { capture: true })
  if (statusBarRevealTimer) {
    clearTimeout(statusBarRevealTimer)
  }
  if (betaNoticeTimer) {
    clearTimeout(betaNoticeTimer)
  }
})
</script>

<template>
  <div
    class="app-layout"
    :class="{ 'animations-disabled': disableAnimations }"
    @contextmenu="handleContextMenu"
  >
    <div
      class="status-bar-slot"
      :class="{ 'is-visible': isStatusBarVisible }"
    >
      <StatusBar />
    </div>
    <main class="main-content">
      <WindowsManager />
      <NuxtRouteAnnouncer />
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.status-bar-slot {
  flex: 0 0 48px;
  height: 48px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.4s cubic-bezier(0.2, 0, 0, 1);
}

.status-bar-slot.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.main-content {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
