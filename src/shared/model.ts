import type { DataOptions, DataSummary } from './browsing-data'
import type { SiteInventory } from './site-inventory'
import type { TabPreview } from './tab-overview'
export type AppearanceMode = 'auto' | 'light' | 'dark'
export type ThemeId = 'mist' | 'sage' | 'wisteria' | 'sand' | 'apricot' | 'graphite'
export type SearchEngine = 'bing' | 'baidu' | 'google'
export interface Preferences {
  theme: ThemeId
  mode: AppearanceMode
  acrylic: boolean
  transparency: number
  themeDepth: number
  search: SearchEngine
  restore: boolean
  bookmarksBar: boolean
}
export interface Bookmark {
  id: string
  title: string
  url: string
  folderId?: string
  favicon?: string
}
export interface BookmarkFolder {
  id: string
  title: string
  parentId?: string
}
export interface SiteDataSummary {
  origin: string
  hostname: string
  cookieCount: number
  cookies: {
    name: string
    domain: string
    path: string
    secure: boolean
    httpOnly: boolean
    session: boolean
  }[]
  cancelled?: boolean
  cleared?: boolean
}
export interface Visit {
  title: string
  url: string
  at: number
}
export interface TabState {
  id: string
  title: string
  url: string
  pendingUrl?: string
  favicon?: string
  loading: boolean
  kind: 'newtab' | 'web' | 'settings' | 'downloads' | 'history' | 'bookmarks'
  pinned: boolean
  muted: boolean
  audible: boolean
  canGoBack: boolean
  canGoForward: boolean
  zoom: number
  error?: string
  crashed: boolean
  settingsOrigin?: string
  settingsSection?: 'privacy'
  previewVersion?: number
  popupStatus?: { blocked: number; allowed: boolean }
  dialogStatus?: { blocked: number; muted: boolean }
}
export interface DownloadState {
  id: string
  name: string
  received: number
  total: number
  status: 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'
  path: string
  url: string
  at: number
  canResume: boolean
  active: boolean
}
export type SiteCapability = 'camera' | 'microphone' | 'geolocation' | 'notifications'
export interface SiteRule {
  origin: string
  capability: SiteCapability
  decision: 'allow' | 'block'
}
export interface BrowserState {
  revision: number
  windowId: string
  private: boolean
  tabs: TabState[]
  activeId: string
  overview?: string
  preferences: Preferences
  palette: Record<string, string>
  dark: boolean
  material: 'acrylic' | 'solid'
  bookmarks: Bookmark[]
  bookmarkFolders: BookmarkFolder[]
  history: Visit[]
  downloads: DownloadState[]
  permissions: SiteRule[]
  canReopen: boolean
  nativeSuggestions: boolean
  runtime: { electron: string; chrome: string; node: string }
  fullscreen: boolean
}
export type BrowserRequest = {
  action:
    | 'state'
    | 'new-tab'
    | 'activate'
    | 'close-tab'
    | 'close-tabs'
    | 'reopen-tab'
    | 'navigate'
    | 'back'
    | 'forward'
    | 'reload'
    | 'stop'
    | 'duplicate'
    | 'pin'
    | 'mute'
    | 'reorder'
    | 'detach'
    | 'move-tab'
    | 'adopt-tab'
    | 'page-info'
    | 'site-settings'
    | 'popup-policy'
    | 'dialog-policy'
    | 'new-window'
    | 'preferences'
    | 'bookmark'
    | 'remove-bookmark'
    | 'save-bookmark'
    | 'import-bookmarks'
    | 'export-bookmarks'
    | 'reorder-bookmarks'
    | 'save-bookmark-folder'
    | 'remove-bookmark-folder'
    | 'folder-menu'
    | 'layout'
    | 'menu'
    | 'tab-menu'
    | 'open-find'
    | 'find-step'
    | 'stop-find'
    | 'zoom'
    | 'download'
    | 'clear-downloads'
    | 'site-permission'
    | 'open-data'
    | 'tab-overview'
  id?: string
  text?: string
  url?: string
  value?: unknown
  private?: boolean
}
export type UiEvent =
  | { type: 'overview-search' }
  | { type: 'focus-address' }
  | { type: 'address-dismissed' }
  | { type: 'notice'; text: string }
export interface BrowserBridge {
  tabPreviews: (request: { token: string; ids: string[] }) => Promise<TabPreview[]>
  siteInventory: (request: {
    action: 'list' | 'clear'
    id: string
    query?: string
    offset?: number
    version?: string
    rowId?: string
  }) => Promise<{ inventory?: SiteInventory; cancelled?: boolean; cleared?: boolean }>
  browsingData: (request: {
    action: 'preview' | 'clear'
    id: string
    options: DataOptions
  }) => Promise<DataSummary>
  siteData: (request: { action: 'inspect' | 'clear'; id: string }) => Promise<SiteDataSummary>
  suggestions: (request: { id?: string; text?: string; value: unknown }) => Promise<void>
  request: (request: BrowserRequest) => Promise<BrowserState>
  onState: (callback: (state: BrowserState) => void) => () => void
  onUi: (callback: (event: UiEvent) => void) => () => void
}
declare global {
  interface Window {
    browser: BrowserBridge
  }
}
