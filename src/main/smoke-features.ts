import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { Browser, Host } from './browser'
import { BrowserStore } from './storage'
import { folderPath } from '../shared/bookmark-folders'

async function until(check: () => boolean | Promise<boolean>, label: string) {
  const start = Date.now()
  while (Date.now() - start < 12000) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 75))
  }
  throw new Error(`Timed out: ${label}`)
}
function shell(host: Host) {
  const evaluate = (code: string) => host.window.webContents.executeJavaScript(code)
  const ready = (selector: string) =>
    until(async () => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), selector)
  const click = async (selector: string) => {
    await ready(selector)
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  }
  return { evaluate, ready, click }
}

export async function smokeBookmarkFolders(browser: Browser, host: Host, origin: string, reportFile: string) {
  const previous = host.activeId,
    manager = browser.newTab(host, 'bookmarks')
  const { evaluate, ready, click } = shell(host)
  const folder = (title: string) => browser.store.data.bookmarkFolders.find((f) => f.title === title)!
  const select = (id: string) => click(`.bookmark-folders [data-folder-id="${id}"]`)
  const root = () => click('.bookmark-folders > button')
  async function create(title: string) {
    await evaluate(
      `[...document.querySelectorAll('.bookmark-tools button')].find(b=>b.textContent.trim()==='新建文件夹').click()`,
    )
    await ready('.folder-editor')
    await evaluate(
      `(()=>{const input=document.querySelector('[aria-label="文件夹名称"]');input.value=${JSON.stringify(title)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.folder-editor').requestSubmit()})()`,
    )
    await until(() => !!folder(title), 'create folder ' + title)
    await until(async () => evaluate('!document.querySelector(".folder-editor")'), 'folder editor closes')
    return folder(title)
  }
  async function importHtml(html: string) {
    await evaluate(
      `(()=>{const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(html)}],'folders.html',{type:'text/html'}));const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    )
    await until(
      async () =>
        evaluate(
          '!document.querySelector("input[type=file]").files.length && !document.querySelector(".bookmark-tools .primary-button").disabled',
        ),
      'folder import completes',
    )
    assert.match(await evaluate('document.querySelector(".bookmark-notice")?.textContent || ""'), /导入完成/)
  }
  try {
    await ready('.bookmark-tools')
    const work = await create('Work'),
      workId = work.id
    await select(workId)
    const docs = await create('Docs'),
      docsId = docs.id
    assert.equal(docs.parentId, workId)
    await root()
    const book = browser.store.data.bookmarks[0]
    await click(`[data-bookmark-id="${book.id}"] .secondary-button`)
    await ready('[aria-label="书签位置"]')
    await evaluate(
      `(()=>{const select=document.querySelector('[aria-label="书签位置"]');select.value=${JSON.stringify(docsId)};select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.bookmark-editor').requestSubmit()})()`,
    )
    await until(
      () => browser.store.data.bookmarks.find((b) => b.id === book.id)?.folderId === docsId,
      'move bookmark into child folder',
    )
    const before = JSON.stringify(browser.store.data.bookmarkFolders)
    await assert.rejects(
      browser.request(host, {
        action: 'save-bookmark-folder',
        id: workId,
        value: { title: 'Work', parentId: docsId },
      }),
    )
    assert.equal(JSON.stringify(browser.store.data.bookmarkFolders), before)
    await select(workId)
    await click(`[data-folder-id="${docsId}"].bookmark-folder-row .secondary-button`)
    await ready('.folder-editor')
    await evaluate(
      `(()=>{const title=document.querySelector('[aria-label="文件夹名称"]'),parent=document.querySelector('[aria-label="文件夹位置"]');title.value='Guides';title.dispatchEvent(new Event('input',{bubbles:true}));parent.value='';parent.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.folder-editor').requestSubmit()})()`,
    )
    await until(() => folder('Guides')?.parentId === undefined, 'rename folder and move to root')
    assert.equal(browser.store.data.bookmarks.find((b) => b.id === book.id)?.folderId, docsId)
    await importHtml(
      `<DL><p><DT><H3>Imported &amp; notes</H3><DL><p><DT><H3>Child</H3><DL><p><DT><A HREF="${origin}/nested">Nested book</A></DL><p></DL><p></DL><p><script>window.folderImportExecuted=true</script>`,
    )
    const nested = browser.store.data.bookmarks.find((b) => b.url === origin + '/nested')!
    assert.ok(nested)
    assert.deepEqual(
      folderPath(nested.folderId, browser.store.data.bookmarkFolders).map((f) => f.title),
      ['Work', 'Imported & notes', 'Child'],
    )
    assert.equal(await evaluate('typeof window.folderImportExecuted'), 'undefined')
    const destination = path.join(path.dirname(reportFile), 'folders-export.html')
    browser.bookmarkExportDestination = async () => destination
    await browser.request(host, { action: 'export-bookmarks' })
    const exported = fs.readFileSync(destination, 'utf8')
    assert.match(exported, /<H3>Imported &amp; notes<\/H3>/)
    await root()
    const count = [browser.store.data.bookmarks.length, browser.store.data.bookmarkFolders.length]
    await importHtml(exported)
    assert.deepEqual([browser.store.data.bookmarks.length, browser.store.data.bookmarkFolders.length], count)
    const bookCount = browser.store.data.bookmarks.length
    await click(`.bookmark-folder-row[data-folder-id="${workId}"] [aria-label="解散文件夹"]`)
    await until(() => !browser.store.data.bookmarkFolders.some((f) => f.id === workId), 'dissolve folder')
    assert.equal(browser.store.data.bookmarks.length, bookCount)
    assert.deepEqual(
      folderPath(nested.folderId, browser.store.data.bookmarkFolders).map((f) => f.title),
      ['Imported & notes', 'Child'],
    )
    browser.store.flush()
    const loaded = new BrowserStore(path.dirname(browser.store.file))
    assert.deepEqual(loaded.data.bookmarkFolders, browser.store.data.bookmarkFolders)
    assert.equal(loaded.data.bookmarks.find((b) => b.id === nested.id)?.folderId, nested.folderId)
    await new Promise((resolve) => setTimeout(resolve, 350))
    fs.writeFileSync(
      path.join(path.dirname(reportFile), 'bookmark-folders.png'),
      (await host.window.webContents.capturePage()).toPNG(),
    )
  } finally {
    browser.bookmarkExportDestination = undefined
    await browser.closeTab(host, manager)
    browser.activate(host, previous)
  }
}

export async function smokeSiteData(browser: Browser, host: Host, origin: string, reportFile: string) {
  const previous = host.activeId,
    otherOrigin = process.env.ECHROMIUM_SMOKE_OTHER_ORIGIN!
  const target = browser.newTab(host, 'web', origin + '/site-data')
  const other = browser.newTab(host, 'web', otherOrigin + '/site-data')
  const privateHost = browser.createWindow({ private: true })
  const { evaluate, ready, click } = shell(host)
  let settings: ReturnType<Browser['openSiteSettings']> | undefined
  // Each origin has its own IndexedDB, CacheStorage, localStorage and sessionStorage.
  const seed = `(async()=>{localStorage.setItem('site-data-proof','keep');sessionStorage.setItem('site-data-proof','keep');await new Promise((resolve,reject)=>{const request=indexedDB.open('site-data-proof',1);request.onupgradeneeded=()=>request.result.createObjectStore('rows');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('rows','readwrite');tx.objectStore('rows').put('keep','proof');tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}});await (await caches.open('site-data-proof')).put('/cached',new Response('keep'));return true})()`
  const stored = `(async()=>({local:localStorage.getItem('site-data-proof'),session:sessionStorage.getItem('site-data-proof'),databases:(await indexedDB.databases()).map(d=>d.name),caches:await caches.keys(),workers:(await navigator.serviceWorker.getRegistrations()).length}))()`
  try {
    await until(
      () => !target.state.loading && !other.state.loading && !!target.state.title && !!other.state.title,
      'site data origins load',
    )
    await target.view!.webContents.executeJavaScript(seed)
    await other.view!.webContents.executeJavaScript(seed)
    await target.view!.webContents.executeJavaScript(
      `navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(()=>true)`,
    )
    await host.session.cookies.set({
      url: origin + '/account',
      name: 'site-data-proof',
      value: 'secret-not-for-shell',
      httpOnly: true,
      path: '/account',
    })
    await host.session.cookies.set({ url: 'https://unrelated.test/', name: 'unrelated-proof', value: 'keep' })
    await privateHost.session.cookies.set({ url: origin, name: 'private-data-proof', value: 'keep' })
    settings = browser.openSiteSettings(host, origin)
    await ready('.site-data-panel .site-data-actions button:not(:disabled)')
    const summary = await browser.siteData.request(host, { action: 'inspect', id: settings.state.id })
    assert.equal(summary.cookieCount, 1)
    assert.ok(
      summary.cookies.some((c) => c.name === 'site-data-proof' && c.httpOnly && c.path === '/account'),
    )
    assert.equal(JSON.stringify(summary).includes('secret-not-for-shell'), false)
    await assert.rejects(browser.siteData.request(host, { action: 'clear', id: target.state.id }))
    browser.siteData.confirm = async () => false
    await click('.site-data-actions button:last-child')
    await until(
      async () =>
        evaluate('document.querySelector(".site-data-panel [role=status]")?.textContent.includes("已取消")'),
      'cancel site data clearing',
    )
    assert.equal(
      await target.view!.webContents.executeJavaScript('localStorage.getItem("site-data-proof")'),
      'keep',
    )
    assert.equal((await host.session.cookies.get({ name: 'site-data-proof' })).length, 1)
    // A confirmation that resolves after leaving the settings tab must also cancel.
    let respond!: (value: boolean) => void
    browser.siteData.confirm = () =>
      new Promise((resolve) => {
        respond = resolve
      })
    const pending = browser.siteData.request(host, { action: 'clear', id: settings.state.id })
    await until(() => !!respond, 'pending site data confirmation')
    browser.activate(host, target.state.id)
    respond(true)
    assert.equal((await pending).cancelled, true)
    browser.activate(host, settings.state.id)
    const replaced = settings
    const navigating = browser.siteData.request(host, { action: 'clear', id: replaced.state.id })
    await browser.request(host, {
      action: 'navigate',
      id: replaced.state.id,
      text: origin + '/replaced-settings',
    })
    respond(true)
    assert.equal((await navigating).cancelled, true)
    await until(
      () => !replaced.state.loading && !!replaced.view?.webContents.getURL(),
      'replaced settings navigation',
    )
    await browser.closeTab(host, replaced)
    settings = browser.openSiteSettings(host, origin)
    await ready('.site-data-panel .site-data-actions button:not(:disabled)')
    assert.equal(
      await target.view!.webContents.executeJavaScript('localStorage.getItem("site-data-proof")'),
      'keep',
    )
    const unchanged = JSON.stringify({
      history: browser.store.data.history,
      bookmarks: browser.store.data.bookmarks,
      permissions: browser.store.data.permissions,
    })
    browser.siteData.confirm = async () => true
    await click('.site-data-actions button:last-child')
    await until(
      async () =>
        evaluate(
          'document.querySelector(".site-data-panel [role=status]")?.textContent.includes("网站数据已清除")',
        ),
      'confirmed site data clearing',
    )
    assert.deepEqual(await target.view!.webContents.executeJavaScript(stored), {
      local: null,
      session: null,
      databases: [],
      caches: [],
      workers: 0,
    })
    assert.deepEqual(await other.view!.webContents.executeJavaScript(stored), {
      local: 'keep',
      session: 'keep',
      databases: ['site-data-proof'],
      caches: ['site-data-proof'],
      workers: 0,
    })
    assert.equal((await host.session.cookies.get({ name: 'site-data-proof' })).length, 0)
    assert.equal((await host.session.cookies.get({ name: 'unrelated-proof' }))[0].value, 'keep')
    assert.equal((await privateHost.session.cookies.get({ name: 'private-data-proof' }))[0].value, 'keep')
    assert.equal(
      JSON.stringify({
        history: browser.store.data.history,
        bookmarks: browser.store.data.bookmarks,
        permissions: browser.store.data.permissions,
      }),
      unchanged,
    )
    await evaluate('document.querySelector(".site-data-panel").scrollIntoView({block:"center"})')
    await new Promise((resolve) => setTimeout(resolve, 350))
    fs.writeFileSync(
      path.join(path.dirname(reportFile), 'site-data.png'),
      (await host.window.webContents.capturePage()).toPNG(),
    )
    // Domain cookies are shared with subdomains; a parent host-only cookie with the same name stays.
    await host.session.cookies.set({
      url: 'https://example.test/scope',
      name: 'shared-scope',
      value: 'parent-host-only',
      path: '/scope',
    })
    await host.session.cookies.set({
      url: 'https://app.example.test/scope',
      domain: '.example.test',
      name: 'shared-scope',
      value: 'parent-domain',
      path: '/scope',
    })
    await host.session.cookies.set({
      url: 'https://app.example.test/scope',
      name: 'child-only',
      value: 'child',
      path: '/scope',
    })
    const scopedSettings = browser.openSiteSettings(host, 'https://app.example.test')
    try {
      assert.equal(
        (await browser.siteData.request(host, { action: 'inspect', id: scopedSettings.state.id }))
          .cookieCount,
        2,
      )
      const cleared = await browser.siteData.request(host, { action: 'clear', id: scopedSettings.state.id })
      assert.equal(cleared.cleared, true)
      assert.equal(cleared.cookieCount, 0)
      const remaining = await host.session.cookies.get({ name: 'shared-scope' })
      assert.equal(remaining.length, 1)
      assert.equal(remaining[0].value, 'parent-host-only')
    } finally {
      await browser.closeTab(host, scopedSettings)
    }
  } finally {
    browser.siteData.confirm = undefined
    if (settings) await browser.closeTab(host, settings)
    await browser.closeTab(host, target)
    await browser.closeTab(host, other)
    await browser.closeWindow(privateHost)
    browser.activate(host, previous)
  }
}
