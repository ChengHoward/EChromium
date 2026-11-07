import type { DownloadState } from './model'
import { webTarget } from './navigation'

/** Only serializable metadata survives restart; a saved record is never a live DownloadItem. */
export function restoredDownloads(raw: unknown): DownloadState[] {
  if (!Array.isArray(raw)) return []
  const records = new Map<string, DownloadState>()
  for (const row of raw.slice(0, 1000)) {
    if (
      !row ||
      typeof row.id !== 'string' ||
      row.id.length > 100 ||
      !row.id ||
      typeof row.name !== 'string' ||
      typeof row.path !== 'string' ||
      !webTarget(row.url) ||
      !Number.isFinite(row.at) ||
      !Number.isFinite(row.received) ||
      row.received < 0 ||
      !Number.isFinite(row.total) ||
      row.total < 0 ||
      !['progressing', 'paused', 'completed', 'cancelled', 'interrupted'].includes(row.status)
    )
      continue
    records.set(row.id, {
      id: row.id,
      name: row.name.slice(0, 500),
      path: row.path.slice(0, 32768),
      url: row.url,
      at: row.at,
      received: row.received,
      total: row.total,
      status: ['progressing', 'paused'].includes(row.status) ? 'interrupted' : row.status,
      active: false,
      canResume: false,
    })
  }
  return [...records.values()].sort((a, b) => b.at - a.at).slice(0, 500)
}
