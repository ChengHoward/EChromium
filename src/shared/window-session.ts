import type { TabState } from './model'
import { webTarget } from './navigation'
import { canonicalOrigin } from './site-policy'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}
export interface SessionTab {
  kind: TabState['kind']
  url: string
  title: string
  pinned: boolean
  muted: boolean
  zoom: number
  settingsOrigin?: string
}
export interface SessionWindow {
  bounds: WindowBounds
  maximized: boolean
  activeIndex: number
  tabs: SessionTab[]
}
export interface WindowSession {
  version: 1
  windows: SessionWindow[]
}
export const sessionLimits = { windows: 10, tabsPerWindow: 100, tabs: 200 }
const kinds: TabState['kind'][] = ['web', 'newtab', 'settings', 'downloads', 'history', 'bookmarks']
export function sessionTab(value: unknown): SessionTab | undefined {
  if (!value || typeof value !== 'object') return
  const raw = value as Record<string, unknown>
  if (!kinds.includes(raw.kind as TabState['kind'])) return
  const kind = raw.kind as TabState['kind']
  if (kind === 'web' && (typeof raw.url !== 'string' || raw.url.length > 8192 || !webTarget(raw.url))) return
  return {
    kind,
    url: kind === 'web' ? new URL(raw.url as string).href : '',
    title: typeof raw.title === 'string' ? raw.title.slice(0, 500) : '',
    pinned: raw.pinned === true,
    muted: raw.muted === true,
    zoom:
      typeof raw.zoom === 'number' && Number.isFinite(raw.zoom) ? Math.min(3, Math.max(0.25, raw.zoom)) : 1,
    settingsOrigin: kind === 'settings' ? canonicalOrigin(raw.settingsOrigin) || undefined : undefined,
  }
}
export function windowBounds(value: unknown): WindowBounds | undefined {
  if (!value || typeof value !== 'object') return
  const raw = value as WindowBounds
  if (![raw.x, raw.y, raw.width, raw.height].every(Number.isFinite) || raw.width <= 0 || raw.height <= 0)
    return
  return {
    x: Math.max(-100000, Math.min(100000, Math.round(raw.x))),
    y: Math.max(-100000, Math.min(100000, Math.round(raw.y))),
    width: Math.max(650, Math.min(8192, Math.round(raw.width))),
    height: Math.max(460, Math.min(8192, Math.round(raw.height))),
  }
}
export function restoredSession(value: unknown): WindowSession | undefined {
  if (!value || typeof value !== 'object') return
  const raw = value as WindowSession
  if (raw.version !== 1 || !Array.isArray(raw.windows)) return
  const windows: SessionWindow[] = []
  let count = 0
  for (const item of raw.windows.slice(0, sessionLimits.windows)) {
    if (!item || !Array.isArray(item.tabs)) continue
    const candidates = item.tabs
      .slice(0, sessionLimits.tabsPerWindow)
      .map((tab, index) => ({ tab: sessionTab(tab), index }))
    const rows = candidates
      .filter((row): row is { tab: SessionTab; index: number } => !!row.tab)
      .slice(0, sessionLimits.tabs - count)
    if (!rows.length) continue
    const active = rows.find((row) => row.index === item.activeIndex) || rows[0]
    rows.sort((a, b) => Number(b.tab.pinned) - Number(a.tab.pinned))
    windows.push({
      bounds: windowBounds(item.bounds) || { x: 80, y: 80, width: 1240, height: 820 },
      maximized: item.maximized === true,
      tabs: rows.map((row) => row.tab),
      activeIndex: rows.indexOf(active),
    })
    count += rows.length
  }
  return windows.length ? { version: 1, windows } : undefined
}
/** Keep the whole normal window inside a current work area, including negative-coordinate displays. */
export function visibleWindowBounds(saved: WindowBounds, areas: readonly WindowBounds[]): WindowBounds {
  const list = areas.length ? areas : [{ x: 0, y: 0, width: 1280, height: 900 }]
  const overlap = (area: WindowBounds) =>
    Math.max(0, Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x)) *
    Math.max(0, Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y))
  const area = [...list].sort((a, b) => overlap(b) - overlap(a))[0]
  const width = Math.min(saved.width, area.width),
    height = Math.min(saved.height, area.height)
  return {
    x: Math.max(area.x, Math.min(saved.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(saved.y, area.y + area.height - height)),
    width,
    height,
  }
}
