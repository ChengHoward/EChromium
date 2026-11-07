export const dataRanges = { hour: '过去一小时', day: '过去一天', week: '过去七天', all: '全部时间' } as const
export interface DataOptions {
  range: keyof typeof dataRanges
  history: boolean
  downloads: boolean
  siteData: boolean
  cache: boolean
}
export interface DataSummary {
  history: number
  downloads: number
  cancelled?: boolean
  cleared?: boolean
}
export function dataOptions(value: unknown): DataOptions {
  if (!value || typeof value !== 'object') throw new Error('请选择要清除的数据。')
  const raw = value as DataOptions
  if (
    !Object.hasOwn(dataRanges, raw.range) ||
    ['history', 'downloads', 'siteData', 'cache'].some(
      (key) => typeof raw[key as keyof DataOptions] !== 'boolean',
    )
  )
    throw new Error('无效的清除选项。')
  if (raw.range !== 'all' && (raw.siteData || raw.cache))
    throw new Error('Cookie、网站存储和缓存暂时只支持清除全部时间。')
  if (!raw.history && !raw.downloads && !raw.siteData && !raw.cache) throw new Error('请至少选择一种数据。')
  return {
    range: raw.range,
    history: raw.history,
    downloads: raw.downloads,
    siteData: raw.siteData,
    cache: raw.cache,
  }
}
export function dataInterval(range: DataOptions['range'], now = Date.now()) {
  return {
    from: range === 'all' ? 0 : now - { hour: 3600000, day: 86400000, week: 604800000 }[range],
    to: now,
  }
}
export function withinInterval(at: number, interval: { from: number; to: number }) {
  return Number.isFinite(at) && at >= interval.from && at <= interval.to
}
