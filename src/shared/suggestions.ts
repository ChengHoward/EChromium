import type { Bookmark, SearchEngine, TabState, Visit } from './model'
import { inputTarget, isSearchTarget, webTarget } from './navigation'

export interface AddressChoice {
  kind: 'input' | 'tab' | 'bookmark' | 'history'
  title: string
  url: string
  tabId?: string
}
export function addressChoices(
  query: string,
  data: { tabs: TabState[]; activeId: string; bookmarks: Bookmark[]; history: Visit[]; search: SearchEngine },
): AddressChoice[] {
  const text = query.trim(),
    needle = text.toLocaleLowerCase()
  if (text.length > 8192) return []
  const result: AddressChoice[] = [],
    seen = new Set<string>()
  const add = (choice: AddressChoice) => {
    if (!seen.has(choice.url) && (webTarget(choice.url) || choice.url === 'about:blank')) {
      if (choice.kind !== 'input') seen.add(choice.url)
      result.push(choice)
    }
  }
  if (text) {
    try {
      const url = inputTarget(text, data.search)
      const isSearch = isSearchTarget(url, text, data.search)
      add({ kind: 'input', title: isSearch ? `搜索「${text}」` : `访问 ${text}`, url })
    } catch {
      return []
    }
  }
  const matches = (row: { title: string; url: string }) =>
    !needle || `${row.title} ${row.url}`.toLocaleLowerCase().includes(needle)
  for (const tab of data.tabs)
    if (tab.id !== data.activeId && tab.kind === 'web' && matches(tab))
      add({ kind: 'tab', title: tab.title, url: tab.url, tabId: tab.id })
  for (const bookmark of data.bookmarks)
    if (matches(bookmark)) add({ kind: 'bookmark', title: bookmark.title, url: bookmark.url })
  for (const visit of data.history)
    if (matches(visit)) add({ kind: 'history', title: visit.title, url: visit.url })
  return result.slice(0, 8)
}
export const choiceLabel = (choice: AddressChoice) =>
  ({ input: '打开', tab: '切换标签', bookmark: '书签', history: '历史记录' })[choice.kind]
