import { NativePanel, type NativePanelContent } from 'electron'
import type { Browser, Host } from './browser'
import { addressChoices, choiceLabel, type AddressChoice } from '../shared/suggestions'
import { safeBounds } from '../shared/navigation'
import { panelTheme } from './panel-theme'

const label = (text: string) =>
  text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 2000)
export class AddressSuggestions {
  private entries = new Map<
    string,
    { panel: NativePanel; tabId: string; epoch: number; rows: AddressChoice[] }
  >()
  private disabled = new Set<string>()
  private serial = 0
  private available = false
  constructor(private browser: Browser) {
    try {
      this.available = typeof NativePanel?.isSupported === 'function' && NativePanel.isSupported()
    } catch {
      /* Use the in-chrome list. */
    }
  }
  supported(host: Host) {
    return this.available && !this.disabled.has(host.id)
  }
  diagnostics(host: Host) {
    return this.entries.get(host.id)?.panel.getDiagnostics()
  }
  refresh(host: Host) {
    this.entries.get(host.id)?.panel.update({ theme: panelTheme(host) })
  }
  hide(host: Host, dismissed = false) {
    this.entries.get(host.id)?.panel.hide()
    if (dismissed) this.browser.ui(host, { type: 'address-dismissed' })
  }
  destroy(host: Host) {
    this.entries.get(host.id)?.panel.destroy()
    this.entries.delete(host.id)
    this.disabled.delete(host.id)
  }
  show(host: Host, id: unknown, text: unknown, value: unknown) {
    if (value === false) {
      this.hide(host)
      return
    }
    const tab = this.browser.active(host)
    if (
      !tab ||
      host.closing ||
      host.batchClosing ||
      host.window.isDestroyed() ||
      tab.state.id !== id ||
      tab.closing ||
      typeof text !== 'string' ||
      text.length > 8192 ||
      !value ||
      typeof value !== 'object'
    )
      throw new Error('地址建议已失效。')
    if (!this.supported(host)) return
    const raw = value as { anchor: unknown; selected: unknown }
    if (!Number.isInteger(raw.selected) || (raw.selected as number) < -1 || (raw.selected as number) > 7)
      throw new Error('无效的地址建议。')
    const bounds = safeBounds(
      raw.anchor,
      host.window.getContentSize(),
      host.window.webContents.getZoomFactor(),
    )
    const rows = addressChoices(text, {
      tabs: host.tabs.map((t) => t.state),
      activeId: host.activeId,
      bookmarks: this.browser.store.data.bookmarks,
      history: host.private ? [] : this.browser.store.data.history.slice(0, 150),
      search: this.browser.store.data.preferences.search,
    })
    if (!rows.length || !bounds.width || !bounds.height) {
      this.hide(host)
      return
    }
    const serial = ++this.serial
    const width = Math.max(120, Math.min(900, bounds.width))
    const content: NativePanelContent = {
      type: 'list',
      id: 'address-list',
      role: 'listbox',
      width,
      height: Math.min(380, rows.length * 46 + 12),
      padding: 6,
      gap: 2,
      children: rows.map((row, index) => ({
        type: 'item',
        id: `address-${serial}-${index}`,
        role: 'option',
        selected: raw.selected === index,
        height: 44,
        padding: 8,
        gap: 6,
        contextMenu: false,
        accessibleName: label(`${choiceLabel(row)}，${row.title}，${row.url}`),
        style: { borderless: true, radius: 6 },
        children: [
          {
            type: 'column',
            id: `address-${serial}-${index}-copy`,
            flex: 1,
            gap: 2,
            children: [
              {
                type: 'text',
                id: `address-${serial}-${index}-title`,
                text: label(row.title),
                singleLine: true,
                maxWidth: width - 110,
              },
              {
                type: 'text',
                id: `address-${serial}-${index}-url`,
                text: label(row.url),
                singleLine: true,
                muted: true,
                fontSize: 11,
                maxWidth: width - 110,
              },
            ],
          },
          {
            type: 'text',
            id: `address-${serial}-${index}-kind`,
            text: choiceLabel(row),
            muted: true,
            fontSize: 11,
            width: 65,
          },
        ],
      })),
    }
    const theme = panelTheme(host)
    try {
      let entry = this.entries.get(host.id)
      if (!entry) {
        const panel = new NativePanel({
          parent: host.window,
          sourceWebContents: host.window.webContents,
          content,
          theme,
          focusMode: 'none',
          dismissOnEscape: false,
          contentInset: 0,
          radius: 10,
        })
        entry = { panel, tabId: tab.state.id, epoch: tab.epoch, rows }
        this.entries.set(host.id, entry)
        panel.on('closed', () => {
          if (this.entries.get(host.id)?.panel === panel) this.entries.delete(host.id)
        })
        panel.on('dismissed', () => this.browser.ui(host, { type: 'address-dismissed' }))
        panel.on('action', (action) => {
          const current = this.entries.get(host.id),
            active = this.browser.active(host)
          if (
            current?.panel !== panel ||
            action.type !== 'click' ||
            action.revision !== panel.revision ||
            !panel.getDiagnostics().visible ||
            active?.state.id !== current.tabId ||
            active.epoch !== current.epoch ||
            host.closing ||
            host.batchClosing
          )
            return
          const match = /^address-\d+-(\d+)$/.exec(action.id)
          if (!match || !panel.getDiagnostics().controls.some((c) => c.id === action.id)) return
          const row = current.rows[Number(match[1])]
          if (!row) return
          this.hide(host, true)
          void this.browser
            .request(
              host,
              row.tabId
                ? { action: 'activate', id: row.tabId }
                : { action: 'navigate', id: current.tabId, text: row.url },
            )
            .catch((error) => this.browser.ui(host, { type: 'notice', text: String(error) }))
        })
      } else entry.panel.update({ content, theme })
      entry.tabId = tab.state.id
      entry.epoch = tab.epoch
      entry.rows = rows
      const origin = host.window.getContentBounds()
      entry.panel.show({
        anchorBounds: { ...bounds, x: origin.x + bounds.x, y: origin.y + bounds.y },
        placement: 'bottom-start',
      })
      entry.panel.setActiveItem(
        (raw.selected as number) >= 0 && rows[raw.selected as number]
          ? `address-${serial}-${raw.selected}`
          : null,
      )
    } catch (error) {
      console.warn('Native address suggestions unavailable:', error)
      this.destroy(host)
      this.disabled.add(host.id)
      this.browser.publish()
    }
  }
}
