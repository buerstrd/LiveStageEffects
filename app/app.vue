<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { settingsManager } from '~/composables/settingsmanager'
import { bpmAnalyzer } from '~/composables/bpmanalyzer'
import { statusBarNoticeManager } from '~/composables/statusbarnotice'
import { clearBrowserCache } from '~/utils/browsercache'

const { clearBrowserCacheOnStartup } = settingsManager()
const { showStatusBarNotice } = statusBarNoticeManager()
bpmAnalyzer()

if (import.meta.client && clearBrowserCacheOnStartup.value) {
  void clearBrowserCache()
}

const isStatusBarVisible = ref(false)
let statusBarRevealTimer: ReturnType<typeof setTimeout> | null = null
let betaNoticeTimer: ReturnType<typeof setTimeout> | null = null

const tooltipControlSelector = [
  'button',
  '[role="button"]',
  '[role="switch"]',
  '[data-tooltip]',
  '.md3-ripple-surface'
].join(', ')
const tooltipDelay = 500
const tooltipGap = 8
const tooltipViewportPadding = 8

const tooltipElement = ref<HTMLElement | null>(null)
const tooltipVisible = ref(false)
const tooltipPositioned = ref(false)
const tooltipText = ref('')
const tooltipStyle = ref<Record<string, string>>({})

let tooltipTarget: HTMLElement | null = null
let pendingTooltipTarget: HTMLElement | null = null
let tooltipShowTimer: ReturnType<typeof setTimeout> | null = null
let tooltipOriginalTitle: string | null = null
let tooltipHadNativeTitle = false

const handleContextMenu = (e: MouseEvent) => {
  e.preventDefault()
}

const findTooltipControl = (event: Event) => {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement && node.matches(tooltipControlSelector)) {
      return node
    }
  }

  return null
}

const findTooltipControlFromTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement>(tooltipControlSelector)
}

const normalizeTooltipText = (value: string | null | undefined) => {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}

const getLabelledByText = (control: HTMLElement) => {
  const ids = control.getAttribute('aria-labelledby')?.split(/\s+/).filter(Boolean) ?? []
  if (ids.length === 0) return ''

  return normalizeTooltipText(
    ids
      .map((id) => document.getElementById(id)?.textContent)
      .filter(Boolean)
      .join(' ')
  )
}

const resolveTooltipText = (control: HTMLElement) => {
  const explicitText = normalizeTooltipText(control.getAttribute('data-tooltip'))
  if (explicitText) return explicitText

  const titleText = normalizeTooltipText(control.getAttribute('title'))
  if (titleText) return titleText

  const ariaLabel = normalizeTooltipText(control.getAttribute('aria-label'))
  if (ariaLabel) return ariaLabel

  const labelledByText = getLabelledByText(control)
  if (labelledByText) return labelledByText

  if (control.getAttribute('role') === 'switch') {
    const context = control.closest<HTMLElement>('.setting-item-row, .serial-setting-row')
    const contextText = normalizeTooltipText(context?.innerText || context?.textContent)
    if (contextText) return contextText
  }

  return normalizeTooltipText(control.innerText || control.textContent)
}

const clearTooltipShowTimer = () => {
  if (tooltipShowTimer) {
    clearTimeout(tooltipShowTimer)
    tooltipShowTimer = null
  }
}

const restoreNativeTooltipTitle = () => {
  if (
    tooltipTarget &&
    tooltipHadNativeTitle &&
    tooltipOriginalTitle !== null &&
    !tooltipTarget.hasAttribute('title')
  ) {
    tooltipTarget.setAttribute('title', tooltipOriginalTitle)
  }

  tooltipHadNativeTitle = false
  tooltipOriginalTitle = null
}

const updateTooltipPosition = (control = tooltipTarget) => {
  const tooltip = tooltipElement.value
  if (!control || !tooltip) return

  if (!control.isConnected) {
    hideTooltip()
    return
  }

  const controlRect = control.getBoundingClientRect()
  const tooltipRect = tooltip.getBoundingClientRect()
  if (controlRect.width === 0 && controlRect.height === 0) {
    hideTooltip()
    return
  }

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const preferredTop = controlRect.bottom + tooltipGap
  const canFitBelow = preferredTop + tooltipRect.height <= viewportHeight - tooltipViewportPadding
  const rawTop = canFitBelow
    ? preferredTop
    : controlRect.top - tooltipGap - tooltipRect.height
  const maxTop = Math.max(
    tooltipViewportPadding,
    viewportHeight - tooltipViewportPadding - tooltipRect.height
  )
  const top = Math.min(
    Math.max(rawTop, tooltipViewportPadding),
    maxTop
  )
  const rawLeft = controlRect.left + (controlRect.width - tooltipRect.width) / 2
  const maxLeft = Math.max(
    tooltipViewportPadding,
    viewportWidth - tooltipViewportPadding - tooltipRect.width
  )
  const left = Math.min(
    Math.max(rawLeft, tooltipViewportPadding),
    maxLeft
  )

  tooltipStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`
  }
}

const hideTooltip = () => {
  clearTooltipShowTimer()
  pendingTooltipTarget = null
  restoreNativeTooltipTitle()
  tooltipTarget = null
  tooltipVisible.value = false
  tooltipPositioned.value = false
  tooltipStyle.value = {}
}

const showTooltip = async (control: HTMLElement) => {
  const text = resolveTooltipText(control)
  if (!text) {
    if (tooltipTarget === control || pendingTooltipTarget === control) {
      hideTooltip()
    }
    return
  }

  clearTooltipShowTimer()
  pendingTooltipTarget = null

  if (tooltipTarget === control && tooltipVisible.value) {
    tooltipText.value = text
    await nextTick()
    updateTooltipPosition(control)
    return
  }

  restoreNativeTooltipTitle()
  tooltipTarget = control
  tooltipText.value = text

  if (control.hasAttribute('title')) {
    tooltipOriginalTitle = control.getAttribute('title')
    tooltipHadNativeTitle = true
    control.removeAttribute('title')
  }

  tooltipVisible.value = true
  tooltipPositioned.value = false
  await nextTick()

  if (tooltipTarget !== control || !tooltipVisible.value) return
  updateTooltipPosition(control)
  tooltipPositioned.value = true
}

const scheduleTooltip = (control: HTMLElement) => {
  const text = resolveTooltipText(control)
  if (!text) {
    if (tooltipTarget === control || pendingTooltipTarget === control) {
      hideTooltip()
    }
    return
  }

  clearTooltipShowTimer()
  pendingTooltipTarget = control

  if (tooltipVisible.value && tooltipTarget !== control) {
    void showTooltip(control)
    return
  }

  if (tooltipVisible.value && tooltipTarget === control) {
    tooltipText.value = text
    updateTooltipPosition(control)
    return
  }

  tooltipShowTimer = setTimeout(() => {
    tooltipShowTimer = null
    if (pendingTooltipTarget === control) {
      void showTooltip(control)
    }
  }, tooltipDelay)
}

const handleGlobalPointerOver = (event: PointerEvent) => {
  if (event.pointerType === 'touch') return

  const control = findTooltipControl(event)
  if (control) scheduleTooltip(control)
}

const handleGlobalPointerOut = (event: PointerEvent) => {
  const control = findTooltipControl(event)
  if (!control) return

  const relatedTarget = event.relatedTarget
  if (relatedTarget instanceof Node && control.contains(relatedTarget)) return

  const nextControl = findTooltipControlFromTarget(relatedTarget)
  if (nextControl && nextControl !== control) {
    scheduleTooltip(nextControl)
    return
  }

  if (tooltipTarget === control || pendingTooltipTarget === control) {
    hideTooltip()
  }
}

const handleGlobalPointerMove = (event: PointerEvent) => {
  if (!tooltipVisible.value) return

  const control = findTooltipControl(event)
  if (control && control === tooltipTarget) {
    updateTooltipPosition(control)
  }
}

const handleGlobalFocusIn = (event: FocusEvent) => {
  const control = findTooltipControlFromTarget(event.target)
  if (control) scheduleTooltip(control)
}

const handleGlobalFocusOut = (event: FocusEvent) => {
  const control = findTooltipControlFromTarget(event.target)
  if (!control) return

  const relatedTarget = event.relatedTarget
  if (relatedTarget instanceof Node && control.contains(relatedTarget)) return

  if (tooltipTarget === control || pendingTooltipTarget === control) {
    hideTooltip()
  }
}

const handleViewportChange = () => {
  if (tooltipVisible.value) {
    updateTooltipPosition()
  }
}

const handleGlobalClick = (event: MouseEvent) => {
  const control = findTooltipControl(event)
  if (!control) return

  if (tooltipTarget === control || pendingTooltipTarget === control) {
    hideTooltip()
  }
}

// 全局 MD3 按钮水波纹（Ripple）动画管理器
const createRipple = (
  button: HTMLElement,
  clientX?: number,
  clientY?: number
) => {
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
  window.addEventListener('click', handleGlobalClick, { capture: true })
  window.addEventListener('keydown', handleGlobalKeyDown, { capture: true })
  window.addEventListener('keyup', handleGlobalKeyUp, { capture: true })
  window.addEventListener('pointerover', handleGlobalPointerOver, { capture: true })
  window.addEventListener('pointerout', handleGlobalPointerOut, { capture: true })
  window.addEventListener('pointermove', handleGlobalPointerMove, {
    capture: true,
    passive: true
  })
  window.addEventListener('focusin', handleGlobalFocusIn, { capture: true })
  window.addEventListener('focusout', handleGlobalFocusOut, { capture: true })
  window.addEventListener('scroll', handleViewportChange, {
    capture: true,
    passive: true
  })
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('blur', hideTooltip)

  statusBarRevealTimer = setTimeout(() => {
    isStatusBarVisible.value = true
    statusBarRevealTimer = null

    betaNoticeTimer = setTimeout(() => {
      showStatusBarNotice('time', '当前为测试版', 5000, {
        backgroundColor: 'var(--md-sys-color-primary, #8ab4f8)',
        textColor: 'var(--md-sys-color-on-primary, #042a59)'
      })
      betaNoticeTimer = null
    }, 400)
  }, 1000)
})

onUnmounted(() => {
  window.removeEventListener('contextmenu', handleContextMenu)
  window.removeEventListener('pointerdown', handleGlobalPointerDown, { capture: true })
  window.removeEventListener('click', handleGlobalClick, { capture: true })
  window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true })
  window.removeEventListener('keyup', handleGlobalKeyUp, { capture: true })
  window.removeEventListener('pointerover', handleGlobalPointerOver, { capture: true })
  window.removeEventListener('pointerout', handleGlobalPointerOut, { capture: true })
  window.removeEventListener('pointermove', handleGlobalPointerMove, { capture: true })
  window.removeEventListener('focusin', handleGlobalFocusIn, { capture: true })
  window.removeEventListener('focusout', handleGlobalFocusOut, { capture: true })
  window.removeEventListener('scroll', handleViewportChange, { capture: true })
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('blur', hideTooltip)
  hideTooltip()
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
    <Teleport to="body">
      <div
        v-if="tooltipVisible"
        ref="tooltipElement"
        class="md3-tooltip"
        :class="{ 'is-positioned': tooltipPositioned }"
        :style="tooltipStyle"
        role="tooltip"
      >
        {{ tooltipText }}
      </div>
    </Teleport>
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
