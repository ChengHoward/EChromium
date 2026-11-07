import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { Browser, Host, Tab } from './browser'
import type { BrowserRequest } from '../shared/model'
import { closeTargets } from '../shared/tab-operations'
import { compatibleWindows } from './tab-transfer'

function bookmarkEntries(
  browser: Browser,
  host: Host,
  folderId?: string,
  depth = 0,
): MenuItemConstructorOptions[] {
  if (depth > 12) return []
  const folders = browser.store.data.bookmarkFolders
    .filter((f) => f.parentId === folderId)
    .map((folder) => ({
      label: folder.title.replace(/&/g, '&&'),
      submenu: bookmarkEntries(browser, host, folder.id, depth + 1),
    }))
  const bookmarks = browser.store.data.bookmarks
    .filter((b) => b.folderId === folderId)
    .slice(0, 100)
    .map((b) => ({
      label: b.title.replace(/&/g, '&&'),
      click: () => {
        if (!host.window.isDestroyed())
          void browser.request(host, { action: 'new-tab', url: b.url }).catch(console.error)
      },
    }))
  return [...folders, ...bookmarks].length
    ? [...folders, ...bookmarks]
    : [{ label: '空文件夹', enabled: false }]
}
export function openFolderMenu(browser: Browser, host: Host, id: unknown) {
  if (typeof id !== 'string' || !browser.store.data.bookmarkFolders.some((f) => f.id === id))
    throw new Error('文件夹已被删除。')
  Menu.buildFromTemplate(bookmarkEntries(browser, host, id)).popup({ window: host.window })
}

export function buildBrowserMenu(browser: Browser, host: Host, tab?: Tab) {
  const send = (request: BrowserRequest) => {
    if (!host.window.isDestroyed()) void browser.request(host, request).catch(console.error)
  }
  const reopen: MenuItemConstructorOptions = {
    label: '重新打开关闭的标签页',
    accelerator: 'CmdOrCtrl+Shift+T',
    enabled: browser.snapshot(host).canReopen,
    click: () => send({ action: 'reopen-tab' }),
  }
  const destinations = [...browser.hosts.values()].filter((target) => compatibleWindows(host, target))
  const entries: MenuItemConstructorOptions[] = tab
    ? [
        { label: '新标签页', accelerator: 'CmdOrCtrl+T', click: () => send({ action: 'new-tab' }) },
        { label: '复制标签页', click: () => send({ action: 'duplicate', id: tab.state.id }) },
        {
          label: tab.state.pinned ? '取消固定' : '固定标签页',
          click: () => send({ action: 'pin', id: tab.state.id }),
        },
        {
          label: tab.state.muted ? '取消静音' : '标签页静音',
          click: () => send({ action: 'mute', id: tab.state.id }),
        },
        {
          label: '移至新窗口',
          enabled: host.tabs.length > 1,
          click: () => send({ action: 'detach', id: tab.state.id }),
        },
        {
          label: '移至其他窗口',
          enabled: destinations.length > 0,
          submenu: destinations.map((target, index) => ({
            label: `窗口 ${index + 1} · ${target.window.getTitle().slice(0, 90).replace(/&/g, '&&')}`,
            click: () => send({ action: 'move-tab', id: tab.state.id, value: { windowId: target.id } }),
          })),
        },
        { type: 'separator' },
        {
          label: '关闭标签页',
          accelerator: 'CmdOrCtrl+W',
          click: () => send({ action: 'close-tab', id: tab.state.id }),
        },
        ...(['others', 'left', 'right'] as const).map((mode) => ({
          label: { others: '关闭其他标签页', left: '关闭左侧标签页', right: '关闭右侧标签页' }[mode],
          enabled:
            closeTargets(
              host.tabs.map((t) => t.state),
              tab.state.id,
              mode,
            ).length > 0,
          click: () => send({ action: 'close-tabs', id: tab.state.id, value: mode }),
        })),
        { type: 'separator' },
        reopen,
      ]
    : [
        {
          label: '标签总览',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => send({ action: 'tab-overview' }),
        },
        { label: '新窗口', accelerator: 'CmdOrCtrl+N', click: () => send({ action: 'new-window' }) },
        {
          label: '新隐私窗口',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => send({ action: 'new-window', private: true }),
        },
        { type: 'separator' },
        reopen,
        {
          label: '历史记录',
          accelerator: 'CmdOrCtrl+H',
          click: () => send({ action: 'new-tab', value: 'history' }),
        },
        {
          label: '下载',
          accelerator: 'CmdOrCtrl+J',
          click: () => send({ action: 'new-tab', value: 'downloads' }),
        },
        {
          label: '书签',
          submenu: [
            {
              label: '管理书签',
              accelerator: 'CmdOrCtrl+Shift+O',
              click: () => send({ action: 'new-tab', value: 'bookmarks' }),
            },
            { type: 'separator' },
            ...bookmarkEntries(browser, host),
          ],
        },
        { type: 'separator' },
        {
          label: '在页面中查找',
          accelerator: 'CmdOrCtrl+F',
          enabled: !!browser.active(host)?.view && !browser.active(host)?.state.error,
          click: () => send({ action: 'open-find' }),
        },
        {
          label: '开发者工具',
          accelerator: 'F12',
          enabled: !!browser.active(host)?.view,
          click: () => browser.active(host)?.view?.webContents.openDevTools({ mode: 'detach' }),
        },
        {
          label: '网站信息与连接安全',
          enabled: browser.active(host)?.state.kind === 'web',
          click: () => send({ action: 'page-info', value: { x: 140, y: 50, width: 28, height: 28 } }),
        },
        {
          label: '此网站的设置',
          enabled: browser.active(host)?.state.kind === 'web',
          click: () => send({ action: 'site-settings' }),
        },
        { type: 'separator' },
        {
          label: '外观',
          submenu: [
            ...(['auto', 'light', 'dark'] as const).map((mode) => ({
              label: { auto: '跟随系统', light: '浅色', dark: '深色' }[mode],
              type: 'radio' as const,
              checked: browser.store.data.preferences.mode === mode,
              click: () => send({ action: 'preferences', value: { mode } }),
            })),
            { type: 'separator' },
            { label: '外观设置…', click: () => send({ action: 'new-tab', value: 'settings' }) },
          ],
        },
        {
          label: '清除浏览数据',
          accelerator: 'CmdOrCtrl+Shift+Delete',
          click: () => send({ action: 'open-data' }),
        },
        { label: '设置', click: () => send({ action: 'new-tab', value: 'settings' }) },
      ]
  return Menu.buildFromTemplate(entries)
}
export function openBrowserMenu(browser: Browser, host: Host, tab?: Tab) {
  buildBrowserMenu(browser, host, tab).popup({ window: host.window })
}
