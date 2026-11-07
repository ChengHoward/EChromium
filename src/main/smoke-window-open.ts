import assert from 'node:assert/strict'
import type { Browser, Host, Tab } from './browser'

async function until(check: () => boolean | Promise<boolean>, label: string) {
  const start = Date.now()
  while (Date.now() - start < 10000) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error('Timed out: ' + label)
}

export async function smokeOpenedTabs(browser: Browser, host: Host, origin: string) {
  const original = host.activeId,
    before = new Set(host.tabs)
  const source = browser.newTab(host, 'web', origin + '/opener')
  const focus = async (tab: Tab) => {
    browser.activate(host, tab.state.id)
    host.window.show()
    host.window.focus()
    await until(() => host.window.isFocused(), 'new tab source focus')
  }
  try {
    await until(() => source.state.title === 'Fixture one' && !source.state.loading, 'opener loaded')
    const wc = source.view!.webContents
    await focus(source)
    await wc.executeJavaScript(
      `(()=>{const form=document.createElement('form');
      form.action=${JSON.stringify(origin + '/popup')};form.method='POST';form.target='named-fixture-tab';
      const field=document.createElement('input');field.name='proof';field.value='posted';
      form.append(field);document.body.append(form);form.submit()})()`,
      true,
    )
    await until(() => host.tabs.length === before.size + 2, 'POST opens browser tab')
    const child = host.tabs[host.tabs.indexOf(source) + 1],
      guest = child.view!.webContents
    await until(async () => {
      try {
        return (
          (await guest.executeJavaScript('document.getElementById("result")?.textContent')) ===
          'POST proof=posted'
        )
      } catch {
        return false
      }
    }, 'native tab preserves POST')
    assert.equal(browser.popups.size, 0, 'ordinary form does not create a popup window')
    assert.equal(host.activeId, child.state.id)
    assert.equal(await guest.executeJavaScript('Boolean(window.opener)'), true)
    assert.equal(
      await guest.executeJavaScript('typeof window.browser + ":" + typeof process'),
      'undefined:undefined',
    )
    assert.equal(guest.session, host.session)
    assert.equal(
      (guest as unknown as { getLastWebPreferences(): { sandbox: boolean } }).getLastWebPreferences().sandbox,
      true,
    )
    // A named target reuses Chromium's existing browsing context, rather than making a duplicate tab.
    await focus(source)
    await wc.executeJavaScript(
      `window.open(${JSON.stringify(origin + '/two')},'named-fixture-tab');void 0`,
      true,
    )
    await until(() => child.state.title === 'Fixture two' && !child.state.loading, 'named tab reuse')
    assert.equal(host.tabs.length, before.size + 2)
    // Actual Ctrl-click must leave the opener active and insert a background tab beside it.
    await focus(source)
    const point =
      await wc.executeJavaScript(`(()=>{const a=document.createElement('a');a.href='/background-link';
      a.textContent='background fixture';a.style='position:fixed;left:30px;top:30px;z-index:9999;background:white';
      document.body.append(a);const r=a.getBoundingClientRect();return {x:Math.round(r.x+10),y:Math.round(r.y+8)}})()`)
    wc.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1, modifiers: ['control'] })
    wc.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1, modifiers: ['control'] })
    await until(() => host.tabs.length === before.size + 3, 'Ctrl click opens background tab')
    const background = host.tabs[host.tabs.indexOf(source) + 1]
    await until(
      () => background.state.url.endsWith('/background-link') && !background.state.loading,
      'background tab loaded',
    )
    assert.equal(host.activeId, source.state.id)
    await wc.executeJavaScript(
      `(()=>{const a=document.createElement('a');a.href='/target-blank';a.target='_blank';
      document.body.append(a);a.click()})()`,
      true,
    )
    await until(() => host.tabs.length === before.size + 4, 'target blank opens foreground tab')
    const blank = host.tabs[host.tabs.indexOf(source) + 1]
    await until(
      () => blank.state.url.endsWith('/target-blank') && !blank.state.loading,
      'target blank loaded',
    )
    assert.equal(host.activeId, blank.state.id)
    // An independently owned browser tab must survive navigation and closure of its opener.
    await browser.request(host, { action: 'navigate', id: source.state.id, text: origin + '/two' })
    await until(() => source.state.title === 'Fixture two' && !source.state.loading, 'opener navigates')
    await browser.closeTab(host, source)
    assert.equal(guest.isDestroyed(), false)
    assert.equal(background.view!.webContents.isDestroyed(), false)
    browser.activate(host, child.state.id)
    await guest.executeJavaScript('window.close();void 0')
    await until(() => !host.tabs.includes(child), 'script-created tab closes itself')
  } finally {
    for (const tab of [...host.tabs]) if (!before.has(tab)) await browser.closeTab(host, tab)
    browser.activate(host, original)
  }
}
