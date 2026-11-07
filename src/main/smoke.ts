import { app, type WebContents } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { Browser, type Host } from './browser'
import { BrowserStore } from './storage'
import { Downloads } from './downloads'
import { smokeBookmarkFolders, smokeSiteData } from './smoke-features'
import { smokePopupProtection, smokePageDialogs } from './smoke-interactions'
import { smokeViewLayout } from './smoke-layout'
import { smokeFind } from './smoke-find'
import { smokeBrowsingData } from './smoke-browsing-data'
import { smokeSiteInventory } from './smoke-site-inventory'
import { smokeTabOverview } from './smoke-tab-overview'
import { smokeChrome } from './smoke-chrome'
import { smokeOpenedTabs } from './smoke-window-open'

async function until(check: () => boolean | Promise<boolean>, label: string) {
  const start = Date.now()
  while (Date.now() - start < 12000) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 75))
  }
  throw new Error(`Timed out: ${label}`)
}
export async function smoke(browser: Browser, host: Host) {
  // Only the isolated test shell stays rendering while the desktop denies foreground focus.
  // Production windows retain Electron's normal background throttling.
  host.window.webContents.setBackgroundThrottling(false)
  const preferences = (wc: WebContents) =>
    (
      wc as unknown as { getLastWebPreferences: () => { sandbox: boolean; nodeIntegration: boolean } }
    ).getLastWebPreferences()
  const reportFile = process.env.ECHROMIUM_SMOKE_REPORT!,
    origin = process.env.ECHROMIUM_SMOKE_ORIGIN!
  const results: { name: string; passed: boolean; error?: string }[] = []
  async function check(name: string, run: () => void | Promise<void>) {
    try {
      await run()
      results.push({ name, passed: true })
    } catch (error) {
      results.push({ name, passed: false, error: String(error) })
      console.error(name, error)
    }
  }
  host.window.showInactive()
  await check('shell starts with sandboxed preload and a rendered new tab', async () => {
    await until(
      async () =>
        host.window.webContents.executeJavaScript(
          'Boolean(window.browser && document.querySelector(".start-search"))',
        ),
      'Vue shell',
    )
    assert.equal(preferences(host.window.webContents).sandbox, true)
    assert.equal(await host.window.webContents.executeJavaScript('typeof process'), 'undefined')
    await new Promise((resolve) => setTimeout(resolve, 400))
    // The native surface can exist before Viz has produced its first copyable frame.
    await until(async () => {
      try {
        const image = await host.window.webContents.capturePage()
        if (image.isEmpty()) return false
        fs.writeFileSync(path.join(path.dirname(reportFile), 'new-tab.png'), image.toPNG())
        return true
      } catch {
        return false
      }
    }, 'first composited shell frame')
  })
  const nativeCapture: {
    captured: boolean
    requestedMaterial: string
    reason?: string
    address?: { captured: boolean; reason?: string }
    siteInfo?: { captured: boolean; reason?: string }
  } = {
    captured: false,
    requestedMaterial: browser.snapshot(host).material,
  }
  if (process.platform === 'win32') {
    host.window.show()
    host.window.focus()
    await new Promise((resolve) => setTimeout(resolve, 300))
    const capture = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.resolve('scripts/capture-window.ps1'),
        '-WindowHandle',
        host.window.getNativeWindowHandle().readBigUInt64LE().toString(),
        '-OutputPath',
        path.join(path.dirname(reportFile), 'window-native.png'),
      ],
      { encoding: 'utf8', windowsHide: true },
    )
    nativeCapture.captured = capture.status === 0
    if (capture.status !== 0) nativeCapture.reason = capture.stderr.trim()
  }
  await check('new tab text survives unrelated state broadcasts', async () => {
    await host.window.webContents.executeJavaScript(
      'const input=document.querySelector(".start-search input"); input.value="keep this draft"; input.dispatchEvent(new Event("input",{bubbles:true}));',
    )
    browser.publish()
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(
      await host.window.webContents.executeJavaScript('document.querySelector(".start-search input").value'),
      'keep this draft',
    )
  })
  await check('address form sends a real renderer-to-main navigation command', async () => {
    await host.window.webContents.executeJavaScript(
      `(()=>{const field=document.querySelector('.address-bar input');field.focus();field.value=${JSON.stringify(origin + '/')};field.dispatchEvent(new Event('input',{bubbles:true}));field.closest('form').requestSubmit()})()`,
    )
    await until(
      () => browser.active(host)?.state.title === 'Fixture one' && !browser.active(host)?.state.loading,
      'address form navigation',
    )
  })
  const tab = browser.newTab(host, 'web', origin + '/')
  await check('real web navigation and guest isolation', async () => {
    await until(() => tab.state.title === 'Fixture one' && !tab.state.loading, 'web navigation')
    const wc = tab.view!.webContents
    assert.equal(preferences(wc).sandbox, true)
    assert.equal(preferences(wc).nodeIntegration, false)
    assert.deepEqual(await wc.executeJavaScript('({node:typeof process,bridge:typeof window.browser})'), {
      node: 'undefined',
      bridge: 'undefined',
    })
    assert.throws(() => browser.sender({ sender: wc, senderFrame: wc.mainFrame } as never), /Untrusted/)
  })
  await check(
    'site information opens Chromium UI and site settings show all per-origin capabilities',
    async () => {
      const content = tab.view!.webContents,
        original = content.showPageInfoDialog.bind(content)
      let shown = false
      content.showPageInfoDialog = (options) => {
        shown = original(options)
        return shown
      }
      try {
        host.window.webContents.focus()
        await host.window.webContents.executeJavaScript(
          'document.querySelector(\'[aria-label="网站信息与连接安全"]\').click()',
        )
        await until(() => shown, 'real Chromium page info')
        assert.equal(tab.view!.webContents.id, content.id)
        await new Promise((resolve) => setTimeout(resolve, 350))
        if (nativeCapture.captured) {
          const capture = spawnSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-ExecutionPolicy',
              'Bypass',
              '-File',
              path.resolve('scripts/capture-window.ps1'),
              '-WindowHandle',
              host.window.getNativeWindowHandle().readBigUInt64LE().toString(),
              '-OutputPath',
              path.join(path.dirname(reportFile), 'site-info-native.png'),
            ],
            { encoding: 'utf8', windowsHide: true },
          )
          nativeCapture.siteInfo = {
            captured: capture.status === 0,
            reason: capture.status === 0 ? undefined : capture.stderr.trim(),
          }
          if (capture.status !== 0)
            console.warn('Native site information capture unavailable:', capture.stderr.trim())
        }
        const count = host.tabs.length
        content.emit('page-info-open-site-settings', {} as Electron.Event, {
          url: 'https://unrelated.test/',
          origin: 'https://unrelated.test',
        })
        assert.equal(host.tabs.length, count)
        content.emit('page-info-open-site-settings', {} as Electron.Event, { url: origin + '/', origin })
        await until(() => browser.active(host)?.state.kind === 'settings', 'runtime site settings event')
        const settings = browser.active(host)!
        assert.equal(settings.state.settingsOrigin, origin)
        await until(
          async () =>
            host.window.webContents.executeJavaScript(
              'document.querySelectorAll(".permission-line select").length===4',
            ),
          'per-origin permission settings',
        )
        assert.equal(
          await host.window.webContents.executeJavaScript(
            'document.querySelector(".focused-site strong").textContent',
          ),
          origin,
        )
        await host.window.webContents.executeJavaScript(
          '(()=>{const select=document.querySelector(".permission-line select");select.value="block";select.dispatchEvent(new Event("change",{bubbles:true}))})()',
        )
        await until(
          () =>
            browser.store.data.permissions.some(
              (r) => r.origin === origin && r.capability === 'camera' && r.decision === 'block',
            ),
          'site capability update',
        )
        await new Promise((resolve) => setTimeout(resolve, 350))
        fs.writeFileSync(
          path.join(path.dirname(reportFile), 'site-settings.png'),
          (await host.window.webContents.capturePage()).toPNG(),
        )
        await browser.request(host, {
          action: 'site-permission',
          value: { origin, capability: 'camera', decision: 'ask' },
        })
        await browser.closeTab(host, settings)
        browser.activate(host, tab.state.id)
      } finally {
        content.showPageInfoDialog = original
      }
    },
  )
  await check('native suggestions preserve the guest and handle keyboard, Escape and IME', async () => {
    const wcId = tab.view!.webContents.id
    await until(
      async () =>
        host.window.webContents.executeJavaScript(
          `document.querySelector('.tab.selected')?.dataset.tabId === ${JSON.stringify(tab.state.id)}`,
        ),
      'suggestion source rendered active',
    )
    host.window.show()
    host.window.focus()
    await until(() => host.window.isFocused(), 'suggestion source focus')
    await browser.request(host, {
      action: 'save-bookmark',
      value: { title: 'Fixture saved', url: origin + '/two' },
    })
    host.window.webContents.focus()
    await host.window.webContents.executeJavaScript(
      '(()=>{const input=document.querySelector(".address-bar input");input.focus();input.value="Fixture";input.dispatchEvent(new Event("input",{bubbles:true}))})()',
    )
    try {
      await until(() => !!browser.suggestions.diagnostics(host)?.visible, 'native address suggestions')
    } catch (error) {
      console.error(
        'Address diagnostics',
        browser.snapshot(host).nativeSuggestions,
        browser.suggestions.diagnostics(host),
        await host.window.webContents.executeJavaScript(
          '({expanded:document.querySelector(".address-bar input").getAttribute("aria-expanded"),choices:document.querySelectorAll("#address-choices button").length,value:document.querySelector(".address-bar input").value,notice:document.querySelector(".toast")?.textContent})',
        ),
      )
      throw error
    }
    assert.equal(browser.snapshot(host).nativeSuggestions, true)
    assert.equal(tab.view!.webContents.id, wcId)
    assert.equal(
      await host.window.webContents.executeJavaScript(
        'document.activeElement===document.querySelector(".address-bar input")',
      ),
      true,
    )
    assert.equal(
      browser.suggestions.diagnostics(host)!.controls.filter((c) => c.id.match(/^address-\d+-\d+$/)).length,
      3,
    )
    await host.window.webContents.executeJavaScript(
      '(()=>{const input=document.querySelector(".address-bar input");input.dispatchEvent(new FocusEvent("focus"));input.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true}))})()',
    )
    await until(
      () =>
        browser.suggestions
          .diagnostics(host)
          ?.controls.some((c) => /^address-\d+-2$/.test(c.id) && c.selected) === true,
      'Arrow Up starts at the last suggestion',
    )
    await host.window.webContents.executeJavaScript(
      'document.querySelector(".address-bar input").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))',
    )
    if (nativeCapture.captured) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const capture = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.resolve('scripts/capture-window.ps1'),
          '-WindowHandle',
          host.window.getNativeWindowHandle().readBigUInt64LE().toString(),
          '-OutputPath',
          path.join(path.dirname(reportFile), 'address-native.png'),
        ],
        { encoding: 'utf8', windowsHide: true },
      )
      nativeCapture.address = {
        captured: capture.status === 0,
        reason: capture.status === 0 ? undefined : capture.stderr.trim(),
      }
      if (capture.status !== 0) console.warn('Native address capture unavailable:', capture.stderr.trim())
    }
    await host.window.webContents.executeJavaScript(
      'document.querySelector(".address-bar input").dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}))',
    )
    await until(() => !browser.suggestions.diagnostics(host)?.visible, 'IME hides suggestions')
    await host.window.webContents.executeJavaScript(
      'document.querySelector(".address-bar input").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true}))',
    )
    assert.equal(tab.state.url, origin + '/')
    await host.window.webContents.executeJavaScript(
      'document.querySelector(".address-bar input").dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}))',
    )
    await until(() => !!browser.suggestions.diagnostics(host)?.visible, 'IME resumes suggestions')
    await host.window.webContents.executeJavaScript(
      'document.querySelector(".address-bar input").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))',
    )
    await until(() => !browser.suggestions.diagnostics(host)?.visible, 'Escape dismisses suggestions')
    assert.equal(
      await host.window.webContents.executeJavaScript('document.querySelector(".address-bar input").value'),
      'Fixture',
    )
    await host.window.webContents.executeJavaScript(
      '(()=>{const input=document.querySelector(".address-bar input");for(let i=0;i<2;i++)input.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}));input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))})()',
    )
    await until(() => tab.state.title === 'Fixture two' && !tab.state.loading, 'keyboard chosen bookmark')
    assert.equal(browser.active(host)?.state.id, tab.state.id)
    await browser.request(host, { action: 'navigate', id: tab.state.id, text: origin + '/' })
    await until(() => tab.state.title === 'Fixture one' && !tab.state.loading, 'after suggestion navigation')
    host.window.webContents.focus()
    await host.window.webContents.executeJavaScript(
      '(()=>{const input=document.querySelector(".address-bar input");input.focus();input.value="Fixture";input.dispatchEvent(new Event("input",{bubbles:true}))})()',
    )
    await until(() => !!browser.suggestions.diagnostics(host)?.visible, 'mouse suggestion list')
    const diagnostics = browser.suggestions.diagnostics(host)!
    const target = diagnostics.controls.filter((c) => /^address-\d+-\d+$/.test(c.id))[1]
    const clicked = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.resolve('scripts/click-fixture-panel.ps1'),
        '-PanelHandle',
        diagnostics.windowHandle,
        '-OwnerHandle',
        host.window.getNativeWindowHandle().readBigUInt64LE().toString(),
        '-FixtureProcessId',
        String(process.pid),
        '-FractionX',
        '0.5',
        '-FractionY',
        String(
          (target.bounds.y + target.bounds.height / 2 - diagnostics.bounds.y) / diagnostics.bounds.height,
        ),
      ],
      { encoding: 'utf8', windowsHide: true },
    )
    assert.equal(clicked.status, 0, clicked.stderr)
    await until(() => host.activeId !== tab.state.id, 'native mouse switches existing tab')
    assert.equal(tab.view!.webContents.id, wcId)
    browser.activate(host, tab.state.id)
    const bookmark = browser.store.data.bookmarks.find((b) => b.title === 'Fixture saved')!
    await browser.request(host, { action: 'remove-bookmark', id: bookmark.id })
  })
  await check('bookmark manager creates, edits, imports, sorts, deletes, undoes and exports', async () => {
    for (const b of [...browser.store.data.bookmarks])
      await browser.request(host, { action: 'remove-bookmark', id: b.id })
    const manager = browser.newTab(host, 'bookmarks')
    await until(
      async () =>
        host.window.webContents.executeJavaScript('Boolean(document.querySelector(".bookmark-tools"))'),
      'bookmark manager',
    )
    assert.equal(
      await host.window.webContents.executeJavaScript('document.querySelector(".address-bar input").value'),
      '',
    )
    await host.window.webContents.executeJavaScript(
      'document.querySelector(".bookmark-tools .primary-button").click()',
    )
    await until(
      async () =>
        host.window.webContents.executeJavaScript('Boolean(document.querySelector(".bookmark-editor"))'),
      'bookmark editor',
    )
    await host.window.webContents.executeJavaScript(
      `(()=>{const title=document.querySelector('[aria-label="书签名称"]'),url=document.querySelector('[aria-label="书签网址"]');title.value='Fixture saved';url.value=${JSON.stringify(origin + '/saved')};for(const field of [title,url])field.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.bookmark-editor').requestSubmit()})()`,
    )
    await until(() => browser.store.data.bookmarks.some((b) => b.url === origin + '/saved'), 'bookmark save')
    await until(
      async () =>
        host.window.webContents.executeJavaScript(
          'Boolean(document.querySelector(".bookmark-row .secondary-button"))',
        ),
      'bookmark row',
    )
    await host.window.webContents.executeJavaScript(
      'document.querySelector(".bookmark-row .secondary-button").click()',
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    await host.window.webContents.executeJavaScript(
      '(()=>{const field=document.querySelector(\'[aria-label="书签名称"]\');field.value="Fixture edited & <test>";field.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector(".bookmark-editor").requestSubmit()})()',
    )
    await until(
      () => browser.store.data.bookmarks.some((b) => b.title === 'Fixture edited & <test>'),
      'bookmark edit',
    )
    const html = `<DL><DT><A HREF="${origin}/imported">Imported fixture</A><DT><A HREF="${origin}/saved">Duplicate</A><DT><A HREF="javascript:alert(1)">Unsafe</A></DL><script>window.importExecuted=true</script>`
    await host.window.webContents.executeJavaScript(
      `(()=>{const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(html)}],'bookmarks.html',{type:'text/html'}));const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    )
    await until(() => browser.store.data.bookmarks.length === 2, 'HTML import deduplicates and filters URLs')
    assert.equal(await host.window.webContents.executeJavaScript('typeof window.importExecuted'), 'undefined')
    await until(
      async () =>
        host.window.webContents.executeJavaScript('document.querySelectorAll(".bookmark-row").length===2'),
      'imported rows',
    )
    await host.window.webContents.executeJavaScript(
      'document.querySelector(\'.bookmark-row [aria-label="下移书签"]\').click()',
    )
    await until(() => browser.store.data.bookmarks[0].title === 'Imported fixture', 'bookmark order')
    await host.window.webContents.executeJavaScript(
      'document.querySelector(\'.bookmark-row [aria-label="删除书签"]\').click()',
    )
    await until(() => browser.store.data.bookmarks.length === 1, 'bookmark delete')
    await until(
      async () =>
        host.window.webContents.executeJavaScript('Boolean(document.querySelector(".text-action"))'),
      'undo control',
    )
    await host.window.webContents.executeJavaScript('document.querySelector(".text-action").click()')
    await until(() => browser.store.data.bookmarks.length === 2, 'bookmark undo')
    await host.window.webContents.executeJavaScript(
      '(()=>{const input=document.querySelector(\'[aria-label="搜索书签"]\');input.value="Imported";input.dispatchEvent(new Event("input",{bubbles:true}))})()',
    )
    await until(
      async () =>
        host.window.webContents.executeJavaScript('document.querySelectorAll(".bookmark-row").length===1'),
      'bookmark search',
    )
    await host.window.webContents.executeJavaScript(
      '(()=>{const input=document.querySelector(\'[aria-label="搜索书签"]\');input.value="";input.dispatchEvent(new Event("input",{bubbles:true}))})()',
    )
    const destination = path.join(path.dirname(reportFile), 'bookmarks-export.html')
    browser.bookmarkExportDestination = async () => destination
    await browser.request(host, { action: 'export-bookmarks' })
    browser.bookmarkExportDestination = undefined
    assert.ok(fs.readFileSync(destination, 'utf8').includes('Fixture edited &amp; &lt;test&gt;'))
    browser.store.flush()
    assert.equal(new BrowserStore(path.dirname(browser.store.file)).data.bookmarks.length, 2)
    await new Promise((resolve) => setTimeout(resolve, 350))
    fs.writeFileSync(
      path.join(path.dirname(reportFile), 'bookmarks.png'),
      (await host.window.webContents.capturePage()).toPNG(),
    )
    await browser.closeTab(host, manager)
    browser.activate(host, tab.state.id)
  })
  await check(
    'bookmark folders preserve hierarchy, moves, imports, exports and contents on dissolution',
    () => smokeBookmarkFolders(browser, host, origin, reportFile),
  )
  await check('site data clearing honors cancellation and isolates origins and private profiles', () =>
    smokeSiteData(browser, host, origin, reportFile),
  )
  await check(
    'site inventory measures real quota data, preserves page debuggers and isolates clearing and private sessions',
    () => smokeSiteInventory(browser, host, origin, reportFile),
  )
  await check('navigation history returns to previous committed document', async () => {
    await browser.request(host, { action: 'navigate', text: origin + '/two', id: tab.state.id })
    await until(() => tab.state.title === 'Fixture two' && !tab.state.loading, 'second page')
    await browser.request(host, { action: 'back', id: tab.state.id })
    await until(() => tab.state.title === 'Fixture one' && !tab.state.loading, 'history back')
  })
  await check('native view follows browser bars, viewport resizing and fullscreen corner changes', () =>
    smokeViewLayout(browser, host, origin, reportFile),
  )
  await check(
    'native find preserves live views, CJK input, result identity, focus sessions and navigation lifecycle',
    () => smokeFind(browser, host, origin, reportFile),
  )
  await check('unsafe destinations are rejected without changing the tab', async () => {
    const before = tab.state.url
    await assert.rejects(
      browser.request(host, { action: 'navigate', text: 'javascript:alert(1)', id: tab.state.id }),
    )
    assert.equal(tab.state.url, before)
  })
  await check(
    'new browser tabs preserve POST, opener, named reuse, Ctrl click and independent lifecycle',
    () => smokeOpenedTabs(browser, host, origin),
  )
  await check('explicit Chromium popup preserves POST and opener with no privileged bridge', async () => {
    browser.activate(host, tab.state.id)
    host.window.show()
    host.window.focus()
    await until(() => host.window.isFocused(), 'popup source focus')
    await tab.view!.webContents.executeJavaScript(
      `window.open('about:blank','named-fixture-popup','popup,width=800,height=600');void 0`,
      true,
    )
    await until(() => browser.popups.size > 0, 'explicit native popup')
    host.window.focus()
    await until(() => host.window.isFocused(), 'POST popup source focus')
    await tab.view!.webContents.executeJavaScript(
      `const form=document.createElement('form');form.action=${JSON.stringify(origin + '/popup')};form.method='POST';form.target='named-fixture-popup';const field=document.createElement('input');field.name='proof';field.value='posted';form.append(field);document.body.append(form);form.submit();`,
      true,
    )
    await until(() => browser.popups.size > 0, 'native popup')
    const popup = [...browser.popups.values()][0].window
    await until(async () => {
      try {
        return (
          (await popup.webContents.executeJavaScript('document.getElementById("result")?.textContent')) ===
          'POST proof=posted'
        )
      } catch {
        return false
      }
    }, 'popup POST')
    assert.equal(await popup.webContents.executeJavaScript('Boolean(window.opener)'), true)
    assert.equal(await popup.webContents.executeJavaScript('typeof window.browser'), 'undefined')
    popup.destroy()
  })
  await check('popup bursts and background sources are blocked with a page-scoped user override', () =>
    smokePopupProtection(browser, host, origin, reportFile),
  )
  await check(
    'page prompt, confirm and alert honor replies, cancellation, frame origins and suppression',
    () => smokePageDialogs(browser, host, origin),
  )
  await check('download uses the real session and completes to the selected file', async () => {
    const destination = path.join(path.dirname(reportFile), 'download-fixture.txt')
    host.session.once('will-download', (_e, item) => item.setSavePath(destination))
    tab.view!.webContents.downloadURL(origin + '/download')
    await until(() => browser.downloads.list(host.profile).some((d) => d.status === 'completed'), 'download')
    assert.equal(fs.readFileSync(destination, 'utf8'), 'EChromium download fixture')
  })
  await check('download metadata survives reload and removing records leaves files intact', async () => {
    browser.store.flush()
    const loaded = new BrowserStore(path.dirname(browser.store.file))
    const restored = new Downloads(loaded, () => {})
    const row = restored.list('default')[0]
    assert.equal(row.status, 'completed')
    assert.equal(row.active, false)
    assert.equal(row.canResume, false)
    assert.equal(restored.list('private:test').length, 0)
    const downloads = browser.newTab(host, 'downloads')
    await until(
      async () =>
        host.window.webContents.executeJavaScript('Boolean(document.querySelector(".download-item"))'),
      'download records UI',
    )
    await new Promise((resolve) => setTimeout(resolve, 350))
    fs.writeFileSync(
      path.join(path.dirname(reportFile), 'downloads.png'),
      (await host.window.webContents.capturePage()).toPNG(),
    )
    await restored.action('default', row.id, 'remove')
    loaded.flush()
    assert.equal(new BrowserStore(path.dirname(loaded.file)).data.downloads.length, 0)
    assert.ok(fs.existsSync(row.path))
    await assert.rejects(restored.action('default', row.id, 'resume'))
    await browser.closeTab(host, downloads)
  })
  await check('reopening a closed tab restores navigation, mute, pin and zoom', async () => {
    const original = browser.newTab(host, 'web', origin + '/')
    await until(() => original.state.title === 'Fixture one' && !original.state.loading, 'reopen source')
    await browser.request(host, { action: 'navigate', id: original.state.id, text: origin + '/two' })
    await until(
      () => original.state.title === 'Fixture two' && !original.state.loading,
      'reopen second entry',
    )
    await browser.request(host, { action: 'back', id: original.state.id })
    await until(
      () => original.state.title === 'Fixture one' && !original.state.loading,
      'reopen active entry',
    )
    await browser.request(host, { action: 'pin', id: original.state.id })
    await browser.request(host, { action: 'mute', id: original.state.id })
    await browser.request(host, { action: 'zoom', id: original.state.id, value: 1.25 })
    await browser.closeTab(host, original)
    host.window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control', 'shift'] })
    host.window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['control', 'shift'] })
    await until(
      () => browser.active(host)?.state.pinned === true && browser.active(host)?.state.muted === true,
      'Ctrl Shift T',
    )
    const reopened = browser.active(host)!
    assert.notEqual(reopened.state.id, original.state.id)
    await until(() => reopened.state.title === 'Fixture one' && !reopened.state.loading, 'restored page')
    assert.equal(reopened.view!.webContents.navigationHistory.canGoForward(), true)
    assert.equal(reopened.view!.webContents.isAudioMuted(), true)
    assert.equal(reopened.view!.webContents.getZoomFactor(), 1.25)
    await browser.request(host, { action: 'forward', id: reopened.state.id })
    await until(
      () => reopened.state.title === 'Fixture two' && !reopened.state.loading,
      'restored forward entry',
    )
    await browser.closeTab(host, reopened)
    browser.activate(host, tab.state.id)
  })
  await check('batch close stops on beforeunload cancellation and preserves pinned tabs', async () => {
    const owner = browser.createWindow()
    const pinned = owner.tabs[0]
    await browser.request(owner, { action: 'pin', id: pinned.state.id })
    const anchor = browser.newTab(owner)
    const guarded = browser.newTab(owner, 'web', origin + '/')
    await until(
      () => guarded.state.title === 'Fixture one' && !guarded.state.loading,
      'batch close guarded page',
    )
    await guarded.view!.webContents.executeJavaScript(
      'window.addEventListener("beforeunload",event=>{event.preventDefault();event.returnValue=""});document.getElementById("activate").click()',
      true,
    )
    const later = browser.newTab(owner)
    browser.confirmLeave = () => false
    await browser.request(owner, { action: 'close-tabs', id: anchor.state.id, value: 'right' })
    assert.ok(owner.tabs.includes(guarded))
    assert.ok(owner.tabs.includes(later))
    assert.equal(browser.snapshot(owner).canReopen, browser.snapshot(host).canReopen)
    browser.confirmLeave = () => true
    await browser.request(owner, { action: 'close-tabs', id: anchor.state.id, value: 'others' })
    assert.deepEqual(
      owner.tabs.map((t) => t.state.id),
      [pinned.state.id, anchor.state.id],
    )
    await browser.closeWindow(owner)
    browser.confirmLeave = undefined
  })
  await check(
    'real notification permission persists, can be blocked, and is isolated from private sessions',
    async () => {
      browser.activate(host, tab.state.id)
      host.window.show()
      host.window.focus()
      await until(() => host.window.isFocused(), 'permission window focus')
      let prompts = 0
      browser.permissionPrompt = async () => {
        prompts++
        return 'allow'
      }
      assert.equal(
        await tab.view!.webContents.executeJavaScript('Notification.requestPermission()', true),
        'granted',
      )
      assert.equal(prompts, 1)
      browser.store.flush()
      assert.ok(
        new BrowserStore(path.dirname(browser.store.file)).data.permissions.some(
          (r) => r.origin === origin && r.capability === 'notifications' && r.decision === 'allow',
        ),
      )
      await browser.request(host, {
        action: 'site-permission',
        value: { origin, capability: 'notifications', decision: 'block' },
      })
      assert.equal(
        await tab.view!.webContents.executeJavaScript(
          'navigator.permissions.query({name:"notifications"}).then(p=>p.state)',
        ),
        'denied',
      )
      const settings = browser.newTab(host, 'settings')
      await until(
        async () =>
          host.window.webContents.executeJavaScript(
            'Boolean(document.querySelector(".permission-line select"))',
          ),
        'site settings UI',
      )
      await host.window.webContents.executeJavaScript(
        'document.querySelector("a[href$=permissions]").click()',
      )
      await new Promise((resolve) => setTimeout(resolve, 150))
      assert.equal(
        await host.window.webContents.executeJavaScript(
          'document.querySelector(".settings-nav h2").getBoundingClientRect().top > document.querySelector(".viewport").getBoundingClientRect().top',
        ),
        true,
      )
      fs.writeFileSync(
        path.join(path.dirname(reportFile), 'permissions.png'),
        (await host.window.webContents.capturePage()).toPNG(),
      )
      await host.window.webContents.executeJavaScript(
        '(()=>{const select=document.querySelector(".permission-line select");select.value="ask";select.dispatchEvent(new Event("change",{bubbles:true}))})()',
      )
      await until(() => browser.store.data.permissions.length === 0, 'reset permission from UI')
      await browser.closeTab(host, settings)
      browser.permissionPrompt = undefined
    },
  )
  await check('theme and settings render and persist', async () => {
    await browser.request(host, { action: 'preferences', value: { theme: 'sage', mode: 'dark' } })
    const settings = browser.newTab(host, 'settings')
    await until(
      async () => host.window.webContents.executeJavaScript('Boolean(document.querySelector(".theme-grid"))'),
      'settings',
    )
    assert.equal(browser.snapshot(host).dark, true)
    await new Promise((resolve) => setTimeout(resolve, 400))
    const image = await host.window.webContents.capturePage()
    fs.writeFileSync(path.join(path.dirname(reportFile), 'settings-dark.png'), image.toPNG())
    await host.window.webContents.executeJavaScript('document.querySelector("a[href$=browsing]").click()')
    await until(() => host.window.webContents.getURL().endsWith('#browsing'), 'settings fragment navigation')
    await host.window.webContents.executeJavaScript(
      'window.browser.request({action:"preferences",value:{bookmarksBar:false}})',
    )
    assert.equal(browser.store.data.preferences.bookmarksBar, false)
    await browser.request(host, { action: 'preferences', value: { bookmarksBar: true } })
    await browser.closeTab(host, settings)
    await browser.request(host, { action: 'preferences', value: { theme: 'mist', mode: 'light' } })
  })
  await check('cross-window transfer preserves WebContents and revokes old ownership', async () => {
    const wcId = tab.view!.webContents.id
    await browser.request(host, { action: 'detach', id: tab.state.id })
    const target = browser.hosts.get(tab.hostId)!
    assert.notEqual(target.id, host.id)
    assert.equal(tab.view!.webContents.id, wcId)
    await assert.rejects(browser.request(host, { action: 'activate', id: tab.state.id }))
    assert.equal(target.session, host.session)
  })
  await check(
    'dropping into an existing window preserves live forms, cookies and navigation then closes the empty source',
    async () => {
      const source = browser.hosts.get(tab.hostId)!,
        content = tab.view!.webContents
      const permissionEpoch = tab.permissionEpoch
      const contentId = content.id,
        entries = content.navigationHistory.getAllEntries().map((e) => e.url)
      await content.executeJavaScript(
        'window.moveProof="live";document.getElementById("input").value="unsubmitted form";sessionStorage.setItem("move-proof","stored")',
      )
      await source.session.cookies.set({ url: origin, name: 'move-proof', value: 'cookie' })
      await browser.request(source, { action: 'pin', id: tab.state.id })
      await browser.request(source, { action: 'mute', id: tab.state.id })
      await host.window.webContents.executeJavaScript(
        `(()=>{const data=new DataTransfer();data.setData('application/x-echromium-tab',${JSON.stringify(tab.state.id)});document.querySelector('.tabs').dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}))})()`,
      )
      await until(() => tab.hostId === host.id && source.window.isDestroyed(), 'real drop adoption')
      assert.equal(tab.view!.webContents.id, contentId)
      assert.ok(tab.permissionEpoch > permissionEpoch)
      assert.deepEqual(
        await content.executeJavaScript(
          '({proof:window.moveProof,input:document.getElementById("input").value,storage:sessionStorage.getItem("move-proof")})',
        ),
        { proof: 'live', input: 'unsubmitted form', storage: 'stored' },
      )
      assert.equal((await host.session.cookies.get({ name: 'move-proof' }))[0].value, 'cookie')
      assert.deepEqual(
        content.navigationHistory.getAllEntries().map((e) => e.url),
        entries,
      )
      assert.equal(tab.state.pinned, true)
      assert.equal(content.isAudioMuted(), true)
      assert.equal(host.tabs[0], tab)
      await assert.rejects(browser.request(source, { action: 'activate', id: tab.state.id }))
    },
  )
  await check('a failed native attachment rolls ownership and live View back to the source', async () => {
    const epoch = tab.permissionEpoch
    const target = browser.createWindow(),
      view = tab.view!,
      original = target.window.contentView.addChildView.bind(target.window.contentView)
    target.window.contentView.addChildView = () => {
      throw new Error('fixture attachment failure')
    }
    try {
      await assert.rejects(
        browser.request(host, { action: 'move-tab', id: tab.state.id, value: { windowId: target.id } }),
        /fixture attachment failure/,
      )
      assert.equal(tab.hostId, host.id)
      assert.equal(tab.permissionEpoch, epoch)
      assert.ok(host.tabs.includes(tab))
      assert.ok(!target.tabs.includes(tab))
      assert.ok(host.window.contentView.children.includes(view))
      assert.equal(view.webContents.isDestroyed(), false)
    } finally {
      target.window.contentView.addChildView = original
      await browser.closeWindow(target)
    }
  })
  await check('private browsing isolates cookies and leaves no browsing history snapshot', async () => {
    const privateHost = browser.createWindow({ private: true })
    const privateTab = browser.newTab(privateHost, 'web', origin + '/secret-private')
    await until(() => privateTab.state.title === 'Fixture one' && !privateTab.state.loading, 'private page')
    assert.notEqual(privateHost.session, host.session)
    await assert.rejects(
      browser.request(host, { action: 'move-tab', id: tab.state.id, value: { windowId: privateHost.id } }),
    )
    const otherPrivate = browser.createWindow({ private: true })
    await assert.rejects(
      browser.request(privateHost, {
        action: 'move-tab',
        id: privateTab.state.id,
        value: { windowId: otherPrivate.id },
      }),
    )
    assert.equal(privateTab.hostId, privateHost.id)
    await browser.closeWindow(otherPrivate)
    assert.equal(browser.snapshot(privateHost).canReopen, false)
    await browser.request(privateHost, {
      action: 'site-permission',
      value: { origin, capability: 'camera', decision: 'allow' },
    })
    assert.equal(browser.snapshot(privateHost).permissions.length, 1)
    assert.equal(browser.store.data.permissions.length, 0)
    await privateHost.session.cookies.set({ url: origin, name: 'private-proof', value: 'private' })
    assert.equal((await host.session.cookies.get({ name: 'private-proof' })).length, 0)
    browser.saveSession()
    assert.ok(!browser.store.data.history.some((v) => v.url.includes('secret-private')))
    assert.ok(!browser.store.data.tabs.some((url) => url.includes('secret-private')))
    await browser.closeWindow(privateHost)
    assert.equal(browser.permissions.list(privateHost.profile).length, 0)
  })
  await check(
    'browsing data review supports time ranges, cancellation, file retention and profile isolation',
    () => smokeBrowsingData(browser, host, origin, reportFile),
  )
  await check(
    'compressed tabs and overview preserve live pages, laziness, previews, search, focus and close confirmations',
    () => smokeTabOverview(browser, origin, reportFile),
  )
  await check(
    'chrome alignment, overview shape, native theme menu, automatic mode, translucent layers and tab motion',
    () => smokeChrome(browser, reportFile),
  )
  await check('beforeunload cancellation retains the actual live WebContents', async () => {
    const owner = browser.hosts.get(tab.hostId)!
    await tab.view!.webContents.executeJavaScript(
      'window.addEventListener("beforeunload",event=>{event.preventDefault();event.returnValue=""});document.getElementById("activate").click();',
      true,
    )
    browser.confirmLeave = () => false
    assert.equal(await browser.closeTab(owner, tab), false)
    assert.equal(tab.view!.webContents.isDestroyed(), false)
    assert.ok(owner.tabs.includes(tab))
    browser.confirmLeave = () => true
    assert.equal(await browser.closeTab(owner, tab), true)
  })
  const report = {
    at: new Date().toISOString(),
    runtime: process.versions,
    runtimeExecutable: {
      path: process.execPath,
      sha256: createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'),
    },
    nativeCapture,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
  }
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
  browser.flushForExit()
  app.exit(report.failed ? 1 : 0)
}
