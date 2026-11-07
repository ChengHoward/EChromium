import type { Host, Tab } from './browser'
import type { TabPreview } from '../shared/tab-overview'

/** Small session-memory snapshots; no navigation, activation, disk writes or visibility changes. */
export class TabPreviews {
  private images = new WeakMap<Tab, TabPreview>()
  private pending = new WeakMap<Tab, Promise<TabPreview>>()
  private running = 0
  private waiting: (() => void)[] = []
  private async slot() {
    if (this.running >= 2) await new Promise<void>((resolve) => this.waiting.push(resolve))
    else this.running++
  }
  private release() {
    const next = this.waiting.shift()
    if (next) next()
    else this.running--
  }
  async capture(host: Host, tab: Tab, token?: string): Promise<TabPreview> {
    const version = tab.epoch,
      ownerId = host.id,
      wc = tab.view?.webContents
    const fallback: TabPreview = {
      id: tab.state.id,
      version,
      status: tab.state.kind !== 'web' ? 'internal' : !wc ? 'unloaded' : 'unavailable',
    }
    const valid = () =>
      !host.window.isDestroyed() &&
      !host.closing &&
      !host.batchClosing &&
      !tab.closing &&
      tab.hostId === ownerId &&
      host.tabs.includes(tab) &&
      tab.epoch === version &&
      !tab.state.pendingUrl &&
      !tab.state.error &&
      !tab.state.crashed &&
      (token === undefined || host.overview === token)
    if (!valid() || !wc || wc.isDestroyed() || tab.state.kind !== 'web' || tab.state.loading) return fallback
    const cached = this.images.get(tab)
    if (cached?.version === version && Date.now() - (cached.capturedAt || 0) < 10000) return cached
    const existing = this.pending.get(tab)
    if (existing) {
      const result = await existing
      return valid() && result.version === version ? result : fallback
    }
    const task = (async () => {
      await this.slot()
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        if (!valid() || wc.isDestroyed()) return fallback
        const bounds = tab.view!.getBounds()
        if (!bounds.width || !bounds.height) return fallback
        const result = await Promise.race([
          wc.capturePage(
            { x: 0, y: 0, width: Math.min(1600, bounds.width), height: Math.min(1000, bounds.height) },
            { stayHidden: true, stayAwake: false },
          ),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('Preview timed out')), 1800)
          }),
        ])
        if (!valid() || result.isEmpty()) return fallback
        const size = result.getSize(),
          scale = Math.min(1, 400 / size.width, 250 / size.height)
        const bytes = result
          .resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
            quality: 'good',
          })
          .toJPEG(65)
        if (bytes.length > 180000) return fallback
        const preview: TabPreview = {
          id: tab.state.id,
          version,
          status: 'ready',
          image: 'data:image/jpeg;base64,' + bytes.toString('base64'),
          capturedAt: Date.now(),
        }
        this.images.set(tab, preview)
        return preview
      } catch {
        return cached?.version === version && valid() ? cached : fallback
      } finally {
        clearTimeout(timeout)
        this.release()
      }
    })()
    this.pending.set(tab, task)
    try {
      return await task
    } finally {
      if (this.pending.get(tab) === task) this.pending.delete(tab)
    }
  }
  forget(tab: Tab) {
    this.images.delete(tab)
    this.pending.delete(tab)
  }
  async request(host: Host, value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('无效的标签预览请求。')
    const raw = value as { token: unknown; ids: unknown }
    if (
      !host.overview ||
      raw.token !== host.overview ||
      !Array.isArray(raw.ids) ||
      raw.ids.length > 8 ||
      raw.ids.some((id) => typeof id !== 'string')
    )
      throw new Error('标签总览已失效，请重新打开。')
    const token = host.overview,
      ids = [...new Set(raw.ids)]
    const tabs = ids.map((id) => host.tabs.find((tab) => tab.state.id === id))
    if (tabs.some((tab) => !tab || tab.hostId !== host.id)) throw new Error('标签已关闭或移至其它窗口。')
    const result = await Promise.all(tabs.map((tab) => this.capture(host, tab!, token)))
    if (host.overview !== token || host.window.isDestroyed() || host.closing) return []
    return result.filter((preview) =>
      host.tabs.some(
        (tab) => tab.state.id === preview.id && tab.epoch === preview.version && tab.hostId === host.id,
      ),
    )
  }
}
