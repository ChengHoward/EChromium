import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { Browser, Host } from './browser'
import type { DataOptions } from '../shared/browsing-data'

async function until(check: () => boolean | Promise<boolean>, label: string) {
  const start = Date.now()
  while (Date.now() - start < 12000) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 70))
  }
  throw new Error('Timed out: ' + label)
}
export async function smokeBrowsingData(browser: Browser, host: Host, origin: string, report: string) {
  const previous = host.activeId,
    privateHost = browser.createWindow({ private: true }),
    target = browser.newTab(host, 'web', origin + '/clear-data'),
    privateTab = browser.newTab(privateHost, 'web', origin + '/private-clear-data')
  let settings: ReturnType<Browser['newTab']> | undefined
  const js = (code: string) => host.window.webContents.executeJavaScript(code)
  const historyOptions: DataOptions = {
    range: 'hour',
    history: true,
    downloads: true,
    siteData: false,
    cache: false,
  }
  try {
    await until(
      () =>
        !target.state.loading &&
        !privateTab.state.loading &&
        target.state.title === 'Fixture one' &&
        privateTab.state.title === 'Fixture one',
      'clear data pages',
    )
    const seed =
      'localStorage.setItem("clear-data-proof","keep");sessionStorage.setItem("clear-data-proof","keep")'
    await target.view!.webContents.executeJavaScript(seed)
    await privateTab.view!.webContents.executeJavaScript(seed)
    await host.session.cookies.set({ url: origin, name: 'clear-data-proof', value: 'normal' })
    await privateHost.session.cookies.set({ url: origin, name: 'clear-data-proof', value: 'private' })
    await browser.request(host, { action: 'open-data' })
    settings = browser.active(host)!
    await until(
      async () => js('Boolean(document.querySelector(".clear-browsing-data"))'),
      'privacy settings UI',
    )
    assert.equal(settings.state.settingsSection, 'privacy')
    assert.equal(await js('document.querySelectorAll(".data-options input:disabled").length'), 2)
    const now = Date.now(),
      old = { title: 'Old record', url: origin + '/clear-old', at: now - 7200000 },
      recent = { title: 'Recent record', url: origin + '/clear-recent', at: now - 10000 }
    browser.store.data.history.push(old, recent)
    const bookmarks = JSON.stringify(browser.store.data.bookmarks),
      rules = JSON.stringify(browser.store.data.permissions),
      downloads = browser.downloads.list(host.profile)
    const ended = downloads.filter((d) => !d.active && d.at >= now - 3600000)
    const files = ended.filter((d) => d.path && fs.existsSync(d.path)).map((d) => d.path)
    const request = (action: 'preview' | 'clear', options = historyOptions) =>
      browser.browsingData.request(host, { action, id: settings!.state.id, options })
    await assert.rejects(request('clear', { ...historyOptions, siteData: true }), /全部时间/)
    await assert.rejects(
      browser.browsingData.request(host, { action: 'clear', id: target.state.id, options: historyOptions }),
    )
    browser.browsingData.confirm = async () => false
    assert.equal((await request('clear')).cancelled, true)
    assert.ok(browser.store.data.history.includes(recent))
    let respond!: (value: boolean) => void
    browser.browsingData.confirm = () =>
      new Promise((resolve) => {
        respond = resolve
      })
    const stale = request('clear')
    await until(() => !!respond, 'data confirmation')
    await assert.rejects(request('clear'), /正在清除/)
    browser.activate(host, target.state.id)
    respond(true)
    assert.equal((await stale).cancelled, true)
    assert.ok(browser.store.data.history.includes(recent))
    browser.activate(host, settings.state.id)
    browser.browsingData.confirm = async () => {
      // Data added after the confirmation began is excluded by the frozen end time.
      browser.store.data.history.push({
        title: 'Later record',
        url: origin + '/clear-future',
        at: Date.now() + 1000,
      })
      return true
    }
    const removed = await request('clear')
    assert.equal(removed.cleared, true)
    assert.equal(removed.downloads, ended.length)
    assert.ok(browser.store.data.history.includes(old))
    assert.ok(!browser.store.data.history.includes(recent))
    assert.ok(browser.store.data.history.some((v) => v.url.endsWith('/clear-future')))
    for (const file of files) assert.equal(fs.existsSync(file), true)
    assert.equal(
      await target.view!.webContents.executeJavaScript('localStorage.getItem("clear-data-proof")'),
      'keep',
    )
    browser.browsingData.confirm = async () => true
    await until(
      async () =>
        js(
          `document.querySelector('.tab.selected')?.dataset.tabId===${JSON.stringify(settings!.state.id)} && Boolean(document.querySelector('.clear-browsing-data'))`,
        ),
      'current data settings rendered after reactivation',
    )
    await js(
      `(()=>{const range=document.querySelector('select[aria-label="清除数据的时间范围"]');range.value="all";range.dispatchEvent(new Event("change",{bubbles:true}))})()`,
    )
    await until(
      async () => js('document.querySelectorAll(".data-options input:disabled").length===0'),
      'all-time storage selection',
    )
    await js(
      '(()=>{const inputs=document.querySelectorAll(".data-options input");for(const index of [0,2,3]){inputs[index].click()}document.querySelector(".clear-browsing-data").click()})()',
    )
    await until(
      async () => js('document.querySelector(".data-result")?.textContent.includes("已清除")'),
      'renderer confirms all-time storage/cache clearing',
    )
    assert.equal((await host.session.cookies.get({ name: 'clear-data-proof' })).length, 0)
    assert.deepEqual(
      await target.view!.webContents.executeJavaScript(
        '({local:localStorage.getItem("clear-data-proof"),session:sessionStorage.getItem("clear-data-proof")})',
      ),
      { local: null, session: null },
    )
    assert.equal((await privateHost.session.cookies.get({ name: 'clear-data-proof' }))[0].value, 'private')
    assert.equal(
      await privateTab.view!.webContents.executeJavaScript('localStorage.getItem("clear-data-proof")'),
      'keep',
    )
    assert.equal(JSON.stringify(browser.store.data.bookmarks), bookmarks)
    assert.equal(JSON.stringify(browser.store.data.permissions), rules)
    await new Promise((resolve) => setTimeout(resolve, 200))
    fs.writeFileSync(
      path.join(path.dirname(report), 'browsing-data.png'),
      (await host.window.webContents.capturePage()).toPNG(),
    )
    const privateSettings = browser.newTab(privateHost, 'settings')
    await assert.rejects(
      browser.browsingData.request(privateHost, {
        action: 'clear',
        id: privateSettings.state.id,
        options: historyOptions,
      }),
      /隐私/,
    )
    const globalBefore = JSON.stringify(browser.store.data.history)
    assert.equal(
      (
        await browser.browsingData.request(privateHost, {
          action: 'clear',
          id: privateSettings.state.id,
          options: { ...historyOptions, range: 'all', history: false, siteData: true },
        })
      ).cleared,
      true,
    )
    assert.equal(JSON.stringify(browser.store.data.history), globalBefore)
    assert.equal((await privateHost.session.cookies.get({ name: 'clear-data-proof' })).length, 0)
  } finally {
    browser.browsingData.confirm = undefined
    if (settings && host.tabs.includes(settings)) await browser.closeTab(host, settings)
    await browser.closeTab(host, target)
    await browser.closeWindow(privateHost)
    browser.activate(host, previous)
  }
}
