import type { Preferences, ThemeId } from './model'

// Palette values adapted from Navora shared/appearance.ts (MIT).
export const themes: Record<ThemeId, { name: string; light: string[]; dark: string[] }> = {
  mist: {
    name: '雾蓝',
    light: [
      '#DEE7EF',
      '#EEF3F7',
      '#FBFCFE',
      '#F3F6FA',
      '#293C4E',
      '#5A6E80',
      '#3F6D91',
      '#D5DFE8',
      '#E1ECF5',
    ],
    dark: ['#1B2733', '#22313F', '#283746', '#243240', '#E8EFF6', '#AEBFCE', '#A8CAE5', '#415569', '#344D62'],
  },
  sage: {
    name: '鼠尾草绿',
    light: [
      '#DFE8E2',
      '#EFF4F0',
      '#FBFDFB',
      '#F4F8F5',
      '#2C4136',
      '#64756B',
      '#507563',
      '#D6E1D9',
      '#E1EDE5',
    ],
    dark: ['#202B25', '#27352D', '#2D3B32', '#28362E', '#E8F0EA', '#B2C2B6', '#B1D0BD', '#465B4D', '#3A5143'],
  },
  wisteria: {
    name: '淡藤紫',
    light: [
      '#E5E1EC',
      '#F1EEF6',
      '#FDFBFE',
      '#F6F3F9',
      '#3D3749',
      '#70667C',
      '#75618C',
      '#DDD7E6',
      '#EBE4F3',
    ],
    dark: ['#252330', '#2C2938', '#332F40', '#2E2A39', '#F0EBF6', '#BEB3CE', '#C9B8E1', '#51495F', '#453C55'],
  },
  sand: {
    name: '暖砂',
    light: [
      '#E9E3DA',
      '#F5F1EB',
      '#FEFCF8',
      '#F9F6F0',
      '#433D32',
      '#796D5C',
      '#7B6038',
      '#E3DACE',
      '#EFE4D4',
    ],
    dark: ['#2A2722', '#333029', '#3A352E', '#343029', '#F1ECE3', '#C6BAAB', '#D9C29E', '#5B5143', '#504635'],
  },
  apricot: {
    name: '柔杏',
    light: [
      '#ECE2DD',
      '#F7F0EC',
      '#FFFCFA',
      '#FBF5F1',
      '#493B35',
      '#796860',
      '#845A44',
      '#E7DAD3',
      '#F1E0D6',
    ],
    dark: ['#2D2622', '#362D28', '#3D322C', '#362D28', '#F4EBE5', '#CCBBAF', '#DFBCA6', '#605045', '#544337'],
  },
  graphite: {
    name: '石墨',
    light: [
      '#E2E6EA',
      '#F0F3F5',
      '#FCFDFE',
      '#F5F7F9',
      '#303840',
      '#63707B',
      '#566878',
      '#D8DFE5',
      '#E2E8ED',
    ],
    dark: ['#22272D', '#292F36', '#303740', '#2A3139', '#EBEFF4', '#B6C0CB', '#C1CEDD', '#485360', '#3D4B5B'],
  },
}
export const transparencyLimits = { min: 15, max: 75, default: 72 } as const
export const themeDepthLimits = { min: 0, max: 100, default: 50 } as const
export const defaults: Preferences = {
  theme: 'mist',
  mode: 'auto',
  acrylic: true,
  transparency: transparencyLimits.default,
  themeDepth: themeDepthLimits.default,
  search: 'bing',
  restore: true,
  bookmarksBar: true,
}
export function palette(preferences: Preferences, systemDark: boolean) {
  const dark = preferences.mode === 'dark' || (preferences.mode === 'auto' && systemDark)
  const colors = themes[preferences.theme][dark ? 'dark' : 'light']
  const result: Record<string, string> = {}
  ;['shell', 'sidebar', 'surface', 'header', 'ink', 'muted', 'accent', 'stroke', 'selection'].forEach(
    (key, index) => {
      result[key] = colors[index]
    },
  )
  const depth = Math.max(
    themeDepthLimits.min,
    Math.min(
      themeDepthLimits.max,
      Number.isFinite(preferences.themeDepth) ? preferences.themeDepth : themeDepthLimits.default,
    ),
  )
  if (depth !== themeDepthLimits.default) {
    const amount = (depth - themeDepthLimits.default) / 50
    const target = amount > 0 ? '#000000' : '#FFFFFF'
    const strength = Math.abs(amount) * (amount > 0 ? (dark ? 0.4 : 0.12) : dark ? 0.12 : 0.45)
    for (const key of ['shell', 'sidebar', 'surface', 'header', 'stroke', 'selection'])
      result[key] = mix(result[key], target, strength)
  }
  // Browser bars keep a lighter tint than the titlebar at deep settings.
  // Do not change the internal page surfaces or the user's material opacity to get that separation.
  const deepAmount = Math.max(0, (depth - themeDepthLimits.default) / 50)
  result['bar-surface'] = deepAmount ? mix(colors[3], '#000000', deepAmount * 0.04) : result.header
  result['field-surface'] = deepAmount
    ? mix(colors[2], '#000000', deepAmount * (dark ? 0.08 : 0.025))
    : result.surface
  // Apply at the default depth too: captions and native panels must not inherit a faint base color.
  const backgrounds = [
    'shell',
    'sidebar',
    'surface',
    'header',
    'selection',
    'bar-surface',
    'field-surface',
  ].map((key) => luminance(result[key]))
  for (const key of ['ink', 'muted', 'accent']) {
    const original = result[key],
      minimum = key === 'ink' ? 7 : key === 'muted' ? 5 : 4.5
    for (let step = 0; step <= 100; step++) {
      result[key] = mix(original, dark ? '#FFFFFF' : '#000000', step / 100)
      const foreground = luminance(result[key])
      if (
        backgrounds.every(
          (background, index) =>
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) >=
            (key === 'ink' && index === 4 ? 4.5 : minimum),
        )
      )
        break
    }
  }
  // Accent buttons need a dedicated foreground, particularly with pastel dark-mode accents.
  const accent = luminance(result.accent),
    deep = themes[preferences.theme].dark[0],
    deepLuminance = luminance(deep)
  result['on-accent'] =
    (Math.max(accent, deepLuminance) + 0.05) / (Math.min(accent, deepLuminance) + 0.05) >= 4.5
      ? deep
      : 1.05 / (accent + 0.05) >= 4.5
        ? '#FFFFFF'
        : '#000000'
  return { colors: result, dark }
}

function channels(color: string) {
  return [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16))
}
function mix(color: string, target: string, amount: number) {
  const destination = channels(target)
  return (
    '#' +
    channels(color)
      .map((value, index) =>
        Math.round(value + (destination[index] - value) * amount)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  )
}
function luminance(color: string) {
  const [r, g, b] = channels(color).map((value) => {
    const s = value / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// One native backdrop, then a single tint for each disjoint piece of browser chrome.
// Keep page colors opaque; these tokens are exclusively for the surrounding frame.
function alphaHex(opacity: number) {
  return Math.round(255 * opacity)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
}
export function chromePalette(
  colors: Record<string, string>,
  dark: boolean,
  systemDark: boolean,
  acrylic: boolean,
  transparency: number = transparencyLimits.default,
) {
  const opposite = dark !== systemDark,
    bounded = Math.max(
      transparencyLimits.min,
      Math.min(
        transparencyLimits.max,
        Number.isFinite(transparency) ? transparency : transparencyLimits.default,
      ),
    ),
    // Keep the app's chosen tone readable over the opposite system material.
    level = bounded / 100,
    strength = level * (opposite ? (dark ? 0.22 : 0.08) : 1),
    tint = alphaHex(1 - strength)
  return {
    chrome: acrylic ? `${colors.shell}${tint}` : colors.shell,
    // Secondary bars retain a visibly stronger tint than the titlebar; inputs are steadier still.
    // Both respond to the slider without flattening the difference between the three layers.
    'chrome-content': acrylic
      ? `${colors['bar-surface'] || colors.header}${alphaHex(0.72 - level * 0.18)}`
      : colors['bar-surface'] || colors.header,
    'chrome-field': acrylic
      ? `${colors['field-surface'] || colors.surface}${alphaHex(0.82 - level * 0.14)}`
      : colors['field-surface'] || colors.surface,
  }
}
export function preferencesPatch(value: unknown): Partial<Preferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的设置。')
  const input = value as Record<string, unknown>,
    output: Partial<Preferences> = {}
  for (const [key, v] of Object.entries(input)) {
    if (key === 'theme' && typeof v === 'string' && Object.hasOwn(themes, v)) output.theme = v as ThemeId
    else if (key === 'mode' && ['auto', 'light', 'dark'].includes(String(v)))
      output.mode = v as Preferences['mode']
    else if (key === 'transparency') {
      if (
        typeof v !== 'number' ||
        !Number.isInteger(v) ||
        v < transparencyLimits.min ||
        v > transparencyLimits.max
      )
        throw new Error(`窗口透明度须为 ${transparencyLimits.min}%–${transparencyLimits.max}% 之间的整数。`)
      output.transparency = v
    } else if (key === 'themeDepth') {
      if (
        typeof v !== 'number' ||
        !Number.isInteger(v) ||
        v < themeDepthLimits.min ||
        v > themeDepthLimits.max
      )
        throw new Error(`主题色深浅须为 ${themeDepthLimits.min}–${themeDepthLimits.max} 之间的整数。`)
      output.themeDepth = v
    } else if (key === 'search' && ['bing', 'baidu', 'google'].includes(String(v)))
      output.search = v as Preferences['search']
    else if (['acrylic', 'restore', 'bookmarksBar'].includes(key) && typeof v === 'boolean')
      Object.assign(output, { [key]: v })
    else throw new Error('无效的设置值。')
  }
  return output
}
