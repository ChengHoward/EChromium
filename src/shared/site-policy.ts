import type { SiteCapability, SiteRule } from './model'
import { webTarget } from './navigation'

export const capabilityNames: Record<SiteCapability, string> = {
  camera: '摄像头',
  microphone: '麦克风',
  geolocation: '位置信息',
  notifications: '通知',
}
export function canonicalOrigin(value: unknown): string | undefined {
  if (!webTarget(value)) return
  return new URL(value as string).origin
}
export function siteRule(value: unknown): SiteRule {
  if (!value || typeof value !== 'object') throw new Error('无效的网站权限。')
  const row = value as SiteRule
  const origin = canonicalOrigin(row.origin)
  if (
    !origin ||
    !Object.hasOwn(capabilityNames, row.capability) ||
    !['allow', 'block'].includes(row.decision)
  )
    throw new Error('无效的网站权限。')
  return { origin, capability: row.capability, decision: row.decision }
}
export function requestedCapabilities(permission: string, media?: readonly string[]): SiteCapability[] {
  if (permission === 'media') {
    if (!media?.length || media.some((type) => !['video', 'audio'].includes(type))) return []
    return [...new Set(media.map((type) => (type === 'video' ? 'camera' : 'microphone') as SiteCapability))]
  }
  return permission === 'geolocation' || permission === 'notifications' ? [permission] : []
}
