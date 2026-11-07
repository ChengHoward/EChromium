import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { defaults, preferencesPatch } from '../shared/appearance'
import { webTarget } from '../shared/navigation'
import type { Bookmark, BookmarkFolder, Preferences, Visit, DownloadState, SiteRule } from '../shared/model'
import { restoredFolders, folderDestination, saveFolder } from '../shared/bookmark-folders'
import { restoredDownloads } from '../shared/download-records'
import { siteRule } from '../shared/site-policy'
import { bookmarkInput } from '../shared/bookmarks'
import { restoredSession, type WindowSession } from '../shared/window-session'

interface StoredData {
  version: 1
  preferences: Preferences
  bookmarks: Bookmark[]
  bookmarkFolders: BookmarkFolder[]
  history: Visit[]
  tabs: string[]
  session?: WindowSession
  downloads: DownloadState[]
  permissions: SiteRule[]
}
export class BrowserStore {
  readonly file: string
  data: StoredData = {
    version: 1,
    preferences: { ...defaults },
    bookmarks: [],
    bookmarkFolders: [],
    history: [],
    tabs: [],
    downloads: [],
    permissions: [],
  }
  private timer?: ReturnType<typeof setTimeout>
  constructor(directory: string) {
    fs.mkdirSync(directory, { recursive: true })
    this.file = path.join(directory, 'browser-v1.json')
    if (!fs.existsSync(this.file)) return
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (raw.version !== 1) throw new Error('Unsupported browser data version')
      this.data.preferences = { ...defaults, ...preferencesPatch(raw.preferences) }
      this.data.bookmarkFolders = restoredFolders(raw.bookmarkFolders)
      const ids = new Set<string>(),
        urls = new Set<string>()
      for (const b of (Array.isArray(raw.bookmarks) ? raw.bookmarks : []).slice(0, 2000)) {
        try {
          const clean = bookmarkInput(b)
          if (typeof b.id !== 'string' || !b.id || b.id.length > 100 || ids.has(b.id) || urls.has(clean.url))
            continue
          const folderId = this.data.bookmarkFolders.some((f) => f.id === b.folderId) ? b.folderId : undefined
          this.data.bookmarks.push({ id: b.id, ...clean, folderId })
          ids.add(b.id)
          urls.add(clean.url)
        } catch {
          /* Keep the other valid bookmarks. */
        }
      }
      this.data.history = (Array.isArray(raw.history) ? raw.history : [])
        .filter((v: Visit) => v && typeof v.title === 'string' && Number.isFinite(v.at) && webTarget(v.url))
        .slice(0, 2000)
      this.data.tabs = (Array.isArray(raw.tabs) ? raw.tabs : []).filter(webTarget).slice(0, 50)
      this.data.session = restoredSession(raw.session)
      this.data.downloads = restoredDownloads(raw.downloads)
      for (const value of (Array.isArray(raw.permissions) ? raw.permissions : []).slice(0, 2000)) {
        try {
          const rule = siteRule(value)
          this.data.permissions = this.data.permissions.filter(
            (r) => r.origin !== rule.origin || r.capability !== rule.capability,
          )
          this.data.permissions.push(rule)
        } catch {
          /* Ignore malformed individual rules without discarding bookmarks. */
        }
      }
    } catch (error) {
      // Preserve unreadable data instead of silently replacing it.
      fs.copyFileSync(this.file, `${this.file}.unreadable-${Date.now()}`)
      console.error('Browser data could not be loaded; preserved a recovery copy.', error)
    }
  }
  visit(url: string, title: string) {
    if (!webTarget(url)) return
    this.data.history = [
      { url, title: title.slice(0, 500), at: Date.now() },
      ...this.data.history.filter((v) => v.url !== url),
    ].slice(0, 2000)
    this.saveSoon()
  }
  toggleBookmark(url: string, title: string) {
    if (!webTarget(url)) throw new Error('此页面无法添加书签。')
    const old = this.data.bookmarks.find((b) => b.url === url)
    if (old) this.data.bookmarks = this.data.bookmarks.filter((b) => b.id !== old.id)
    else this.saveBookmark(undefined, { url, title })
    this.saveSoon()
  }
  saveBookmark(id: unknown, value: unknown) {
    const clean = bookmarkInput(value)
    const existing = typeof id === 'string' ? this.data.bookmarks.find((b) => b.id === id) : undefined
    const raw = value as Record<string, unknown>
    const folderId = folderDestination(
      raw.folderId === undefined ? existing?.folderId : raw.folderId,
      this.data.bookmarkFolders,
    )
    if (id !== undefined && !existing) throw new Error('这个书签已被删除。')
    if (this.data.bookmarks.some((b) => b.url === clean.url && b.id !== id))
      throw new Error('这个网址已在书签中。')
    if (existing) Object.assign(existing, clean, { folderId })
    else {
      if (this.data.bookmarks.length >= 2000) throw new Error('书签已达到 2000 个上限。')
      this.data.bookmarks.push({ id: randomUUID(), ...clean, folderId })
    }
    this.saveSoon()
  }
  saveFolder(id: unknown, value: unknown) {
    this.data.bookmarkFolders = saveFolder(this.data.bookmarkFolders, id, value, randomUUID)
    this.saveSoon()
  }
  removeFolder(id: unknown) {
    const folder = this.data.bookmarkFolders.find((f) => f.id === id)
    if (!folder) throw new Error('文件夹已被删除。')
    this.data.bookmarkFolders = this.data.bookmarkFolders
      .filter((f) => f !== folder)
      .map((f) => (f.parentId === id ? { ...f, parentId: folder.parentId } : f))
    this.data.bookmarks = this.data.bookmarks.map((b) =>
      b.folderId === id ? { ...b, folderId: folder.parentId } : b,
    )
    this.saveSoon()
  }
  saveSoon() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      try {
        this.flush()
      } catch (e) {
        console.error('Saving browser data failed.', e)
      }
    }, 300)
  }
  flush() {
    clearTimeout(this.timer)
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temp, JSON.stringify(this.data), 'utf8')
      fs.renameSync(temp, this.file)
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp)
    }
  }
}
