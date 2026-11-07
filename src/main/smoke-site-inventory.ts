import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { webContents } from 'electron'
import type { Browser, Host } from './browser'
import type { SiteInventory } from '../shared/site-inventory'

async function until(check: () => boolean | Promise<boolean>, label: string) {
  const start = Date.now()
  while (Date.now() - start < 14000) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 65))
  }
  throw new Error('Timed out: ' + label)
}
export async function smokeSiteInventory(browser: Browser, host: Host, origin: string, report: string) {
  const previous = host.activeId,
    otherOrigin = process.env.ECHROMIUM_SMOKE_OTHER_ORIGIN!,
    privateHost = browser.createWindow({ private: true }),
    target = browser.newTab(host, 'web', origin + '/inventory'),
    other = browser.newTab(host, 'web', otherOrigin + '/inventory'),
    privateTab = browser.newTab(privateHost, 'web', origin + '/inventory-private')
  let settings: ReturnType<Browser['newTab']> | undefined
  const js = (code: string) => host.window.webContents.executeJavaScript(code)
  const seed = `(async()=>{localStorage.setItem('inventory-local','keep');sessionStorage.setItem('inventory-session','keep');await (await caches.open('inventory-cache')).put('/inventory-large',new Response('x'.repeat(65536)));await new Promise((resolve,reject)=>{const request=indexedDB.open('inventory-db',1);request.onupgradeneeded=()=>request.result.createObjectStore('rows');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const transaction=db.transaction('rows','readwrite');transaction.objectStore('rows').put('x'.repeat(32000),'test');transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}});return true})()`
  try {
    await until(
      () =>
        !target.state.loading &&
        !other.state.loading &&
        !privateTab.state.loading &&
        target.state.title === 'Fixture one' &&
        other.state.title === 'Fixture one' &&
        privateTab.state.title === 'Fixture one',
      'inventory fixture pages',
    )
    const wc = target.view!.webContents
    await wc.executeJavaScript(seed)
    await other.view!.webContents.executeJavaScript(seed)
    await privateTab.view!.webContents.executeJavaScript(seed)
    await wc.executeJavaScript(
      'document.getElementById("input").value="keep live form";window.inventoryIdentity="live"',
    )
    await host.session.cookies.set({ url: origin, name: 'inventory-proof', value: 'secret-never-for-ui' })
    await host.session.cookies.set({
      url: 'https://inventory-only.invalid',
      name: 'inventory-domain-proof',
      value: 'another-secret-never-for-ui',
    })
    await privateHost.session.cookies.set({
      url: 'https://inventory-private.invalid',
      name: 'inventory-private-proof',
      value: 'private',
    })
    settings = browser.newTab(host, 'settings')
    await until(
      async () => js('Boolean(document.querySelector(".site-overview-tools"))'),
      'site inventory UI',
    )
    const list = async (query = '', offset = 0) =>
      (await browser.siteInventory.request(host, { action: 'list', id: settings!.state.id, query, offset }))
        .inventory!
    const clear = (inventory: SiteInventory, rowId: string, version = inventory.version) =>
      browser.siteInventory.request(host, { action: 'clear', id: settings!.state.id, rowId, version })
    const ids = webContents
      .getAllWebContents()
      .map((w) => w.id)
      .sort()
    wc.debugger.attach('1.3')
    let inventory: SiteInventory
    try {
      inventory = await list()
      assert.equal(wc.debugger.isAttached(), true, 'statistics never detach the user page debugger')
      assert.equal(
        (
          await wc.debugger.sendCommand('Runtime.evaluate', {
            expression: 'window.inventoryIdentity',
            returnByValue: true,
          })
        ).result.value,
        'live',
      )
    } finally {
      if (!wc.isDestroyed() && wc.debugger.isAttached()) wc.debugger.detach()
    }
    await until(
      () =>
        JSON.stringify(
          webContents
            .getAllWebContents()
            .map((w) => w.id)
            .sort(),
        ) === JSON.stringify(ids),
      'statistics target is destroyed',
    )
    const row = inventory.rows.find((r) => r.origin === origin)!,
      otherRow = inventory.rows.find((r) => r.origin === otherOrigin)!,
      cookieRow = inventory.rows.find((r) => r.hostname === 'inventory-only.invalid')!
    assert.ok(row.storage && row.storage.bytes > 0, 'actual quota storage measured')
    assert.ok(row.storage.breakdown.some((item) => item.type === 'cache_storage' && item.bytes > 0))
    assert.ok(otherRow.storage && otherRow.storage.bytes > 0)
    assert.ok(row.cookieCount >= 1)
    assert.equal(cookieRow.origin, undefined, 'cookie-only host is never assigned an invented origin')
    assert.equal(cookieRow.cookieCount, 1)
    assert.ok(!JSON.stringify(inventory).includes('secret-never-for-ui'))
    assert.ok(!JSON.stringify(inventory).includes('inventory-private.invalid'))
    assert.equal(await wc.executeJavaScript('document.getElementById("input").value'), 'keep live form')
    await assert.rejects(clear(inventory, 'origin:https://not-listed.invalid'))
    await assert.rejects(clear(inventory, row.id, 'forged-version'))
    browser.siteData.confirm = async () => false
    assert.equal((await clear(inventory, row.id)).cancelled, true)
    assert.equal(await wc.executeJavaScript('localStorage.getItem("inventory-local")'), 'keep')
    let respond!: (value: boolean) => void
    browser.siteData.confirm = () =>
      new Promise((resolve) => {
        respond = resolve
      })
    const pending = clear(inventory, row.id)
    await until(() => !!respond, 'inventory clear confirmation')
    browser.activate(host, target.state.id)
    respond(true)
    assert.equal((await pending).cancelled, true)
    browser.activate(host, settings.state.id)
    const refreshed = await list()
    await assert.rejects(clear(inventory, row.id), /列表已变化/)
    browser.siteData.confirm = async () => true
    assert.equal((await clear(refreshed, cookieRow.id)).cleared, true)
    assert.equal((await host.session.cookies.get({ name: 'inventory-domain-proof' })).length, 0)
    assert.equal(
      await wc.executeJavaScript('localStorage.getItem("inventory-local")'),
      'keep',
      'cookie-only removal preserves origin storage',
    )
    await js(
      `document.querySelector('a[href="#site-data"]').click();document.querySelector('.site-overview-tools').requestSubmit()`,
    )
    await until(
      async () =>
        js(
          'Boolean(document.querySelector(".site-overview-summary")) && document.querySelector(".site-data-overview").getAttribute("aria-busy")==="false"',
        ),
      'UI reads actual inventory',
    )
    await new Promise((resolve) => setTimeout(resolve, 120))
    fs.writeFileSync(
      path.join(path.dirname(report), 'site-inventory.png'),
      (await host.window.webContents.capturePage()).toPNG(),
    )
    await js(
      `Array.from(document.querySelectorAll('.site-overview-row')).find(row=>row.dataset.siteId===${JSON.stringify(row.id)}).querySelector('button').click()`,
    )
    await until(
      async () =>
        js(
          'document.querySelector(".site-overview-notice")?.textContent.includes("已清除") && document.querySelector(".site-data-overview").getAttribute("aria-busy")==="false"',
        ),
      'UI clears one origin and refreshes',
    )
    assert.equal(await wc.executeJavaScript('localStorage.getItem("inventory-local")'), null)
    assert.equal(await wc.executeJavaScript('sessionStorage.getItem("inventory-session")'), null)
    assert.deepEqual(await wc.executeJavaScript('caches.keys()'), [])
    assert.equal(
      await other.view!.webContents.executeJavaScript('localStorage.getItem("inventory-local")'),
      'keep',
    )
    assert.equal(
      await privateTab.view!.webContents.executeJavaScript('localStorage.getItem("inventory-local")'),
      'keep',
    )
    for (let i = 0; i < 43; i++)
      await host.session.cookies.set({
        url: `https://inventory-pagination-${String(i).padStart(2, '0')}.invalid`,
        name: 'inventory-page',
        value: 'keep',
      })
    const first = await list('inventory-pagination'),
      second = await list('inventory-pagination', 40)
    assert.equal(first.total, 43)
    assert.equal(first.rows.length, 40)
    assert.equal(second.offset, 40)
    assert.equal(second.rows.length, 3)
    assert.ok(first.rows.every((r) => !r.origin))
    await assert.rejects(clear(first, first.rows[0].id), /列表已变化/)
    await assert.rejects(list('', -1))
    const stale = list()
    browser.activate(host, target.state.id)
    await assert.rejects(stale, /设置页已变化/)
    browser.activate(host, settings.state.id)
    const privateSettings = browser.newTab(privateHost, 'settings'),
      privateInventory = (
        await browser.siteInventory.request(privateHost, { action: 'list', id: privateSettings.state.id })
      ).inventory!
    assert.ok(privateInventory.rows.some((r) => r.hostname === 'inventory-private.invalid'))
    assert.ok(!privateInventory.rows.some((r) => r.hostname.includes('inventory-pagination')))
    assert.ok(!JSON.stringify(privateInventory).includes(otherOrigin))
  } finally {
    browser.siteData.confirm = undefined
    if (settings && host.tabs.includes(settings)) await browser.closeTab(host, settings)
    await browser.closeTab(host, target)
    await browser.closeTab(host, other)
    await browser.closeWindow(privateHost)
    browser.activate(host, previous)
  }
}
