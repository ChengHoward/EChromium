import type { Session, WebContents } from 'electron'
import type { SiteCapability, SiteRule } from '../shared/model'
import { canonicalOrigin, requestedCapabilities, siteRule } from '../shared/site-policy'
import type { BrowserStore } from './storage'

export interface PermissionContext {
  profile: string
  token: string
  origin: string
  valid: () => boolean
}
export type PermissionPrompt = (
  wc: WebContents,
  origin: string,
  capabilities: SiteCapability[],
) => Promise<'once' | 'allow' | 'block' | 'dismiss'>

export class SitePermissions {
  private temporary = new Map<string, SiteRule[]>()
  private grants = new Map<
    number,
    { token: string; profile: string; origin: string; capabilities: Set<SiteCapability> }
  >()
  private pending = new Set<number>()
  private revisions = new Map<string, Map<string, number>>()
  private revision(profile: string, origin: string) {
    return this.revisions.get(profile)?.get(origin) || 0
  }
  constructor(
    private store: BrowserStore,
    private context: (wc: WebContents) => PermissionContext | undefined,
    private prompt: PermissionPrompt,
    private changed: () => void,
  ) {}
  list(profile: string) {
    return (profile === 'default' ? this.store.data.permissions : this.temporary.get(profile) || []).map(
      (r) => ({ ...r }),
    )
  }
  edit(profile: string, value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('无效的网站权限。')
    const raw = value as Omit<SiteRule, 'decision'> & { decision: string }
    const rule = siteRule({ ...raw, decision: raw.decision === 'ask' ? 'block' : raw.decision })
    const rules = this.list(profile).filter(
      (r) => r.origin !== rule.origin || r.capability !== rule.capability,
    )
    if (raw.decision !== 'ask') rules.push(rule)
    if (rules.length > 2000) throw new Error('网站权限条目已达到上限。')
    if (profile === 'default') {
      this.store.data.permissions = rules
      this.store.saveSoon()
    } else this.temporary.set(profile, rules)
    // Do not let an earlier prompt overwrite a later settings edit for this site.
    const revisions = this.revisions.get(profile) || new Map<string, number>()
    revisions.set(rule.origin, this.revision(profile, rule.origin) + 1)
    this.revisions.set(profile, revisions)
    for (const [id, grant] of this.grants) {
      if (grant.profile === profile && grant.origin === rule.origin) {
        grant.capabilities.delete(rule.capability)
        if (!grant.capabilities.size) this.grants.delete(id)
      }
    }
    this.changed()
  }
  release(profile: string) {
    this.temporary.delete(profile)
    this.revisions.delete(profile)
    for (const [id, grant] of this.grants) if (grant.profile === profile) this.grants.delete(id)
  }
  forget(wcId: number) {
    this.grants.delete(wcId)
  }
  private decision(profile: string, origin: string, capability: SiteCapability) {
    return this.list(profile).find((r) => r.origin === origin && r.capability === capability)?.decision
  }
  private granted(wc: WebContents, ctx: PermissionContext, capability: SiteCapability) {
    const decision = this.decision(ctx.profile, ctx.origin, capability)
    if (decision) return decision === 'allow'
    const grant = this.grants.get(wc.id)
    return grant?.token === ctx.token && grant.capabilities.has(capability)
  }
  register(session: Session) {
    session.setPermissionCheckHandler((wc, permission, origin, details) => {
      const ctx = wc && this.context(wc)
      if (
        !wc ||
        !ctx?.valid() ||
        canonicalOrigin(origin) !== ctx.origin ||
        (details.requestingUrl && canonicalOrigin(details.requestingUrl) !== ctx.origin) ||
        (details.embeddingOrigin && canonicalOrigin(details.embeddingOrigin) !== ctx.origin) ||
        (details.securityOrigin && canonicalOrigin(details.securityOrigin) !== ctx.origin)
      )
        return false
      if (permission === 'fullscreen') return true
      const capabilities = requestedCapabilities(permission, details.mediaType ? [details.mediaType] : [])
      return capabilities.length > 0 && capabilities.every((c) => this.granted(wc, ctx, c))
    })
    session.setPermissionRequestHandler((wc, permission, callback, details) => {
      const ctx = this.context(wc)
      if (
        !ctx?.valid() ||
        canonicalOrigin(details.requestingUrl) !== ctx.origin ||
        ('securityOrigin' in details &&
          details.securityOrigin &&
          canonicalOrigin(details.securityOrigin) !== ctx.origin)
      ) {
        callback(false)
        return
      }
      if (permission === 'fullscreen') {
        callback(true)
        return
      }
      const capabilities = requestedCapabilities(
        permission,
        'mediaTypes' in details ? details.mediaTypes : [],
      )
      if (
        !capabilities.length ||
        capabilities.some((c) => this.decision(ctx.profile, ctx.origin, c) === 'block')
      ) {
        callback(false)
        return
      }
      if (capabilities.every((c) => this.granted(wc, ctx, c))) {
        callback(true)
        return
      }
      if (this.pending.has(wc.id)) {
        callback(false)
        return
      }
      this.pending.add(wc.id)
      let finished = false
      const finish = (allowed: boolean) => {
        if (finished) return
        finished = true
        this.pending.delete(wc.id)
        callback(allowed)
      }
      const revision = this.revision(ctx.profile, ctx.origin)
      const needed = capabilities.filter((c) => !this.granted(wc, ctx, c))
      void this.prompt(wc, ctx.origin, needed)
        .then((answer) => {
          if (!ctx.valid() || this.revision(ctx.profile, ctx.origin) !== revision) {
            finish(false)
            return
          }
          if (answer === 'allow' || answer === 'block')
            for (const capability of needed)
              this.edit(ctx.profile, { origin: ctx.origin, capability, decision: answer })
          if (answer === 'once') {
            const previous = this.grants.get(wc.id)
            const granted = previous?.token === ctx.token ? previous.capabilities : new Set<SiteCapability>()
            needed.forEach((c) => granted.add(c))
            this.grants.set(wc.id, {
              token: ctx.token,
              profile: ctx.profile,
              origin: ctx.origin,
              capabilities: granted,
            })
          }
          finish(answer === 'allow' || answer === 'once')
        })
        .catch(() => finish(false))
    })
    session.setDisplayMediaRequestHandler((_request, callback) => callback({}))
  }
}
