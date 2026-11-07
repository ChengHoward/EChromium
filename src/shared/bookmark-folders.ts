import type { Bookmark, BookmarkFolder } from './model'
import { bookmarkInput } from './bookmarks'

export const maxFolderDepth = 12
export function folderTitle(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请输入文件夹名称。')
  const title = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 500)
  if (!title) throw new Error('请输入文件夹名称。')
  return title
}
export function folderPath(id: string | undefined, folders: readonly BookmarkFolder[]) {
  const path: BookmarkFolder[] = [],
    seen = new Set<string>()
  while (id) {
    const row = folders.find((f) => f.id === id)
    if (!row || seen.has(id) || path.length >= maxFolderDepth) throw new Error('文件夹位置无效或层级过深。')
    seen.add(id)
    path.unshift(row)
    id = row.parentId
  }
  return path
}
export function folderDestination(value: unknown, folders: readonly BookmarkFolder[]) {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string') throw new Error('无效的文件夹位置。')
  folderPath(value, folders)
  return value
}
export function restoredFolders(value: unknown): BookmarkFolder[] {
  if (!Array.isArray(value)) return []
  const folders: BookmarkFolder[] = [],
    ids = new Set<string>()
  for (const row of value.slice(0, 500)) {
    try {
      if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 100 || ids.has(row.id)) continue
      folders.push({
        id: row.id,
        title: folderTitle(row.title),
        parentId: typeof row.parentId === 'string' ? row.parentId : undefined,
      })
      ids.add(row.id)
    } catch {
      /* Preserve the other valid folders. */
    }
  }
  for (const folder of folders) {
    try {
      folderPath(folder.id, folders)
    } catch {
      folder.parentId = undefined
    }
  }
  return folders
}
export function saveFolder(folders: BookmarkFolder[], id: unknown, value: unknown, makeId: () => string) {
  if (!value || typeof value !== 'object') throw new Error('无效的文件夹。')
  const raw = value as Record<string, unknown>,
    title = folderTitle(raw.title),
    parentId = folderDestination(raw.parentId, folders)
  const existing = typeof id === 'string' ? folders.find((f) => f.id === id) : undefined
  if (id !== undefined && !existing) throw new Error('文件夹已被删除。')
  if (!existing && folders.length >= 500) throw new Error('文件夹已达到 500 个上限。')
  const next = folders.map((f) => ({ ...f })),
    record = existing ? next.find((f) => f.id === id)! : { id: makeId(), title }
  Object.assign(record, { title, parentId })
  if (!existing) next.push(record)
  for (const folder of next) folderPath(folder.id, next)
  return next
}
export interface BookmarkImportNode {
  title: string
  url?: string
  children?: BookmarkImportNode[]
}
export function importBookmarkTree(
  existing: readonly Bookmark[],
  folders: readonly BookmarkFolder[],
  value: unknown,
  makeId: () => string,
  destination?: unknown,
) {
  if (!Array.isArray(value)) throw new Error('无效的书签文件。')
  const root = folderDestination(destination, folders),
    bookmarks = existing.map((b) => ({ ...b })),
    nextFolders = folders.map((f) => ({ ...f }))
  const urls = new Set(existing.map((b) => b.url)),
    seen = new Set<object>()
  let nodes = 0,
    skipped = 0
  function walk(rows: unknown[], parentId: string | undefined) {
    for (const row of rows) {
      if (++nodes > 5000) throw new Error('一次最多导入 5000 个书签与文件夹。')
      if (!row || typeof row !== 'object') {
        skipped++
        continue
      }
      if (seen.has(row)) throw new Error('书签文件包含循环结构。')
      seen.add(row)
      const item = row as BookmarkImportNode
      if (Array.isArray(item.children)) {
        let title: string
        try {
          title = folderTitle(item.title)
        } catch {
          skipped++
          continue
        }
        if (folderPath(parentId, nextFolders).length >= maxFolderDepth)
          throw new Error('导入的文件夹层级超过 12 层。')
        let folder = nextFolders.find((f) => f.parentId === parentId && f.title === title)
        if (!folder) {
          folder = { id: makeId(), title, parentId }
          nextFolders.push(folder)
        }
        if (nextFolders.length > 500) throw new Error('文件夹总数将超过 500 个，未导入。')
        walk(item.children, folder.id)
      } else {
        try {
          const clean = bookmarkInput(item)
          if (urls.has(clean.url)) {
            skipped++
            continue
          }
          bookmarks.push({ id: makeId(), ...clean, folderId: parentId })
          urls.add(clean.url)
        } catch {
          skipped++
        }
        if (bookmarks.length > 2000) throw new Error('书签总数将超过 2000 个，未导入。')
      }
    }
  }
  walk(value, root)
  return {
    bookmarks,
    folders: nextFolders,
    added: bookmarks.length - existing.length,
    addedFolders: nextFolders.length - folders.length,
    skipped,
  }
}
