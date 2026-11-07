import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { webContents, type NativePanel } from 'electron'
import type { Browser, Host } from './browser'

async function until(check: () => boolean | Promise<boolean>, label: string) {
  const start = Date.now()
  while (Date.now() - start < 12000) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  throw new Error('Timed out: ' + label)
}
export async function smokeFind(browser: Browser, host: Host, origin: string, report: string) {
  const previous = host.activeId,
    originalBounds = host.window.getBounds(),
    tab = browser.newTab(host, 'web', origin + '/find')
  try {
    await until(() => !tab.state.loading && tab.state.title === 'Fixture one', 'find fixture')
    const wc = tab.view!.webContents
    wc.setBackgroundThrottling(false)
    await wc.executeJavaScript(
      `window.findIdentity={};document.getElementById('input').value='unsaved draft';document.getElementById('result').textContent='Needle needle needle 中文查找 中文查找';window.findFrames=0;function findTick(){window.findFrames++;requestAnimationFrame(findTick)};requestAnimationFrame(findTick)`,
    )
    await new Promise((resolve) => setTimeout(resolve, 150))
    const bounds = tab.view!.getBounds(),
      contents = webContents
        .getAllWebContents()
        .map((c) => c.id)
        .sort(),
      frames = await wc.executeJavaScript('window.findFrames')
    let captures = 0,
      hidden = 0
    const capture = wc.capturePage.bind(wc),
      visibility = tab.view!.setVisible.bind(tab.view!)
    wc.capturePage = ((...args: Parameters<typeof wc.capturePage>) => {
      captures++
      return capture(...args)
    }) as typeof wc.capturePage
    tab.view!.setVisible = (visible) => {
      if (!visible) hidden++
      visibility(visible)
    }
    try {
      host.window.show()
      host.window.focus()
      await until(() => host.window.isFocused(), 'find owner focus')
      wc.focus()
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: ['control'] })
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: ['control'] })
      await until(() => !!browser.find.panel(host), 'guest Ctrl+F opens native panel')
      const panel = browser.find.panel(host)!
      assert.equal(panel.getDiagnostics().visible, true)
      await until(
        () => panel.getDiagnostics().controls.find((c) => c.id === 'find-query')?.focused === true,
        'native input focus',
      )
      assert.equal(panel.getDiagnostics().controls.find((c) => c.id === 'find-query')?.focused, true)
      assert.deepEqual(tab.view!.getBounds(), bounds)
      assert.deepEqual(
        webContents
          .getAllWebContents()
          .map((c) => c.id)
          .sort(),
        contents,
      )
      assert.equal(await wc.executeJavaScript('document.getElementById("input").value'), 'unsaved draft')
      const act = (
        target: NativePanel,
        id: string,
        type: string,
        value?: string | boolean,
        revision = target.revision,
      ) => target.emit('action', { id, type, value, revision })
      const type = (target: NativePanel, text?: string, key?: number) => {
        const result = spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.resolve('scripts/type-fixture-panel.ps1'),
            '-PanelHandle',
            target.getDiagnostics().windowHandle,
            '-OwnerHandle',
            host.window.getNativeWindowHandle().readBigUInt64LE().toString(),
            '-FixtureProcessId',
            String(process.pid),
            ...(text ? ['-TextBase64', Buffer.from(text).toString('base64')] : []),
            ...(key ? ['-Key', String(key)] : []),
          ],
          { encoding: 'utf8', windowsHide: true },
        )
        assert.equal(result.status, 0, result.stderr)
      }
      type(panel, 'needle')
      await until(() => browser.find.state(host)?.status === 'ready', 'native input starts real find')
      assert.equal(browser.find.state(host)?.query, 'needle')
      assert.equal(browser.find.state(host)?.total, 3)
      assert.equal(browser.find.state(host)?.ordinal, 1)
      const request = browser.find.state(host)!.requestId!
      wc.emit('found-in-page', {} as Electron.Event, {
        requestId: request + 1000,
        matches: 999,
        activeMatchOrdinal: 999,
        finalUpdate: true,
      })
      assert.equal(browser.find.state(host)?.total, 3, 'old results ignored')
      type(panel, undefined, 114)
      await until(
        () => browser.find.state(host)?.status === 'ready' && browser.find.state(host)?.ordinal === 2,
        'next match',
      )
      browser.find.step(host, false)
      await until(
        () => browser.find.state(host)?.status === 'ready' && browser.find.state(host)?.ordinal === 1,
        'previous match',
      )
      browser.find.step(host, false)
      await until(
        () => browser.find.state(host)?.status === 'ready' && browser.find.state(host)?.ordinal === 3,
        'wrap backwards',
      )
      act(panel, 'find-case', 'change', true)
      await until(
        () => browser.find.state(host)?.status === 'ready' && browser.find.state(host)?.total === 2,
        'case-sensitive match',
      )
      // Focus returns to the real page; neither page Escape nor a result refresh dismisses find.
      wc.focus()
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
      await new Promise((resolve) => setTimeout(resolve, 120))
      assert.equal(browser.find.panel(host), panel)
      assert.equal(panel.getDiagnostics().visible, true)
      await browser.request(host, { action: 'open-find' })
      const reopened = browser.find.panel(host)!
      assert.notEqual(reopened, panel)
      await until(
        () => reopened.getDiagnostics().controls.find((c) => c.id === 'find-query')?.focused === true,
        'reopened input focus',
      )
      assert.equal(reopened.getDiagnostics().controls.find((c) => c.id === 'find-query')?.focused, true)
      act(panel, 'find-query', 'change', 'stale')
      assert.equal(browser.find.state(host)?.query, 'needle')
      // Emptying the query clears highlights and enters a compact, idle state.
      act(reopened, 'find-query', 'change', '')
      assert.equal(browser.find.state(host)?.status, 'idle')
      browser.find.close(host)
      browser.find.open(host)
      const chinese = browser.find.panel(host)!
      await until(
        () => chinese.getDiagnostics().controls.find((c) => c.id === 'find-query')?.focused === true,
        'CJK editor focus',
      )
      type(chinese, '中文查找')
      await until(
        () => browser.find.state(host)?.status === 'ready' && browser.find.state(host)?.total === 2,
        'native CJK characters',
      )
      const originalDiagnostics = chinese.getDiagnostics.bind(chinese)
      chinese.getDiagnostics = () => {
        const value = originalDiagnostics()
        return {
          ...value,
          controls: value.controls.map((c) => (c.id === 'find-query' ? { ...c, composing: true } : c)),
        }
      }
      act(chinese, 'find-query', 'change', 'composition pending')
      act(chinese, 'find-query', 'submit', 'composition pending')
      await new Promise((resolve) => setTimeout(resolve, 220))
      assert.equal(browser.find.state(host)?.requestId, undefined, 'IME draft never searches early')
      browser.find.open(host)
      assert.equal(browser.find.panel(host), chinese, 'reopen preserves active composition')
      chinese.getDiagnostics = originalDiagnostics
      act(chinese, 'find-query', 'change', '中文查找')
      await until(() => browser.find.state(host)?.status === 'ready', 'composition commit')
      const nativeValue = () =>
        (chinese.getDiagnostics().controls.find((c) => c.id === 'find-query') as { value?: string })?.value
      assert.equal(nativeValue(), '中文查找')
      await browser.request(host, { action: 'preferences', value: { mode: 'dark' } })
      host.window.setBounds({ ...originalBounds, width: originalBounds.width - 80 })
      await new Promise((resolve) => setTimeout(resolve, 180))
      browser.find.reposition(host)
      assert.equal(nativeValue(), '中文查找', 'theme/geometry/results never reset native text')
      host.window.minimize()
      await until(() => host.window.isMinimized(), 'minimized find owner')
      assert.equal(browser.find.panel(host), chinese, 'minimizing retains the find session')
      host.window.restore()
      host.window.show()
      host.window.focus()
      await until(() => chinese.getDiagnostics().visible, 'find restores with its owner')
      assert.equal(nativeValue(), '中文查找')
      assert.ok((await wc.executeJavaScript('window.findFrames')) > frames)
      assert.equal(captures, 0)
      assert.equal(hidden, 0)
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
          path.join(path.dirname(report), 'find-native.png'),
        ],
        { encoding: 'utf8', windowsHide: true },
      )
      fs.writeFileSync(
        path.join(path.dirname(report), 'find-native.json'),
        JSON.stringify(
          {
            at: new Date().toISOString(),
            captured: capture.status === 0,
            reason: capture.status === 0 ? undefined : capture.stderr.trim(),
            diagnostics: chinese.getDiagnostics(),
          },
          null,
          2,
        ),
      )
      type(chinese, undefined, 27)
      await until(() => !browser.find.panel(host), 'native Escape closes find')
      await until(() => wc.isFocused(), 'closing restores focus to the web page')
      browser.find.open(host)
      const closed = browser.find.panel(host)!
      const other = browser.newTab(host)
      assert.equal(browser.find.panel(host), undefined)
      act(closed, 'find-query', 'change', 'other page leak')
      await browser.closeTab(host, other)
      browser.activate(host, tab.state.id)
      browser.find.open(host)
      assert.equal(browser.find.state(host)?.query, '中文查找')
      await browser.request(host, {
        action: 'navigate',
        id: tab.state.id,
        text: origin + '/find-new-document',
      })
      await until(() => !tab.state.loading && tab.state.url.endsWith('/find-new-document'), 'find navigation')
      assert.equal(browser.find.panel(host), undefined)
    } catch (error) {
      console.error(
        'Find state:',
        browser.find.state(host),
        JSON.stringify(browser.find.panel(host)?.getDiagnostics()),
      )
      throw error
    } finally {
      wc.capturePage = capture
      tab.view!.setVisible = visibility
    }
  } finally {
    browser.find.close(host, false)
    host.window.setBounds(originalBounds)
    await browser.request(host, { action: 'preferences', value: { mode: 'light' } })
    await browser.closeTab(host, tab)
    browser.activate(host, previous)
  }
}
