import type { TabState } from './model'
export interface TabPreview {
  id: string
  version: number
  status: 'ready' | 'unavailable' | 'unloaded' | 'internal'
  image?: string
  capturedAt?: number
}
export function overviewTabs(tabs: TabState[], query: string, pinnedOnly = false) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return tabs.filter(
    (tab) =>
      (!pinnedOnly || tab.pinned) &&
      words.every((word) => `${tab.title} ${tab.url}`.toLocaleLowerCase().includes(word)),
  )
}
export function tabLocation(tab: TabState) {
  if (tab.kind !== 'web')
    return {
      newtab: '新标签页',
      settings: '设置',
      bookmarks: '书签',
      downloads: '下载',
      history: '历史记录',
    }[tab.kind]
  try {
    return new URL(tab.pendingUrl || tab.url).host || tab.url
  } catch {
    return tab.url
  }
}
export function tabIcon(tab: TabState) {
  return tab.kind === 'web'
    ? 'globe'
    : { newtab: 'plus', settings: 'settings', bookmarks: 'star', downloads: 'download', history: 'history' }[
        tab.kind
      ]
}
