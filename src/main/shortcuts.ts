import type { Browser, Host } from './browser'
import type { BrowserRequest } from '../shared/model'

export function routeShortcut(browser: Browser, host: Host, event: Electron.Event, input: Electron.Input) {
  if (input.type !== 'keyDown' || input.isComposing) return
  const key = input.key.toLowerCase(),
    ctrl = input.control || input.meta
  const run = (request: BrowserRequest) => {
    event.preventDefault()
    void browser.request(host, request).catch(console.error)
  }
  if (ctrl && input.shift && key === 'a') run({ action: 'tab-overview' })
  else if (key === 'escape' && host.overview) run({ action: 'tab-overview', value: false })
  else if (ctrl && key === 'f' && host.overview) {
    event.preventDefault()
    browser.ui(host, { type: 'overview-search' })
  } else if (ctrl && key === 'l') {
    event.preventDefault()
    if (host.overview) browser.setOverview(host, false)
    host.window.webContents.focus()
    browser.ui(host, { type: 'focus-address' })
  } else if (ctrl && input.shift && key === 'delete') run({ action: 'open-data' })
  else if (ctrl && input.shift && key === 't') run({ action: 'reopen-tab' })
  else if (ctrl && key === 't') run({ action: 'new-tab' })
  else if (ctrl && key === 'w') run({ action: 'close-tab' })
  else if (ctrl && key === 'n') run({ action: 'new-window', private: input.shift })
  else if (ctrl && key === 'tab') {
    const at = host.tabs.findIndex((t) => t.state.id === host.activeId)
    run({
      action: 'activate',
      id: host.tabs[(at + (input.shift ? -1 : 1) + host.tabs.length) % host.tabs.length]?.state.id,
    })
  } else if (ctrl && /^[1-9]$/.test(key))
    run({
      action: 'activate',
      id: host.tabs[key === '9' ? host.tabs.length - 1 : Number(key) - 1]?.state.id,
    })
  else if (key === 'f5' || (ctrl && key === 'r'))
    run({ action: 'reload', value: input.shift || (key === 'f5' && ctrl) })
  else if (ctrl && key === 'f') {
    run({ action: 'open-find' })
  } else if (key === 'f3' || (ctrl && key === 'g')) {
    run({ action: 'find-step', value: !input.shift })
  } else if (ctrl && ['+', '=', '-', '0'].includes(key))
    run({
      action: 'zoom',
      value: key === '0' ? 1 : (browser.active(host)?.state.zoom || 1) + (key === '-' ? -0.1 : 0.1),
    })
  else if (ctrl && key === 'd') run({ action: 'bookmark' })
  else if (ctrl && input.shift && key === 'o') run({ action: 'new-tab', value: 'bookmarks' })
  else if (ctrl && key === 'j') run({ action: 'new-tab', value: 'downloads' })
  else if (ctrl && key === 'h') run({ action: 'new-tab', value: 'history' })
  else if (key === 'f12') {
    event.preventDefault()
    browser.active(host)?.view?.webContents.openDevTools({ mode: 'detach' })
  } else if (key === 'f11') {
    event.preventDefault()
    host.window.setFullScreen(!host.window.isFullScreen())
  } else if (key === 'escape' && host.window.isFullScreen()) {
    event.preventDefault()
    host.htmlFullscreen = false
    host.window.setFullScreen(false)
  } else if (input.alt && ['left', 'arrowleft', 'right', 'arrowright'].includes(key))
    run({ action: key.includes('left') ? 'back' : 'forward' })
}
