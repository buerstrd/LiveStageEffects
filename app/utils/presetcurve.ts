export interface PresetPoint {
  x: number
  y: number
  color: string
}

export interface PresetLightEffect {
  color: string
  repeat: number
  duration: number
  points: PresetPoint[]
}

export interface PresetItem {
  id: number
  name: string
  shortcut?: string
  effect?: PresetLightEffect
}

export interface PresetCurveTemplate {
  id: string
  name: string
  points: PresetPoint[]
}

const HEX_COLOR_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

const clamp = (value: number, min: number, max: number): number => (
  Math.max(min, Math.min(max, value))
)

export const normalizeHexColor = (
  value: unknown,
  fallback = '#ffffff'
): string => {
  if (typeof value !== 'string') return fallback
  const match = value.trim().match(HEX_COLOR_PATTERN)
  if (!match?.[1]) return fallback
  const hex = match[1].toLowerCase()
  return `#${hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex}`
}

export const normalizePresetPoint = (
  point: Partial<PresetPoint> | null | undefined,
  fallbackColor: string
): PresetPoint => ({
  x: Number.isFinite(point?.x) ? clamp(Number(point?.x), 0, 1) : 0,
  y: Number.isFinite(point?.y) ? clamp(Number(point?.y), 0, 1) : 0.5,
  color: normalizeHexColor(point?.color, normalizeHexColor(fallbackColor))
})

export const createDefaultPresetPoints = (
  color = '#ffffff',
  brightness = 0.5
): PresetPoint[] => [
  { x: 0, y: brightness, color: normalizeHexColor(color) },
  { x: 1, y: brightness, color: normalizeHexColor(color) }
]

export const createDefaultEffect = (): PresetLightEffect => ({
  color: '#ffffff',
  repeat: 1,
  duration: 500,
  points: createDefaultPresetPoints()
})

export const normalizePresetEffect = (
  effect?: Partial<PresetLightEffect> | null
): PresetLightEffect => {
  const color = normalizeHexColor(effect?.color)
  const repeat = Number.isFinite(effect?.repeat)
    ? clamp(Math.round(Number(effect?.repeat)), 0, 99)
    : 1
  const duration = Number.isFinite(effect?.duration)
    ? clamp(Math.round(Number(effect?.duration)), 50, 20000)
    : 500
  const sourcePoints = Array.isArray(effect?.points) ? effect.points : []
  const sortedPoints = sourcePoints
    .map(point => normalizePresetPoint(point, color))
    .sort((a, b) => a.x - b.x)
  const points = sortedPoints.reduce<PresetPoint[]>((result, point) => {
    const previous = result[result.length - 1]
    if (previous && Math.abs(previous.x - point.x) < 0.0001) {
      result[result.length - 1] = point
      return result
    }
    result.push(point)
    return result
  }, [])

  if (points.length === 0) {
    return {
      color,
      repeat,
      duration,
      points: createDefaultPresetPoints(color)
    }
  }

  if (points.length === 1) {
    const point = points[0]!
    points.splice(
      0,
      1,
      { ...point, x: 0 },
      { ...point, x: 1 }
    )
  }

  return {
    color,
    repeat,
    duration,
    points
  }
}

export const normalizePresetItem = (
  preset: Partial<PresetItem> | null | undefined,
  index: number
): PresetItem => ({
  id: typeof preset?.id === 'number' && Number.isInteger(preset.id) && preset.id > 0
    ? preset.id
    : index + 1,
  name: typeof preset?.name === 'string' && preset.name.trim()
    ? preset.name.trim()
    : `预设 ${index + 1}`,
  shortcut: typeof preset?.shortcut === 'string' ? preset.shortcut.trim() : '',
  effect: normalizePresetEffect(preset?.effect)
})

export const normalizeCurveTemplate = (
  template: unknown,
  index: number,
  fallbackColor = '#ffffff'
): PresetCurveTemplate | null => {
  if (!template || typeof template !== 'object') return null
  const source = template as Partial<PresetCurveTemplate>
  if (!Array.isArray(source.points) || source.points.length < 2) return null

  return {
    id: typeof source.id === 'string' && source.id.trim()
      ? source.id.trim()
      : `tmpl-${index + 1}`,
    name: typeof source.name === 'string' && source.name.trim()
      ? source.name.trim()
      : `曲线 ${index + 1}`,
    points: source.points
      .map(point => normalizePresetPoint(point, fallbackColor))
      .sort((a, b) => a.x - b.x)
  }
}
