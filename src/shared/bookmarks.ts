import type { Bookmark, BookmarkFolder } from './model'
import { webTarget } from './navigation'

export function bookmarkInput(value: unknown): Pick<Bookmark, 'title' | 'url'> {
  if (!value || typeof value !== 'object') throw new Error('请输入书签名称和网址。')
  const row = value as Record<string, unknown>
  if (typeof row.url !== 'string' || !webTarget(row.url.trim()) || typeof row.title !== 'string')
    throw new Error('书签网址须为有效的 HTTP 或 HTTPS 地址。')
  const url = new URL(row.url.trim()).href
  const title =
    row.title
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 500) || new URL(url).hostname
  return { title, url }
}
export function exportBookmarks(bookmarks: readonly Bookmark[], folders: readonly BookmarkFolder[] = []) {
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    )
  const seen = new Set<string>()
  const entries = (parentId: string | undefined, depth: number): string => {
    if (depth > 12) return ''
    const parts: string[] = []
    for (const folder of folders.filter((f) => f.parentId === parentId)) {
      if (seen.has(folder.id)) continue
      seen.add(folder.id)
      parts.push(`<DT><H3>${escape(folder.title)}</H3>\n<DL><p>\n${entries(folder.id, depth + 1)}\n</DL><p>`)
    }
    for (const bookmark of bookmarks.filter((b) => b.folderId === parentId && webTarget(b.url)))
      parts.push(`<DT><A HREF="${escape(bookmark.url)}">${escape(bookmark.title)}</A>`)
    return parts.join('\n')
  }
  return (
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>书签</TITLE>\n<H1>EChromium 书签</H1>\n<DL><p>\n' +
    entries(undefined, 0) +
    '\n</DL><p>\n'
  )
}
