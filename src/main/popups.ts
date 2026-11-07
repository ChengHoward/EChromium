import { Menu, type WebContents } from 'electron'
import { safeOrigin, webTarget } from '../shared/navigation'
import type { Browser, Tab } from './browser'
import { windowOpenTarget } from '../shared/window-open'

export function installPopup(browser: Browser, wc: WebContents, root: () => Tab | undefined) {
  const context = () => {
    const tab = root(),
      host = tab && browser.hosts.get(tab.hostId)
    return tab && host && host.tabs.includes(tab) && !host.window.isDestroyed() ? { tab, host } : undefined
  }
  wc.setWindowOpenHandler((details) => {
    const current = context()
    if (!current?.tab.view) return { action: 'deny' }
    const { tab, host } = current,
      rootId = tab.view!.webContents.id
    const target = windowOpenTarget(details.disposition, details.features)
    if (target !== 'popup' && host.tabs.length >= 100) return { action: 'deny' }
    const sourcePopup = [...browser.popups.values()].find((p) => p.window.webContents === wc)
    const foreground =
      !host.overview &&
      !host.closing &&
      !host.batchClosing &&
      !tab.closing &&
      host.activeId === tab.state.id &&
      (sourcePopup ? sourcePopup.window.isFocused() : host.window.isFocused())
    const allowed = browser.popupPolicy.request(
      rootId,
      tab.permissionEpoch,
      details.url,
      foreground,
      [...browser.popups.values()].filter((p) => p.rootId === rootId).length,
      browser.popups.size,
    )
    if (!allowed) {
      browser.publishSoon()
      return { action: 'deny' }
    }
    // Let Chromium create the native child: preserves POST, referrer and WindowProxy.
    return {
      action: 'allow',
      ...(target !== 'popup'
        ? {
            outlivesOpener: true,
            createWindow: (options: Electron.BrowserWindowConstructorOptions) => {
              // Adopt Chromium's actual guest, preserving POST bodies, referrers and WindowProxy.
              // Replaying the URL here would turn form submissions into GET requests.
              // This runtime supplies the native guest, although its public declaration omits the field.
              const guest = (
                options as Electron.BrowserWindowConstructorOptions & { webContents: WebContents }
              ).webContents
              const owner = context()
              if (!owner || owner.host.closing || owner.host.tabs.length >= 100) {
                setImmediate(() => {
                  if (!guest.isDestroyed()) guest.close({ waitForBeforeUnload: false })
                })
                return guest
              }
              try {
                return browser.adoptTab(owner.host, owner.tab, guest, details.url, target === 'background')
              } catch (error) {
                console.error('Unable to attach new tab', error)
                setImmediate(() => {
                  if (!guest.isDestroyed()) guest.close({ waitForBeforeUnload: false })
                })
                return guest
              }
            },
          }
        : {}),
      overrideBrowserWindowOptions: {
        width: 1000,
        height: 740,
        frame: true,
        autoHideMenuBar: false,
        webPreferences: {
          session: host.session,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
          spellcheck: true,
          autoplayPolicy: 'document-user-activation-required',
          disableHtmlFullscreenWindowResize: true,
          safeDialogs: true,
          safeDialogsMessage: '不再显示此来源的连续对话框',
        },
      },
    }
  })
  wc.on('did-create-window', (child) => {
    const current = context()
    if (!current?.tab.view) {
      child.destroy()
      return
    }
    const { tab, host } = current
    browser.popups.set(child.id, {
      window: child,
      profile: host.profile,
      hostId: host.id,
      sourceId: wc.id,
      rootId: tab.view!.webContents.id,
    })
    const update = () => {
      const origin = safeOrigin(child.webContents.getURL())
      child.setTitle(`${origin} — EChromium 弹出窗口`)
      child.setMenu(
        Menu.buildFromTemplate([
          { label: origin, enabled: false },
          {
            label: '后退',
            click: () => {
              if (child.webContents.navigationHistory.canGoBack())
                child.webContents.navigationHistory.goBack()
            },
          },
          { label: '重新加载', click: () => child.webContents.reload() },
          { label: '关闭', click: () => child.close() },
        ]),
      )
    }
    child.webContents.on('page-title-updated', (e) => {
      e.preventDefault()
      update()
    })
    child.webContents.on('did-navigate', update)
    child.webContents.on('will-navigate', (e, url) => {
      if (!webTarget(url)) e.preventDefault()
    })
    child.webContents.on('will-redirect', (e, url) => {
      if (!webTarget(url)) e.preventDefault()
    })
    child.once('closed', () => browser.popups.delete(child.id))
    browser.dialogs.install(child.webContents, root, () => child)
    installPopup(browser, child.webContents, root)
    update()
  })
}
