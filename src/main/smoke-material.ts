import assert from 'node:assert/strict'
import type { Browser, Host } from './browser'

export async function smokeMaterial(browser: Browser, host: Host) {
  const win = host.window,
    wc = win.webContents
  const original = win.setBackgroundMaterial
  const previous = { ...browser.store.data.preferences }
  const samples: Promise<string>[] = [],
    calls: string[] = []
  const frames: number[][] = []
  try {
    await browser.request(host, { action: 'preferences', value: { mode: 'dark', acrylic: true } })
    if (browser.snapshot(host).material !== 'acrylic') return
    // Inspect the real native setter, without replacing its behavior.
    win.setBackgroundMaterial = function (material) {
      calls.push(material)
      samples.push(
        wc.executeJavaScript(
          `getComputedStyle(document.querySelector('.browser-shell')).getPropertyValue('--chrome').trim()`,
        ),
      )
      return original.call(this, material)
    }
    wc.beginFrameSubscription((image) => {
      const size = image.getSize()
      if (size.width < 450 || size.height < 30) return
      const bitmap = image.toBitmap(),
        offset = (20 * size.width + 440) * 4
      frames.push([...bitmap.subarray(offset, offset + 4)])
    })
    await browser.request(host, { action: 'preferences', value: { transparency: 65 } })
    await browser.request(host, { action: 'preferences', value: { themeDepth: 65 } })
    await browser.request(host, { action: 'preferences', value: { bookmarksBar: previous.bookmarksBar } })
    assert.equal(calls.length, 0, 'tint and unrelated preferences do not reset native material')
    for (const acrylic of [false, true, false, true]) {
      await browser.request(host, { action: 'preferences', value: { acrylic } })
      assert.equal(browser.snapshot(host).material, acrylic ? 'acrylic' : 'solid')
    }
    assert.deepEqual(calls, ['none', 'acrylic', 'none', 'acrylic'])
    const guards = await Promise.all(samples)
    assert.ok(
      guards.every((color) => /^#[\da-f]{6}$/i.test(color)),
      'opaque shell is painted across each native switch',
    )
    assert.ok(frames.length >= 4, 'observe actual compositor frames through the switches')
    assert.ok(
      frames.every((pixel) => !(pixel[3] > 250 && pixel.slice(0, 3).every((c) => c > 245))),
      'dark titlebar never exposes an opaque white frame',
    )
    await Promise.all(
      [false, true, false, true].map((acrylic) =>
        browser.request(host, { action: 'preferences', value: { acrylic } }),
      ),
    )
    assert.equal(browser.snapshot(host).material, 'acrylic', 'rapid toggles converge on the latest choice')
    const color = await wc.executeJavaScript(
      `getComputedStyle(document.querySelector('.browser-shell')).getPropertyValue('--chrome').trim()`,
    )
    assert.equal(
      color.toUpperCase(),
      browser.snapshot(host).palette.chrome.toUpperCase(),
      'temporary opaque paint is removed',
    )
  } finally {
    wc.endFrameSubscription()
    win.setBackgroundMaterial = original
    await browser.request(host, { action: 'preferences', value: previous })
  }
}
