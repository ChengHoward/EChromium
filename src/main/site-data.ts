import { dialog } from 'electron'
import type { Browser, Host } from './browser'
import type { SiteDataSummary } from '../shared/model'
import { canonicalOrigin } from '../shared/site-policy'
import { cookieAppliesToHost } from '../shared/site-data'

export class SiteData {
  confirm?: (host: Host, origin: string) => Promise<boolean>
  constructor(private browser: Browser) {}
  private async cookies(host: Host, hostname: string) {
    return (await host.session.cookies.get({})).filter((cookie) => cookieAppliesToHost(cookie, hostname))
  }
  private async inspect(host: Host, origin: string): Promise<SiteDataSummary> {
    const hostname = new URL(origin).hostname,
      cookies = await this.cookies(host, hostname)
    return {
      origin,
      hostname,
      cookieCount: cookies.length,
      cookies: cookies.slice(0, 200).map((cookie) => ({
        name: cookie.name,
        domain: cookie.domain || '',
        path: cookie.path || '/',
        secure: !!cookie.secure,
        httpOnly: !!cookie.httpOnly,
        session: !!cookie.session,
      })),
    }
  }
  async request(host: Host, value: unknown): Promise<SiteDataSummary> {
    if (!value || typeof value !== 'object' || host.window.isDestroyed() || host.closing || host.batchClosing)
      throw new Error('站点数据操作已失效。')
    const raw = value as { action: unknown; id: unknown }
    const tab = host.tabs.find((t) => t.state.id === raw.id),
      origin = canonicalOrigin(tab?.state.settingsOrigin)
    if (
      !tab ||
      tab.hostId !== host.id ||
      tab.state.kind !== 'settings' ||
      !origin ||
      tab.closing ||
      !['inspect', 'clear'].includes(raw.action as string)
    )
      throw new Error('请从网站信息打开该站点的设置。')
    if (raw.action === 'inspect') return this.inspect(host, origin)
    const epoch = tab.epoch
    return this.clearTarget(
      host,
      { origin, hostname: new URL(origin).hostname },
      () =>
        !host.window.isDestroyed() &&
        !host.closing &&
        !host.batchClosing &&
        !tab.closing &&
        tab.hostId === host.id &&
        host.tabs.includes(tab) &&
        host.activeId === tab.state.id &&
        tab.epoch === epoch &&
        tab.state.kind === 'settings' &&
        canonicalOrigin(tab.state.settingsOrigin) === origin,
    )
  }
  async clearTarget(
    host: Host,
    target: { origin?: string; hostname: string },
    valid: () => boolean,
  ): Promise<SiteDataSummary> {
    const { origin, hostname } = target
    if (!valid()) throw new Error('网站数据操作已失效。')
    const inspect = async (): Promise<SiteDataSummary> =>
      origin
        ? this.inspect(host, origin)
        : {
            origin: '',
            hostname,
            cookieCount: (await this.cookies(host, hostname)).length,
            cookies: [],
          }
    const key = host.profile
    if (this.browser.dataTasks.has(key)) throw new Error('此会话正在清除数据，请稍后刷新。')
    this.browser.dataTasks.add(key)
    let started = false
    try {
      const allowed = this.confirm
        ? await this.confirm(host, origin || hostname)
        : (
            await dialog.showMessageBox(host.window, {
              type: 'warning',
              title: '清除网站数据',
              message: `清除 ${origin || hostname} 的${origin ? '网站数据' : ' Cookie'}？`,
              detail: `${origin ? '会移除这个来源的本地存储、数据库、服务工作线程及当前顶层页面的会话存储，以及' : '仅清除'}可用于 ${hostname} 的 Cookie。Cookie 可能跨端口或由域下子站共享，因此这些站点也可能退出登录。${origin ? '其它来源的网页存储' : '网站存储'}、浏览记录、书签和网站权限会保留。网站仍打开时可能重新写入数据。`,
              buttons: ['取消', '清除数据'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            })
          ).response === 1
      if (!allowed || !valid()) return { ...(await inspect()), cancelled: true }
      started = true
      if (origin)
        await host.session.clearStorageData({
          origin,
          storages: ['filesystem', 'indexdb', 'localstorage', 'serviceworkers', 'cachestorage'],
        })
      const cookies = (await this.cookies(host, hostname)).sort(
        (a, b) => (b.path?.length || 1) - (a.path?.length || 1),
      )
      for (const cookie of cookies) {
        const url = new URL(origin || `https://${hostname}`)
        url.protocol = 'https:'
        url.pathname = cookie.path || '/'
        // Always use the selected host, so a parent domain's host-only cookies cannot match.
        await host.session.cookies.remove(url.href, cookie.name)
      }
      const contents = [...this.browser.hosts.values()]
        .filter((h) => h.session === host.session)
        .flatMap((h) => h.tabs.map((t) => t.view?.webContents))
      for (const popup of this.browser.popups.values())
        if (popup.profile === host.profile) contents.push(popup.window.webContents)
      for (const wc of origin ? contents : [])
        if (wc && !wc.isDestroyed() && canonicalOrigin(wc.getURL()) === origin)
          await wc.executeJavaScriptInIsolatedWorld(1002, [
            { code: `if (location.origin === ${JSON.stringify(origin)}) sessionStorage.clear()` },
          ])
      await host.session.cookies.flushStore()
      return { ...(await inspect()), cleared: true }
    } catch (error) {
      if (started)
        throw new Error(
          '部分网站数据可能已清除，请刷新后检查。' + (error instanceof Error ? error.message : String(error)),
        )
      throw error
    } finally {
      this.browser.dataTasks.delete(key)
    }
  }
}
