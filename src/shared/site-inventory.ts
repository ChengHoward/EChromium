import { canonicalOrigin } from './site-policy'

export const storageTypeNames: Record<string, string> = {
  file_systems: '文件系统',
  indexeddb: '数据库',
  cache_storage: '离线缓存',
  service_workers: '服务工作线程',
}
export interface StorageUsage {
  bytes: number
  breakdown: { type: string; bytes: number }[]
}
export interface SiteDataRow {
  id: string
  hostname: string
  origin?: string
  cookieCount: number
  storage?: StorageUsage
}
export interface SiteInventory {
  version: string
  rows: SiteDataRow[]
  total: number
  offset: number
  limit: number
  cookieTotal: number
  truncated: boolean
  measuredAt: number
}
export function cookieHostname(domain: string | undefined) {
  if (!domain) return
  let host = domain.toLowerCase().replace(/^\./, '')
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`
  try {
    const origin = canonicalOrigin(`https://${host}`)
    if (!origin || new URL(origin).hostname !== host) return
    return host
  } catch {
    return
  }
}
export function storageUsage(value: unknown): StorageUsage | undefined {
  if (!value || typeof value !== 'object') return
  const raw = value as { usage?: unknown; usageBreakdown?: unknown }
  if (typeof raw.usage !== 'number' || !Number.isFinite(raw.usage) || raw.usage < 0) return
  const breakdown: StorageUsage['breakdown'] = []
  for (const item of Array.isArray(raw.usageBreakdown) ? raw.usageBreakdown : []) {
    if (
      item &&
      typeof item.storageType === 'string' &&
      Object.hasOwn(storageTypeNames, item.storageType) &&
      typeof item.usage === 'number' &&
      Number.isFinite(item.usage) &&
      item.usage >= 0
    )
      breakdown.push({ type: item.storageType, bytes: item.usage })
  }
  return { bytes: raw.usage, breakdown }
}
export function siteCandidates(urls: string[], domains: (string | undefined)[]) {
  const origins = new Set<string>(),
    hosts = new Set<string>()
  for (const url of urls) {
    const origin = canonicalOrigin(url)
    if (origin) origins.add(origin)
  }
  const rows: SiteDataRow[] = [...origins].map((origin) => {
    const hostname = new URL(origin).hostname
    hosts.add(hostname)
    return { id: 'origin:' + origin, hostname, origin, cookieCount: 0 }
  })
  for (const domain of domains) {
    const hostname = cookieHostname(domain)
    if (hostname && !hosts.has(hostname)) {
      hosts.add(hostname)
      rows.push({ id: 'cookies:' + hostname, hostname, cookieCount: 0 })
    }
  }
  return rows.sort(
    (a, b) => a.hostname.localeCompare(b.hostname) || (a.origin || '').localeCompare(b.origin || ''),
  )
}
export function formatStorage(bytes: number) {
  if (!bytes) return '0 B'
  const unit = Math.min(3, Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))))
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: unit ? 1 : 0 }).format(bytes / 1024 ** unit)} ${['B', 'KB', 'MB', 'GB'][unit]}`
}
