import { NativePanel, type WebContents, type NativePanelAction } from 'electron'
import type { Browser, Host, Tab } from './browser'
import { panelTheme } from './panel-theme'
import { findPanelContent, type FindPresentation } from '../shared/find-panel'

interface Entry extends FindPresentation {
  host: Host
  tab: Tab
  wc: WebContents
  epoch: number
  panel?: NativePanel
  requestId?: number
  timer?: ReturnType<typeof setTimeout>
  refreshKey?: string
  listener: (_event: Electron.Event, result: Electron.FoundInPageResult) => void
}
export class PageFind {
  private entries = new Map<string, Entry>()
  private drafts = new WeakMap<Tab, { query: string; matchCase: boolean }>()
  constructor(private browser: Browser) {}
  panel(host: Host) {
    return this.entries.get(host.id)?.panel
  }
  state(host: Host) {
    const entry = this.entries.get(host.id)
    return (
      entry && {
        query: entry.query,
        status: entry.status,
        total: entry.total,
        ordinal: entry.ordinal,
        requestId: entry.requestId,
      }
    )
  }
  private valid(entry: Entry) {
    const { host, tab, wc } = entry
    return (
      this.entries.get(host.id) === entry &&
      !host.window.isDestroyed() &&
      !wc.isDestroyed() &&
      !host.closing &&
      !host.batchClosing &&
      !tab.closing &&
      tab.hostId === host.id &&
      host.tabs.includes(tab) &&
      host.activeId === tab.state.id &&
      tab.epoch === entry.epoch &&
      !tab.state.error &&
      !tab.state.crashed
    )
  }
  private composing(entry: Entry) {
    // desktop.3 exposes IME state at runtime; its bundled Controls declaration omits this field.
    return (
      entry.panel
        ?.getDiagnostics()
        .controls.some(
          (control) =>
            control.id === 'find-query' && (control as typeof control & { composing?: boolean }).composing,
        ) === true
    )
  }
  private theme(host: Host) {
    return panelTheme(host)
  }
  private anchor(entry: Entry) {
    const origin = entry.host.window.getContentBounds(),
      bounds = entry.tab.view!.getBounds()
    entry.width = Math.max(200, Math.min(380, bounds.width - 48))
    // Borrow space from the lower browser chrome, keeping the window controls clear.
    const top =
      entry.host.htmlFullscreen || entry.host.window.isFullScreen()
        ? bounds.y + 8
        : Math.max(44, bounds.y - 40)
    return { x: origin.x + bounds.x + bounds.width - 8, y: origin.y + top, width: 0, height: 0 }
  }
  open(host: Host) {
    const tab = this.browser.active(host),
      wc = tab?.view?.webContents
    if (
      !tab ||
      host.overview ||
      tab.state.kind !== 'web' ||
      !wc ||
      wc.isDestroyed() ||
      tab.closing ||
      tab.state.error ||
      tab.state.crashed ||
      host.closing ||
      host.batchClosing
    )
      throw new Error('请先打开网页，再进行页内查找。')
    if (typeof NativePanel?.isSupported !== 'function' || !NativePanel.isSupported())
      throw new Error('当前平台暂不支持原生查找面板。')
    this.browser.suggestions.hide(host, true)
    let entry = this.entries.get(host.id)
    if (entry && !this.valid(entry)) {
      this.close(host, false)
      entry = undefined
    }
    if (entry && this.composing(entry)) {
      entry.panel?.focus('find-query')
      return
    }
    if (!entry) {
      const draft = this.drafts.get(tab)
      entry = {
        host,
        tab,
        wc,
        epoch: tab.epoch,
        query: draft?.query || '',
        matchCase: draft?.matchCase || false,
        width: 380,
        status: 'idle',
        total: 0,
        ordinal: 0,
        listener: () => {},
      }
      const current = entry
      entry.listener = (_event, result) => {
        if (!this.valid(current) || current.requestId !== result.requestId || !result.finalUpdate) return
        current.status = 'ready'
        current.total = Math.max(0, result.matches)
        current.ordinal = current.total ? Math.max(1, Math.min(current.total, result.activeMatchOrdinal)) : 0
        this.render(current)
      }
      wc.on('found-in-page', entry.listener)
      this.entries.set(host.id, entry)
    }
    // Reopening is an explicit focus request. Replace the native input session; never do this for a result update.
    const previous = entry.panel
    entry.panel = undefined
    previous?.destroy()
    try {
      const anchor = this.anchor(entry),
        current = entry
      const panel = new NativePanel({
        parent: host.window,
        sourceWebContents: wc,
        content: findPanelContent(entry, true),
        theme: this.theme(host),
        focusMode: 'input',
        dismissOnEscape: true,
        dismissOnOutsideClick: false,
        contentInset: 8,
        radius: 14,
        shadow: false,
      })
      entry.panel = panel
      entry.refreshKey = undefined
      panel.on('action', (action) => this.action(current, panel, action))
      panel.on('dismissed', (details) => {
        if (
          this.entries.get(host.id) === current &&
          current.panel === panel &&
          details.reason !== 'parent-hidden'
        )
          this.close(host, details.reason === 'escape')
      })
      panel.on('closed', () => {
        if (this.entries.get(host.id) === current && current.panel === panel) this.close(host, false)
      })
      panel.show({ anchorBounds: anchor, placement: 'bottom-end' })
      panel.focus('find-query')
      if (entry.query && entry.status === 'idle') this.search(entry, true, true)
    } catch (error) {
      this.close(host, false)
      throw new Error('无法打开网页查找面板：' + String(error))
    }
  }
  private render(entry: Entry) {
    if (!this.valid(entry) || !entry.panel) return
    entry.panel.update({ content: findPanelContent(entry), theme: this.theme(entry.host) })
  }
  reposition(host: Host) {
    const entry = this.entries.get(host.id)
    if (!entry) return
    if (!this.valid(entry)) {
      this.close(host, false)
      return
    }
    if (!entry.panel || host.window.isMinimized() || !host.window.isVisible()) return
    const anchor = this.anchor(entry),
      theme = this.theme(host),
      key = JSON.stringify([anchor, theme, entry.width])
    if (entry.refreshKey !== key) {
      entry.panel.update({ anchorBounds: anchor, content: findPanelContent(entry), theme })
      entry.refreshKey = key
    }
    if (!entry.panel.getDiagnostics().visible)
      entry.panel.show({ anchorBounds: anchor, placement: 'bottom-end' })
  }
  private action(entry: Entry, panel: NativePanel, action: NativePanelAction) {
    if (
      !this.valid(entry) ||
      entry.panel !== panel ||
      !panel.getDiagnostics().visible ||
      action.revision > panel.revision
    )
      return
    if (
      action.id === 'find-query' &&
      ['change', 'submit'].includes(action.type) &&
      typeof action.value === 'string' &&
      action.value.length <= 1024
    ) {
      this.query(entry, action.value)
      if (action.type === 'submit' && !this.composing(entry)) this.step(entry.host, true)
    } else if (action.id === 'find-close' && action.type === 'click') this.close(entry.host, true)
    else if (
      action.revision === panel.revision &&
      action.id === 'find-case' &&
      action.type === 'change' &&
      typeof action.value === 'boolean'
    ) {
      entry.matchCase = action.value
      this.query(entry, entry.query, true)
    } else if (
      action.revision === panel.revision &&
      action.type === 'click' &&
      ['find-next', 'find-previous'].includes(action.id)
    )
      this.step(entry.host, action.id === 'find-next')
  }
  private query(entry: Entry, query: string, force = false) {
    if (entry.query === query && !force) return
    clearTimeout(entry.timer)
    entry.timer = undefined
    entry.query = query
    entry.requestId = undefined
    entry.total = entry.ordinal = 0
    entry.notice = undefined
    this.drafts.set(entry.tab, { query, matchCase: entry.matchCase })
    if (!query) {
      entry.status = 'idle'
      entry.wc.stopFindInPage('clearSelection')
    } else {
      entry.status = 'searching'
      const commit = () => {
        if (!this.valid(entry)) return
        if (this.composing(entry)) {
          entry.timer = setTimeout(commit, 80)
          return
        }
        entry.timer = undefined
        this.search(entry, true, true)
      }
      entry.timer = setTimeout(commit, 140)
    }
    this.render(entry)
  }
  private search(entry: Entry, initial: boolean, forward: boolean) {
    if (!this.valid(entry) || !entry.query || this.composing(entry)) return
    clearTimeout(entry.timer)
    entry.timer = undefined
    entry.status = 'searching'
    entry.notice = undefined
    try {
      // In this runtime findNext is Chromium's new_session flag: true initially, false for subsequent matches.
      entry.requestId = entry.wc.findInPage(entry.query, {
        forward,
        findNext: initial,
        matchCase: entry.matchCase,
      })
    } catch {
      entry.requestId = undefined
      entry.status = 'error'
      entry.notice = '暂时无法查找，请重新打开查找面板。'
    }
    this.render(entry)
  }
  step(host: Host, forward: boolean) {
    const entry = this.entries.get(host.id)
    if (!entry) {
      this.open(host)
      return
    }
    if (!this.valid(entry) || this.composing(entry)) return
    if (entry.timer || (entry.query && entry.requestId === undefined)) this.search(entry, true, forward)
    else if (entry.status === 'ready' && entry.total > 0) this.search(entry, false, forward)
  }
  closeTab(tab: Tab) {
    for (const entry of [...this.entries.values()]) if (entry.tab === tab) this.close(entry.host, false)
  }
  close(host: Host, focus = false) {
    const entry = this.entries.get(host.id)
    if (!entry) return
    const current = this.valid(entry)
    this.entries.delete(host.id)
    clearTimeout(entry.timer)
    this.drafts.set(entry.tab, { query: entry.query, matchCase: entry.matchCase })
    entry.wc.off('found-in-page', entry.listener)
    if (!entry.wc.isDestroyed()) {
      try {
        entry.wc.stopFindInPage('clearSelection')
      } catch {
        /* The renderer may be stopping. */
      }
    }
    const panel = entry.panel
    entry.panel = undefined
    panel?.destroy()
    if (focus && current)
      setImmediate(() => {
        if (
          !this.entries.has(host.id) &&
          !entry.wc.isDestroyed() &&
          !host.window.isDestroyed() &&
          host.activeId === entry.tab.state.id &&
          entry.tab.hostId === host.id &&
          entry.tab.epoch === entry.epoch
        )
          entry.wc.focus()
      })
  }
}
