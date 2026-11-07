import { app, screen } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Browser } from './browser'
import { BrowserStore } from './storage'
import { visibleWindowBounds, type WindowSession } from '../shared/window-session'

async function until(check: () => boolean | Promise<boolean>, label: string) {
  const start = Date.now()
  while (Date.now() - start < 12000) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 75))
  }
  throw new Error(`Timed out: ${label}`)
}
export async function smokeSession(browser: Browser, phase: string) {
  const origin = process.env.ECHROMIUM_SMOKE_ORIGIN!,
    directory = path.dirname(process.env.ECHROMIUM_SMOKE_REPORT!)
  const expectedFile = path.join(directory, 'session-expected.json'),
    reportFile = path.join(directory, 'session-restore.json')
  let error: unknown
  try {
    if (phase === 'write') {
      const host = [...browser.hosts.values()][0],
        first = host.tabs[0]
      await browser.request(host, { action: 'navigate', id: first.state.id, text: origin + '/restore-one' })
      await until(() => !first.state.loading && first.state.title === 'Fixture one', 'first session page')
      await browser.request(host, { action: 'pin', id: first.state.id })
      await browser.request(host, { action: 'mute', id: first.state.id })
      await browser.request(host, { action: 'zoom', id: first.state.id, value: 1.4 })
      const books = browser.newTab(host, 'bookmarks')
      browser.newTab(host, 'web', origin + '/restore-lazy', false)
      browser.activate(host, books.state.id)
      const other = browser.createWindow(),
        second = other.tabs[0]
      await browser.request(other, { action: 'navigate', id: second.state.id, text: origin + '/restore-two' })
      await until(() => !second.state.loading && second.state.title === 'Fixture one', 'second session page')
      await browser.request(other, { action: 'mute', id: second.state.id })
      await browser.request(other, { action: 'zoom', id: second.state.id, value: 1.2 })
      browser.newTab(other, 'settings', '', false)
      const area = screen.getPrimaryDisplay().workArea
      host.window.setBounds(
        visibleWindowBounds({ x: area.x + 30, y: area.y + 30, width: 1000, height: 700 }, [area]),
      )
      other.window.setBounds(
        visibleWindowBounds({ x: area.x + 100, y: area.y + 70, width: 1100, height: 740 }, [area]),
      )
      other.window.maximize()
      await until(() => other.window.isMaximized(), 'maximized session window')
      const privateHost = browser.createWindow({ private: true })
      browser.newTab(privateHost, 'web', origin + '/private-restore-secret')
      await privateHost.session.cookies.set({
        url: origin,
        name: 'private-restore-proof',
        value: 'private-only',
      })
      browser.saveSession()
      browser.store.flush()
      const disk = new BrowserStore(path.dirname(browser.store.file))
      assert.equal(disk.data.session?.windows.length, 2)
      assert.ok(!JSON.stringify(disk.data.session).includes('private-restore-secret'))
      assert.ok(!disk.data.tabs.some((url) => url.includes('private-restore-secret')))
      fs.writeFileSync(expectedFile, JSON.stringify(disk.data.session))
      // Exit without closing windows: the next process exercises durable crash recovery.
    } else if (phase === 'read') {
      const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8')) as WindowSession
      const hosts = [...browser.hosts.values()]
      assert.equal(hosts.length, 2)
      for (let index = 0; index < hosts.length; index++) {
        const host = hosts[index],
          saved = expected.windows[index]
        assert.equal(host.private, false)
        assert.equal(host.tabs.length, saved.tabs.length)
        assert.equal(
          host.tabs.findIndex((tab) => tab.state.id === host.activeId),
          saved.activeIndex,
        )
        assert.equal(host.window.isMaximized(), saved.maximized)
        for (let i = 0; i < host.tabs.length; i++) {
          const state = host.tabs[i].state,
            record = saved.tabs[i]
          assert.deepEqual(
            { kind: state.kind, url: state.url, pinned: state.pinned, muted: state.muted, zoom: state.zoom },
            {
              kind: record.kind,
              url: record.url,
              pinned: record.pinned,
              muted: record.muted,
              zoom: record.zoom,
            },
          )
          if (state.id !== host.activeId) assert.equal(host.tabs[i].view, undefined)
        }
        const fitted = visibleWindowBounds(
            saved.bounds,
            screen.getAllDisplays().map((display) => display.workArea),
          ),
          actual = host.window.getNormalBounds()
        for (const key of ['x', 'y', 'width', 'height'] as const)
          assert.ok(
            Math.abs(actual[key] - fitted[key]) <= 2,
            `restored ${index} ${key}: ${actual[key]} vs ${fitted[key]}`,
          )
      }
      const first = hosts[0],
        second = hosts[1],
        live = browser.active(second)!
      assert.equal(browser.active(first)?.state.kind, 'bookmarks')
      assert.equal(first.tabs.filter((tab) => tab.view).length, 0)
      await until(
        () => !live.state.loading && live.state.url === origin + '/restore-two',
        'active restored page loads',
      )
      assert.equal(live.view!.webContents.isAudioMuted(), true)
      assert.ok(Math.abs(live.view!.webContents.getZoomFactor() - 1.2) < 0.001)
      assert.equal((await first.session.cookies.get({ name: 'private-restore-proof' })).length, 0)
      const pinned = first.tabs.find((tab) => tab.state.pinned)!
      browser.activate(first, pinned.state.id)
      await until(
        () => !pinned.state.loading && pinned.state.title === 'Fixture one',
        'lazy pinned page activation',
      )
      assert.equal(pinned.view!.webContents.isAudioMuted(), true)
      assert.ok(Math.abs(pinned.view!.webContents.getZoomFactor() - 1.4) < 0.001)
      assert.equal(first.tabs.find((tab) => tab.state.url.endsWith('/restore-lazy'))!.view, undefined)
      assert.equal(await browser.closeWindow(second), true)
      assert.equal(browser.store.data.session?.windows.length, 1)
      assert.ok(!JSON.stringify(browser.store.data.session).includes('/restore-two'))
      // A private window remaining open must not overwrite the last regular window with an empty snapshot.
      browser.createWindow({ private: true })
      assert.equal(await browser.closeWindow(first), true)
      browser.store.flush()
      const disk = new BrowserStore(path.dirname(browser.store.file))
      assert.equal(disk.data.session?.windows.length, 1)
      assert.equal(disk.data.session?.windows[0].tabs.length, 3)
      assert.equal(disk.data.session?.windows[0].tabs[0].pinned, true)
      assert.equal(
        disk.data.session?.windows[0].tabs[disk.data.session.windows[0].activeIndex].url,
        origin + '/restore-one',
      )
    } else if (phase === 'closed') {
      const hosts = [...browser.hosts.values()]
      assert.equal(hosts.length, 1)
      assert.equal(hosts[0].tabs.length, 3)
      const active = browser.active(hosts[0])!
      assert.equal(active.state.url, origin + '/restore-one')
      assert.equal(active.state.pinned, true)
      assert.equal(active.state.muted, true)
      assert.ok(!hosts[0].tabs.some((tab) => tab.state.url.includes('private-restore-secret')))
      assert.equal(hosts[0].tabs.find((tab) => tab.state.url.endsWith('/restore-lazy'))!.view, undefined)
      await until(
        () => !active.state.loading && active.state.title === 'Fixture one',
        'last closed window restores after another restart',
      )
      browser.store.data.preferences.restore = false
    } else if (phase === 'disabled') {
      const hosts = [...browser.hosts.values()]
      assert.equal(hosts.length, 1)
      assert.equal(hosts[0].tabs.length, 1)
      assert.equal(browser.active(hosts[0])?.state.kind, 'newtab')
      assert.equal(hosts[0].tabs[0].view, undefined)
    } else throw new Error('Unknown session smoke phase')
  } catch (cause) {
    error = cause
    console.error('Session smoke', phase, cause)
  }
  const report =
    phase === 'write'
      ? { results: [] as { phase: string; passed: boolean; error?: string }[] }
      : JSON.parse(fs.readFileSync(reportFile, 'utf8'))
  report.results.push({ phase, passed: !error, ...(error ? { error: String(error) } : {}) })
  fs.writeFileSync(
    reportFile,
    JSON.stringify(
      {
        ...report,
        at: new Date().toISOString(),
        runtime: process.versions,
        executable: process.execPath,
        sha256: createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'),
      },
      null,
      2,
    ),
  )
  browser.flushForExit()
  app.exit(error ? 1 : 0)
}
