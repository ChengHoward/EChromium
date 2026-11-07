import type { Browser, Host, Tab } from './browser'
import { nextTab } from '../shared/navigation'

export function compatibleWindows(source: Host, target: Host) {
  return (
    source !== target &&
    source.private === target.private &&
    source.profile === target.profile &&
    source.session === target.session &&
    !source.window.isDestroyed() &&
    !target.window.isDestroyed() &&
    !source.closing &&
    !target.closing &&
    !source.batchClosing &&
    !target.batchClosing &&
    !source.tabs.some((t) => t.closing) &&
    !target.tabs.some((t) => t.closing) &&
    target.tabs.length < 100
  )
}

/** Move the actual View; URL reloads would lose forms, history and live page identity. */
export function transferTab(browser: Browser, source: Host, target: Host, tab: Tab, before?: string) {
  if (
    !compatibleWindows(source, target) ||
    tab.hostId !== source.id ||
    !source.tabs.includes(tab) ||
    tab.closing
  )
    throw new Error('无法移动到该窗口。请使用同一资料且未在关闭中的窗口。')
  if (before !== undefined && !target.tabs.some((t) => t.state.id === before))
    throw new Error('目标标签已关闭或移动，请重试。')
  const oldSource = [...source.tabs],
    oldTarget = [...target.tabs],
    sourceActive = source.activeId,
    targetActive = target.activeId
  const sourceFullscreen = source.htmlFullscreen,
    targetFullscreen = target.htmlFullscreen
  const epoch = tab.epoch,
    permissionEpoch = tab.permissionEpoch
  const view = tab.view
  browser.find.closeTab(tab)
  if (view) browser.dialogs.cancelRoot(view.webContents.id)
  browser.suggestions.hide(source, true)
  browser.suggestions.hide(target, true)
  if (view && !view.webContents.isDestroyed()) view.webContents.stopFindInPage('clearSelection')
  let removed = false,
    attached = false
  try {
    view?.setVisible(false)
    if (view) {
      source.window.contentView.removeChildView(view)
      removed = true
      target.window.contentView.addChildView(view)
      attached = true
    }
    source.tabs = source.tabs.filter((t) => t !== tab)
    const index =
      before === undefined ? target.tabs.length : target.tabs.findIndex((t) => t.state.id === before)
    target.tabs.splice(index, 0, tab)
    target.tabs.sort((a, b) => Number(b.state.pinned) - Number(a.state.pinned))
    tab.hostId = target.id
    tab.epoch++
    tab.permissionEpoch++
    if (sourceActive === tab.state.id) {
      if (source.htmlFullscreen) {
        source.htmlFullscreen = false
        source.window.setFullScreen(false)
      }
      const next = nextTab(
        oldSource.map((t) => t.state.id),
        tab.state.id,
        source.tabs.map((t) => t.state.id),
      )
      if (next) browser.activate(source, next)
      else source.activeId = ''
    }
    browser.activate(target, tab.state.id)
  } catch (error) {
    source.tabs = oldSource
    target.tabs = oldTarget
    tab.hostId = source.id
    tab.epoch = epoch
    tab.permissionEpoch = permissionEpoch
    source.activeId = sourceActive
    target.activeId = targetActive
    view?.setVisible(false)
    if (attached && view) target.window.contentView.removeChildView(view)
    if (removed && view) source.window.contentView.addChildView(view)
    source.htmlFullscreen = sourceFullscreen
    target.htmlFullscreen = targetFullscreen
    if (sourceFullscreen) source.window.setFullScreen(true)
    if (targetFullscreen) target.window.setFullScreen(true)
    browser.layout(source)
    browser.layout(target)
    browser.publish()
    throw error
  }
  if (view) {
    const ids = new Set([view.webContents.id])
    // Popups keep their opener relationship; update the application's current host attribution.
    for (let changed = true; changed; ) {
      changed = false
      for (const popup of browser.popups.values())
        if (ids.has(popup.sourceId) && !ids.has(popup.window.webContents.id)) {
          ids.add(popup.window.webContents.id)
          popup.hostId = target.id
          changed = true
        }
    }
  }
  if (!source.tabs.length) source.window.destroy()
  target.window.show()
  target.window.focus()
  browser.saveSession()
  browser.publish()
}
