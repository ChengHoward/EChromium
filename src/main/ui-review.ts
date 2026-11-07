import { app, ipcMain, Menu } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { Browser } from './browser'
import { BrowserStore } from './storage'
import { themes } from '../shared/appearance'
import type { ThemeId } from '../shared/model'
import { inspectTextContrast } from './ui-text-audit'

const directory = path.resolve('test-results/ui-review')
fs.mkdirSync(directory, { recursive: true })
app.setPath('userData', path.resolve(`.local/ui-review-${Date.now()}`))
const outputs: string[] = []
const textAudits: { scene: string; checked: number; lowest: number; failures: unknown[] }[] = []
const started = new Date().toISOString()
async function until(check: () => Promise<boolean>, label: string) {
  const start = Date.now()
  while (Date.now() - start < 8000) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error('UI review: ' + label)
}
void app
  .whenReady()
  .then(async () => {
    Menu.setApplicationMenu(null)
    const store = new BrowserStore(app.getPath('userData'))
    store.data.preferences.acrylic = false
    store.visit('https://example.test/ui-review', '界面检查 · 示例页面')
    store.toggleBookmark('https://example.test/ui-review', '示例书签')
    const browser = new Browser(store)
    ipcMain.handle('browser:request', (event, request) => browser.request(browser.sender(event), request))
    ipcMain.handle('browser:suggestions', (event, request) =>
      browser.suggestions.show(browser.sender(event), request.id, request.text, request.value),
    )
    ipcMain.handle('browser:tab-previews', (event, request) =>
      browser.previews.request(browser.sender(event), request),
    )
    ipcMain.handle('browser:browsing-data', (event, request) =>
      browser.browsingData.request(browser.sender(event), request),
    )
    ipcMain.handle('browser:site-data', (event, request) =>
      browser.siteData.request(browser.sender(event), request),
    )
    ipcMain.handle('browser:site-inventory', (event, request) =>
      browser.siteInventory.request(browser.sender(event), request),
    )
    const host = browser.createWindow(),
      wc = host.window.webContents
    wc.setBackgroundThrottling(false)
    host.window.setSize(1360, 900)
    host.window.show()
    const settings = browser.newTab(host, 'settings')
    const js = (code: string) => wc.executeJavaScript(code)
    await until(() => js('Boolean(document.getElementById("theme-depth"))'), 'settings rendered')
    const audit = async (scene: string) => {
      await until(
        () => js('!document.querySelector(".tab-motion-enter-active,.tab-motion-leave-active")'),
        'tab motion settles before static text audit',
      )
      await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const text = await js(`(${inspectTextContrast.toString()})()`)
      textAudits.push({ scene, ...text })
      assert.equal(text.failures.length, 0, scene + ': ' + JSON.stringify(text.failures.slice(0, 8)))
    }
    const capture = async (name: string) => {
      await audit(name)
      const result = await wc.capturePage()
      assert.equal(result.isEmpty(), false)
      fs.writeFileSync(path.join(directory, name), result.toPNG())
      outputs.push(name)
    }
    for (const theme of Object.keys(themes) as ThemeId[]) {
      for (const mode of ['light', 'dark'] as const) {
        await browser.request(host, { action: 'preferences', value: { theme, mode } })
        await js('document.querySelector(".settings-content").scrollTop=0')
        await capture(`settings-${theme}-${mode}.png`)
        for (const themeDepth of [0, 100]) {
          await browser.request(host, { action: 'preferences', value: { themeDepth } })
          if (themeDepth === 100) await capture(`settings-${theme}-${mode}-depth-100.png`)
          else await audit(`${theme}-${mode}-depth-${themeDepth}`)
        }
        await browser.request(host, { action: 'preferences', value: { themeDepth: 50 } })
      }
    }
    await js('document.getElementById("privacy").scrollIntoView({block:"start"})')
    await until(
      () =>
        js(
          'document.querySelector(".settings-nav a[aria-current=location]")?.getAttribute("href")==="#privacy"',
        ),
      'navigation follows scroll',
    )
    await js('document.querySelector(".settings-content").scrollTop=1e6')
    await until(
      () =>
        js(
          'document.querySelector(".settings-nav a[aria-current=location]")?.getAttribute("href")==="#about"',
        ),
      'navigation identifies final section',
    )
    for (const mode of ['light', 'dark'] as const) {
      await browser.request(host, { action: 'preferences', value: { theme: 'mist', mode } })
      for (const section of ['appearance', 'browsing', 'privacy', 'site-data', 'permissions', 'about']) {
        await js(`document.getElementById('${section}').scrollIntoView({block:'start'})`)
        await audit(`settings-section-${section}-${mode}`)
      }
    }
    for (const mode of ['light', 'dark'] as const) {
      await browser.request(host, { action: 'preferences', value: { theme: 'mist', mode } })
      browser.activate(host, host.tabs[0].state.id)
      await until(() => js('Boolean(document.querySelector(".start-search"))'), 'new tab rendered')
      await capture(`new-tab-${mode}.png`)
      browser.activate(host, settings.state.id)
      host.window.setSize(700, 700)
      await js('document.querySelector(".settings-content").scrollTop=0')
      await capture(`settings-narrow-${mode}.png`)
      const layout = await js(`(()=>{const e=document.querySelector('.settings-content');return {
      right:e.getBoundingClientRect().right,edge:document.querySelector('.viewport').getBoundingClientRect().right,
      width:e.clientWidth,scroll:e.scrollWidth}})()`)
      assert.ok(Math.abs(layout.right - layout.edge) < 1 && layout.scroll <= layout.width)
      host.window.setSize(1360, 900)
    }
    for (const kind of ['bookmarks', 'history', 'downloads'] as const) {
      const tab = browser.newTab(host, kind)
      await until(
        () =>
          js(
            `Boolean(document.querySelector('.${kind === 'bookmarks' ? 'bookmark-workspace' : kind === 'downloads' ? 'empty-page' : 'history-item'}'))`,
          ),
        kind + ' rendered',
      )
      for (const mode of ['light', 'dark'] as const) {
        await browser.request(host, { action: 'preferences', value: { mode } })
        await capture(`${kind}-${mode}.png`)
      }
      await browser.closeTab(host, tab)
    }
    assert.equal(
      await js('getComputedStyle(document.querySelector(".address-bar input")).userSelect'),
      'text',
    )
    assert.equal(await js('getComputedStyle(document.querySelector(".bookmarks-bar")).userSelect'), 'none')
    for (let index = 0; index < 22; index++) browser.newTab(host, 'newtab', '', false)
    await until(
      () =>
        js(
          'document.querySelectorAll(".tab").length===24&&!document.querySelector(".tab-motion-enter-active")',
        ),
      'compressed strip settled',
    )
    await capture('tabs-compressed.png')
    browser.setOverview(host, true)
    await until(() => js('Boolean(document.querySelector(".tab-overview"))'), 'overview rendered')
    await capture('overview-dark.png')
    browser.setOverview(host, false)
    await new Promise((resolve) => setTimeout(resolve, 100))
    fs.writeFileSync(
      path.join(directory, 'report.json'),
      JSON.stringify(
        {
          started,
          completed: new Date().toISOString(),
          passed: true,
          nativeMaterial: false,
          note: 'Opaque captures verify palette and layout; they do not verify DWM blur.',
          runtime: process.versions,
          executable: process.execPath,
          screenshots: outputs,
          textAudits,
        },
        null,
        2,
      ),
    )
    console.log(`UI review passed; ${outputs.length} screenshots in ${directory}`)
    app.exit(0)
  })
  .catch((error) => {
    fs.writeFileSync(
      path.join(directory, 'report.json'),
      JSON.stringify(
        { started, passed: false, error: String(error), screenshots: outputs, textAudits },
        null,
        2,
      ),
    )
    console.error(error)
    app.exit(1)
  })
