import { app, ipcMain, Menu } from 'electron'
import path from 'node:path'
import { Browser } from './browser'
import { BrowserStore } from './storage'
import { webTarget } from '../shared/navigation'

app.setName('EChromium')
if (process.env.ECHROMIUM_SMOKE)
  process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection in browser smoke:', error)
    app.exit(1)
  })
if (process.env.ECHROMIUM_USER_DATA) app.setPath('userData', path.resolve(process.env.ECHROMIUM_USER_DATA))
const locked = app.requestSingleInstanceLock()
if (!locked) app.quit()
else {
  let browser: Browser
  app.on('second-instance', (_event, argv) => {
    if (!browser) return
    const urls = argv.filter(webTarget),
      host = [...browser.hosts.values()].find((h) => !h.private) || browser.createWindow()
    for (const url of urls) void browser.request(host, { action: 'new-tab', url }).catch(console.error)
    if (host.window.isMinimized()) host.window.restore()
    host.window.show()
    host.window.focus()
  })
  void app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(null)
      const store = new BrowserStore(app.getPath('userData'))
      browser = new Browser(store)
      ipcMain.handle('browser:request', (event, request) => browser.request(browser.sender(event), request))
      ipcMain.handle('browser:site-data', (event, request) =>
        browser.siteData.request(browser.sender(event), request),
      )
      ipcMain.handle('browser:browsing-data', (event, request) =>
        browser.browsingData.request(browser.sender(event), request),
      )
      ipcMain.handle('browser:site-inventory', (event, request) =>
        browser.siteInventory.request(browser.sender(event), request),
      )
      ipcMain.handle('browser:tab-previews', (event, request) =>
        browser.previews.request(browser.sender(event), request),
      )
      ipcMain.handle('browser:suggestions', (event, request) => {
        const host = browser.sender(event)
        if (!request || typeof request !== 'object') throw new Error('无效的地址建议。')
        browser.suggestions.show(host, request.id, request.text, request.value)
      })
      const host = browser.restoreWindows()[0]
      for (const url of process.argv.slice(1).filter(webTarget))
        void browser.request(host, { action: 'new-tab', url }).catch(console.error)
      app.on('activate', () => {
        if (!browser.hosts.size) browser.createWindow()
      })
      app.on('will-quit', () => {
        browser.flushForExit()
      })
      if (process.env.ECHROMIUM_SESSION_SMOKE) {
        const { smokeSession } = await import('./smoke-session')
        await smokeSession(browser, process.env.ECHROMIUM_SESSION_SMOKE)
      } else if (process.env.ECHROMIUM_SMOKE) {
        const { smoke } = await import('./smoke')
        await smoke(browser, host)
      }
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
