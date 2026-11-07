import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { Browser, Host } from './browser'

async function until(check: () => boolean | Promise<boolean>, label: string) {
  const start = Date.now()
  while (Date.now() - start < 12000) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 75))
  }
  throw new Error(`Timed out: ${label}`)
}
export async function smokeViewLayout(browser: Browser, host: Host, origin: string, report: string) {
  const previous = host.activeId,
    originalBounds = host.window.getBounds(),
    bookmarksBar = browser.store.data.preferences.bookmarksBar
  const tab = browser.newTab(host, 'web', origin + '/view-layout')
  const js = (code: string) => host.window.webContents.executeJavaScript(code)
  const exists = (selector: string) =>
    until(async () => js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), selector)
  let geometry: unknown
  const findFits = () => {
    const panel = browser.find.panel(host)!.getDiagnostics().bounds,
      window = host.window.getContentBounds(),
      pageTop = window.y + tab.view!.getBounds().y
    assert.ok(panel.y >= window.y + 44, 'find leaves the title bar and window buttons clear')
    assert.ok(panel.y < pageTop, 'find uses browser chrome space above the page')
    assert.ok(panel.y + panel.height <= pageTop + 60, 'find covers at most a shallow strip of the page')
    assert.ok(
      panel.x >= window.x && panel.x + panel.width <= window.x + window.width,
      'find fits inside narrow windows',
    )
  }
  const aligned = () =>
    until(
      async () => {
        const measured = await js(
          `(()=>{const rect=document.querySelector('.viewport').getBoundingClientRect(),chrome=document.querySelector('.chrome').getBoundingClientRect();return {id:document.querySelector('.tab.selected')?.dataset.tabId,x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height),top:chrome.bottom,padding:parseFloat(getComputedStyle(document.querySelector('.content-frame')).paddingTop),radius:parseFloat(getComputedStyle(document.querySelector('.viewport')).borderTopLeftRadius)}})()`,
        )
        const native = tab.view!.getBounds()
        geometry = { measured, native }
        return (
          measured.id === tab.state.id &&
          measured.radius === 10 &&
          Math.abs(measured.y - measured.top - measured.padding) <= 1 &&
          (['x', 'y', 'width', 'height'] as const).every((key) => native[key] === measured[key])
        )
      },
      'native view and browser surface agree: ' + JSON.stringify(geometry),
    )
  try {
    await until(() => !tab.state.loading && tab.state.title === 'Fixture one', 'layout fixture')
    await aligned()
    const initialTop = tab.view!.getBounds().y
    await browser.request(host, { action: 'popup-policy', id: tab.state.id, value: true })
    await exists('.popup-controls')
    await aligned()
    assert.ok(tab.view!.getBounds().y > initialTop)
    await browser.request(host, { action: 'dialog-policy', id: tab.state.id, value: true })
    await exists('.dialog-controls')
    await aligned()
    const beforeFind = tab.view!.getBounds()
    browser.find.open(host)
    assert.equal(browser.find.panel(host)?.getDiagnostics().visible, true)
    assert.deepEqual(tab.view!.getBounds(), beforeFind, 'native find does not move the guest')
    findFits()
    await aligned()
    await browser.request(host, { action: 'preferences', value: { bookmarksBar: false } })
    await until(async () => js('!document.querySelector(".bookmarks-bar")'), 'hidden bookmarks bar')
    await aligned()
    const current = tab.view!.getBounds()
    findFits()
    await browser.request(host, {
      action: 'layout',
      id: previous,
      value: { x: 0, y: 0, width: 1, height: 1 },
    })
    assert.deepEqual(tab.view!.getBounds(), current, 'late geometry from another tab is ignored')
    host.window.setBounds({
      ...originalBounds,
      width: 700,
      height: Math.max(520, originalBounds.height - 80),
    })
    await until(
      async () => (await js('window.innerWidth')) === host.window.getContentSize()[0],
      'resized shell',
    )
    await aligned()
    findFits()
    await new Promise((resolve) => setTimeout(resolve, 350))
    fs.writeFileSync(
      path.join(path.dirname(report), 'view-top.png'),
      (await host.window.webContents.capturePage()).toPNG(),
    )
    // Exercise real native sizing and clipping without claiming to automate a player's fullscreen entry.
    host.htmlFullscreen = true
    browser.layout(host)
    assert.deepEqual(tab.view!.getBounds(), {
      x: 0,
      y: 0,
      width: host.window.getContentSize()[0],
      height: host.window.getContentSize()[1],
    })
    assert.equal(tab.viewRadius, 0)
    host.htmlFullscreen = false
    browser.layout(host)
    assert.equal(tab.viewRadius, 10)
    await aligned()
  } catch (error) {
    console.error('View geometry:', geometry)
    throw error
  } finally {
    host.htmlFullscreen = false
    browser.find.close(host, false)
    host.window.setBounds(originalBounds)
    await browser.request(host, { action: 'preferences', value: { bookmarksBar } })
    await browser.closeTab(host, tab)
    browser.activate(host, previous)
  }
}
