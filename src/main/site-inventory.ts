import { randomUUID } from 'node:crypto'
import type { Browser, Host, Tab } from './browser'
import { siteCandidates, type SiteDataRow, type SiteInventory } from '../shared/site-inventory'
import { cookieAppliesToHost } from '../shared/site-data'
import { measureStorage } from './site-storage'

interface Issued {
  version: string
  tab: Tab
  epoch: number
  rows: SiteDataRow[]
}
export class SiteInventoryService {
  private issued = new WeakMap<Host, Issued>()
  private reading = new Set<string>()
  constructor(private browser: Browser) {}
  async request(
    host: Host,
    value: unknown,
  ): Promise<{ inventory?: SiteInventory; cancelled?: boolean; cleared?: boolean }> {
    if (!value || typeof value !== 'object') throw new Error('无效的网站数据请求。')
    const raw = value as {
        action: unknown
        id: unknown
        query?: unknown
        offset?: unknown
        version?: unknown
        rowId?: unknown
      },
      tab = host.tabs.find((t) => t.state.id === raw.id),
      epoch = tab?.epoch
    const valid = () =>
      !!tab &&
      !host.window.isDestroyed() &&
      !host.closing &&
      !host.batchClosing &&
      !tab.closing &&
      tab.hostId === host.id &&
      host.tabs.includes(tab) &&
      host.activeId === tab.state.id &&
      tab.epoch === epoch &&
      tab.state.kind === 'settings'
    if (!valid() || !['list', 'clear'].includes(raw.action as string))
      throw new Error('请在当前设置页管理网站数据。')
    if (raw.action === 'clear') {
      const issued = this.issued.get(host),
        row = issued?.rows.find((r) => r.id === raw.rowId)
      const current = () =>
        valid() &&
        this.issued.get(host) === issued &&
        issued?.tab === tab &&
        issued?.epoch === epoch &&
        issued?.version === raw.version
      if (!row || !current()) throw new Error('网站列表已变化，请刷新后再试。')
      const result = await this.browser.siteData.clearTarget(host, row, current)
      return { cancelled: !!result.cancelled, cleared: !!result.cleared }
    }
    if (raw.query !== undefined && (typeof raw.query !== 'string' || raw.query.length > 200))
      throw new Error('搜索内容过长。')
    if (
      raw.offset !== undefined &&
      (typeof raw.offset !== 'number' || !Number.isSafeInteger(raw.offset) || raw.offset < 0)
    )
      throw new Error('无效的列表页码。')
    if (this.reading.has(host.profile) || this.browser.dataTasks.has(host.profile))
      throw new Error('此会话正在读取或清除数据，请稍后刷新。')
    this.reading.add(host.profile)
    const issued: Issued = { tab: tab!, epoch: epoch!, version: randomUUID(), rows: [] }
    this.issued.set(host, issued)
    try {
      // Values are never copied to the UI, storage, logs or the inventory snapshot.
      const cookies = (await host.session.cookies.get({})).map(({ domain, hostOnly }) => ({
        domain,
        hostOnly,
      }))
      const urls: string[] = []
      for (const owner of this.browser.hosts.values())
        if (owner.session === host.session)
          for (const page of owner.tabs) {
            urls.push(page.state.url)
            const wc = page.view?.webContents
            if (wc && !wc.isDestroyed())
              for (const frame of wc.mainFrame.framesInSubtree) urls.push(frame.url)
          }
      for (const popup of this.browser.popups.values())
        if (popup.profile === host.profile && !popup.window.isDestroyed())
          for (const frame of popup.window.webContents.mainFrame.framesInSubtree) urls.push(frame.url)
      if (!host.private) urls.push(...this.browser.store.data.history.map((v) => v.url))
      urls.push(...this.browser.permissions.list(host.profile).map((v) => v.origin))
      const candidates = siteCandidates(
          urls,
          cookies.map((c) => c.domain),
        ),
        truncated = candidates.length > 4000,
        query = ((raw.query as string) || '').trim().toLowerCase()
      const matching = candidates
          .slice(0, 4000)
          .filter((r) => !query || r.hostname.includes(query) || r.origin?.toLowerCase().includes(query)),
        limit = 40,
        offset = Math.min(
          Math.floor(((raw.offset as number) || 0) / limit) * limit,
          Math.max(0, Math.floor((matching.length - 1) / limit) * limit),
        ),
        rows = matching.slice(offset, offset + limit)
      const results = await measureStorage(
        host.session,
        rows.flatMap((r) => (r.origin ? [r.origin] : [])),
        () => valid() && this.issued.get(host) === issued,
      )
      if (!valid() || this.issued.get(host) !== issued) throw new Error('设置页已变化，请重新读取网站数据。')
      for (const row of rows) {
        row.cookieCount = cookies.filter((cookie) => cookieAppliesToHost(cookie, row.hostname)).length
        if (row.origin) row.storage = results.get(row.origin)
      }
      issued.rows = rows
      return {
        inventory: {
          version: issued.version,
          rows,
          total: matching.length,
          offset,
          limit,
          cookieTotal: cookies.length,
          truncated,
          measuredAt: Date.now(),
        },
      }
    } finally {
      this.reading.delete(host.profile)
    }
  }
}
