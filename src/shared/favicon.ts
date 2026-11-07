/** Only locally decoded PNG thumbnails may enter the privileged shell. */
export function faviconData(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length <= 24000 &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    ? value
    : undefined
}

export const faviconMaxAge = 7 * 24 * 60 * 60 * 1000
export interface FaviconRecord {
  iconUrl: string
  data: string
  updatedAt: number
  pages: string[]
}
export function faviconPage(value: string) {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return
    url.hash = ''
    return url.href
  } catch {
    return
  }
}
export class FaviconCache {
  records: FaviconRecord[] = []
  constructor(value: unknown = []) {
    if (!Array.isArray(value)) return
    for (const row of value.slice(-256)) {
      if (
        !row ||
        typeof row.iconUrl !== 'string' ||
        row.iconUrl.length > 8192 ||
        !(faviconPage(row.iconUrl) || /^data:sha256:[a-f0-9]{64}$/.test(row.iconUrl)) ||
        !faviconData(row.data) ||
        !Number.isFinite(row.updatedAt) ||
        row.updatedAt <= 0 ||
        row.updatedAt > Date.now() + 60000 ||
        !Array.isArray(row.pages)
      )
        continue
      const pages = [
        ...new Set<string>(
          row.pages
            .filter((p: unknown) => typeof p === 'string')
            .map(faviconPage)
            .filter(Boolean),
        ),
      ].slice(-32)
      this.records.push({ iconUrl: row.iconUrl, data: row.data, updatedAt: row.updatedAt, pages })
    }
    this.prune()
  }
  page(url: string) {
    const key = faviconPage(url)
    return key ? this.records.find((row) => row.pages.includes(key)) : undefined
  }
  icon(url: string) {
    return this.records.find((row) => row.iconUrl === url)
  }
  fresh(row: FaviconRecord, now = Date.now()) {
    return now - row.updatedAt <= faviconMaxAge
  }
  set(page: string, iconUrl: string, data: string, now = Date.now()) {
    const key = faviconPage(page)
    if (!key || !faviconData(data)) return
    this.unlink(key)
    let row = this.icon(iconUrl)
    if (row) Object.assign(row, { data, updatedAt: now })
    else {
      row = { iconUrl, data, updatedAt: now, pages: [] }
      this.records.push(row)
    }
    row.pages = [...row.pages.filter((url) => url !== key), key].slice(-32)
    this.prune()
  }
  link(page: string, iconUrl: string) {
    const key = faviconPage(page),
      row = this.icon(iconUrl)
    if (!key || !row) return
    this.unlink(key)
    row.pages = [...row.pages, key].slice(-32)
  }
  unlink(page: string) {
    const key = faviconPage(page)
    for (const row of this.records) row.pages = row.pages.filter((url) => url !== key)
  }
  retainPages(keep: (url: string) => boolean) {
    for (const row of this.records) row.pages = row.pages.filter(keep)
    this.records = this.records.filter((row) => row.pages.length)
  }
  private prune() {
    this.records.sort((a, b) => a.updatedAt - b.updatedAt)
    let size = this.records.reduce(
      (sum, row) => sum + row.data.length + row.iconUrl.length + row.pages.join('').length,
      0,
    )
    while (this.records.length > 256 || size > 2_000_000) {
      const row = this.records.shift()!
      size -= row.data.length + row.iconUrl.length + row.pages.join('').length
    }
  }
}
