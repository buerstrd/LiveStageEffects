<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  text: string
  fixedWidth?: number | null
  measureText?: string
}>()

const titleRef = ref<HTMLSpanElement | null>(null)
const measuredWidth = ref<number | null>(null)
let measureRafId: number | null = null
let measureProbe: HTMLSpanElement | null = null

const measureTitleWidth = () => {
  const titleElement = titleRef.value
  if (!titleElement) return

  const styles = window.getComputedStyle(titleElement)
  measureProbe ??= document.createElement('span')
  measureProbe.textContent = props.measureText ?? props.text

  Object.assign(measureProbe.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    display: 'inline-block',
    width: 'max-content',
    margin: '0',
    padding: '0',
    border: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    fontFamily: styles.fontFamily,
    fontSize: styles.fontSize,
    fontStyle: styles.fontStyle,
    fontWeight: styles.fontWeight,
    fontStretch: styles.fontStretch,
    fontVariantNumeric: styles.fontVariantNumeric,
    fontFeatureSettings: styles.fontFeatureSettings,
    fontKerning: styles.fontKerning,
    letterSpacing: styles.letterSpacing,
    textRendering: styles.textRendering
  })

  if (!measureProbe.isConnected) {
    document.body.appendChild(measureProbe)
  }

  measuredWidth.value = Math.ceil(measureProbe.getBoundingClientRect().width)
}

const scheduleMeasure = () => {
  if (typeof requestAnimationFrame === 'undefined') {
    measureTitleWidth()
    return
  }

  if (measureRafId !== null) return
  measureRafId = requestAnimationFrame(() => {
    measureRafId = null
    measureTitleWidth()
  })
}

const titleStyle = computed(() => {
  const style: Record<string, string> = {}
  const renderedWidth = props.fixedWidth ?? measuredWidth.value

  if (renderedWidth !== null) {
    style.width = `${renderedWidth}px`
  }
  if (props.fixedWidth !== null && props.fixedWidth !== undefined) {
    style.flex = `0 0 ${props.fixedWidth}px`
    style.minWidth = `${props.fixedWidth}px`
    style.transition = 'none'
  }
  if (measuredWidth.value !== null) {
    style['--window-title-content-width'] = `${measuredWidth.value}px`
  }
  return style
})

watch(
  () => props.measureText ?? props.text,
  async () => {
    await nextTick()
    scheduleMeasure()
  },
  { flush: 'post' }
)

onMounted(() => {
  scheduleMeasure()
  document.fonts?.ready.then(scheduleMeasure)
})

onUnmounted(() => {
  if (measureRafId !== null) {
    cancelAnimationFrame(measureRafId)
  }
  measureProbe?.remove()
  measureProbe = null
})
</script>

<template>
  <span
    ref="titleRef"
    class="window-title"
    :style="titleStyle"
  >
    {{ text }}
  </span>
</template>

<style scoped>
.window-title {
  display: inline-block;
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  transition: width 0.28s cubic-bezier(0.2, 0, 0, 1);
}
</style>
