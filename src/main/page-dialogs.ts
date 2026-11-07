import {
  NativePanel,
  type BrowserWindow,
  type JsDialogDetails,
  type JsDialogResponse,
  type WebContents,
} from 'electron'
import type { Browser, Host, Tab } from './browser'
import { canonicalOrigin } from '../shared/site-policy'
import { safeOrigin } from '../shared/navigation'
import { panelTheme } from './panel-theme'

interface Budget {
  epoch: number
  times: number[]
  muted: boolean
  blocked: number
}
interface Pending {
  panel: NativePanel
  host: Host
  root: Tab
  sourceId: number
  finish: (response: JsDialogResponse) => void
}
type DialogEvent = Electron.Event & { respond?: (response: JsDialogResponse) => void }
export class PageDialogs {
  private budgets = new Map<number, Budget>()
  private pending = new Map<number, Pending>()
  constructor(private browser: Browser) {}
  private budget(root: number, epoch: number) {
    let item = this.budgets.get(root)
    if (!item || item.epoch !== epoch) {
      item = { epoch, times: [], muted: false, blocked: 0 }
      this.budgets.set(root, item)
    }
    return item
  }
  status(root: number, epoch: number) {
    const item = this.budget(root, epoch)
    return { muted: item.muted, blocked: item.blocked }
  }
  mute(root: number, epoch: number, muted: boolean) {
    const item = this.budget(root, epoch)
    item.muted = muted
    if (!muted) item.times = []
  }
  forget(root: number) {
    this.budgets.delete(root)
  }
  panel(sourceId: number) {
    return this.pending.get(sourceId)?.panel
  }
  refresh(host: Host) {
    for (const entry of this.pending.values())
      if (entry.host === host) entry.panel.update({ theme: panelTheme(host) })
  }
  cancel(sourceId: number) {
    this.pending.get(sourceId)?.finish({ accept: false })
  }
  cancelRoot(rootId: number) {
    for (const entry of [...this.pending.values()])
      if (entry.root.view?.webContents.id === rootId) entry.finish({ accept: false })
  }
  cancelHost(host: Host) {
    for (const entry of [...this.pending.values()]) if (entry.host === host) entry.finish({ accept: false })
  }
  install(wc: WebContents, root: () => Tab | undefined, parent: () => BrowserWindow | undefined) {
    // The runtime's default asynchronous timeout accepts confirm(). Own the timeout and cancel instead.
    if (typeof wc.setJsDialogTimeout === 'function') wc.setJsDialogTimeout(0)
    wc.on('js-dialog', (event, details) => this.open(wc, root, parent, event as DialogEvent, details))
    wc.on('did-start-navigation', (_event, _url, inPlace, main) => {
      if (main && !inPlace) this.cancel(wc.id)
    })
    wc.once('destroyed', () => this.cancel(wc.id))
  }
  private open(
    wc: WebContents,
    root: () => Tab | undefined,
    parent: () => BrowserWindow | undefined,
    event: DialogEvent,
    details: JsDialogDetails,
  ) {
    // Stock runtimes retain their native alert/confirm path with safeDialogs enabled.
    if (typeof event.respond !== 'function') return
    try {
      if (!NativePanel.isSupported()) return
    } catch {
      return
    }
    event.preventDefault()
    const respond = event.respond,
      tab = root(),
      owner = tab && this.browser.hosts.get(tab.hostId),
      window = parent()
    if (!tab?.view || !owner || !window || window.isDestroyed() || wc.isDestroyed()) {
      respond({ accept: false })
      return
    }
    const rootId = tab.view.webContents.id,
      epoch = tab.permissionEpoch,
      sourceUrl = wc.getURL()
    const budget = this.budget(rootId, epoch),
      now = Date.now()
    budget.times = budget.times.filter((time) => now - time < 10000)
    const valid = () =>
      !wc.isDestroyed() &&
      !window.isDestroyed() &&
      !owner.window.isDestroyed() &&
      !owner.closing &&
      !owner.batchClosing &&
      !tab.closing &&
      tab.hostId === owner.id &&
      owner.tabs.includes(tab) &&
      owner.activeId === tab.state.id &&
      !owner.overview &&
      tab.permissionEpoch === epoch &&
      wc.getURL() === sourceUrl
    if (
      !valid() ||
      !window.isFocused() ||
      budget.muted ||
      budget.times.length >= 3 ||
      [...this.pending.values()].some((p) => p.host === owner)
    ) {
      if (budget.times.length >= 3) budget.muted = true
      budget.blocked = Math.min(999, budget.blocked + 1)
      respond({ accept: false })
      this.browser.publishSoon()
      return
    }
    budget.times.push(now)
    this.browser.find.close(owner, false)
    this.browser.suggestions.hide(owner, true)
    let panel: NativePanel | undefined,
      done = false,
      prompt = (details.defaultPrompt || '').slice(0, 65536),
      mute = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = (response: JsDialogResponse) => {
      if (done) return
      done = true
      clearTimeout(timeout)
      this.pending.delete(wc.id)
      if (mute && valid()) budget.muted = true
      const accepted = response.accept && valid()
      // Deliver before destroying the source-bound panel; the page resumes only through this callback.
      respond({
        accept: accepted,
        ...(accepted && details.type === 'prompt' ? { promptText: response.promptText ?? prompt } : {}),
      })
      panel?.destroy()
      this.browser.publish()
    }
    try {
      if (!NativePanel.isSupported()) {
        finish({ accept: false })
        return
      }
      panel = new NativePanel({
        parent: window,
        sourceWebContents: wc,
        focusMode: details.type === 'prompt' ? 'input' : 'menu',
        dismissOnEscape: true,
        content: {
          id: 'page-dialog',
          type: 'column',
          width: 440,
          gap: 12,
          padding: 8,
          children: [
            {
              id: 'dialog-title',
              type: 'text',
              text:
                details.type === 'alert'
                  ? '网页提示'
                  : details.type === 'confirm'
                    ? '网页确认'
                    : '网页要求输入',
              style: { fontWeight: 'medium' },
              fontSize: 16,
            },
            {
              id: 'dialog-origin',
              type: 'text',
              text:
                canonicalOrigin(details.url) ||
                (details.isMainFrame === false ? '无法确认来源的嵌入页面' : safeOrigin(sourceUrl)),
              selectable: true,
              maxWidth: 420,
            },
            ...(details.isMainFrame === false
              ? [
                  {
                    id: 'dialog-embed',
                    type: 'text',
                    text: `嵌入在 ${safeOrigin(tab.view.webContents.getURL())}`,
                    muted: true,
                    maxWidth: 420,
                  },
                ]
              : []),
            {
              id: 'dialog-message',
              type: 'textarea',
              value: details.message.slice(0, 8000),
              readOnly: true,
              height: 120,
              accessibleName: '网站消息',
              maxLength: 8000,
            },
            ...(details.message.length > 8000
              ? [
                  {
                    id: 'dialog-truncated',
                    type: 'text',
                    text: '消息过长，仅显示前 8000 个字符。',
                    muted: true,
                  },
                ]
              : []),
            ...(details.type === 'prompt'
              ? [
                  {
                    id: 'dialog-input',
                    type: 'input',
                    value: prompt,
                    maxLength: 65536,
                    accessibleName: '输入回复',
                    height: 34,
                  },
                ]
              : []),
            { id: 'dialog-mute', type: 'toggle', text: '不再显示本页的对话框', checked: false },
            {
              id: 'dialog-actions',
              type: 'row',
              gap: 10,
              justify: 'end',
              children: [
                {
                  id: 'dialog-cancel',
                  type: 'button',
                  text: details.type === 'alert' ? '关闭' : '取消',
                  variant: 'outlined',
                  width: 90,
                },
                { id: 'dialog-accept', type: 'button', text: '确定', variant: 'default', width: 90 },
              ],
            },
          ],
        },
        theme: panelTheme(owner),
      })
      const currentPanel = panel
      this.pending.set(wc.id, { panel, host: owner, root: tab, sourceId: wc.id, finish })
      panel.on('action', (action) => {
        if (done || action.revision !== currentPanel.revision || !currentPanel.getDiagnostics().visible)
          return
        if (!valid()) {
          finish({ accept: false })
          return
        }
        if (
          action.id === 'dialog-input' &&
          typeof action.value === 'string' &&
          ['change', 'submit'].includes(action.type)
        ) {
          prompt = action.value.slice(0, 65536)
          if (action.type === 'submit') finish({ accept: true, promptText: prompt })
        } else if (
          action.id === 'dialog-mute' &&
          action.type === 'change' &&
          typeof action.value === 'boolean'
        )
          mute = action.value
        else if (action.type === 'click' && action.id === 'dialog-accept')
          finish({ accept: true, promptText: prompt })
        else if (action.type === 'click' && action.id === 'dialog-cancel') finish({ accept: false })
      })
      panel.on('dismissed', () => finish({ accept: false }))
      panel.on('closed', () => finish({ accept: false }))
      const bounds = window.getContentBounds()
      panel.show({
        anchorBounds: {
          x: bounds.x + Math.max(0, (bounds.width - 480) / 2),
          y: bounds.y + 90,
          width: 480,
          height: 1,
        },
        placement: 'bottom-start',
      })
      panel.focus(details.type === 'prompt' ? 'dialog-input' : 'dialog-cancel')
      timeout = setTimeout(() => finish({ accept: false }), 120000)
    } catch (error) {
      console.warn('Page dialog unavailable:', error)
      finish({ accept: false })
    }
  }
}
