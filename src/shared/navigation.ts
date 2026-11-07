import type { SearchEngine } from './model'

const engines: Record<SearchEngine, string> = {
  bing: 'https://www.bing.com/search?q=',
  baidu: 'https://www.baidu.com/s?wd=',
  google: 'https://www.google.com/search?q=',
}
export function isSearchTarget(url: string, input: string, engine: SearchEngine) {
  return url === engines[engine] + encodeURIComponent(input.trim())
}
/** User-entered addresses and untrusted popup destinations have different rules. */
export function inputTarget(input: string, engine: SearchEngine = 'bing'): string {
  const text = input.trim()
  if (!text || text.length > 8192 || /[\u0000-\u001f\u007f]/.test(text))
    throw new Error('请输入有效的网址或搜索内容。')
  if (text === 'about:blank') return text
  const host = /^(localhost|\[[\da-f:]+\]|(?:[\p{L}\p{N}_-]+\.)+[\p{L}\p{N}_-]+)(:\d{1,5})?([/?#].*)?$/iu
  let candidate = text
  // localhost:3000 and example.com:443 are host/port pairs, not custom schemes.
  if (!/\s/.test(text) && host.test(text))
    candidate = `${/^localhost(?:[:/?#]|$)|^127\.|^\[::1\]/i.test(text) ? 'http' : 'https'}://${text}`
  else if (!/^[a-z][\w+.-]*:/i.test(text)) return engines[engine] + encodeURIComponent(text)
  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
    return url.href
  } catch {
    throw new Error('暂不支持此地址。请使用 HTTP 或 HTTPS 网址。')
  }
}
export function webTarget(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) return false
  try {
    const u = new URL(value)
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password
  } catch {
    return false
  }
}
export function safeOrigin(value: string): string {
  try {
    const u = new URL(value)
    return ['http:', 'https:'].includes(u.protocol) ? u.origin : '此页面'
  } catch {
    return '此页面'
  }
}
/** Adapted from Navora shared/browser-workspace.ts; see THIRD_PARTY_NOTICES.md. */
export function nextTab(previous: string[], removed: string, remaining: string[]): string | undefined {
  const at = previous.indexOf(removed),
    live = new Set(remaining)
  return (
    previous.slice(at + 1).find((id) => live.has(id)) ||
    previous
      .slice(0, Math.max(0, at))
      .reverse()
      .find((id) => live.has(id)) ||
    remaining[0]
  )
}
export function safeBounds(value: unknown, size: readonly number[], zoom = 1) {
  if (!value || typeof value !== 'object') throw new Error('Invalid layout')
  const raw = value as Record<string, unknown>,
    values = ['x', 'y', 'width', 'height'].map((k) => raw[k])
  if (values.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0))
    throw new Error('Invalid layout')
  const [x, y, width, height] = (values as number[]).map((v) => Math.round(v * zoom))
  return {
    x: Math.min(x, size[0]),
    y: Math.min(y, size[1]),
    width: Math.max(0, Math.min(width, size[0] - x)),
    height: Math.max(0, Math.min(height, size[1] - y)),
  }
}
