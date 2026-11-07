import type { Session, WebContents } from 'electron'
import { createHash } from 'node:crypto'
import { FaviconCache, faviconPage } from '../shared/favicon'
import { pageFavicon } from './favicons'
import type { BrowserStore } from './storage'

/** Page mappings and shared icon bitmaps, following Chromium's cache-first lifecycle. */
export class FaviconService {
  readonly normal: FaviconCache
  private sessions = new WeakMap<Session, FaviconCache>()
  private pending = new WeakMap<Session, Map<string, Promise<string | undefined>>>()
  private failures = new WeakMap<Session, Map<string, number>>()
  private generation = 0
  constructor(private store: BrowserStore) {
    this.normal = new FaviconCache(store.data.favicons)
  }
  cache(session: Session, persistent: boolean) {
    if (persistent) return this.normal
    let cache = this.sessions.get(session)
    if (!cache) {
      cache = new FaviconCache()
      this.sessions.set(session, cache)
    }
    return cache
  }
  save() {
    this.store.data.favicons = this.normal.records
    this.store.saveSoon()
  }
  release(session: Session) {
    this.sessions.delete(session)
    this.pending.delete(session)
    this.failures.delete(session)
  }
  forgetHistory(urls: Set<string>, retainedUrls = new Set<string>()) {
    const bookmarks = new Set(this.store.data.bookmarks.map((b) => faviconPage(b.url)))
    const removed = new Set([...urls].map(faviconPage))
    const retained = new Set([...retainedUrls].map(faviconPage))
    this.generation++
    this.normal.retainPages((url) => !removed.has(url) || bookmarks.has(url) || retained.has(url))
    this.save()
  }
  async update(
    wc: WebContents,
    page: string,
    candidates: string[],
    persistent: boolean,
    valid: () => boolean,
    force = false,
  ) {
    const cache = this.cache(wc.session, persistent),
      generation = this.generation
    const alive = () => !wc.isDestroyed() && valid() && (!persistent || generation === this.generation)
    const unique = [...new Set(candidates)].filter((value) => typeof value === 'string').slice(0, 4)
    if (!unique.length) {
      if (alive()) {
        cache.unlink(page)
        if (persistent) this.save()
      }
      return
    }
    let pending = this.pending.get(wc.session)
    if (!pending) {
      pending = new Map()
      this.pending.set(wc.session, pending)
    }
    let failures = this.failures.get(wc.session)
    if (!failures) {
      failures = new Map()
      this.failures.set(wc.session, failures)
    }
    for (const candidate of unique) {
      if (!alive()) return
      const key = candidate.startsWith('data:image/')
        ? 'data:sha256:' + createHash('sha256').update(candidate).digest('hex')
        : faviconPage(candidate)
      if (!key || key.length > 8192) continue
      const cached = cache.icon(key)
      if (!force && cached && cache.fresh(cached)) {
        cache.link(page, key)
        if (persistent) this.save()
        return cached.data
      }
      if (!force && Date.now() - (failures.get(key) || 0) < 60000) continue
      let request = pending.get(key)
      if (!request) {
        const abort = new AbortController(),
          timer = setTimeout(() => abort.abort(), 5000)
        request = pageFavicon(wc, [candidate], abort.signal).finally(() => {
          clearTimeout(timer)
          pending!.delete(key)
        })
        pending.set(key, request)
      }
      const data = await request
      if (!alive()) return
      if (data) {
        cache.set(page, key, data)
        failures.delete(key)
        if (persistent) this.save()
        return data
      }
      if (failures.size >= 256) failures.delete(failures.keys().next().value!)
      failures.set(key, Date.now())
    }
    // Keep a stale bitmap when offline; never replace it with a failed response.
    return cache.page(page)?.data
  }
}
