/** Runs in the isolated review shell. Measures flat composited UI colors, excluding
 * native panels, guest websites and the Windows backdrop. */
export function inspectTextContrast() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const failures: { text: string; ratio: number; minimum: number }[] = []
  let checked = 0,
    lowest = 100
  const luminance = (pixel: Uint8ClampedArray) => {
    const [r, g, b] = [...pixel].slice(0, 3).map((value) => {
      const s = value / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return r * 0.2126 + g * 0.7152 + b * 0.0722
  }
  const check = (element: Element, text: string, placeholder = false) => {
    const bounds = element.getBoundingClientRect()
    if (
      !text.trim() ||
      !bounds.width ||
      !bounds.height ||
      bounds.bottom <= 0 ||
      bounds.top >= innerHeight ||
      bounds.right <= 0 ||
      bounds.left >= innerWidth ||
      element.closest('[aria-hidden="true"]')
    )
      return
    const ancestors: Element[] = []
    let current: Element | null = element
    while (current) {
      ancestors.unshift(current)
      current = current.parentElement
    }
    const styles = ancestors.map((ancestor) => getComputedStyle(ancestor))
    if (styles.some((style) => style.visibility !== 'visible' || Number(style.opacity) === 0)) return
    context.globalAlpha = 1
    context.fillStyle = '#FFFFFF'
    context.fillRect(0, 0, 1, 1)
    for (const style of styles) {
      context.fillStyle = style.backgroundColor
      context.fillRect(0, 0, 1, 1)
    }
    const background = luminance(context.getImageData(0, 0, 1, 1).data)
    const style = placeholder ? getComputedStyle(element, '::placeholder') : getComputedStyle(element)
    context.globalAlpha =
      styles.reduce((opacity, item) => opacity * Number(item.opacity), 1) *
      (placeholder ? Number(style.opacity) : 1)
    context.fillStyle = style.color
    context.fillRect(0, 0, 1, 1)
    const foreground = luminance(context.getImageData(0, 0, 1, 1).data)
    const ratio = (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
    const size = parseFloat(style.fontSize),
      weight = Number(style.fontWeight)
    const minimum = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5
    checked++
    lowest = Math.min(lowest, ratio)
    if (ratio + 0.01 < minimum) failures.push({ text: text.trim().slice(0, 60), ratio, minimum })
  }
  const walker = document.createTreeWalker(document.querySelector('.browser-shell')!, NodeFilter.SHOW_TEXT)
  let text: Node | null
  while ((text = walker.nextNode())) if (text.parentElement) check(text.parentElement, text.textContent || '')
  for (const input of document.querySelectorAll<HTMLInputElement>(
    'input:not([type="range"]):not([type="checkbox"])',
  ))
    check(input, input.value || input.placeholder, !input.value)
  return { checked, lowest, failures }
}
