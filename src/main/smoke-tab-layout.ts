import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { Browser } from './browser'

export async function smokeTabLayout(browser: Browser, report: string) {
  const host = browser.createWindow(),
    wc = host.window.webContents
  const longTitle = 'Chromium 标签页布局与长标题渐隐遮罩检查 · 保留完整标题内容，同时避免与关闭按钮重叠'
  const first = host.tabs[0]
  first.state.title = '短标题'
  const selected = browser.newTab(host, 'settings')
  selected.state.title = longTitle
  selected.state.audible = true
  browser.newTab(host, 'newtab', '', false).state.title = 'LINUX DO · 常用网站与浏览器开发文档的长标题'
  host.window.setSize(1200, 820)
  wc.setBackgroundThrottling(false)
  browser.publish()
  const js = (code: string) => wc.executeJavaScript(code)
  const until = async (check: () => Promise<boolean>, label: string) => {
    const end = Date.now() + 6000
    while (Date.now() < end) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    throw new Error('Tab layout: ' + label)
  }
  try {
    await until(
      () =>
        js(
          `Boolean(document.querySelector('.tab.selected .tab-title.overflowing'))&&!document.querySelector('.tab-motion-enter-active')`,
        ),
      'long title rendered',
    )
    const geometry = await js(
      `(()=>{const tab=document.querySelector('.tab.selected'),title=tab.querySelector('.tab-title'),icon=tab.querySelector('.tab-icon'),close=tab.querySelector('.tab-close'),add=document.querySelector('.new-tab'),strip=document.querySelector('.titlebar');const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2}};return {tab:rect(tab),icon:rect(icon),close:rect(close),add:rect(add),addIcon:rect(add.querySelector('svg')),strip:rect(strip),title:{mask:getComputedStyle(title).maskImage,text:title.textContent,overflow:getComputedStyle(title).textOverflow,font:getComputedStyle(title).fontSize},shortMask:getComputedStyle(document.querySelector('[data-tab-id="${first.state.id}"] .tab-title')).maskImage}})()`,
    )
    assert.equal(Math.round(geometry.strip.height), 41)
    assert.equal(Math.round(geometry.tab.height), 35)
    assert.equal(Math.round(geometry.icon.width), 16)
    assert.ok(
      Math.abs(geometry.icon.cy - geometry.addIcon.cy) < 0.5,
      'favicon and add glyph share their visual center',
    )
    assert.ok(Math.abs(geometry.close.cy - geometry.icon.cy) < 0.5, 'close glyph and favicon align')
    assert.equal(geometry.title.text, longTitle)
    assert.equal(geometry.title.overflow, 'clip')
    assert.equal(geometry.title.font, '13px')
    assert.ok(geometry.title.mask.includes('linear-gradient'))
    assert.equal(geometry.shortMask, 'none', 'short titles remain completely unmasked')
    assert.ok(
      await js(
        `(()=>{const icons=[...document.querySelector('.tab.selected').children];return icons.indexOf(document.querySelector('.tab.selected .tab-audio'))<icons.indexOf(document.querySelector('.tab.selected .tab-title'))})()`,
      ),
      'audio indicator precedes title as in the reference',
    )
    wc.debugger.attach('1.3')
    await wc.debugger.sendCommand('DOM.enable')
    await wc.debugger.sendCommand('CSS.enable')
    const root = await wc.debugger.sendCommand('DOM.getDocument')
    const add = await wc.debugger.sendCommand('DOM.querySelector', {
      nodeId: root.root.nodeId,
      selector: '.new-tab',
    })
    await wc.debugger.sendCommand('CSS.forcePseudoState', {
      nodeId: add.nodeId,
      forcedPseudoClasses: ['hover'],
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    const dividerOpacity = () =>
      js('Number(getComputedStyle(document.querySelector(".new-tab"),"::before").opacity)')
    assert.equal(await dividerOpacity(), 0, 'hovering add suppresses its adjacent separator')
    await wc.debugger.sendCommand('CSS.forcePseudoState', {
      nodeId: add.nodeId,
      forcedPseudoClasses: [],
    })
    await until(async () => (await dividerOpacity()) === 1, 'inactive final tab keeps separator')
    const last = await wc.debugger.sendCommand('DOM.querySelector', {
      nodeId: root.root.nodeId,
      selector: '.tabs .tab:last-child',
    })
    await wc.debugger.sendCommand('CSS.forcePseudoState', {
      nodeId: last.nodeId,
      forcedPseudoClasses: ['hover'],
    })
    await until(async () => (await dividerOpacity()) === 0, 'hovering final tab suppresses separator')
    await wc.debugger.sendCommand('CSS.forcePseudoState', {
      nodeId: last.nodeId,
      forcedPseudoClasses: [],
    })
    await js('document.querySelector(".tabs .tab:last-child").classList.add("selected")')
    await until(async () => (await dividerOpacity()) === 0, 'selected final tab suppresses separator')
    await js('document.querySelector(".tabs .tab:last-child").classList.remove("selected")')
    await wc.debugger.sendCommand('CSS.forcePseudoState', {
      nodeId: add.nodeId,
      forcedPseudoClasses: ['hover'],
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    fs.writeFileSync(
      path.join(path.dirname(report), 'chromium-tab-layout.png'),
      (await wc.capturePage()).toPNG(),
    )
    host.window.setSize(700, 820)
    await until(
      () => js('Boolean(document.querySelector(".tab.selected .tab-title.overflowing"))'),
      'resized title remains masked',
    )
    assert.equal(await js('document.querySelector(".tab.selected .tab-title").textContent'), longTitle)
    selected.state.title = '短'
    browser.publish()
    await until(
      () => js('getComputedStyle(document.querySelector(".tab.selected .tab-title")).maskImage==="none"'),
      'changing to a short title clears the mask',
    )
    fs.writeFileSync(
      path.join(path.dirname(report), 'tab-layout.json'),
      JSON.stringify({ passed: true, geometry }, null, 2),
    )
  } finally {
    if (wc.debugger.isAttached()) wc.debugger.detach()
    if (!host.window.isDestroyed()) await browser.closeWindow(host)
  }
}
