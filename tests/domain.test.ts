import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inputTarget, nextTab, safeBounds, webTarget } from '../src/shared/navigation'
import {
  chromePalette,
  defaults,
  palette,
  preferencesPatch,
  transparencyLimits,
  themeDepthLimits,
  themes,
} from '../src/shared/appearance'
import { BrowserStore } from '../src/main/storage'
import { restoredDownloads } from '../src/shared/download-records'
import { closeTargets } from '../src/shared/tab-operations'
import { canonicalOrigin, requestedCapabilities, siteRule } from '../src/shared/site-policy'
import { SitePermissions, type PermissionPrompt } from '../src/main/permissions'
import type { Session, WebContents } from 'electron'
import { addressChoices } from '../src/shared/suggestions'
import { bookmarkInput, exportBookmarks } from '../src/shared/bookmarks'
import type { TabState, Preferences } from '../src/shared/model'
import type { Host } from '../src/main/browser'
import { compatibleWindows } from '../src/main/tab-transfer'
import { folderPath, importBookmarkTree, restoredFolders, saveFolder } from '../src/shared/bookmark-folders'
import { cookieAppliesToHost } from '../src/shared/site-data'
import { PopupPolicy } from '../src/shared/popup-policy'
import { windowOpenTarget } from '../src/shared/window-open'
import { restoredSession, visibleWindowBounds } from '../src/shared/window-session'
import { dataOptions, dataInterval, withinInterval } from '../src/shared/browsing-data'
import { findPanelContent } from '../src/shared/find-panel'
import { overviewTabs, tabLocation } from '../src/shared/tab-overview'
test('web links become tabs while explicit dialog features and dispositions stay respected', () => {
  assert.equal(windowOpenTarget('default', ''), 'tab')
  assert.equal(windowOpenTarget('default', 'noopener,noreferrer'), 'tab')
  assert.equal(windowOpenTarget('default', 'popup=no'), 'tab')
  assert.equal(windowOpenTarget('default', 'popup'), 'popup')
  assert.equal(windowOpenTarget('default', 'width=600,height=400'), 'popup')
  assert.equal(windowOpenTarget('new-window', ''), 'popup')
  assert.equal(windowOpenTarget('background-tab', 'width=600'), 'background')
  assert.equal(windowOpenTarget('foreground-tab', 'popup'), 'tab')
})
test('tab overview matches multiple words across title and URL, retains order and filters pinned tabs', () => {
  const tab = (id: string, title: string, url: string, pinned = false) =>
    ({ id, title, url, pinned, kind: 'web' }) as TabState
  const rows = [
    tab('a', '设计笔记', 'https://design.test/reading', true),
    tab('b', '工作记录', 'https://work.test/design'),
    tab('c', '设置', '', false),
  ]
  rows[2].kind = 'settings'
  assert.deepEqual(
    overviewTabs(rows, '设计 reading').map((t) => t.id),
    ['a'],
  )
  assert.deepEqual(
    overviewTabs(rows, 'DESIGN').map((t) => t.id),
    ['a', 'b'],
  )
  assert.deepEqual(
    overviewTabs(rows, '', true).map((t) => t.id),
    ['a'],
  )
  assert.equal(overviewTabs(rows, '没有匹配').length, 0)
  assert.equal(tabLocation(rows[0]), 'design.test')
  assert.equal(tabLocation(rows[2]), '设置')
})
import { siteCandidates, cookieHostname, storageUsage, formatStorage } from '../src/shared/site-inventory'

test('site inventory keeps ports separate, deduplicates known origins and never invents cookie origins', () => {
  const rows = siteCandidates(
    [
      'https://site.test/a',
      'https://site.test/b',
      'https://site.test:8443/',
      'file:///secret',
      'https://user:pass@secret.test/',
    ],
    ['.site.test', 'cookie.test', 'bad.test/path'],
  )
  assert.equal(rows.length, 3)
  assert.equal(rows.filter((r) => r.origin).length, 2)
  assert.equal(rows.find((r) => r.hostname === 'cookie.test')?.origin, undefined)
  assert.equal(cookieHostname('::1'), '[::1]')
  assert.equal(cookieHostname('.EXAMPLE.test'), 'example.test')
  assert.equal(cookieHostname('user@evil.test'), undefined)
})

test('quota readings distinguish unavailable from zero and accept only numeric known storage classes', () => {
  assert.equal(storageUsage({ usage: -1 }), undefined)
  assert.equal(storageUsage({ usage: NaN }), undefined)
  assert.equal(storageUsage({ usage: '0' }), undefined)
  assert.deepEqual(storageUsage({ usage: 0, usageBreakdown: [] }), { bytes: 0, breakdown: [] })
  assert.deepEqual(
    storageUsage({
      usage: 42,
      usageBreakdown: [
        { storageType: 'indexeddb', usage: 42 },
        { storageType: 'secret', usage: 10 },
        { storageType: 'cache_storage', usage: -1 },
      ],
    }),
    { bytes: 42, breakdown: [{ type: 'indexeddb', bytes: 42 }] },
  )
  assert.equal(formatStorage(1024), '1 KB')
})

test('data range boundaries and validation prevent time-limited requests from clearing all storage', () => {
  const options = { range: 'hour', history: true, downloads: false, siteData: false, cache: false }
  assert.equal(dataOptions(options).range, 'hour')
  assert.throws(() => dataOptions({ ...options, range: '__proto__' }))
  assert.throws(() => dataOptions({ ...options, history: 'true' }))
  assert.throws(() => dataOptions({ ...options, siteData: true }), /全部时间/)
  assert.throws(() => dataOptions({ ...options, cache: true }), /全部时间/)
  assert.throws(() => dataOptions({ ...options, history: false }))
  const interval = dataInterval('hour', 8000000)
  assert.equal(withinInterval(interval.from, interval), true)
  assert.equal(withinInterval(interval.to, interval), true)
  assert.equal(withinInterval(interval.from - 1, interval), false)
  assert.equal(withinInterval(interval.to + 1, interval), false)
  assert.equal(withinInterval(NaN, interval), false)
})

test('find input gets a value only for an explicit opening, preserving native drafts and composition on refresh', () => {
  const state = {
    width: 380,
    query: '中文',
    matchCase: false,
    status: 'ready' as const,
    total: 3,
    ordinal: 2,
  }
  const input = (seed: boolean) => findPanelContent(state, seed).children![0].children![0]
  assert.equal(input(true).id, 'find-query')
  assert.equal(input(true).value, '中文')
  assert.equal(Object.hasOwn(input(false), 'value'), false)
})

test('popup creation shares burst limits across descendants and does not reset when windows close', () => {
  let time = 0
  const policy = new PopupPolicy(() => time)
  for (let i = 0; i < 3; i++) assert.equal(policy.request(1, 0, 'https://site.test/', true, 0, 0), true)
  assert.equal(policy.request(1, 0, 'https://site.test/', true, 0, 0), false)
  assert.equal(policy.status(1, 0).blocked, 1)
  policy.allow(1, 0, true)
  assert.equal(policy.request(1, 0, 'https://site.test/', true, 0, 0), true)
  assert.equal(policy.request(1, 0, 'https://site.test/', true, 0, 8), false)
  assert.equal(policy.request(1, 0, 'https://site.test/', false, 0, 0), false)
  assert.equal(policy.request(1, 0, 'javascript:alert(1)', true, 0, 0), false)
  assert.equal(policy.status(1, 1).allowed, false)
  assert.equal(policy.status(1, 1).blocked, 0)
  assert.equal(policy.request(2, 0, 'https://site.test/', true, 0, 0), true)
  time = 10001
  policy.allow(1, 1, false)
  assert.equal(policy.request(1, 1, 'https://site.test/', true, 3, 3), false)
  assert.equal(policy.request(1, 1, 'about:blank', true, 0, 0), true)
})

test('window snapshots validate content, retain active identity after pin ordering and bound restoration', () => {
  const tab = (url: string, pinned = false) => ({
    kind: 'web',
    title: 'Page',
    url,
    pinned,
    muted: true,
    zoom: 1.5,
  })
  const snapshot = restoredSession({
    version: 1,
    windows: [
      {
        bounds: { x: -900, y: 50, width: 900, height: 700 },
        maximized: true,
        activeIndex: 1,
        tabs: [tab('javascript:bad'), tab('https://active.test/'), tab('https://pinned.test/', true)],
      },
    ],
  })!
  assert.equal(snapshot.windows[0].tabs.length, 2)
  assert.equal(snapshot.windows[0].tabs[0].url, 'https://pinned.test/')
  assert.equal(snapshot.windows[0].tabs[snapshot.windows[0].activeIndex].url, 'https://active.test/')
  assert.equal(snapshot.windows[0].tabs[1].zoom, 1.5)
  assert.equal(snapshot.windows[0].maximized, true)
  assert.equal(restoredSession({ version: 100, windows: [] }), undefined)
  const huge = restoredSession({
    version: 1,
    windows: Array.from({ length: 20 }, () => ({
      tabs: Array.from({ length: 120 }, () => tab('https://safe.test/')),
    })),
  })!
  assert.equal(
    huge.windows.reduce((n, window) => n + window.tabs.length, 0),
    200,
  )
  assert.equal(huge.windows[0].tabs.length, 100)
})

test('window placement preserves an available negative display and recovers when it is unplugged', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 },
    secondary = { x: -1280, y: 0, width: 1280, height: 984 }
  const original = { x: -1200, y: 50, width: 1000, height: 700 }
  assert.deepEqual(visibleWindowBounds(original, [primary, secondary]), original)
  assert.deepEqual(visibleWindowBounds(original, [primary]), { x: 0, y: 50, width: 1000, height: 700 })
  const fitted = visibleWindowBounds({ x: 9000, y: 9000, width: 8192, height: 8192 }, [primary])
  assert.deepEqual(fitted, primary)
})

test('addresses distinguish local hosts and ports from custom protocols', () => {
  assert.equal(inputTarget('localhost:3000/a?q=x'), 'http://localhost:3000/a?q=x')
  assert.equal(inputTarget('[::1]:8080'), 'http://[::1]:8080/')
  assert.equal(inputTarget('example.com:8443/a'), 'https://example.com:8443/a')
  assert.equal(inputTarget('127.0.0.1:3000'), 'http://127.0.0.1:3000/')
  assert.equal(inputTarget('https://例子.测试'), 'https://xn--fsqu00a.xn--0zwm56d/')
  assert.equal(inputTarget('例子.测试'), 'https://xn--fsqu00a.xn--0zwm56d/')
})
test('search text is encoded without treating it as HTML or a URL', () => {
  assert.equal(
    inputTarget('你好 & Chromium', 'baidu'),
    'https://www.baidu.com/s?wd=' + encodeURIComponent('你好 & Chromium'),
  )
  assert.ok(inputTarget('<img src=x onerror=alert(1)>').startsWith('https://www.bing.com/search?q='))
})
test('web navigation rejects privileged protocols and URL credentials', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///C:/Windows/win.ini',
    'echromium:settings',
    'https://user:password@example.com',
    'https://a.test/\nhello',
  ]) {
    assert.throws(() => inputTarget(value), value)
    assert.equal(webTarget(value), false, value)
  }
  assert.equal(webTarget('about:blank'), false)
  assert.equal(inputTarget('about:blank'), 'about:blank')
})
test('closing chooses the next surviving neighbour even with multiple removals', () => {
  assert.equal(nextTab(['a', 'b', 'c', 'd'], 'b', ['a', 'd']), 'd')
  assert.equal(nextTab(['a', 'b', 'c'], 'c', ['a', 'b']), 'b')
  assert.equal(nextTab(['a'], 'a', []), undefined)
})
test('batch close preserves the anchor and pinned tabs on either side', () => {
  const tabs = [
    { id: 'p', pinned: true },
    { id: 'a', pinned: false },
    { id: 'b', pinned: false },
    { id: 'c', pinned: false },
  ]
  assert.deepEqual(closeTargets(tabs, 'b', 'others'), ['a', 'c'])
  assert.deepEqual(closeTargets(tabs, 'b', 'left'), ['a'])
  assert.deepEqual(closeTargets(tabs, 'b', 'right'), ['c'])
  assert.deepEqual(closeTargets(tabs, 'p', 'right'), ['a', 'b', 'c'])
  assert.throws(() => closeTargets(tabs, 'moved', 'others'))
})
test('window transfer requires compatible profiles, available capacity and no pending close', () => {
  const session = {},
    window = { isDestroyed: () => false }
  const source = {
    window,
    session,
    tabs: [],
    private: false,
    profile: 'default',
    closing: false,
    batchClosing: false,
  } as unknown as Host
  const target = { ...source } as Host
  assert.equal(compatibleWindows(source, target), true)
  assert.equal(compatibleWindows(source, source), false)
  assert.equal(compatibleWindows(source, { ...target, private: true }), false)
  assert.equal(compatibleWindows(source, { ...target, profile: 'other' }), false)
  assert.equal(compatibleWindows(source, { ...target, session: {} as Electron.Session }), false)
  assert.equal(compatibleWindows(source, { ...target, batchClosing: true }), false)
  assert.equal(
    compatibleWindows(source, { ...target, tabs: [{ closing: Promise.resolve(false) }] as Host['tabs'] }),
    false,
  )
  assert.equal(
    compatibleWindows(source, { ...target, tabs: Array.from({ length: 100 }, () => ({})) as Host['tabs'] }),
    false,
  )
})
test('download restart keeps metadata but never invents a resumable live task', () => {
  const row = {
    id: 'task',
    name: 'a.txt',
    path: 'D:/a.txt',
    url: 'https://example.com/a',
    received: 10,
    total: 100,
    at: 123,
    status: 'paused',
    active: true,
    canResume: true,
  }
  const [restored] = restoredDownloads([null, { ...row, id: 'bad', received: -10 }, row])
  assert.equal(restored.status, 'interrupted')
  assert.equal(restored.active, false)
  assert.equal(restored.canResume, false)
  assert.equal(restored.path, row.path)
  assert.equal(restoredDownloads([{ ...row, status: 'completed' }])[0].status, 'completed')
})
test('site permissions distinguish origins and granular camera/microphone access', () => {
  assert.equal(canonicalOrigin('https://EXAMPLE.com:443/path'), 'https://example.com')
  assert.notEqual(canonicalOrigin('http://example.com'), canonicalOrigin('https://example.com'))
  assert.equal(canonicalOrigin('file:///D:/a'), undefined)
  assert.throws(() => siteRule({ origin: 'https://a.test', capability: '__proto__', decision: 'allow' }))
  assert.deepEqual(requestedCapabilities('media', ['audio']), ['microphone'])
  assert.deepEqual(requestedCapabilities('media', ['video', 'audio']), ['camera', 'microphone'])
  assert.deepEqual(requestedCapabilities('media', ['unknown']), [])
  assert.deepEqual(requestedCapabilities('display-capture', ['video']), [])
})
test('local suggestions retain switch-to-tab actions and avoid duplicate secondary sources', () => {
  const data = {
    tabs: [{ id: 'other', kind: 'web', title: 'Example tab', url: 'https://example.com/' }] as TabState[],
    activeId: 'current',
    bookmarks: [
      { id: 'one', title: 'Example bookmark', url: 'https://example.com/' },
      { id: 'two', title: 'Example saved', url: 'https://saved.test/' },
    ],
    history: [
      { title: 'Example recent', url: 'https://saved.test/', at: 1 },
      { title: 'Example history', url: 'https://recent.test/', at: 2 },
    ],
    search: 'bing' as const,
  }
  const rows = addressChoices('Example', data)
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['input', 'tab', 'bookmark', 'history'],
  )
  assert.equal(rows[1].tabId, 'other')
  const exact = addressChoices('https://example.com/', data)
  assert.equal(exact[0].kind, 'input')
  assert.equal(exact[1].kind, 'tab')
  assert.equal(addressChoices('javascript:alert(1)', data).length, 0)
  assert.equal(addressChoices('hello v2.0 world', data)[0].title, '搜索「hello v2.0 world」')
  assert.equal(addressChoices('example.com', data)[0].title, '访问 example.com')
  const privateRows = addressChoices('', { ...data, history: [] })
  assert.ok(!privateRows.some((row) => row.kind === 'history'))
})
test('bookmark import canonicalizes URLs, rejects privileged entries and exports inert escaped HTML', () => {
  assert.equal(bookmarkInput({ title: '', url: 'https://EXAMPLE.com:443' }).url, 'https://example.com/')
  assert.throws(() => bookmarkInput({ title: 'a', url: 'javascript:alert(1)' }))
  const source = [{ id: 'original', title: 'Existing', url: 'https://example.com/' }]
  const merged = importBookmarkTree(
    source,
    [],
    [
      null,
      { title: 'duplicate', url: 'https://EXAMPLE.com:443/' },
      { title: '<img src=x onerror=alert(1)> & "name"', url: 'https://safe.test/?a=1&b=2' },
      { title: 'file', url: 'file:///D:/secret' },
    ],
    () => 'imported',
  )
  assert.equal(merged.added, 1)
  assert.equal(merged.skipped, 3)
  assert.equal(source.length, 1)
  const html = exportBookmarks(merged.bookmarks)
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;name&quot;'))
  assert.ok(html.includes('?a=1&amp;b=2'))
  assert.ok(!html.includes('<img'))
  assert.throws(() =>
    importBookmarkTree(
      source,
      [],
      Array.from({ length: 2001 }, (_, i) => ({ title: 'A', url: `https://example.test/${i}` })),
      () => 'id',
    ),
  )
  assert.equal(source.length, 1)
})
test('folder edits reject cycles and deep moves without mutating existing data', () => {
  const folders = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B', parentId: 'a' },
  ]
  assert.throws(() => saveFolder(folders, 'a', { title: 'A', parentId: 'b' }, () => 'new'))
  assert.equal(folders[0].parentId, undefined)
  const moved = saveFolder(folders, 'b', { title: 'Renamed', parentId: '' }, () => 'new')
  assert.equal(moved[1].parentId, undefined)
  assert.equal(folders[1].title, 'B')
  const repaired = restoredFolders([
    { id: 'a', title: 'A', parentId: 'b' },
    { id: 'b', title: 'B', parentId: 'a' },
    { id: 'orphan', title: 'C', parentId: 'missing' },
  ])
  for (const f of repaired) assert.doesNotThrow(() => folderPath(f.id, repaired))
  const chain = Array.from({ length: 12 }, (_, i) => ({
    id: String(i),
    title: String(i),
    parentId: i ? String(i - 1) : undefined,
  }))
  chain.push({ id: 'new-root', title: 'Root', parentId: undefined })
  assert.throws(() => saveFolder(chain, '0', { title: '0', parentId: 'new-root' }, () => 'unused'))
  assert.equal(chain[0].parentId, undefined)
})
test('nested imports merge by folder path, export structure and fail atomically at depth limits', () => {
  let id = 0
  const tree = [
    {
      title: 'Research & notes',
      children: [{ title: 'Docs', children: [{ title: 'Example', url: 'https://example.test/' }] }],
    },
  ]
  const imported = importBookmarkTree([], [], tree, () => String(++id))
  assert.equal(imported.folders.length, 2)
  assert.equal(
    folderPath(imported.bookmarks[0].folderId, imported.folders)
      .map((f) => f.title)
      .join('/'),
    'Research & notes/Docs',
  )
  const again = importBookmarkTree(imported.bookmarks, imported.folders, tree, () => String(++id))
  assert.equal(again.added, 0)
  assert.equal(again.addedFolders, 0)
  const html = exportBookmarks(imported.bookmarks, imported.folders)
  assert.ok(html.includes('<H3>Research &amp; notes</H3>'))
  assert.ok(html.includes('<H3>Docs</H3>'))
  let deep: unknown[] = [{ title: 'Leaf', url: 'https://deep.test/' }]
  for (let i = 0; i < 13; i++) deep = [{ title: String(i), children: deep }]
  assert.throws(() => importBookmarkTree(imported.bookmarks, imported.folders, deep, () => String(++id)))
  assert.equal(imported.folders.length, 2)
  assert.equal(imported.bookmarks.length, 1)
})
test('cookie scope includes shared parent domains but excludes sibling host-only cookies and suffix lookalikes', () => {
  assert.equal(cookieAppliesToHost({ domain: '.example.test', hostOnly: false }, 'app.example.test'), true)
  assert.equal(cookieAppliesToHost({ domain: 'example.test', hostOnly: true }, 'app.example.test'), false)
  assert.equal(cookieAppliesToHost({ domain: '.example.test' }, 'notexample.test'), false)
  assert.equal(
    cookieAppliesToHost({ domain: 'other.example.test', hostOnly: true }, 'app.example.test'),
    false,
  )
  assert.equal(cookieAppliesToHost({ domain: '::1', hostOnly: true }, '[::1]'), true)
  assert.equal(cookieAppliesToHost({ domain: '.0.0.1' }, '127.0.0.1'), false)
})
test('native view geometry rejects non-finite and clamps oversized rectangles', () => {
  assert.throws(() => safeBounds({ x: NaN, y: 0, width: 10, height: 10 }, [800, 600]))
  assert.throws(() => safeBounds({ x: -1, y: 0, width: 10, height: 10 }, [800, 600]))
  assert.deepEqual(safeBounds({ x: 4, y: 100, width: 2000, height: 2000 }, [800, 600]), {
    x: 4,
    y: 100,
    width: 796,
    height: 500,
  })
  assert.deepEqual(safeBounds({ x: 20, y: 100, width: 100, height: 100 }, [800, 600], 1.25), {
    x: 25,
    y: 125,
    width: 125,
    height: 125,
  })
})
test('appearance preferences reject unknown and inherited theme names', () => {
  assert.throws(() => preferencesPatch({ theme: '__proto__' }))
  assert.throws(() => preferencesPatch({ mode: 'invalid' }))
  assert.throws(() => preferencesPatch({ acrylic: 'true' }))
  assert.equal(palette({ ...defaults, mode: 'dark' }, false).dark, true)
  assert.equal(palette({ ...defaults, mode: 'light' }, true).dark, false)
})

test('theme depth keeps hue families and text contrast across light and dark themes without changing opacity', () => {
  for (const themeDepth of [null, '50', NaN, Infinity, -1, 101, 42.5])
    assert.throws(() => preferencesPatch({ themeDepth }), /0–100/)
  const lightness = (color: string) => {
    const [r, g, b] = [1, 3, 5].map((offset) => {
      const value = parseInt(color.slice(offset, offset + 2), 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return r * 0.2126 + g * 0.7152 + b * 0.0722
  }
  for (const theme of Object.keys(themes) as Preferences['theme'][]) {
    for (const mode of ['light', 'dark'] as const) {
      const base = { ...defaults, theme, mode }
      assert.equal(
        palette(base, false).colors.shell,
        themes[theme][mode][0],
        'default preserves original palette',
      )
      let previous = 1
      for (let themeDepth = 0; themeDepth <= 100; themeDepth++) {
        assert.equal(preferencesPatch({ themeDepth }).themeDepth, themeDepth)
        const { colors, dark } = palette({ ...base, themeDepth }, false)
        const buttonForeground = lightness(colors['on-accent']),
          buttonBackground = lightness(colors.accent)
        assert.ok(
          (Math.max(buttonForeground, buttonBackground) + 0.05) /
            (Math.min(buttonForeground, buttonBackground) + 0.05) >=
            4.5,
          `${theme}/${mode}/${themeDepth}: accent buttons retain readable text`,
        )
        const current = lightness(colors.shell)
        assert.ok(current <= previous, 'moving toward deep never lightens the shell')
        previous = current
        {
          for (const foreground of ['ink', 'muted', 'accent']) {
            for (const background of [
              'shell',
              'sidebar',
              'surface',
              'header',
              'selection',
              'bar-surface',
              'field-surface',
            ]) {
              const a = lightness(colors[foreground]),
                b = lightness(colors[background])
              assert.ok(
                (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >=
                  (foreground === 'ink'
                    ? background === 'selection'
                      ? 4.5
                      : 7
                    : foreground === 'muted'
                      ? 5
                      : 4.5),
                `${theme}/${mode}/${themeDepth}: ${foreground} over ${background}`,
              )
            }
          }
        }
        const chrome = chromePalette(colors, dark, false, true)
        const original = chromePalette(palette(base, false).colors, dark, false, true)
        assert.equal(chrome.chrome.slice(-2), original.chrome.slice(-2), 'depth never changes transparency')
        assert.equal(chrome['chrome-content'].slice(-2), original['chrome-content'].slice(-2))
        assert.equal(chrome['chrome-field'].slice(-2), original['chrome-field'].slice(-2))
        if (themeDepth >= 50) {
          assert.ok(
            lightness(colors['bar-surface']) > lightness(colors.shell),
            'bars keep a lighter base than the titlebar',
          )
          assert.ok(
            lightness(colors['field-surface']) > lightness(colors['bar-surface']),
            'address field keeps its own level',
          )
          if (themeDepth === 100) {
            const composite = (top: string, bottom: string, opacity: number) =>
              '#' +
              [1, 3, 5]
                .map((offset) =>
                  Math.round(
                    parseInt(top.slice(offset, offset + 2), 16) * opacity +
                      parseInt(bottom.slice(offset, offset + 2), 16) * (1 - opacity),
                  )
                    .toString(16)
                    .padStart(2, '0'),
                )
                .join('')
            const title = composite(
              colors.shell,
              dark ? '#202020' : '#D0D0D0',
              parseInt(chrome.chrome.slice(-2), 16) / 255,
            )
            const bar = composite(
              colors['bar-surface'],
              title,
              parseInt(chrome['chrome-content'].slice(-2), 16) / 255,
            )
            assert.ok(
              (lightness(bar) + 0.05) / (lightness(title) + 0.05) >= 1.12,
              'full depth retains visible separation over a reference native backdrop',
            )
          }
        }
        assert.ok(Object.values(colors).every((color) => /^#[\dA-F]{6}$/i.test(color)))
      }
      assert.deepEqual(palette({ ...base, themeDepth: NaN }, false), palette(base, false))
      assert.deepEqual(
        palette({ ...base, themeDepth: 999 }, false),
        palette({ ...base, themeDepth: 100 }, false),
      )
    }
  }
})

test('window transparency rejects out-of-range input and keeps native tint bounded without changing page colors', () => {
  for (const transparency of [null, '50', NaN, Infinity, -1, 14, 76, 100, 42.5])
    assert.throws(() => preferencesPatch({ transparency }), /15%–75%/)
  for (const transparency of [15, 42, 75])
    assert.equal(preferencesPatch({ transparency }).transparency, transparency)
  for (const dark of [false, true]) {
    const { colors } = palette({ ...defaults, mode: dark ? 'dark' : 'light' }, false)
    for (const systemDark of [false, true]) {
      const low = chromePalette(colors, dark, systemDark, true, transparencyLimits.min)
      const high = chromePalette(colors, dark, systemDark, true, transparencyLimits.max)
      assert.ok(parseInt(low.chrome.slice(-2), 16) > parseInt(high.chrome.slice(-2), 16))
      assert.ok(parseInt(high.chrome.slice(-2), 16) >= 64, 'never produce a fully transparent titlebar')
      assert.notEqual(low['chrome-content'], high['chrome-content'], 'browser bars follow the slider')
      assert.notEqual(low['chrome-field'], high['chrome-field'], 'address tint follows the slider')
      const transmitted = (value: typeof low) => {
        const transparency = (color: string) => 1 - parseInt(color.slice(-2), 16) / 255
        const title = transparency(value.chrome),
          bars = title * transparency(value['chrome-content']),
          address = bars * transparency(value['chrome-field'])
        assert.ok(
          address > 0 && address < bars && bars < title,
          'nested chrome keeps a weaker, visible backdrop',
        )
        return { bars, address }
      }
      const lowTransmission = transmitted(low),
        highTransmission = transmitted(high)
      assert.ok(highTransmission.bars > lowTransmission.bars)
      assert.ok(highTransmission.address > lowTransmission.address)
      assert.equal(chromePalette(colors, dark, systemDark, false, 75).chrome, colors.shell)
      assert.equal(chromePalette(colors, dark, systemDark, true, 100).chrome, high.chrome)
      assert.equal(chromePalette(colors, dark, systemDark, true, -1).chrome, low.chrome)
      assert.equal(colors.surface.length, 7, 'page surface stays opaque')
    }
  }
})
test('storage roundtrips data and preserves corrupt files for recovery', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'echromium-domain-'))
  try {
    const store = new BrowserStore(directory)
    store.data.preferences.transparency = 31
    store.data.preferences.themeDepth = 73
    store.visit('https://example.com/', 'A')
    store.visit('https://example.com/', 'A updated')
    store.visit('javascript:bad', 'Invalid')
    store.toggleBookmark('https://example.com/', 'Example')
    store.saveFolder(undefined, { title: 'Group' })
    const folderId = store.data.bookmarkFolders[0].id
    store.saveBookmark(store.data.bookmarks[0].id, {
      title: 'Example',
      url: 'https://example.com/',
      folderId,
    })
    store.data.permissions = [{ origin: 'https://example.com', capability: 'camera', decision: 'block' }]
    store.data.downloads = [
      {
        id: 'one',
        name: 'a.txt',
        url: 'https://example.com/a',
        path: '',
        status: 'progressing',
        received: 5,
        total: 10,
        at: 100,
        active: true,
        canResume: true,
      },
    ]
    store.flush()
    const loaded = new BrowserStore(directory)
    assert.equal(loaded.data.preferences.transparency, 31)
    assert.equal(loaded.data.preferences.themeDepth, 73)
    assert.equal(loaded.data.history.length, 1)
    assert.equal(loaded.data.history[0].title, 'A updated')
    assert.equal(loaded.data.bookmarks.length, 1)
    assert.equal(loaded.data.bookmarks[0].folderId, folderId)
    loaded.removeFolder(folderId)
    loaded.flush()
    assert.equal(loaded.data.bookmarks.length, 1)
    assert.equal(loaded.data.bookmarks[0].folderId, undefined)
    assert.equal(loaded.data.permissions[0].decision, 'block')
    assert.equal(loaded.data.downloads[0].status, 'interrupted')
    assert.equal(loaded.data.downloads[0].canResume, false)
    // Earlier versions have no folder collection; their bookmarks stay in the root.
    const legacy = JSON.parse(fs.readFileSync(store.file, 'utf8'))
    delete legacy.bookmarkFolders
    delete legacy.preferences.transparency
    delete legacy.preferences.themeDepth
    legacy.bookmarks[0].folderId = 'missing-folder'
    fs.writeFileSync(store.file, JSON.stringify(legacy))
    const upgraded = new BrowserStore(directory)
    assert.equal(upgraded.data.preferences.transparency, transparencyLimits.default)
    assert.equal(upgraded.data.preferences.themeDepth, themeDepthLimits.default)
    assert.deepEqual(upgraded.data.bookmarkFolders, [])
    assert.equal(upgraded.data.bookmarks[0].folderId, undefined)
    fs.writeFileSync(store.file, 'not JSON')
    const recovery = new BrowserStore(directory)
    assert.equal(recovery.data.history.length, 0)
    assert.ok(fs.readdirSync(directory).some((f) => f.includes('unreadable-')))
    assert.equal(fs.readFileSync(store.file, 'utf8'), 'not JSON')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
test('permission lifecycle rejects stale prompts, separates profiles and honors settings resets', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'echromium-permissions-'))
  const store = new BrowserStore(directory)
  type Check = NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>
  type Request = NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>
  let check!: Check, request!: Request
  const fakeSession = {
    setPermissionCheckHandler: (handler: Check) => {
      check = handler
    },
    setPermissionRequestHandler: (handler: Request) => {
      request = handler
    },
    setDisplayMediaRequestHandler: () => {},
  } as unknown as Session
  const wc = { id: 1 } as WebContents
  let epoch = 0,
    profile = 'default',
    valid = true,
    prompts = 0
  let answer: PermissionPrompt = async () => 'once'
  const permissions = new SitePermissions(
    store,
    () => {
      const original = epoch
      return {
        profile,
        token: `${profile}:${epoch}`,
        origin: 'https://site.test',
        valid: () => valid && epoch === original,
      }
    },
    (...args) => {
      prompts++
      return answer(...args)
    },
    () => {},
  )
  permissions.register(fakeSession)
  const ask = (permission = 'media', url = 'https://site.test/page', mediaTypes = ['audio']) =>
    new Promise<boolean>((resolve) =>
      request(wc, permission as never, resolve, {
        requestingUrl: url,
        isMainFrame: true,
        mediaTypes,
      } as never),
    )
  const granted = (type: 'video' | 'audio' = 'audio', origin = 'https://site.test') =>
    check(wc, 'media', origin, { isMainFrame: true, mediaType: type })
  try {
    assert.equal(await ask(), true)
    assert.equal(granted(), true)
    assert.equal(granted('video'), false)
    assert.equal(granted('audio', 'https://embedded.test'), false)
    assert.equal(store.data.permissions.length, 0)
    epoch++
    assert.equal(granted(), false)
    let respond!: (value: 'allow') => void
    answer = () =>
      new Promise((resolve) => {
        respond = resolve
      })
    const stale = ask()
    epoch++
    respond('allow')
    assert.equal(await stale, false)
    assert.equal(store.data.permissions.length, 0)
    const editedWhilePrompting = ask()
    permissions.edit('default', { origin: 'https://site.test', capability: 'microphone', decision: 'block' })
    respond('allow')
    assert.equal(await editedWhilePrompting, false)
    assert.equal(store.data.permissions[0].decision, 'block')
    permissions.edit('default', { origin: 'https://site.test', capability: 'microphone', decision: 'ask' })
    answer = async () => 'allow'
    assert.equal(await ask(), true)
    assert.equal(store.data.permissions[0].capability, 'microphone')
    permissions.edit('default', { origin: 'https://site.test', capability: 'microphone', decision: 'block' })
    const before = prompts
    assert.equal(await ask(), false)
    assert.equal(prompts, before)
    permissions.edit('default', { origin: 'https://site.test', capability: 'microphone', decision: 'ask' })
    assert.equal(granted(), false)
    profile = 'private:test'
    assert.equal(await ask(), true)
    assert.equal(permissions.list(profile).length, 1)
    assert.equal(store.data.permissions.length, 0)
    permissions.release(profile)
    assert.equal(permissions.list(profile).length, 0)
    assert.equal(await ask('media', 'https://embedded.test'), false)
    valid = false
    assert.equal(await ask('notifications'), false)
    store.flush()
    assert.equal(new BrowserStore(directory).data.permissions.length, 0)
  } finally {
    store.flush()
    assert.equal(path.dirname(directory), os.tmpdir())
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
