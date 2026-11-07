import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { nativeImage } from 'electron'
import { Browser, type Host } from './browser'
import { BrowserStore } from './storage'
import { FaviconCache, faviconMaxAge } from '../shared/favicon'

export async function smokeFavicons(browser: Browser) {
  let color = 0,
    requests = 0
  const bytes = () => {
    const bitmap = Buffer.alloc(16 * 16 * 4)
    for (let i = 0; i < bitmap.length; i += 4) {
      bitmap[i] = color ? 230 : 20
      bitmap[i + 1] = 80
      bitmap[i + 2] = color ? 20 : 230
      bitmap[i + 3] = 255
    }
    return nativeImage.createFromBitmap(bitmap, { width: 16, height: 16 }).toPNG()
  }
  const server = http.createServer((request, response) => {
    if (request.url === '/vector.svg') {
      response.writeHead(200, { 'content-type': 'image/svg+xml' })
      response.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="green"/></svg>',
      )
    } else if (request.url === '/packed.ico') {
      const png = bytes(),
        header = Buffer.alloc(22)
      header.writeUInt16LE(1, 2)
      header.writeUInt16LE(1, 4)
      header[6] = header[7] = 16
      header.writeUInt16LE(1, 10)
      header.writeUInt16LE(32, 12)
      header.writeUInt32LE(png.length, 14)
      header.writeUInt32LE(22, 18)
      response.writeHead(200, { 'content-type': 'image/x-icon' })
      response.end(Buffer.concat([header, png]))
    } else if (request.url?.endsWith('.png')) {
      requests++
      const reply = () => {
        response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
        response.end(bytes())
      }
      if (request.url === '/slow.png') setTimeout(reply, 300)
      else reply()
    } else if (request.url === '/missing.ico') {
      response.writeHead(404)
      response.end()
    } else {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(
        '<!doctype html><title>Favicon fixture</title><link rel="icon" href="/auto.png"><h1>Favicon fixture</h1>',
      )
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const host = browser.createWindow({ empty: true })
  let privateHost: Host | undefined
  const wait = async (check: () => boolean | Promise<boolean>) => {
    const end = Date.now() + 8000
    while (Date.now() < end) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    throw new Error('Favicon fixture timed out')
  }
  try {
    host.window.webContents.setBackgroundThrottling(false)
    const tab = browser.newTab(host, 'web', origin + '/auto')
    await wait(() => !!tab.state.favicon && !tab.state.loading)
    await wait(() =>
      host.window.webContents.executeJavaScript(
        'Boolean(document.querySelector(".tab-icon img")?.naturalWidth)',
      ),
    )
    const wc = tab.view!.webContents,
      service = browser.favicons
    assert.ok(
      await service.update(wc, origin + '/svg', [origin + '/vector.svg'], true, () => true),
      'Chromium decodes SVG icons in an isolated renderer',
    )
    assert.ok(
      await service.update(wc, origin + '/ico', [origin + '/packed.ico'], true, () => true),
      'ICO candidates become safe PNG thumbnails',
    )
    browser.store.toggleBookmark(origin + '/auto', 'Favicon fixture')
    assert.equal(
      browser.snapshot(host).bookmarks.find((b) => b.url === origin + '/auto')?.favicon,
      tab.state.favicon,
    )
    browser.store.flush()
    const reopened = new BrowserStore(path.dirname(browser.store.file))
    assert.equal(new FaviconCache(reopened.data.favicons).page(origin + '/auto')?.data, tab.state.favicon)

    const cached = service.normal.page(origin + '/auto')!
    const count = requests
    assert.equal(
      await service.update(wc, origin + '/fresh', [origin + '/auto.png'], true, () => true),
      cached.data,
    )
    assert.equal(requests, count, 'fresh icon is reused without downloading')
    cached.updatedAt = Date.now() - faviconMaxAge - 1
    color = 1
    const updated = await service.update(wc, origin + '/auto', [origin + '/auto.png'], true, () => true)
    assert.notEqual(updated, tab.state.favicon, 'expired icon updates while sharing the same image URL')
    const forcedCount = requests
    await service.update(wc, origin + '/auto', [origin + '/auto.png'], true, () => true, true)
    assert.equal(requests, forcedCount + 1, 'hard refresh bypasses fresh icon data')

    const sharedCount = requests
    await Promise.all(
      ['/shared-a', '/shared-b'].map((page) =>
        service.update(wc, origin + page, [origin + '/shared.png'], true, () => true),
      ),
    )
    assert.equal(requests, sharedCount + 1, 'concurrent tabs share one image request')
    assert.equal(
      service.normal.page(origin + '/shared-a')?.iconUrl,
      service.normal.page(origin + '/shared-b')?.iconUrl,
    )
    let valid = true
    const slow = service.update(wc, origin + '/gone', [origin + '/slow.png'], true, () => valid)
    valid = false
    await slow
    assert.equal(
      service.normal.page(origin + '/gone'),
      undefined,
      'late replies cannot recreate navigated or closed page mappings',
    )
    assert.equal(
      await service.update(wc, origin + '/auto', [origin + '/missing.ico'], true, () => true),
      updated,
      'failed updates preserve the last valid bitmap',
    )
    await service.update(wc, origin + '/fresh', [], true, () => true)
    assert.equal(
      service.normal.page(origin + '/fresh'),
      undefined,
      'removing all icons removes the page mapping',
    )
    assert.ok(service.normal.page(origin + '/auto'), 'other pages sharing that bitmap remain valid')

    privateHost = browser.createWindow({ private: true, empty: true })
    const privateTab = browser.newTab(privateHost, 'web', origin + '/private')
    await wait(() => !!privateTab.state.favicon)
    assert.equal(service.normal.page(origin + '/private'), undefined)
    assert.ok(service.cache(privateHost.session, false).page(origin + '/private'))
    const beforePrivate = JSON.stringify(browser.store.data.favicons)
    await service.update(
      privateTab.view!.webContents,
      origin + '/private-only',
      [origin + '/private.png'],
      false,
      () => true,
    )
    assert.equal(
      JSON.stringify(browser.store.data.favicons),
      beforePrivate,
      'private favicon updates never persist',
    )
    service.forgetHistory(new Set([origin + '/auto', origin + '/shared-a']))
    service.forgetHistory(new Set([origin + '/shared-b']), new Set([origin + '/shared-b']))
    assert.ok(service.normal.page(origin + '/shared-b'), 'retaining older history preserves the page icon')
    assert.ok(service.normal.page(origin + '/auto'), 'history cleanup preserves bookmarked favicons')
    assert.equal(service.normal.page(origin + '/shared-a'), undefined)
    browser.store.data.bookmarks = browser.store.data.bookmarks.filter((b) => b.url !== origin + '/auto')
  } finally {
    if (privateHost && !privateHost.window.isDestroyed()) await browser.closeWindow(privateHost)
    if (!host.window.isDestroyed()) await browser.closeWindow(host)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
