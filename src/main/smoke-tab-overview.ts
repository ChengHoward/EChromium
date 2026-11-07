import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { webContents } from 'electron'
import type { Browser } from './browser'

async function until(check: () => boolean | Promise<boolean>, label: string) {
  const start = Date.now()
  while (Date.now() - start < 14000) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 65))
  }
  throw new Error('Timed out: ' + label)
}
export async function smokeTabOverview(browser: Browser, origin: string, report: string) {
  const host = browser.createWindow({ empty: true }),
    originalLeave = browser.confirmLeave
  host.window.webContents.setBackgroundThrottling(false)
  const first = browser.newTab(host, 'web', origin + '/overview-document'),
    second = browser.newTab(host, 'web', origin + '/overview-reading'),
    lazy = browser.newTab(host, 'web', origin + '/overview-lazy', false)
  lazy.state.title = '稍后阅读的网页'
  browser.newTab(host, 'newtab', '', false)
  browser.newTab(host, 'settings', '', false)
  browser.newTab(host, 'bookmarks', '', false)
  for (let i = 0; i < 20; i++) {
    const tab = browser.newTab(host, 'web', origin + '/overview-index-' + i, false)
    tab.state.title = `资料索引 ${String(i + 1).padStart(2, '0')} · 项目记录`
  }
  const js = (code: string) => host.window.webContents.executeJavaScript(code),
    directory = path.dirname(report)
  const shell = async (selector: string) =>
    until(async () => js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), selector)
  try {
    await until(
      () =>
        !first.state.loading &&
        !second.state.loading &&
        first.state.title === 'Fixture one' &&
        second.state.title === 'Fixture one',
      'overview web fixtures',
    )
    await first.view!.webContents.executeJavaScript(
      `document.title='工作文档 · 产品思路';document.body.style.cssText='margin:32px;background:#edf5fb;color:#263c50;font-family:Segoe UI,sans-serif';document.querySelector('h1').textContent='把想法整理成下一步';document.getElementById('result').textContent='项目文档 · 本周计划';document.getElementById('input').value='尚未提交的表单';window.overviewIdentity='same-page'`,
    )
    await second.view!.webContents.executeJavaScript(
      `document.title='阅读清单 · 设计笔记';document.body.style.cssText='margin:32px;background:#f3f5eb;color:#3f5147;font-family:Segoe UI,sans-serif';document.querySelector('h1').textContent='留给好奇心的一页';document.getElementById('result').textContent='收集灵感，继续探索'`,
    )
    await browser.request(host, { action: 'pin', id: first.state.id })
    browser.activate(host, first.state.id)
    host.window.show()
    host.window.focus()
    await until(() => host.window.isFocused(), 'overview window focus')
    await shell('.tab-overview-toggle')
    await until(
      async () =>
        js(`document.querySelector('.tab.selected')?.dataset.tabId===${JSON.stringify(first.state.id)}`),
      'compressed active tab',
    )
    const metrics = () =>
      js(
        `(()=>{const strip=document.querySelector('.tabs'),r=strip.getBoundingClientRect(),tabs=[...strip.querySelectorAll('.tab')],selected=strip.querySelector('.selected').getBoundingClientRect();return {width:window.innerWidth,strip:r.right,visible:tabs.filter(t=>{const b=t.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1}).length,selectedVisible:selected.left>=r.left-1&&selected.right<=r.right+1,activeWidth:selected.width}})()`,
      )
    await until(async () => (await metrics()).visible >= 16, 'more tabs fit in the strip')
    assert.ok((await metrics()).strip <= (await metrics()).width - 137, 'native window controls stay clear')
    fs.writeFileSync(
      path.join(directory, 'tabs-compressed.png'),
      (
        await host.window.webContents.capturePage({
          x: 0,
          y: 0,
          width: host.window.getContentSize()[0],
          height: 48,
        })
      ).toPNG(),
    )
    const last = host.tabs.at(-1)!
    const internal = host.tabs.find((tab) => tab.state.kind === 'settings')!
    browser.activate(host, internal.state.id)
    await until(
      async () => (await metrics()).selectedVisible && (await metrics()).activeWidth >= 112,
      'selected tab retains a readable width',
    )
    // A long strip must reveal the selected tab even at its far end.
    browser.activate(host, last.state.id, true)
    await until(
      async () =>
        (await js(
          `document.querySelector('.tab.selected')?.dataset.tabId===${JSON.stringify(last.state.id)}`,
        )) && (await metrics()).selectedVisible,
      'selected tab scrolls into view',
    )
    browser.activate(host, first.state.id)
    host.window.setSize(700, 620)
    await until(
      async () =>
        (await metrics()).width <= 700 && (await metrics()).visible >= 6 && (await metrics()).selectedVisible,
      'narrow compressed tabs',
    )
    fs.writeFileSync(
      path.join(directory, 'tabs-compressed-narrow.png'),
      (
        await host.window.webContents.capturePage({
          x: 0,
          y: 0,
          width: host.window.getContentSize()[0],
          height: 48,
        })
      ).toPNG(),
    )
    host.window.setSize(1240, 820)
    await until(async () => (await metrics()).width >= 1200, 'overview full width')
    await browser.request(host, { action: 'pin', id: first.state.id })
    browser.activate(host, second.state.id)
    await until(
      async () =>
        js(`document.querySelector('.tab.selected')?.dataset.tabId===${JSON.stringify(second.state.id)}`),
      'reading page is visible before snapshot',
    )
    await new Promise((resolve) => setTimeout(resolve, 250))
    browser.activate(host, first.state.id)
    await until(
      async () =>
        js(`document.querySelector('.tab.selected')?.dataset.tabId===${JSON.stringify(first.state.id)}`),
      'document page is visible before overview',
    )
    const wc = first.view!.webContents,
      wcId = wc.id,
      history = wc.navigationHistory.getAllEntries().map((entry) => entry.url),
      beforeIds = webContents
        .getAllWebContents()
        .map((contents) => contents.id)
        .sort()
    await js('document.querySelector(".tab-overview-toggle").click()')
    await until(() => !!host.overview, 'button opens overview')
    const token = host.overview!
    await shell('.tab-overview .overview-card')
    await until(
      async () => js('document.activeElement?.getAttribute("aria-label")==="搜索标签"'),
      'overview search autofocus',
    )
    assert.ok(host.tabs.every((tab) => !tab.view || !tab.view.getVisible()))
    assert.equal(lazy.view, undefined)
    await until(
      async () => js('document.querySelectorAll(".overview-preview img").length>=2'),
      'real page preview images',
    )
    await until(
      async () =>
        js(
          `Array.from(document.querySelectorAll('.overview-card')).slice(0,4).every(card=>{const r=card.getBoundingClientRect(),meta=card.querySelector('.overview-meta').getBoundingClientRect();return r.height>r.width*.6+60&&meta.height>=60&&meta.bottom<=r.bottom+1})`,
        ),
      'preview tiles retain their image and readable metadata height',
    )
    assert.deepEqual(
      webContents
        .getAllWebContents()
        .map((contents) => contents.id)
        .sort(),
      beforeIds,
      'overview never creates guest pages',
    )
    assert.equal(first.view!.webContents.id, wcId)
    assert.equal(await wc.executeJavaScript('document.getElementById("input").value'), '尚未提交的表单')
    assert.deepEqual(
      wc.navigationHistory.getAllEntries().map((entry) => entry.url),
      history,
    )
    assert.ok(
      await js(
        `Boolean(document.querySelector('[data-overview-id="${lazy.state.id}"]')?.textContent.includes('选中后载入网页'))`,
      ),
    )
    assert.equal(JSON.stringify(browser.store.data).includes('data:image/jpeg'), false)
    await new Promise((resolve) => setTimeout(resolve, 160))
    fs.writeFileSync(
      path.join(directory, 'tab-overview.png'),
      (await host.window.webContents.capturePage()).toPNG(),
    )
    await browser.request(host, { action: 'preferences', value: { mode: 'dark' } })
    await new Promise((resolve) => setTimeout(resolve, 100))
    fs.writeFileSync(
      path.join(directory, 'tab-overview-dark.png'),
      (await host.window.webContents.capturePage()).toPNG(),
    )
    await browser.request(host, { action: 'preferences', value: { mode: 'light' } })
    await assert.rejects(browser.previews.request(host, { token: 'old-token', ids: [first.state.id] }))
    await assert.rejects(browser.previews.request(host, { token, ids: ['foreign-window-tab'] }))
    await js(
      `(()=>{const input=document.querySelector('.overview-search input');input.value='设计 笔记';input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    )
    await until(
      async () => js('document.querySelectorAll(".overview-card").length===1'),
      'search filters titles and URLs',
    )
    await js(
      `(()=>{const input=document.querySelector('.overview-search input');input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}))})()`,
    )
    assert.equal(host.overview, token)
    await js(
      `document.querySelector('.overview-search input').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));document.querySelector('.overview-select').click()`,
    )
    await until(
      () => !host.overview && host.activeId === second.state.id && second.view!.getVisible(),
      'card selects the actual page',
    )
    await until(() => second.view!.webContents.isFocused(), 'selection restores guest focus')
    second.view!.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: 'A',
      modifiers: ['control', 'shift'],
    })
    second.view!.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control', 'shift'] })
    await until(() => !!host.overview && host.overview !== token, 'keyboard reopens fresh overview')
    await shell('.tab-overview')
    await second.view!.webContents.executeJavaScript(
      'window.addEventListener("beforeunload",event=>{event.preventDefault();event.returnValue=""});document.getElementById("activate").click()',
      true,
    )
    let askedToLeave = false
    browser.confirmLeave = () => {
      askedToLeave = true
      return false
    }
    const count = host.tabs.length
    await js(`document.querySelector('[data-overview-id="${second.state.id}"] .overview-card-close').click()`)
    await until(() => askedToLeave && !second.closing, 'beforeunload cancellation settles')
    assert.equal(host.tabs.length, count)
    assert.ok(host.overview)
    assert.equal(second.view!.webContents.isDestroyed(), false)
    browser.confirmLeave = () => true
    await browser.closeTab(host, second)
    assert.ok(host.overview, 'closing a card leaves overview open')
    assert.equal(host.activeId, lazy.state.id)
    assert.equal(lazy.view, undefined, 'closing the active card does not load its replacement')
    await js(`document.querySelector('[data-overview-id="${first.state.id}"] .overview-select').click()`)
    await until(() => !host.overview && host.activeId === first.state.id, 'select returns to existing guest')
    assert.equal(lazy.view, undefined, 'selecting a different card never loads the previous lazy selection')
    assert.equal(await wc.executeJavaScript('window.overviewIdentity'), 'same-page')
    await assert.rejects(browser.previews.request(host, { token, ids: [first.state.id] }))
    await browser.request(host, { action: 'tab-overview', value: true })
    await shell('.tab-overview')
    host.window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    host.window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await until(() => !host.overview && wc.isFocused(), 'Escape resumes original guest')
    // A screenshot resolving after the overview closes may not re-enter the old UI session.
    const capture = wc.capturePage.bind(wc),
      frame = await capture(undefined, { stayHidden: true })
    browser.previews.forget(first)
    let release!: () => void
    wc.capturePage = () =>
      new Promise((resolve) => {
        release = () => resolve(frame)
      })
    try {
      await browser.request(host, { action: 'tab-overview', value: true })
      await until(() => !!release, 'pending preview snapshot')
      const late = browser.previews.request(host, { token: host.overview!, ids: [first.state.id] })
      await browser.request(host, { action: 'tab-overview', value: false })
      release()
      assert.deepEqual(await late, [])
    } finally {
      wc.capturePage = capture
      release?.()
    }
    const start = host.tabs.find((tab) => tab.state.kind === 'newtab')!
    browser.activate(host, start.state.id)
    await shell('.start-search input')
    await js(
      `(()=>{const input=document.querySelector('.start-search input');input.value='保留内部页面草稿';input.dispatchEvent(new Event('input',{bubbles:true}));const spacer=document.createElement('div');spacer.id='overview-scroll-proof';spacer.style.height='2000px';document.querySelector('.page-layer').append(spacer);document.querySelector('.viewport').scrollTop=180})()`,
    )
    const oldScroll = await js('document.querySelector(".viewport").scrollTop')
    assert.ok(oldScroll > 100)
    await browser.request(host, { action: 'tab-overview', value: true })
    await shell('.tab-overview')
    await until(
      async () => js('document.querySelector(".viewport").scrollTop===0'),
      'overview resets outer scroll',
    )
    assert.equal(await js('document.querySelector(".start-search input").value'), '保留内部页面草稿')
    await browser.request(host, { action: 'tab-overview', value: false })
    await until(
      async () => (await js('document.querySelector(".viewport").scrollTop')) === oldScroll,
      'internal page scroll restores',
    )
    assert.equal(await js('document.querySelector(".start-search input").value'), '保留内部页面草稿')
    await js('document.getElementById("overview-scroll-proof").remove()')
  } finally {
    browser.confirmLeave = () => true
    await browser.closeWindow(host)
    browser.confirmLeave = originalLeave
    browser.store.data.preferences.mode = 'light'
  }
}
