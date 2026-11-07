/** Cookie scope is a host/domain, not an origin or a port. */
export function cookieAppliesToHost(cookie: { domain?: string; hostOnly?: boolean }, hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, ''),
    domain = cookie.domain
      ?.toLowerCase()
      .replace(/^\./, '')
      .replace(/^\[|\]$/g, '')
  if (!domain) return false
  if (host === domain) return true
  if (cookie.hostOnly || host.includes(':') || /^[\d.]+$/.test(host)) return false
  return host.endsWith(`.${domain}`)
}
