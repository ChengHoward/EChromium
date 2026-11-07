import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { nativeTheme } from 'electron'
import type { Browser } from './browser'
import { buildBrowserMenu, openBrowserMenu } from './menus'
import { BrowserStore } from './storage'
import { transparencyLimits, themeDepthLimits, palette } from '../shared/appearance'
import { smokeMaterial } from './smoke-material'

async function until(check: () => boolean | Promise<boolean>, label: string) {
  const start = Date.now()
  while (Date.now() - start < 10000) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error('Timed out: ' + label)
}
export async function smokeChrome(browser: Browser, report: string) {
  const previous = { ...browser.store.data.preferences },
    themeSource = nativeTheme.themeSource,
    host = browser.createWindow(),
    wc = host.window.webContents,
    js = (code: string) => wc.executeJavaScript(code)
  wc.setBackgroundThrottling(false)
  try {
    host.window.show()
    await until(async () => js('Boolean(document.querySelector(".tab.selected"))'), 'chrome rendered')
    await browser.request(host, { action: 'preferences', value: { mode: 'auto', acrylic: true } })
    const modes = () => buildBrowserMenu(browser, host).items.find((item) => item.label === '外观')!.submenu!
    assert.equal(modes().items.find((item) => item.label === '跟随系统')!.checked, true)
    assert.equal(await js('Boolean(document.querySelector("[aria-label=切换明暗外观]"))'), false)
    nativeTheme.themeSource = 'dark'
    await until(() => browser.snapshot(host).dark, 'automatic dark mode follows native theme updates')
    nativeTheme.themeSource = 'light'
    await until(() => !browser.snapshot(host).dark, 'automatic light mode follows native theme updates')
    modes()
      .items.find((item) => item.label === '深色')!
      .click()
    await until(() => browser.snapshot(host).dark, 'native menu changes shared preference')
    assert.equal(browser.snapshot(host).dark, true)
    assert.equal(modes().items.find((item) => item.label === '深色')!.checked, true)
    // A fixed app choice must survive a subsequent system theme notification.
    nativeTheme.themeSource = 'dark'
    nativeTheme.themeSource = 'light'
    assert.equal(browser.snapshot(host).dark, true)
    modes()
      .items.find((item) => item.label === '外观设置…')!
      .click()
    await until(async () => js('Boolean(document.querySelector(".mode-grid"))'), 'appearance settings entry')
    await js('document.querySelector(".mode-grid [data-mode=light]").click()')
    await until(() => !browser.snapshot(host).dark, 'settings and menu share mode')
    assert.equal(modes().items.find((item) => item.label === '浅色')!.checked, true)
    // The scroll container reaches the viewport edge; only the reading column is capped.
    for (const width of [1600, 700]) {
      host.window.setSize(width, 820)
      await until(
        async () =>
          js(`Math.abs(document.querySelector('.settings-content').getBoundingClientRect().right-
        document.querySelector('.viewport').getBoundingClientRect().right)<1`),
        'settings scrollbar reaches right edge',
      )
      const dimensions = await js(`(()=>{const e=document.querySelector('.settings-content');
        return {width:e.clientWidth,scrollWidth:e.scrollWidth,column:document.querySelector('.settings-section').getBoundingClientRect().width}})()`)
      assert.ok(
        dimensions.column <= 788.5 && dimensions.scrollWidth <= dimensions.width,
        'bounded reading width with no horizontal scrollbar: ' + JSON.stringify(dimensions),
      )
    }
    host.window.setSize(1240, 820)
    const scroll =
      await js(`(()=>{const e=document.querySelector('.settings-content'),nav=document.querySelector('.settings-nav');
      e.scrollTop=150;return {content:e.scrollTop,nav:nav.scrollTop}})()`)
    assert.ok(scroll.content > 0 && scroll.nav === 0, 'settings sidebar stays fixed while content scrolls')
    await browser.request(host, { action: 'preferences', value: { acrylic: false } })
    const depthSlider = await js(
      `(()=>{const e=document.getElementById('theme-depth');return {min:e.min,max:e.max,disabled:e.disabled}})()`,
    )
    assert.deepEqual(depthSlider, { min: '0', max: '100', disabled: false })
    for (const mode of ['light', 'dark'] as const) {
      await browser.request(host, { action: 'preferences', value: { mode } })
      const colors: string[] = []
      for (const themeDepth of [themeDepthLimits.min, themeDepthLimits.max]) {
        await js(
          `(()=>{const e=document.getElementById('theme-depth');e.value=${themeDepth};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
        )
        await until(
          () =>
            browser.snapshot(host).palette.shell ===
            palette({ ...browser.store.data.preferences, themeDepth }, false).colors.shell,
          'theme depth slider updates actual palette',
        )
        assert.equal(browser.store.data.preferences.themeDepth, themeDepth)
        colors.push(browser.snapshot(host).palette.shell)
        assert.equal(browser.snapshot(host).material, 'solid')
        for (const other of browser.hosts.values())
          assert.equal(
            browser.snapshot(other).palette.shell,
            colors.at(-1),
            'depth updates every browser window',
          )
      }
      assert.notEqual(colors[0], colors[1])
    }
    browser.store.flush()
    assert.equal(new BrowserStore(path.dirname(browser.store.file)).data.preferences.themeDepth, 100)
    await js('document.querySelector(".theme-depth-setting .text-action").click()')
    await until(
      () => browser.store.data.preferences.themeDepth === themeDepthLimits.default,
      'restore original theme depth',
    )
    await browser.request(host, { action: 'preferences', value: { mode: 'light', acrylic: true } })
    const slider = await js(
      `(()=>{const e=document.getElementById('window-transparency');return {min:e.min,max:e.max,disabled:e.disabled}})()`,
    )
    assert.equal(slider.min, String(transparencyLimits.min))
    assert.equal(slider.max, String(transparencyLimits.max))
    assert.equal(slider.disabled, browser.snapshot(host).material !== 'acrylic')
    const tints: string[] = []
    for (const transparency of [transparencyLimits.min, transparencyLimits.max]) {
      if (!slider.disabled)
        await js(
          `(()=>{const e=document.getElementById('window-transparency');e.value=${transparency};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
        )
      else await browser.request(host, { action: 'preferences', value: { transparency } })
      await until(
        () => browser.store.data.preferences.transparency === transparency,
        'bounded transparency slider updates the shared preference',
      )
      tints.push(browser.snapshot(host).palette.chrome)
    }
    if (!slider.disabled) assert.notEqual(tints[0], tints[1], 'native tint changes across the allowed range')
    await assert.rejects(
      browser.request(host, { action: 'preferences', value: { transparency: 76 } }),
      /15%–75%/,
    )
    assert.equal(browser.store.data.preferences.transparency, transparencyLimits.max)
    browser.store.flush()
    assert.equal(
      new BrowserStore(path.dirname(browser.store.file)).data.preferences.transparency,
      transparencyLimits.max,
    )
    await browser.request(host, {
      action: 'preferences',
      value: { transparency: transparencyLimits.default },
    })
    await js(`document.querySelector('.transparency-setting').scrollIntoView({block:'center'})`)
    await until(
      async () =>
        js(
          `(()=>{const r=document.querySelector('.transparency-setting').getBoundingClientRect(),v=document.querySelector('.settings-content').getBoundingClientRect();return r.top>=v.top&&r.bottom<=v.bottom})()`,
        ),
      'transparency controls are visible for capture',
    )
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await new Promise((resolve) => setTimeout(resolve, 100))
    fs.writeFileSync(
      path.join(path.dirname(report), 'appearance-transparency.png'),
      (await wc.capturePage()).toPNG(),
    )
    await js('document.querySelector(".settings-content").scrollTop=0')
    await until(
      async () => js('!document.querySelector(".tab-motion-enter-active,.tab-motion-leave-active")'),
      'titlebar icons settle after settings opens',
    )
    const centers = await js(
      `(()=>{const center=s=>{const r=document.querySelector(s).getBoundingClientRect();return r.y+r.height/2};return [center('.tab-overview-toggle svg'),center('.new-tab svg'),center('.tab.selected > svg')]})()`,
    )
    assert.ok(
      centers.every((value: number) => Math.abs(value - centers[2]) < 0.5),
      'titlebar icon centers align: ' + JSON.stringify(centers),
    )
    const plus = await js(
      `(()=>{const button=document.querySelector('.new-tab'),r=button.getBoundingClientRect(),bar=document.querySelector('.titlebar').getBoundingClientRect(),last=document.querySelector('.tabs .tab:last-child').getBoundingClientRect(),separator=getComputedStyle(button,'::before');return {width:r.width,height:r.height,gap:bar.bottom-r.bottom,radius:getComputedStyle(button).borderRadius,tabGap:r.left-last.right,separatorWidth:separator.width,separatorHeight:separator.height}})()`,
    )
    assert.equal(plus.width, plus.height, 'new-tab button keeps its compact square footprint')
    assert.equal(plus.radius, '8px')
    assert.ok(
      plus.tabGap >= 8 && plus.tabGap <= 12,
      'new-tab button remains close to the final tab without overlap',
    )
    assert.equal(plus.separatorWidth, '2px')
    assert.equal(plus.separatorHeight, '16px')
    assert.ok(plus.gap >= 1.9, 'new-tab hover boundary leaves room above the toolbar')
    if (process.platform === 'win32') {
      const anchor = await js(
        `(()=>{const r=document.querySelector('[aria-label="设置及更多"]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`,
      )
      const menu = openBrowserMenu(browser, host, undefined, anchor)
      const diagnostics = () =>
        (
          menu as unknown as {
            _getPopupState: () => { contentBounds: { x: number; y: number; width: number } }[]
          }
        )._getPopupState()[0]
      try {
        await until(() => !!diagnostics()?.contentBounds, 'native menu positioned')
        const content = diagnostics().contentBounds,
          window = host.window.getContentBounds()
        assert.ok(
          Math.abs(content.x + content.width - (window.x + anchor.x + anchor.width)) < 2,
          'main menu right-aligns with its toolbar button',
        )
        assert.ok(
          Math.abs(content.y - (window.y + anchor.y + anchor.height + 4)) < 2,
          'main menu opens below its toolbar button',
        )
      } finally {
        menu.closePopup(host.window)
      }
    }
    const gap = await js(`(()=>{document.querySelector('.tabs').scrollLeft=0;
      return document.querySelector('.tab .tab-background').getBoundingClientRect().left -
        document.querySelector('.tab-overview-toggle').getBoundingClientRect().right})()`)
    assert.ok(Math.abs(gap) < 0.5, 'first painted tab touches overview button')
    await browser.request(host, { action: 'tab-overview', value: true })
    await until(async () => js('Boolean(document.querySelector(".tab-overview"))'), 'overview active shape')
    const shape = await js(
      `(()=>{const e=document.querySelector('.tab-overview-toggle'),s=getComputedStyle(e),b=getComputedStyle(e,'::before'),a=getComputedStyle(e,'::after');return {radius:s.borderTopLeftRadius,bottom:s.borderBottomLeftRadius,left:b.left,right:a.right,before:b.backgroundImage,after:a.backgroundImage,other:document.querySelectorAll('.tab.selected').length}})()`,
    )
    assert.equal(shape.radius, '9px')
    assert.equal(shape.bottom, '0px')
    assert.equal(shape.left, '-10px')
    assert.equal(shape.right, '-10px')
    assert.ok(shape.before.includes('radial-gradient') && shape.after.includes('radial-gradient'))
    assert.equal(shape.other, 0, 'only overview is visually selected')
    await browser.request(host, { action: 'tab-overview', value: false })
    await smokeMaterial(browser, host)
    await browser.request(host, { action: 'preferences', value: { acrylic: false } })
    assert.equal(browser.snapshot(host).material, 'solid')
    await until(
      async () => js('document.getElementById("window-transparency").disabled'),
      'solid material disables transparency adjustment',
    )
    assert.equal(browser.snapshot(host).palette['chrome-content'].length, 7)
    await browser.request(host, { action: 'preferences', value: { acrylic: true } })
    const colors = browser.snapshot(host).palette
    if (browser.snapshot(host).material === 'acrylic') {
      assert.equal(colors['chrome-content'].length, 9)
      assert.equal(colors['chrome-field'].length, 9)
      const layers = await js(
        `(()=>{const color=s=>getComputedStyle(document.querySelector(s)).backgroundColor;return {shell:color('.browser-shell'),header:color('.toolbar'),bookmarks:color('.bookmarks-bar'),frame:color('.content-frame'),tab:color('.tab.selected .tab-background'),field:color('.address-bar'),view:color('.viewport'),chrome:color('.chrome')}})()`,
      )
      assert.equal(layers.header, layers.bookmarks)
      assert.equal(layers.header, layers.frame)
      assert.equal(layers.header, layers.tab)
      assert.ok(layers.header.startsWith('rgba(') && layers.field.startsWith('rgba('))
      assert.ok(layers.view.startsWith('rgb('), 'page surface stays opaque')
      assert.equal(layers.chrome, 'rgba(0, 0, 0, 0)', 'chrome does not paint the native tint twice')
    }
    for (const mode of ['light', 'dark'] as const) {
      await browser.request(host, { action: 'preferences', value: { mode } })
      await until(
        async () =>
          js(`document.querySelector('.browser-shell').classList.contains('dark')===${mode === 'dark'}`),
        'theme painted',
      )
      fs.writeFileSync(
        path.join(path.dirname(report), `appearance-${mode}.png`),
        (await wc.capturePage()).toPNG(),
      )
    }
    // Observe actual composited transition frames, then test reduced-motion in this isolated shell.
    wc.debugger.attach('1.3')
    const motion = async (value: string) =>
      wc.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value }],
      })
    await motion('no-preference')
    await js(
      `window.chromeFrames=[];window.observeChromeFrames=true;(()=>{const sample=()=>{if(!window.observeChromeFrames)return;for(const e of document.querySelectorAll('.tab-motion-enter-active,.tab-motion-leave-active')){const s=getComputedStyle(e),content=getComputedStyle(e.querySelector('.tab-icon,.spinner')),base=e.querySelector('.tab-background').getBoundingClientRect(),strip=document.querySelector('.tabs').getBoundingClientRect();window.chromeFrames.push({leave:e.classList.contains('tab-motion-leave-active'),y:parseFloat(content.translate.split(' ')[1])||0,baseGap:Math.abs(base.bottom-strip.bottom),overflow:s.overflow,opacity:Number(s.opacity),width:e.getBoundingClientRect().width,inert:e.inert})}requestAnimationFrame(sample)};requestAnimationFrame(sample)})()`,
    )
    const added = browser.newTab(host)
    await until(
      async () =>
        js(
          `Boolean(document.querySelector('[data-tab-id="${added.state.id}"]:not(.tab-motion-enter-active)'))`,
        ),
      'tab enters and settles',
    )
    const enter = await js('window.chromeFrames.filter(frame=>!frame.leave)')
    assert.ok(
      enter.some((frame: { y: number; opacity: number }) => frame.y > 1 && frame.opacity < 0.95),
      'new tab contents move up from below',
    )
    assert.ok(
      enter.length > 1 &&
        enter.every(
          (frame: { baseGap: number; overflow: string }) =>
            frame.baseGap < 0.6 && frame.overflow === 'visible',
        ),
      'entering tab keeps its reverse corners unclipped and attached to the toolbar',
    )
    await browser.closeTab(host, added)
    await until(
      async () => js(`!document.querySelector('[data-tab-id="${added.state.id}"]')`),
      'closed tab leaves DOM',
    )
    const leave = await js('window.chromeFrames.filter(frame=>frame.leave)')
    assert.ok(
      leave.some((frame: { y: number; opacity: number }) => frame.y > 1 && frame.opacity < 0.95),
      'closed tab contents disappear downward',
    )
    assert.ok(
      leave.length > 1 &&
        leave.every(
          (frame: { baseGap: number; overflow: string }) =>
            frame.baseGap < 0.6 && frame.overflow === 'visible',
        ),
      'departing tab keeps its background on the toolbar baseline',
    )
    assert.ok(
      leave.every((frame: { inert: boolean }) => frame.inert),
      'departing tabs cannot receive input',
    )
    assert.ok(leave.at(-1).width < leave[0].width, 'remaining tabs gain space during close')
    host.window.setSize(700, 620)
    const batch = Array.from({ length: 9 }, () => browser.newTab(host, 'newtab', '', false))
    await until(
      async () =>
        js(
          `document.querySelectorAll('.tab').length===${host.tabs.length}&&!document.querySelector('.tab-motion-enter-active')&&!document.querySelector('.tabs.comfortable')`,
        ),
      'compressed tabs settle before close',
    )
    await browser.request(host, { action: 'pin', id: batch[1].state.id })
    await until(
      async () => js(`Boolean(document.querySelector('[data-tab-id="${batch[1].state.id}"].pinned'))`),
      'pin reorders in the strip',
    )
    for (const target of [batch[1], batch[0]]) {
      await js('window.chromeFrames=[]')
      await browser.closeTab(host, target)
      await until(
        async () => js(`!document.querySelector('[data-tab-id="${target.state.id}"]')`),
        'compressed/pinned tab departs',
      )
      const frames = await js('window.chromeFrames.filter(frame=>frame.leave)')
      assert.ok(
        frames.length > 1 && frames.at(-1).width < 8,
        'dense and pinned tabs collapse padding and minimum width before removal',
      )
    }
    await motion('reduce')
    assert.equal(await js('getComputedStyle(document.querySelector(".tab")).transitionDuration'), '0s')
    const reduced = browser.newTab(host)
    await browser.closeTab(host, reduced)
    await until(
      async () => js('!document.querySelector(".tab-motion-enter-active,.tab-motion-leave-active")'),
      'reduced motion settles',
    )
    await js('window.observeChromeFrames=false')
  } finally {
    if (wc.debugger.isAttached()) wc.debugger.detach()
    nativeTheme.themeSource = themeSource
    await browser.request(host, { action: 'preferences', value: previous })
    await browser.closeWindow(host)
  }
}
