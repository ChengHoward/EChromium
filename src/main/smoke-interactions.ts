import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import type { Browser, Host } from './browser'

async function until(check: () => boolean | Promise<boolean>, label: string) {
  const start = Date.now()
  while (Date.now() - start < 12000) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 75))
  }
  throw new Error(`Timed out: ${label}`)
}
async function focus(host: Host) {
  host.window.show()
  host.window.focus()
  await until(() => host.window.isFocused(), 'fixture interaction focus')
}
export async function smokePopupProtection(browser: Browser, host: Host, origin: string, report: string) {
  const previous = host.activeId,
    tab = browser.newTab(host, 'web', origin + '/popup-limits')
  const children = () => [...browser.popups.values()].filter((p) => p.rootId === tab.view!.webContents.id)
  try {
    await until(() => !tab.state.loading && tab.state.title === 'Fixture one', 'popup fixture')
    const wc = tab.view!.webContents
    for (let i = 0; i < 3; i++) {
      await focus(host)
      await wc.executeJavaScript(
        `window.open(${JSON.stringify(origin + '/limited-popup')},'burst-${i}','popup,width=600,height=450');void 0`,
        true,
      )
      await until(() => children().length === 1, 'allowed popup ' + i)
      children()[0].window.destroy()
      await until(() => children().length === 0, 'popup closes')
    }
    await focus(host)
    assert.equal(
      await wc.executeJavaScript(
        `window.open(${JSON.stringify(origin + '/limited-popup')},'fourth','popup,width=600,height=450')===null`,
        true,
      ),
      true,
    )
    assert.equal(browser.popupPolicy.status(wc.id, tab.permissionEpoch).blocked, 1)
    await until(
      async () =>
        host.window.webContents.executeJavaScript(
          'Boolean(document.querySelector(".popup-controls button"))',
        ),
      'blocked popup control',
    )
    await host.window.webContents.executeJavaScript(
      'document.querySelector(".popup-controls button").click()',
    )
    await until(
      () => browser.popupPolicy.status(wc.id, tab.permissionEpoch).allowed,
      'renderer allows this page',
    )
    await focus(host)
    await wc.executeJavaScript(
      `window.open(${JSON.stringify(origin + '/limited-popup')},'allowed-after-choice','popup,width=600,height=450');void 0`,
      true,
    )
    await until(() => children().length === 1, 'popup after user override')
    children()[0].window.destroy()
    const other = browser.newTab(host)
    try {
      await focus(host)
      assert.equal(
        await wc.executeJavaScript(
          `window.open(${JSON.stringify(origin + '/limited-popup')},'background','popup,width=600,height=450')===null`,
          true,
        ),
        true,
      )
      assert.equal(children().length, 0)
    } finally {
      await browser.closeTab(host, other)
    }
    browser.activate(host, tab.state.id)
    await new Promise((resolve) => setTimeout(resolve, 350))
    fs.writeFileSync(
      path.join(path.dirname(report), 'popup-controls.png'),
      (await host.window.webContents.capturePage()).toPNG(),
    )
    await browser.request(host, {
      action: 'navigate',
      id: tab.state.id,
      text: origin + '/popup-new-document',
    })
    await until(
      () => !tab.state.loading && tab.state.url.endsWith('/popup-new-document'),
      'popup policy navigation reset',
    )
    assert.deepEqual(browser.popupPolicy.status(wc.id, tab.permissionEpoch), { allowed: false, blocked: 0 })
  } finally {
    for (const child of children()) child.window.destroy()
    await browser.closeTab(host, tab)
    browser.activate(host, previous)
  }
}

export async function smokePageDialogs(browser: Browser, host: Host, origin: string) {
  const previous = host.activeId,
    tab = browser.newTab(host, 'web', origin + '/dialogs')
  try {
    await until(() => !tab.state.loading && tab.state.title === 'Fixture one', 'dialog fixture')
    const wc = tab.view!.webContents
    const panel = async () => {
      await until(() => !!browser.dialogs.panel(wc.id)?.getDiagnostics().visible, 'native page dialog')
      return browser.dialogs.panel(wc.id)!
    }
    const act = (
      current: Awaited<ReturnType<typeof panel>>,
      id: string,
      type: string,
      value?: string | boolean,
    ) => current.emit('action', { id, type, value, revision: current.revision })
    await focus(host)
    let settled = false
    let prompt = wc.executeJavaScript('prompt("输入测试文字", "默认回复")').then((value) => {
      settled = true
      return value
    })
    let inputPanel = await panel()
    await new Promise((resolve) => setTimeout(resolve, 5300))
    if (settled) {
      // Desktop focus loss legitimately cancels; it must never return the runtime's default accepted text.
      assert.equal(await prompt, null, 'waiting must not auto-accept the default prompt reply')
      assert.equal(browser.dialogs.panel(wc.id), undefined)
      await browser.request(host, { action: 'dialog-policy', id: tab.state.id, value: false })
      await focus(host)
      prompt = wc.executeJavaScript('prompt("输入测试文字", "默认回复")')
      inputPanel = await panel()
    }
    assert.ok(JSON.stringify(inputPanel.getDiagnostics()).includes(origin))
    const previousMode = browser.store.data.preferences.mode
    const promptTheme = () =>
      (inputPanel.getDiagnostics() as unknown as { theme: { mode: string; background: string } }).theme
    const promptDraft = inputPanel
      .getDiagnostics()
      .controls.find((control) => control.id === 'dialog-input') as { value?: string }
    for (const mode of ['dark', 'light'] as const) {
      await browser.request(host, { action: 'preferences', value: { mode } })
      assert.equal(browser.dialogs.panel(wc.id), inputPanel, 'appearance updates keep the open prompt')
      assert.equal(promptTheme().mode, mode)
      assert.equal(promptTheme().background, host.appearance.colors.surface)
      assert.equal(
        (
          inputPanel.getDiagnostics().controls.find((control) => control.id === 'dialog-input') as {
            value?: string
          }
        ).value,
        promptDraft.value,
        'theme updates preserve native prompt drafts',
      )
    }
    await browser.request(host, { action: 'preferences', value: { mode: previousMode } })
    act(inputPanel, 'dialog-input', 'change', '中文 reply & <text>')
    act(inputPanel, 'dialog-accept', 'click')
    assert.equal(await prompt, '中文 reply & <text>')
    await focus(host)
    const confirm = wc.executeJavaScript('confirm("取消这次操作？")')
    const confirmPanel = await panel(),
      diagnostics = confirmPanel.getDiagnostics(),
      cancel = diagnostics.controls.find((c) => c.id === 'dialog-cancel')!
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
        String((cancel.bounds.x + cancel.bounds.width / 2 - diagnostics.bounds.x) / diagnostics.bounds.width),
        '-FractionY',
        String(
          (cancel.bounds.y + cancel.bounds.height / 2 - diagnostics.bounds.y) / diagnostics.bounds.height,
        ),
      ],
      { encoding: 'utf8', windowsHide: true },
    )
    assert.equal(clicked.status, 0, clicked.stderr)
    await until(() => !browser.dialogs.panel(wc.id), 'native click cancels confirm')
    assert.equal(await confirm, false)
    await focus(host)
    const alert = wc.executeJavaScript('alert("提示后暂停本页对话框");"alert-finished"')
    const alertPanel = await panel()
    act(alertPanel, 'dialog-mute', 'change', true)
    act(alertPanel, 'dialog-accept', 'click')
    assert.equal(await alert, 'alert-finished')
    assert.equal(await wc.executeJavaScript('confirm("这次不会弹出")'), false)
    assert.equal(browser.dialogs.status(wc.id, tab.permissionEpoch).muted, true)
    await until(
      async () =>
        host.window.webContents.executeJavaScript(
          'Boolean(document.querySelector(".dialog-controls button"))',
        ),
      'restore page dialogs control',
    )
    await host.window.webContents.executeJavaScript(
      'document.querySelector(".dialog-controls button").click()',
    )
    await until(
      () => !browser.dialogs.status(wc.id, tab.permissionEpoch).muted,
      'renderer restores page dialogs',
    )
    await focus(host)
    const cancelledPrompt = wc.executeJavaScript('prompt("Escape returns null", "original")')
    const escapePanel = await panel()
    escapePanel.emit('dismissed', { reason: 'escape' })
    assert.equal(await cancelledPrompt, null)
    await focus(host)
    const stale = wc.executeJavaScript('confirm("Leaving the tab cancels this")')
    const stalePanel = await panel()
    browser.activate(host, previous)
    assert.equal(await stale, false)
    act(stalePanel, 'dialog-accept', 'click')
    assert.equal(browser.dialogs.panel(wc.id), undefined)
    browser.activate(host, tab.state.id)
    await browser.request(host, { action: 'dialog-policy', id: tab.state.id, value: false })
    await wc.executeJavaScript(
      `(()=>{const frame=document.createElement('iframe');frame.src=${JSON.stringify(process.env.ECHROMIUM_SMOKE_OTHER_ORIGIN + '/dialog-frame')};document.body.append(frame)})()`,
    )
    await until(
      () => wc.mainFrame.frames.some((frame) => frame.url.endsWith('/dialog-frame')),
      'cross-origin dialog frame',
    )
    const frame = wc.mainFrame.frames.find((frame) => frame.url.endsWith('/dialog-frame'))!
    await focus(host)
    const embedded = frame.executeJavaScript('confirm("来自嵌入来源")')
    const embeddedPanel = await panel()
    const description = JSON.stringify(embeddedPanel.getDiagnostics())
    assert.ok(description.includes(process.env.ECHROMIUM_SMOKE_OTHER_ORIGIN!))
    assert.ok(description.includes('嵌入在'))
    act(embeddedPanel, 'dialog-cancel', 'click')
    assert.equal(await embedded, false)
    // Three dismissed dialogs are allowed in a burst; the fourth cancels without opening a panel.
    for (let i = 0; i < 2; i++) {
      await focus(host)
      const response = wc.executeJavaScript('confirm("rate-limit fixture")')
      act(await panel(), 'dialog-cancel', 'click')
      assert.equal(await response, false)
    }
    await focus(host)
    assert.equal(await wc.executeJavaScript('confirm("fourth in burst")'), false)
    assert.equal(browser.dialogs.panel(wc.id), undefined)
    assert.ok(browser.dialogs.status(wc.id, tab.permissionEpoch).blocked >= 2)
    assert.equal(browser.dialogs.status(wc.id, tab.permissionEpoch).muted, true)
  } finally {
    if (tab.view) browser.dialogs.cancelRoot(tab.view.webContents.id)
    await browser.closeTab(host, tab)
    browser.activate(host, previous)
  }
}
