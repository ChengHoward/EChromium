import { openBrowserMenu } from './menus'
import { routeShortcut } from './shortcuts'
import { installPopup } from './popups'
import { AddressSuggestions } from './address-suggestions'
import { transferTab } from './tab-transfer'
import { SiteData } from './site-data'
import { PopupPolicy } from '../shared/popup-policy'
import { PageDialogs } from './page-dialogs'
import { PageFind } from './page-find'
import { BrowsingData } from './browsing-data'
import { SiteInventoryService } from './site-inventory'
import { TabPreviews } from './tab-previews'
import { FaviconService } from './favicon-service'
import { tabLayout } from '../shared/tab-layout'
import {
  restoredSession,
  sessionTab,
  visibleWindowBounds,
  type SessionWindow,
} from '../shared/window-session'
import {
  BrowserWindow,
  WebContentsView,
  Menu,
  dialog,
  nativeTheme,
  session,
  clipboard,
  screen,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
  type MenuItemConstructorOptions,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { BrowserStore } from './storage'
import { Downloads } from './downloads'
import { SitePermissions, type PermissionPrompt } from './permissions'
import { canonicalOrigin, capabilityNames } from '../shared/site-policy'
import { closeTargets } from '../shared/tab-operations'
import { exportBookmarks } from '../shared/bookmarks'
import { importBookmarkTree } from '../shared/bookmark-folders'
import { openFolderMenu } from './menus'
import { applyMaterial, updateMaterial } from './material'
import { preferencesPatch } from '../shared/appearance'
import { inputTarget, nextTab, safeBounds, safeOrigin, webTarget } from '../shared/navigation'
import type { BrowserRequest, BrowserState, TabState, UiEvent } from '../shared/model'

export type Tab = {
  faviconBypassCache?: boolean
  state: TabState
  view?: WebContentsView
  hostId: string
  epoch: number
  permissionEpoch: number
  pendingZoom?: number
  viewRadius?: number
  closeResult?: (ok: boolean) => void
  closing?: Promise<boolean>
  closedSnapshot?: ClosedTab
}
interface ClosedTab {
  state: TabState
  index: number
  entries?: Electron.NavigationEntry[]
  historyIndex?: number
}
export type Host = {
  id: string
  window: BrowserWindow
  tabs: Tab[]
  activeId: string
  private: boolean
  profile: string
  session: Session
  closing: boolean
  batchClosing: boolean
  bounds: Electron.Rectangle
  appearance: ReturnType<typeof applyMaterial>
  htmlFullscreen: boolean
  overview?: string
  closingSession?: SessionWindow
}

/** Page identity and ownership stay in the main process. Inspired by Navora Host/Tabs. */
export class Browser {
  hosts = new Map<string, Host>()
  popups = new Map<
    number,
    { window: BrowserWindow; profile: string; hostId: string; sourceId: number; rootId: number }
  >()
  readonly downloads: Downloads
  readonly permissions: SitePermissions
  readonly suggestions: AddressSuggestions
  readonly siteData: SiteData
  readonly siteInventory: SiteInventoryService
  readonly previews: TabPreviews
  readonly favicons: FaviconService
  readonly popupPolicy = new PopupPolicy()
  readonly dialogs: PageDialogs
  readonly find: PageFind
  readonly browsingData: BrowsingData
  readonly dataTasks = new Set<string>()
  private restoring = false
  private exiting = false
  private publishTimer?: ReturnType<typeof setTimeout>
  permissionPrompt?: PermissionPrompt
  private closedTabs = new Map<string, ClosedTab[]>()
  private revision = 0
  private sessions = new Map<string, Session>()
  private rendererFile = path.resolve(__dirname, 'renderer/index.html')
  private devUrl = process.env.ECHROMIUM_RENDERER_URL
  confirmLeave?: (wc: WebContents) => boolean
  bookmarkExportDestination?: (host: Host) => Promise<string | undefined>

  constructor(readonly store: BrowserStore) {
    this.favicons = new FaviconService(store)
    this.downloads = new Downloads(store, () => this.publish())
    this.suggestions = new AddressSuggestions(this)
    this.siteData = new SiteData(this)
    this.siteInventory = new SiteInventoryService(this)
    this.previews = new TabPreviews()
    this.dialogs = new PageDialogs(this)
    this.find = new PageFind(this)
    this.browsingData = new BrowsingData(this)
    this.permissions = new SitePermissions(
      store,
      (wc) => {
        const tab = this.findTab(wc),
          host = tab && this.hosts.get(tab.hostId)
        const origin = !wc.isDestroyed() && canonicalOrigin(wc.getURL())
        if (!tab || !host || !origin) return
        const epoch = tab.permissionEpoch
        return {
          profile: host.profile,
          token: `${wc.id}:${epoch}:${host.id}`,
          origin,
          valid: () =>
            !wc.isDestroyed() &&
            tab.permissionEpoch === epoch &&
            tab.hostId === host.id &&
            !tab.closing &&
            !host.closing &&
            !host.window.isDestroyed() &&
            host.activeId === tab.state.id &&
            !host.overview &&
            host.window.isFocused() &&
            canonicalOrigin(wc.getURL()) === origin,
        }
      },
      async (wc, origin, capabilities) => {
        if (this.permissionPrompt) return this.permissionPrompt(wc, origin, capabilities)
        const host = this.hosts.get(this.findTab(wc)!.hostId)!
        const result = await dialog.showMessageBox(host.window, {
          type: 'question',
          title: '网站权限',
          message: `${origin} 请求使用${capabilities.map((c) => capabilityNames[c]).join('、')}`,
          detail: host.private
            ? '此隐私会话的选择不会保存到普通窗口。'
            : '可在设置 → 网站权限中更改。允许本页会在离开此页面后失效。',
          buttons: ['暂不允许', '允许本页', '始终允许', '始终阻止'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        return (['dismiss', 'once', 'allow', 'block'] as const)[result.response] || 'dismiss'
      },
      () => this.publish(),
    )
    if (this.devUrl && !/^http:\/\/127\.0\.0\.1:5188\/$/.test(this.devUrl))
      throw new Error('Untrusted renderer development URL')
    nativeTheme.on('updated', () => {
      void this.refreshAppearance().catch(console.error)
    })
  }
  private async refreshAppearance() {
    await Promise.all(
      [...this.hosts.values()].map((host) =>
        updateMaterial(
          host.window,
          () => this.store.data.preferences,
          (appearance) => {
            host.appearance = appearance
            this.find.reposition(host)
            this.suggestions.refresh(host)
            this.dialogs.refresh(host)
            this.publish()
          },
        ),
      ),
    )
  }
  private getSession(profile: string) {
    const existing = this.sessions.get(profile)
    if (existing) return existing
    const current = session.fromPartition(profile === 'default' ? 'persist:echromium-default-v1' : profile)
    this.permissions.register(current)
    this.downloads.register(current, profile)
    this.sessions.set(profile, current)
    return current
  }
  restoreWindows() {
    const data = this.store.data.preferences.restore ? this.store.data.session : undefined
    const legacy = !data && this.store.data.preferences.restore ? [...this.store.data.tabs] : []
    this.restoring = true
    const hosts: Host[] = []
    try {
      if (data?.windows.length) for (const saved of data.windows) hosts.push(this.createWindow({ saved }))
      else {
        const host = this.createWindow({ empty: true })
        hosts.push(host)
        for (const url of legacy) this.newTab(host, 'web', url, false)
        if (!host.tabs.length) this.newTab(host)
        else this.activate(host, host.tabs[0].state.id)
      }
    } finally {
      this.restoring = false
    }
    this.saveSession()
    return hosts
  }
  createWindow(
    options: { private?: boolean; profile?: string; empty?: boolean; saved?: SessionWindow } = {},
  ) {
    const privateMode = !!options.private,
      profile = options.profile || (privateMode ? `private:${randomUUID()}` : 'default')
    const saved = !privateMode ? options.saved : undefined
    const placement =
      saved &&
      visibleWindowBounds(
        saved.bounds,
        [
          screen.getPrimaryDisplay(),
          ...screen.getAllDisplays().filter((d) => d.id !== screen.getPrimaryDisplay().id),
        ].map((d) => d.workArea),
      )
    const window = new BrowserWindow({
      title: 'EChromium',
      width: 1240,
      height: 820,
      ...placement,
      minWidth: 650,
      minHeight: 460,
      show: false,
      backgroundColor: '#DCE8F2',
      frame: true,
      ...(process.platform === 'win32'
        ? {
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: { color: '#DCE8F2', symbolColor: '#263C50', height: tabLayout.stripHeight },
          }
        : process.platform === 'darwin'
          ? { titleBarStyle: 'hiddenInset' as const }
          : {}),
      webPreferences: {
        preload: path.resolve(__dirname, 'preload.cjs'),
        partition: `shell:${randomUUID()}`,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: false,
      },
    })
    const host: Host = {
      id: randomUUID(),
      window,
      tabs: [],
      activeId: '',
      private: privateMode,
      profile,
      session: this.getSession(profile),
      closing: false,
      batchClosing: false,
      bounds: { x: 0, y: 112, width: 1240, height: 708 },
      appearance: applyMaterial(window, this.store.data.preferences),
      htmlFullscreen: false,
    }
    // Constructor dimensions can include an extra native frame adjustment; apply saved outer bounds afterward.
    if (placement) window.setBounds(placement)
    this.hosts.set(host.id, host)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    if (process.platform === 'win32') {
      // Owned native editors share their owner's menu accelerators; WebContents key handlers cannot see those keys.
      const runFind = (step?: boolean) => {
        try {
          if (step === undefined) this.find.open(host)
          else this.find.step(host, step)
        } catch (error) {
          this.ui(host, { type: 'notice', text: String(error) })
        }
      }
      window.setMenu(
        Menu.buildFromTemplate([
          {
            label: '页面',
            submenu: [
              { label: '页内查找', accelerator: 'CmdOrCtrl+F', click: () => runFind() },
              { label: '下一个匹配项', accelerator: 'F3', click: () => runFind(true) },
              { label: '上一个匹配项', accelerator: 'Shift+F3', click: () => runFind(false) },
            ],
          },
        ]),
      )
      window.setMenuBarVisibility(false)
    }
    window.webContents.on('will-navigate', (event, url) => {
      if (!this.trustedUrl(url)) event.preventDefault()
    })
    window.webContents.on('will-redirect', (event) => event.preventDefault())
    window.webContents.on('before-input-event', (event, input) => routeShortcut(this, host, event, input))
    window.webContents.on('did-finish-load', () => {
      window.webContents.setZoomFactor(1)
      this.publish()
    })
    window.on('resize', () => {
      this.layout(host)
      if (!host.private) this.saveSession()
    })
    const savePlacement = () => {
      if (!host.private) this.saveSession()
    }
    window.on('move', savePlacement)
    window.on('move', () => this.find.reposition(host))
    window.on('focus', () => this.find.reposition(host))
    window.on('restore', () => setImmediate(() => this.find.reposition(host)))
    window.on('maximize', savePlacement)
    window.on('unmaximize', savePlacement)
    window.on('blur', () => this.suggestions.hide(host, true))
    window.on('enter-full-screen', () => this.publish())
    window.on('leave-full-screen', () => {
      host.htmlFullscreen = false
      this.layout(host)
      this.publish()
    })
    window.once('show', () => {
      // Reassert Acrylic once the hidden construction-time HWND is presented (Navora).
      host.appearance = applyMaterial(window, this.store.data.preferences, true)
      this.publish()
    })
    window.once('ready-to-show', () => {
      host.appearance = applyMaterial(window, this.store.data.preferences)
      if (!process.env.ECHROMIUM_SMOKE) window.show()
    })
    window.on('close', (event) => {
      event.preventDefault()
      void this.closeWindow(host)
    })
    window.on('closed', () => {
      this.dialogs.cancelHost(host)
      this.find.close(host, false)
      this.suggestions.destroy(host)
      for (const tab of [...host.tabs]) {
        const content = tab.view?.webContents
        if (content && !content.isDestroyed()) content.close({ waitForBeforeUnload: false })
      }
      this.hosts.delete(host.id)
      if (!host.private) this.saveSession()
      if (host.private && ![...this.hosts.values()].some((h) => h.profile === profile)) {
        this.downloads.release(profile)
        this.permissions.release(profile)
        this.closedTabs.delete(profile)
        this.sessions.delete(profile)
        this.favicons.release(host.session)
        for (const popup of this.popups.values()) if (popup.profile === profile) popup.window.destroy()
        void host.session.clearStorageData().catch(console.error)
      }
    })
    if (!options.empty) {
      for (const record of saved?.tabs || []) {
        const tab = this.newTab(host, record.kind, record.url, false)
        Object.assign(tab.state, record)
        if (record.kind === 'web') tab.pendingZoom = record.zoom
      }
      if (!host.tabs.length) this.newTab(host)
      else this.activate(host, host.tabs[saved?.activeIndex || 0]?.state.id || host.tabs[0].state.id)
    }
    if (saved?.maximized) window.maximize()
    void (this.devUrl ? window.loadURL(this.devUrl) : window.loadFile(this.rendererFile))
    return host
  }
  trustedUrl(url: string) {
    try {
      const target = new URL(url)
      target.hash = ''
      return target.href === (this.devUrl || pathToFileURL(this.rendererFile).href)
    } catch {
      return false
    }
  }
  sender(event: IpcMainInvokeEvent) {
    const host = [...this.hosts.values()].find((h) => h.window.webContents === event.sender)
    if (!host || event.senderFrame !== event.sender.mainFrame || !this.trustedUrl(event.senderFrame.url))
      throw new Error('Untrusted browser interface')
    return host
  }
  findTab(wc: WebContents) {
    for (const host of this.hosts.values()) {
      const tab = host.tabs.find((t) => t.view?.webContents === wc)
      if (tab) return tab
    }
  }
  active(host: Host) {
    return host.tabs.find((t) => t.state.id === host.activeId)
  }
  openSiteSettings(host: Host, origin: string) {
    if (canonicalOrigin(origin) !== origin || host.closing || host.batchClosing)
      throw new Error('网站来源已失效。')
    const settings = this.newTab(host, 'settings')
    settings.state.settingsOrigin = origin
    this.publish()
    return settings
  }
  private target(host: Host, id?: string) {
    const tab = id ? host.tabs.find((t) => t.state.id === id) : this.active(host)
    if (!tab || tab.hostId !== host.id) throw new Error('标签页已关闭或移动。')
    return tab
  }
  snapshot(host: Host): BrowserState {
    return {
      revision: this.revision,
      windowId: host.id,
      private: host.private,
      tabs: host.tabs.map((t) => {
        const content = t.view?.webContents
        const live = content && !content.isDestroyed()
        return {
          ...t.state,
          favicon:
            t.state.kind === 'web'
              ? this.favicons
                  .cache(host.session, !host.private && host.profile === 'default')
                  .page(t.state.url)?.data || t.state.favicon
              : undefined,
          previewVersion: t.epoch,
          popupStatus: live ? this.popupPolicy.status(content.id, t.permissionEpoch) : undefined,
          dialogStatus: live ? this.dialogs.status(content.id, t.permissionEpoch) : undefined,
        }
      }),
      activeId: host.activeId,
      overview: host.overview,
      preferences: { ...this.store.data.preferences },
      palette: host.appearance.colors,
      dark: host.appearance.dark,
      material: host.appearance.material,
      bookmarks: this.store.data.bookmarks.map((b) => ({
        ...b,
        favicon: this.favicons.normal.page(b.url)?.data,
      })),
      bookmarkFolders: this.store.data.bookmarkFolders.map((f) => ({ ...f })),
      history: host.private ? [] : this.store.data.history.slice(0, 150),
      downloads: this.downloads.list(host.profile),
      permissions: this.permissions.list(host.profile),
      canReopen: !!this.closedTabs.get(host.profile)?.length,
      nativeSuggestions: this.suggestions.supported(host),
      runtime: {
        electron: process.versions.electron || '',
        chrome: process.versions.chrome || '',
        node: process.versions.node,
      },
      fullscreen: host.window.isFullScreen(),
    }
  }
  publish() {
    this.revision++
    for (const host of this.hosts.values())
      if (!host.window.isDestroyed() && !host.window.webContents.isDestroyed())
        host.window.webContents.send('browser:state', this.snapshot(host))
  }
  publishSoon() {
    if (this.publishTimer) return
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined
      this.publish()
    }, 150)
    this.publishTimer.unref()
  }
  ui(host: Host, value: UiEvent) {
    if (!host.window.isDestroyed()) host.window.webContents.send('browser:ui', value)
  }
  private captureWindow(host: Host): SessionWindow {
    const rows = host.tabs
      .map((t) => ({ tab: sessionTab(t.state), id: t.state.id }))
      .filter((row): row is { tab: NonNullable<ReturnType<typeof sessionTab>>; id: string } => !!row.tab)
    return {
      bounds: host.window.getNormalBounds(),
      maximized: host.window.isMaximized(),
      activeIndex: Math.max(
        0,
        rows.findIndex((row) => row.id === host.activeId),
      ),
      tabs: rows.map((row) => row.tab),
    }
  }
  saveSession() {
    if (this.restoring || this.exiting) return
    const normal = [...this.hosts.values()].filter(
      (h) => !h.private && h.profile === 'default' && !h.window.isDestroyed() && h.tabs.length,
    )
    // Closing the final regular window keeps its last complete snapshot, even if private windows remain.
    if (!normal.length) return
    const data = restoredSession({
      version: 1,
      windows: normal.map((h) => h.closingSession || this.captureWindow(h)),
    })
    if (!data) return
    this.store.data.session = data
    this.store.data.tabs = normal
      .flatMap((h) =>
        h.tabs
          .filter((t) => t.state.kind === 'web')
          .map((t) => t.state.url)
          .filter(webTarget),
      )
      .slice(0, 50)
    this.store.saveSoon()
  }
  flushForExit() {
    this.saveSession()
    this.store.flush()
    // Explicit process exit also tears down native windows; closed callbacks must not shrink this snapshot.
    this.exiting = true
  }
  newTab(host: Host, kind: TabState['kind'] = 'newtab', url = '', activate = true) {
    if (host.closing || host.tabs.length >= 100) throw new Error('此窗口标签页已达到上限。')
    const tab: Tab = {
      hostId: host.id,
      epoch: 0,
      permissionEpoch: 0,
      state: {
        id: randomUUID(),
        kind,
        title: {
          newtab: '新标签页',
          web: '正在打开…',
          settings: '设置',
          downloads: '下载',
          history: '历史记录',
          bookmarks: '书签',
        }[kind],
        url,
        loading: false,
        pinned: false,
        muted: false,
        audible: false,
        canGoBack: false,
        canGoForward: false,
        zoom: 1,
        crashed: false,
      },
    }
    host.tabs.push(tab)
    if (activate) this.activate(host, tab.state.id)
    this.publish()
    this.saveSession()
    return tab
  }
  setOverview(host: Host, open: boolean, resume = true) {
    if (open === !!host.overview) return
    this.suggestions.hide(host, true)
    this.find.close(host, false)
    this.dialogs.cancelHost(host)
    if (open) {
      const current = this.active(host)
      if (current) void this.previews.capture(host, current)
      host.overview = randomUUID()
      if (host.htmlFullscreen) {
        host.htmlFullscreen = false
        host.window.setFullScreen(false)
      }
      for (const tab of host.tabs) tab.view?.setVisible(false)
      host.window.webContents.focus()
    } else {
      host.overview = undefined
      const tab = this.active(host)
      if (resume) {
        if (tab?.state.kind === 'web' && !tab.view) {
          this.attachView(host, tab)
          this.load(tab, tab.state.url)
        }
        this.layout(host)
        if (tab?.view && !tab.state.error && !tab.state.crashed) tab.view.webContents.focus()
        else host.window.webContents.focus()
      }
    }
    if (open || resume) this.publish()
  }
  activate(host: Host, id: string, preserveOverview = false) {
    this.suggestions.hide(host, true)
    this.target(host, id)
    if (host.overview && !preserveOverview) this.setOverview(host, false, false)
    const previous = this.active(host)
    if (previous?.view && previous.state.id !== id && !host.overview && host.window.isVisible())
      void this.previews.capture(host, previous)
    if (previous?.state.id !== id) this.dialogs.cancelHost(host)
    if (previous?.state.id !== id) this.find.close(host, false)
    previous?.view?.setVisible(false)
    if (host.htmlFullscreen) {
      host.htmlFullscreen = false
      host.window.setFullScreen(false)
    }
    host.activeId = id
    const tab = this.active(host)!
    if (tab.state.kind === 'web' && !tab.view && !host.overview) {
      this.attachView(host, tab)
      this.load(tab, tab.state.url)
    }
    this.layout(host)
    host.window.setTitle(`${tab.state.title} — EChromium${host.private ? ' · 隐私窗口' : ''}`)
    if (tab.view && !tab.state.error && !host.overview) tab.view.webContents.focus()
    else host.window.webContents.focus()
    this.publish()
    this.saveSession()
  }
  layout(host: Host) {
    if (host.window.isDestroyed()) return
    const size = host.window.getContentSize(),
      tab = this.active(host)
    if (!tab?.view) return
    const bounds = host.htmlFullscreen
      ? { x: 0, y: 0, width: size[0], height: size[1] }
      : safeBounds(host.bounds, size)
    tab.view.setBounds(bounds)
    const radius = host.htmlFullscreen ? 0 : 10
    if (tab.viewRadius !== radius && typeof tab.view.setBorderRadius === 'function') {
      tab.view.setBorderRadius(radius)
      tab.viewRadius = radius
    }
    tab.view.setVisible(
      !host.overview && !tab.state.error && !tab.state.crashed && bounds.width > 0 && bounds.height > 0,
    )
    this.find.reposition(host)
  }
  adoptTab(host: Host, source: Tab, content: WebContents, url: string, background: boolean) {
    const tab = this.newTab(host, 'web', url, false)
    try {
      this.attachView(host, tab, content)
      host.tabs.splice(host.tabs.indexOf(tab), 1)
      const index = Math.max(host.tabs.indexOf(source) + 1, host.tabs.filter((t) => t.state.pinned).length)
      host.tabs.splice(index, 0, tab)
      if (!background) this.activate(host, tab.state.id)
      else {
        this.publish()
        this.saveSession()
      }
      return content
    } catch (error) {
      host.tabs = host.tabs.filter((t) => t !== tab)
      this.publish()
      this.saveSession()
      throw error
    }
  }
  private attachView(host: Host, tab: Tab, content?: WebContents) {
    const view = new WebContentsView({
      ...(content ? { webContents: content } : {}),
      webPreferences: {
        session: host.session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: true,
        autoplayPolicy: 'document-user-activation-required',
        disableHtmlFullscreenWindowResize: true,
        safeDialogs: true,
        safeDialogsMessage: '不再显示此来源的连续对话框',
      },
    })
    view.setVisible(false)
    host.window.contentView.addChildView(view)
    tab.view = view
    const wc = view.webContents
    wc.setAudioMuted(tab.state.muted)
    wc.setZoomFactor(tab.state.zoom)
    const owner = () => this.hosts.get(tab.hostId)
    let iconRevision = 0
    let iconPages = new Set<string>()
    wc.on('page-favicon-updated', (_event, candidates) => {
      const revision = ++iconRevision
      const epoch = tab.epoch
      const url = wc.getURL()
      const current = owner()
      if (!current || !webTarget(url) || tab.state.pendingUrl) return
      const valid = () =>
        !wc.isDestroyed() &&
        !tab.closing &&
        !tab.state.pendingUrl &&
        tab.epoch === epoch &&
        revision === iconRevision &&
        wc.getURL() === url &&
        owner()?.session === current.session
      const force = tab.faviconBypassCache === true
      tab.faviconBypassCache = false
      void this.favicons
        .update(wc, url, candidates, !current.private && current.profile === 'default', valid, force)
        .then((icon) => {
          if (!valid()) return
          const persistent = !current.private && current.profile === 'default'
          const cache = this.favicons.cache(current.session, persistent)
          const record = cache.page(url)
          if (record) for (const alias of iconPages) cache.link(alias, record.iconUrl)
          if (!candidates.length) for (const alias of iconPages) cache.unlink(alias)
          if (persistent) this.favicons.save()
          tab.state.favicon = icon || record?.data
          this.publish()
        })
        .catch(() => {})
    })
    wc.on('did-redirect-navigation', (_event, url, _inPlace, main) => {
      if (main && iconPages.size < 16) iconPages.add(url)
    })
    const changed = () => {
      if (wc.isDestroyed()) return
      tab.state.canGoBack = wc.navigationHistory.canGoBack()
      tab.state.canGoForward = wc.navigationHistory.canGoForward()
      tab.state.audible = wc.isCurrentlyAudible()
      tab.state.zoom = tab.pendingZoom ?? wc.getZoomFactor()
      this.publish()
    }
    wc.on('before-input-event', (e, input) => {
      const current = owner()
      if (current) routeShortcut(this, current, e, input)
    })
    wc.on('will-navigate', (e, url) => {
      if (!webTarget(url) && url !== 'about:blank') e.preventDefault()
    })
    wc.on('will-redirect', (e, url) => {
      if (!webTarget(url)) e.preventDefault()
    })
    wc.on('did-start-navigation', (_e, url, inPlace, main) => {
      if (tab.closing) return
      if (main) this.find.closeTab(tab)
      if (main && !inPlace) {
        iconPages = new Set([url])
        iconRevision++
        tab.state.favicon = this.favicons
          .cache(wc.session, !owner()?.private && owner()?.profile === 'default')
          .page(url)?.data
        this.previews.forget(tab)
        this.dialogs.cancelRoot(wc.id)
        const h = owner()
        if (h?.activeId === tab.state.id) this.suggestions.hide(h, true)
        tab.epoch++
        tab.permissionEpoch++
        tab.state.pendingUrl = url
        tab.state.error = undefined
        tab.state.crashed = false
      }
      changed()
      this.saveSession()
    })
    wc.on('did-start-loading', () => {
      if (tab.closing) return
      tab.state.loading = true
      changed()
    })
    const commit = (_event: unknown, url: string) => {
      if (tab.closing) return
      tab.state.url = url
      const current = owner()
      if (current)
        tab.state.favicon = this.favicons
          .cache(wc.session, !current.private && current.profile === 'default')
          .page(url)?.data
      tab.state.pendingUrl = undefined
      tab.state.error = undefined
      changed()
      this.saveSession()
    }
    wc.on('did-navigate', commit)
    wc.on('did-navigate-in-page', (e, url, main) => {
      if (main) {
        const current = owner()
        if (current) {
          const persistent = !current.private && current.profile === 'default'
          const cache = this.favicons.cache(current.session, persistent)
          const previous = cache.page(tab.state.url)
          if (previous) {
            cache.link(url, previous.iconUrl)
            if (persistent) this.favicons.save()
          }
        }
        this.previews.forget(tab)
        tab.epoch++
        commit(e, url)
      }
    })
    wc.on('did-stop-loading', () => {
      if (tab.closing) return
      tab.state.loading = false
      if (!tab.state.error) {
        tab.state.title = wc.getTitle() || safeOrigin(wc.getURL())
        const h = owner()
        if (h && !h.private) this.store.visit(wc.getURL(), tab.state.title)
      }
      const h = owner()
      if (h) {
        this.layout(h)
        if (h.activeId === tab.state.id)
          h.window.setTitle(`${tab.state.title} — EChromium${h.private ? ' · 隐私窗口' : ''}`)
      }
      changed()
      this.saveSession()
    })
    wc.on('did-finish-load', () => {
      // Chromium applies the destination's zoom after navigation starts; restore only after that transition.
      if (tab.pendingZoom !== undefined && webTarget(wc.getURL())) {
        wc.setZoomFactor(tab.pendingZoom)
        tab.pendingZoom = undefined
        changed()
        this.saveSession()
      }
    })
    wc.on('page-title-updated', (_e, title) => {
      tab.state.title = title.slice(0, 500)
      changed()
      this.saveSession()
    })
    wc.on('did-fail-load', (_e, code, description, url, main) => {
      if (main && code !== -3) {
        tab.state.loading = false
        tab.state.error =
          code <= -200 && code >= -299
            ? '此网站的安全证书有问题。请返回上一页或联系网站管理员。'
            : code === -105
              ? '找不到这个网站。请检查网址或网络连接。'
              : code === -106
                ? '网络已断开，请连接网络后重试。'
                : `无法打开页面：${description}`
        tab.state.pendingUrl = url
        const h = owner()
        if (h) this.layout(h)
        changed()
      }
    })
    wc.on('render-process-gone', () => {
      this.previews.forget(tab)
      this.find.closeTab(tab)
      tab.state.crashed = true
      tab.state.loading = false
      const h = owner()
      if (h) this.layout(h)
      this.publish()
    })
    wc.on('audio-state-changed', changed)
    wc.on('media-started-playing', changed)
    wc.on('media-paused', changed)
    wc.on('enter-html-full-screen', () => {
      const h = owner()
      if (h?.activeId === tab.state.id) {
        h.htmlFullscreen = true
        h.window.setFullScreen(true)
        this.layout(h)
        this.publish()
      }
    })
    wc.on('leave-html-full-screen', () => {
      const h = owner()
      if (h) {
        h.htmlFullscreen = false
        h.window.setFullScreen(false)
        this.layout(h)
        this.publish()
      }
    })
    wc.on('will-prevent-unload', (e) => {
      const h = owner()
      const leave = this.confirmLeave
        ? this.confirmLeave(wc)
        : dialog.showMessageBoxSync(h!.window, {
            type: 'question',
            title: '离开页面',
            message: `${safeOrigin(wc.getURL())} 可能有尚未保存的内容。`,
            buttons: ['留在页面', '离开'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          }) === 1
      if (leave) {
        e.preventDefault()
        // The View is independently owned; dispose only after user approval.
        if (tab.closing)
          setImmediate(() => {
            if (!wc.isDestroyed() && tab.closing) wc.close({ waitForBeforeUnload: false })
          })
      } else if (tab.closing) {
        const finish = tab.closeResult
        // Resolve after the renderer has resumed from the native dialog, so a
        // rapid second close cannot re-enter its unfinished cancellation.
        void wc
          .executeJavaScript('void 0')
          .then(() => finish?.(false))
          .catch(() => finish?.(false))
      }
    })
    wc.once('destroyed', () => {
      this.previews.forget(tab)
      this.find.closeTab(tab)
      this.dialogs.cancel(wc.id)
      this.dialogs.forget(wc.id)
      this.popupPolicy.forget(wc.id)
      this.permissions.forget(wc.id)
      const h = owner(),
        old = h?.tabs.map((t) => t.state.id) || []
      if (h) {
        if (tab.closedSnapshot) this.rememberClosed(h, tab.closedSnapshot)
        h.tabs = h.tabs.filter((t) => t !== tab)
        if (h.activeId === tab.state.id) {
          const next = nextTab(
            old,
            tab.state.id,
            h.tabs.map((t) => t.state.id),
          )
          if (next) this.activate(h, next, !!h.overview)
          else if (!h.closing) h.window.destroy()
        }
      }
      tab.closeResult?.(true)
      tab.closeResult = undefined
      if (h && !h.private && !h.closing) this.saveSession()
      this.publish()
    })
    this.dialogs.install(
      wc,
      () => tab,
      () => owner()?.window,
    )
    installPopup(this, wc, () => tab)
    wc.on('context-menu', (_e, params) => {
      const h = owner(),
        epoch = tab.epoch
      if (!h || h.activeId !== tab.state.id) return
      const valid = () =>
        !wc.isDestroyed() && tab.epoch === epoch && tab.hostId === h.id && h.activeId === tab.state.id
      const action = (label: string, fn: () => void, enabled = true): MenuItemConstructorOptions => ({
        label,
        enabled,
        click: () => {
          if (valid()) fn()
        },
      })
      const menu: MenuItemConstructorOptions[] = []
      if (params.isEditable)
        menu.push(
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'pasteAndMatchStyle' },
          { role: 'selectAll' },
          { type: 'separator' },
        )
      else if (params.selectionText)
        menu.push(
          action('复制所选文字', () => clipboard.writeText(params.selectionText)),
          { type: 'separator' },
        )
      if (webTarget(params.linkURL))
        menu.push(
          action('在新标签页打开链接', () => this.newTab(h, 'web', params.linkURL)),
          action('复制链接地址', () => clipboard.writeText(params.linkURL)),
          { type: 'separator' },
        )
      if (webTarget(params.srcURL))
        menu.push(
          action('在新标签页打开资源', () => this.newTab(h, 'web', params.srcURL)),
          action('下载资源', () => wc.downloadURL(params.srcURL)),
          { type: 'separator' },
        )
      menu.push(
        action('后退', () => wc.navigationHistory.goBack(), wc.navigationHistory.canGoBack()),
        action('前进', () => wc.navigationHistory.goForward(), wc.navigationHistory.canGoForward()),
        action('重新加载', () => wc.reload()),
        { type: 'separator' },
        action('检查元素', () => {
          wc.openDevTools({ mode: 'detach' })
          wc.inspectElement(params.x, params.y)
        }),
      )
      Menu.buildFromTemplate(menu).popup({ window: h.window })
    })
    wc.on('page-info-open-site-settings', (_event, details) => {
      const h = owner(),
        origin = !wc.isDestroyed() && canonicalOrigin(wc.getURL())
      if (
        !h ||
        h.closing ||
        h.batchClosing ||
        !origin ||
        h.activeId !== tab.state.id ||
        tab.closing ||
        details.origin !== origin ||
        canonicalOrigin(details.url) !== origin
      )
        return
      try {
        this.openSiteSettings(h, origin)
      } catch (error) {
        this.ui(h, { type: 'notice', text: String(error) })
      }
    })
  }

  private load(tab: Tab, url: string) {
    if (!webTarget(url) && url !== 'about:blank') throw new Error('不支持的网页地址。')
    tab.state.error = undefined
    tab.state.crashed = false
    tab.state.pendingUrl = url
    const content = tab.view!.webContents
    void content.loadURL(url).catch((error) => {
      if (!content.isDestroyed() && error.code !== 'ERR_ABORTED')
        console.warn('Navigation failed:', error.code)
    })
    this.publish()
  }
  private captureClosed(host: Host, tab: Tab): ClosedTab {
    const record: ClosedTab = { state: { ...tab.state }, index: host.tabs.indexOf(tab) }
    const wc = tab.view?.webContents
    if (wc && !wc.isDestroyed()) {
      const all = wc.navigationHistory.getAllEntries(),
        active = wc.navigationHistory.getActiveIndex()
      const start = Math.max(0, active - 25)
      const selection = all.slice(start, start + 50)
      // Deliberately omit Chromium pageState: it may contain form values or POST data.
      if (selection.length && selection.every((e) => webTarget(e.url) || e.url === 'about:blank')) {
        record.entries = selection.map((e) => ({ url: e.url, title: e.title.slice(0, 500) }))
        record.historyIndex = active - start
      }
    }
    return record
  }
  private rememberClosed(host: Host, record: ClosedTab) {
    const stack = this.closedTabs.get(host.profile) || []
    stack.push(record)
    this.closedTabs.set(host.profile, stack.slice(-30))
  }
  private reopenTab(host: Host) {
    const stack = this.closedTabs.get(host.profile),
      record = stack?.at(-1)
    if (!record) return
    const tab = this.newTab(host, record.state.kind, record.state.url, false)
    stack!.pop()
    try {
      tab.state.pinned = record.state.pinned
      tab.state.muted = record.state.muted
      tab.state.title = record.state.title
      tab.state.zoom = record.state.zoom
      if (record.state.kind === 'web') tab.pendingZoom = record.state.zoom
      tab.state.settingsOrigin = record.state.settingsOrigin
      host.tabs.splice(host.tabs.indexOf(tab), 1)
      host.tabs.splice(Math.min(record.index, host.tabs.length), 0, tab)
      host.tabs.sort((a, b) => Number(b.state.pinned) - Number(a.state.pinned))
      if (tab.state.kind === 'web') {
        this.attachView(host, tab)
        tab.view!.webContents.setZoomFactor(record.state.zoom)
        this.activate(host, tab.state.id)
        if (record.entries?.length) {
          const content = tab.view!.webContents
          void content.navigationHistory
            .restore({
              entries: record.entries,
              index: record.historyIndex,
            })
            .catch((error) => {
              if (!content.isDestroyed()) console.warn('Tab history restoration failed:', error)
            })
        } else this.load(tab, tab.state.url)
      } else this.activate(host, tab.state.id)
      this.saveSession()
    } catch (error) {
      stack!.push(record)
      if (tab.view && !tab.view.webContents.isDestroyed())
        tab.view.webContents.close({ waitForBeforeUnload: false })
      else host.tabs = host.tabs.filter((t) => t !== tab)
      this.publish()
      throw error
    }
  }
  async closeTab(host: Host, tab: Tab): Promise<boolean> {
    if (tab.hostId !== host.id || !host.tabs.includes(tab)) return false
    if (tab.closing) return tab.closing
    this.find.closeTab(tab)
    if (tab.view) this.dialogs.cancelRoot(tab.view.webContents.id)
    const record = this.captureClosed(host, tab)
    if (!tab.view) {
      this.rememberClosed(host, record)
      const old = host.tabs.map((t) => t.state.id)
      host.tabs = host.tabs.filter((t) => t !== tab)
      if (host.activeId === tab.state.id) {
        const next = nextTab(
          old,
          tab.state.id,
          host.tabs.map((t) => t.state.id),
        )
        if (next) this.activate(host, next, !!host.overview)
        else if (!host.closing) host.window.destroy()
      }
      if (!host.closing && !host.private) this.saveSession()
      this.publish()
      return true
    }
    let complete!: (ok: boolean) => void
    const pending = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        tab.closeResult = undefined
        resolve(false)
      }, 15000)
      complete = (result) => {
        clearTimeout(timeout)
        resolve(result)
      }
      tab.closeResult = complete
    })
    tab.closedSnapshot = record
    tab.closing = pending
    tab.view.webContents.close({ waitForBeforeUnload: true })
    try {
      return await pending
    } finally {
      if (tab.closing === pending) {
        tab.closing = undefined
        tab.closedSnapshot = undefined
        tab.closeResult = undefined
      }
    }
  }
  async closeWindow(host: Host) {
    if (host.closing || host.batchClosing || host.window.isDestroyed()) return false
    if (!host.private) host.closingSession = this.captureWindow(host)
    this.find.close(host, false)
    this.dialogs.cancelHost(host)
    host.closing = true
    // Snapshot while all tabs still exist; cancellation never overwrites this with half a window.
    if (!host.private) this.saveSession()
    try {
      for (const tab of [...host.tabs]) if (!(await this.closeTab(host, tab))) return false
      host.window.destroy()
      return true
    } finally {
      host.closing = false
      host.closingSession = undefined
      if (!host.window.isDestroyed()) this.saveSession()
    }
  }

  async request(host: Host, request: BrowserRequest): Promise<BrowserState> {
    if (
      !request ||
      typeof request !== 'object' ||
      typeof request.action !== 'string' ||
      host.window.isDestroyed()
    )
      throw new Error('无效的浏览器操作。')
    if ((host.closing || host.batchClosing) && !['state', 'layout'].includes(request.action))
      throw new Error('正在处理标签页，请先完成离开页面确认。')
    const tab = () => this.target(host, request.id)
    const wc = () => {
      const content = tab().view?.webContents
      if (!content || content.isDestroyed()) throw new Error('此页面暂不支持该操作。')
      return content
    }
    switch (request.action) {
      case 'state':
        break
      case 'tab-overview':
        if (request.value !== undefined && typeof request.value !== 'boolean')
          throw new Error('无效的标签总览操作。')
        this.setOverview(host, typeof request.value === 'boolean' ? request.value : !host.overview)
        break
      case 'new-tab': {
        const kinds = ['settings', 'downloads', 'history', 'bookmarks'] as const
        const kind = kinds.find((k) => k === request.value)
        if (kind) this.newTab(host, kind)
        else if (request.url)
          this.newTab(host, 'web', inputTarget(request.url, this.store.data.preferences.search))
        else {
          this.newTab(host)
          this.ui(host, { type: 'focus-address' })
        }
        break
      }
      case 'activate':
        this.activate(host, tab().state.id)
        break
      case 'close-tab':
        await this.closeTab(host, tab())
        break
      case 'reopen-tab':
        await this.reopenTab(host)
        break
      case 'close-tabs': {
        const ids = closeTargets(
          host.tabs.map((t) => t.state),
          tab().state.id,
          request.value,
        )
        host.batchClosing = true
        try {
          for (const id of ids) {
            const current = host.tabs.find((t) => t.state.id === id)
            if (current && !(await this.closeTab(host, current))) break
          }
        } finally {
          host.batchClosing = false
        }
        break
      }
      case 'navigate': {
        if (host.overview) this.setOverview(host, false)
        this.suggestions.hide(host, true)
        if (typeof request.text !== 'string') throw new Error('无效的网址。')
        const target = inputTarget(request.text, this.store.data.preferences.search),
          current = tab()
        if (current.closing) throw new Error('请先完成这个标签页的关闭确认。')
        current.state.kind = 'web'
        current.state.title = '正在打开…'
        if (!current.view) current.state.url = target
        if (!current.view) this.attachView(host, current)
        this.load(current, target)
        this.layout(host)
        current.view!.webContents.focus()
        break
      }
      case 'back':
        if (host.overview) this.setOverview(host, false)
        if (wc().navigationHistory.canGoBack()) wc().navigationHistory.goBack()
        break
      case 'forward':
        if (host.overview) this.setOverview(host, false)
        if (wc().navigationHistory.canGoForward()) wc().navigationHistory.goForward()
        break
      case 'reload': {
        if (host.overview) this.setOverview(host, false)
        const current = tab()
        current.state.error = undefined
        current.state.crashed = false
        if (current.view) {
          if (request.value === true) {
            current.faviconBypassCache = true
            wc().reloadIgnoringCache()
          } else wc().reload()
          this.layout(host)
        }
        break
      }
      case 'stop':
        wc().stop()
        break
      case 'duplicate': {
        const current = tab()
        this.newTab(host, current.state.kind, current.state.url)
        break
      }
      case 'pin': {
        const current = tab()
        current.state.pinned = !current.state.pinned
        host.tabs.sort((a, b) => Number(b.state.pinned) - Number(a.state.pinned))
        break
      }
      case 'mute': {
        const current = tab()
        current.state.muted = !current.state.muted
        current.view?.webContents.setAudioMuted(current.state.muted)
        break
      }
      case 'reorder': {
        if (
          !Array.isArray(request.value) ||
          request.value.length !== host.tabs.length ||
          new Set(request.value).size !== host.tabs.length ||
          request.value.some((id) => typeof id !== 'string' || !host.tabs.some((t) => t.state.id === id))
        )
          throw new Error('无效的标签页顺序。')
        const order = request.value as string[]
        host.tabs.sort((a, b) => order.indexOf(a.state.id) - order.indexOf(b.state.id))
        host.tabs.sort((a, b) => Number(b.state.pinned) - Number(a.state.pinned))
        break
      }
      case 'detach': {
        const current = tab()
        if (host.tabs.length < 2 || current.closing) break
        const target = this.createWindow({ private: host.private, profile: host.profile, empty: true })
        try {
          transferTab(this, host, target, current)
        } catch (error) {
          target.window.destroy()
          throw error
        }
        break
      }
      case 'move-tab':
      case 'adopt-tab': {
        const source =
          request.action === 'move-tab'
            ? host
            : [...this.hosts.values()].find((h) => h.tabs.some((t) => t.state.id === request.id))
        const value = request.value as { windowId?: unknown; beforeId?: unknown } | undefined
        const target =
          request.action === 'adopt-tab'
            ? host
            : typeof value?.windowId === 'string'
              ? this.hosts.get(value.windowId)
              : undefined
        const current = source?.tabs.find((t) => t.state.id === request.id)
        if (
          !source ||
          !target ||
          !current ||
          (value?.beforeId !== undefined && typeof value.beforeId !== 'string')
        )
          throw new Error('目标窗口或标签页已不可用。')
        transferTab(this, source, target, current, value?.beforeId as string | undefined)
        if (host.window.isDestroyed()) return this.snapshot(target)
        break
      }
      case 'page-info': {
        this.find.close(host, false)
        const current = tab(),
          content = wc()
        if (
          host.activeId !== current.state.id ||
          current.closing ||
          !webTarget(content.getURL()) ||
          current.state.loading ||
          current.state.pendingUrl ||
          current.state.error ||
          current.state.crashed
        )
          throw new Error('请等网页加载完成后再查看站点信息。')
        const anchor = safeBounds(
            request.value,
            host.window.getContentSize(),
            host.window.webContents.getZoomFactor(),
          ),
          bounds = host.window.getContentBounds()
        this.suggestions.hide(host, true)
        if (
          typeof content.showPageInfoDialog !== 'function' ||
          !content.showPageInfoDialog({
            anchorBounds: { ...anchor, x: bounds.x + anchor.x, y: bounds.y + anchor.y },
          })
        )
          throw new Error('当前页面暂时无法显示站点信息。')
        break
      }
      case 'site-settings': {
        const origin = canonicalOrigin(wc().getURL())
        if (!origin) throw new Error('此页面没有网站权限设置。')
        this.openSiteSettings(host, origin)
        break
      }
      case 'popup-policy':
      case 'dialog-policy': {
        const current = tab(),
          content = wc()
        if (host.activeId !== current.state.id || typeof request.value !== 'boolean' || current.closing)
          throw new Error('页面设置已失效。')
        if (request.action === 'popup-policy')
          this.popupPolicy.allow(content.id, current.permissionEpoch, request.value)
        else this.dialogs.mute(content.id, current.permissionEpoch, request.value)
        break
      }
      case 'new-window':
        this.createWindow({ private: request.private === true })
        break
      case 'preferences': {
        Object.assign(this.store.data.preferences, preferencesPatch(request.value))
        this.store.saveSoon()
        await this.refreshAppearance()
        break
      }
      case 'bookmark': {
        const current = tab()
        this.store.toggleBookmark(current.state.url, current.state.title)
        break
      }
      case 'remove-bookmark':
        this.store.data.bookmarks = this.store.data.bookmarks.filter((b) => b.id !== request.id)
        this.store.saveSoon()
        break
      case 'save-bookmark':
        this.store.saveBookmark(request.id, request.value)
        break
      case 'import-bookmarks': {
        const raw = request.value as { nodes?: unknown; parentId?: unknown } | undefined
        const imported = importBookmarkTree(
          this.store.data.bookmarks,
          this.store.data.bookmarkFolders,
          Array.isArray(request.value) ? request.value : raw?.nodes,
          randomUUID,
          raw?.parentId,
        )
        this.store.data.bookmarks = imported.bookmarks
        this.store.data.bookmarkFolders = imported.folders
        this.store.saveSoon()
        this.ui(host, {
          type: 'notice',
          text: `已导入 ${imported.added} 个书签、${imported.addedFolders} 个文件夹，跳过 ${imported.skipped} 个重复或无效条目。`,
        })
        break
      }
      case 'export-bookmarks': {
        const html = exportBookmarks(this.store.data.bookmarks, this.store.data.bookmarkFolders)
        const selected = this.bookmarkExportDestination
          ? { canceled: false, filePath: await this.bookmarkExportDestination(host) }
          : await dialog.showSaveDialog(host.window, {
              title: '导出书签',
              defaultPath: 'EChromium-bookmarks.html',
              filters: [{ name: 'HTML 书签', extensions: ['html'] }],
            })
        if (!selected.canceled && selected.filePath) {
          await fs.writeFile(selected.filePath, html, 'utf8')
          this.ui(host, { type: 'notice', text: '书签已导出。' })
        }
        break
      }
      case 'reorder-bookmarks': {
        const order = request.value
        if (
          !Array.isArray(order) ||
          order.length !== this.store.data.bookmarks.length ||
          new Set(order).size !== order.length ||
          order.some((id) => typeof id !== 'string' || !this.store.data.bookmarks.some((b) => b.id === id))
        )
          throw new Error('书签列表已更改，请重试。')
        this.store.data.bookmarks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
        this.store.saveSoon()
        break
      }
      case 'save-bookmark-folder':
        this.store.saveFolder(request.id, request.value)
        break
      case 'remove-bookmark-folder':
        this.store.removeFolder(request.id)
        break
      case 'folder-menu':
        openFolderMenu(this, host, request.id)
        break
      case 'layout':
        if (request.id !== host.activeId) return this.snapshot(host)
        host.bounds = safeBounds(
          request.value,
          host.window.getContentSize(),
          host.window.webContents.getZoomFactor(),
        )
        this.layout(host)
        return this.snapshot(host)
      case 'menu':
        openBrowserMenu(this, host, undefined, request.value)
        break
      case 'tab-menu':
        openBrowserMenu(this, host, tab())
        break
      case 'open-find':
        this.find.open(host)
        break
      case 'find-step':
        this.find.step(host, request.value !== false)
        break
      case 'stop-find':
        this.find.close(host, true)
        break
      case 'zoom': {
        const zoom = Number(request.value)
        if (!Number.isFinite(zoom)) throw new Error('无效的缩放值。')
        wc().setZoomFactor(Math.min(3, Math.max(0.25, zoom)))
        tab().state.zoom = wc().getZoomFactor()
        if (tab().pendingZoom !== undefined) tab().pendingZoom = tab().state.zoom
        break
      }
      case 'download':
        if (typeof request.id !== 'string') throw new Error('无效的下载任务。')
        await this.downloads.action(host.profile, request.id, request.value)
        break
      case 'clear-downloads':
        this.downloads.clear(host.profile)
        break
      case 'site-permission':
        this.permissions.edit(host.profile, request.value)
        break
      case 'open-data': {
        const settings = this.newTab(host, 'settings')
        settings.state.settingsSection = 'privacy'
        break
      }
      default:
        throw new Error('不支持的浏览器操作。')
    }
    this.publish()
    if (['pin', 'mute', 'zoom', 'reorder'].includes(request.action)) this.saveSession()
    return this.snapshot(host)
  }
}
