import { dialog } from 'electron'
import type { Browser, Host } from './browser'
import {
  dataOptions,
  dataInterval,
  dataRanges,
  withinInterval,
  type DataOptions,
  type DataSummary,
} from '../shared/browsing-data'

export class BrowsingData {
  confirm?: (host: Host, options: DataOptions, counts: DataSummary) => Promise<boolean>
  constructor(private browser: Browser) {}
  async request(host: Host, value: unknown): Promise<DataSummary> {
    if (!value || typeof value !== 'object') throw new Error('无效的数据操作。')
    const raw = value as { action: unknown; id: unknown; options: unknown },
      tab = host.tabs.find((t) => t.state.id === raw.id),
      options = dataOptions(raw.options)
    const epoch = tab?.epoch
    const valid = () =>
      tab &&
      !host.window.isDestroyed() &&
      !host.closing &&
      !host.batchClosing &&
      !tab.closing &&
      tab.hostId === host.id &&
      host.tabs.includes(tab) &&
      host.activeId === tab.state.id &&
      tab.epoch === epoch &&
      tab.state.kind === 'settings'
    if (!valid() || !['preview', 'clear'].includes(raw.action as string))
      throw new Error('请在当前设置页清除浏览数据。')
    if (host.private && options.history) throw new Error('隐私窗口不保存浏览历史。')
    // Freeze the end time before confirmation: visits/downloads created while it is open survive.
    const interval = dataInterval(options.range),
      counts = (): DataSummary => ({
        history: options.history
          ? this.browser.store.data.history.filter((v) => withinInterval(v.at, interval)).length
          : 0,
        downloads: options.downloads
          ? this.browser.downloads
              .list(host.profile)
              .filter((v) => !v.active && withinInterval(v.at, interval)).length
          : 0,
      })
    if (raw.action === 'preview') return counts()
    const locks = this.browser.dataTasks
    if (locks.has(host.profile)) throw new Error('此会话正在清除数据，请稍后再试。')
    locks.add(host.profile)
    let started = false
    try {
      const count = counts(),
        names = [
          options.history && `${count.history} 条历史记录`,
          options.downloads && `${count.downloads} 条已结束下载记录`,
          options.siteData && '全部 Cookie 和网站存储',
          options.cache && '全部网页缓存',
        ]
          .filter(Boolean)
          .join('、')
      const allowed = this.confirm
        ? await this.confirm(host, options, count)
        : (
            await dialog.showMessageBox(host.window, {
              type: 'warning',
              title: '清除浏览数据',
              message: `清除${host.private ? '此隐私会话' : '普通窗口'}的浏览数据？`,
              detail: `${dataRanges[options.range]}：${names}。${options.siteData ? '所有网站可能退出登录；仍打开的网站可能重新写入数据。' : ''}书签、网站权限、已下载文件和进行中的下载会保留。`,
              buttons: ['取消', '清除数据'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            })
          ).response === 1
      if (!allowed || !valid()) return { ...counts(), cancelled: true }
      started = true
      if (options.siteData) {
        await host.session.clearStorageData({
          storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'serviceworkers', 'cachestorage'],
        })
        const contents = [...this.browser.hosts.values()]
          .filter((h) => h.session === host.session)
          .flatMap((h) => h.tabs.map((t) => t.view?.webContents))
        for (const popup of this.browser.popups.values())
          if (popup.profile === host.profile) contents.push(popup.window.webContents)
        for (const wc of contents)
          if (wc && !wc.isDestroyed() && /^https?:/.test(wc.getURL()))
            await wc.executeJavaScriptInIsolatedWorld(1002, [{ code: 'sessionStorage.clear()' }])
        await host.session.cookies.flushStore()
      }
      if (options.cache) await host.session.clearCache()
      const removed = counts()
      if (options.history)
        this.browser.favicons.forgetHistory(
          new Set(
            this.browser.store.data.history.filter((v) => withinInterval(v.at, interval)).map((v) => v.url),
          ),
          new Set(
            this.browser.store.data.history.filter((v) => !withinInterval(v.at, interval)).map((v) => v.url),
          ),
        )
      if (options.history)
        this.browser.store.data.history = this.browser.store.data.history.filter(
          (v) => !withinInterval(v.at, interval),
        )
      if (options.downloads) removed.downloads = this.browser.downloads.clearRange(host.profile, interval)
      this.browser.store.saveSoon()
      this.browser.publish()
      return { ...removed, cleared: true }
    } catch (error) {
      if (started) throw new Error('部分数据可能已清除，请刷新后检查。' + String(error))
      throw error
    } finally {
      locks.delete(host.profile)
    }
  }
}
