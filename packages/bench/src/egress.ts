import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { LookupFunction } from 'node:net'
import { Agent } from 'undici'
import {
  evaluateResolved,
  evaluateHostname,
  evaluateUrl,
  localNetworkPolicy,
  type NetworkPolicy,
} from '@w2l/contracts'

export class SsrfDeniedError extends Error {
  override readonly name = 'SsrfDeniedError'
  constructor(
    readonly url: string,
    readonly detail: string,
  ) {
    super(`ssrf denied ${url}: ${detail}`)
  }
}

export class BodyTooLargeError extends Error {
  override readonly name = 'BodyTooLargeError'
  constructor(maxBytes: number) {
    super(`body exceeded ${maxBytes} bytes`)
  }
}

export function defaultNetworkPolicy(): NetworkPolicy {
  return localNetworkPolicy()
}

// Only these fixed, platform-owned hosts may use the local review proxy.
// Arbitrary visitor domains keep the DNS-pinned direct dispatcher.
const LOCAL_PREVIEW_PROXY_HOSTS = new Set([
  'reddit.com', 'www.reddit.com', 'old.reddit.com',
  'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com',
])

export function isLocalPreviewProxyTarget(input: string): boolean {
  try {
    const url = new URL(input)
    return url.protocol === 'https:' && url.port === '' && LOCAL_PREVIEW_PROXY_HOSTS.has(url.hostname.toLowerCase())
  } catch { return false }
}

/** A public visitor cannot choose egress. The local review process may use
 * its operator's existing loopback HTTP proxy for fixed platform hosts. */
export function validateLocalPreviewProxy(input: string): string {
  let url: URL
  try { url = new URL(input) } catch { throw new Error('Local preview proxy URL is invalid') }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Local preview proxy must be an unauthenticated loopback HTTP URL with a port')
  }
  return url.origin
}

type ResolvedAddress = { address: string; family: number }
type Resolver = (hostname: string, options: { all: true }) => Promise<ResolvedAddress[]>

/**
 * Chromium does not use Undici's socket lookup. In the hosted browser mode,
 * resolve the finite operator allowlist once and force Chromium's resolver to
 * use only those validated IPs. Everything else must fail name resolution.
 */
export async function pinnedBrowserHostRules(hosts: readonly string[], policy: NetworkPolicy, resolve: Resolver = lookup): Promise<string> {
  if (hosts.length === 0) throw new SsrfDeniedError('browser', 'host allowlist is empty')
  const rules: string[] = []
  const seen = new Set<string>()
  for (const input of hosts) {
    let hostname: string
    try {
      const parsed = new URL(`https://${input}/`)
      hostname = parsed.hostname.toLowerCase()
      if (parsed.host !== hostname || !/^[a-z0-9.-]+$/.test(hostname) || input.toLowerCase() !== hostname) throw new Error('invalid host')
    } catch { throw new SsrfDeniedError('browser', 'invalid allowed host') }
    if (seen.has(hostname)) continue
    seen.add(hostname)
    const literal = evaluateHostname(hostname, policy)
    let pinned: string | null = null
    if (literal !== null) {
      if (!literal.allowed) throw new SsrfDeniedError(hostname, literal.detail ?? literal.violation ?? 'denied')
      pinned = literal.pinnedAddress
    } else {
      let records: ResolvedAddress[]
      try { records = await resolve(hostname, { all: true }) }
      catch (error) { throw new SsrfDeniedError(hostname, error instanceof Error ? error.message : 'dns lookup failed') }
      const decision = evaluateResolved(hostname, records.map(record => record.address), policy)
      if (!decision.allowed) throw new SsrfDeniedError(hostname, decision.detail ?? decision.violation ?? 'denied')
      pinned = records.find(record => isIP(record.address) === 4)?.address ?? decision.pinnedAddress
    }
    if (pinned === null) throw new SsrfDeniedError(hostname, 'no validated address')
    rules.push(`MAP ${hostname} ${isIP(pinned) === 6 ? `[${pinned}]` : pinned}`)
  }
  // Chromium's rule parser applies the first matching rule. This catch-all
  // prevents DNS prefetch and unanticipated network loads from escaping.
  return [...rules, 'MAP * ~NOTFOUND'].join(', ')
}

/**
 * Validate the addresses at the socket lookup, then hand Node only the
 * validated address. A separate URL preflight cannot prevent DNS rebinding
 * between validation and connect.
 */
export function createGuardedDispatcher(policy: NetworkPolicy, resolve: Resolver = lookup): Agent {
  const safeLookup: LookupFunction = (hostname, options, callback) => {
    const wantedFamily = options.family === 4 || options.family === 'IPv4' ? 4
      : options.family === 6 || options.family === 'IPv6' ? 6 : 0
    const decision = evaluateHostname(hostname, policy)
    if (decision !== null) {
      if (!decision.allowed || decision.pinnedAddress === null) {
        callback(new SsrfDeniedError(hostname, decision.detail ?? decision.violation ?? 'denied'), '')
        return
      }
      const selected = { address: decision.pinnedAddress, family: isIP(decision.pinnedAddress) }
      if (wantedFamily !== 0 && selected.family !== wantedFamily) {
        callback(new SsrfDeniedError(hostname, 'no allowed address for requested IP family'), '')
        return
      }
      callback(null, options.all ? [selected] : selected.address, selected.family)
      return
    }
    const normalizedHostname = hostname.replace(/^\[|\]$/g, '').toLowerCase()
    void resolve(normalizedHostname, { all: true }).then((records) => {
      const verdict = evaluateResolved(normalizedHostname, records.map(record => record.address), policy)
      if (!verdict.allowed || verdict.pinnedAddress === null) {
        callback(new SsrfDeniedError(hostname, verdict.detail ?? verdict.violation ?? 'denied'), '')
        return
      }
      const selected = records.find(record => wantedFamily === 0 || isIP(record.address) === wantedFamily)
      if (selected === undefined) {
        callback(new SsrfDeniedError(hostname, 'no allowed address for requested IP family'), '')
        return
      }
      const pinned = { address: selected.address, family: isIP(selected.address) }
      callback(null, options.all ? [pinned] : pinned.address, pinned.family)
    }).catch((error: unknown) => {
      callback(new SsrfDeniedError(hostname, error instanceof Error ? error.message : 'dns lookup failed'), '')
    })
  }
  return new Agent({
    connect: { lookup: safeLookup },
    keepAliveTimeout: 1_000,
    keepAliveMaxTimeout: 1_000,
  })
}

export async function assertSafeUrl(url: string, policy: NetworkPolicy): Promise<void> {
  const first = evaluateUrl(url, policy)
  if ('allowed' in first) {
    if (!first.allowed) throw new SsrfDeniedError(url, first.detail ?? first.violation ?? 'denied')
    return
  }
  let records: readonly { address: string }[]
  try {
    records = await lookup(first.hostname, { all: true })
  } catch (err) {
    throw new SsrfDeniedError(url, err instanceof Error ? err.message : 'dns lookup failed')
  }
  const decision = evaluateResolved(
    first.hostname,
    records.map((record) => record.address),
    policy,
  )
  if (!decision.allowed) throw new SsrfDeniedError(url, decision.detail ?? decision.violation ?? 'denied')
}

export async function readCappedBody(body: AsyncIterable<unknown>, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let n = 0
  for await (const chunk of body) {
    const buf = chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk))
    n += buf.byteLength
    if (n > maxBytes) throw new BodyTooLargeError(maxBytes)
    chunks.push(buf)
  }
  const out = new Uint8Array(n)
  let off = 0
  for (const chunk of chunks) {
    out.set(chunk, off)
    off += chunk.byteLength
  }
  return out
}
