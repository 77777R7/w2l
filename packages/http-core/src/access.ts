/**
 * Access normalization: turn a caller's proxy/session config into the
 * credential-free `AccessFact` that goes into the signed compliance record.
 *
 * Zero-dependency, same convention as `compliance.ts` and `gate.ts`: the types
 * below are structural subsets of the contract's, and @w2l/bench asserts
 * assignability at compile time. SHA-256 comes from `hash.ts`, inlined there.
 *
 * The load-bearing rules, all enforced here rather than left to callers:
 *
 *  1. CREDENTIALS NEVER SURVIVE. A proxy password or a cookie value goes in as
 *     input and comes out as a hash. The record is meant to be handed to a
 *     publisher; leaking the user's session cookie in an attestation would be
 *     a breach wearing a compliance record's clothes.
 *
 *  2. USERINFO IN THE URL IS STRIPPED, NOT HONOURED. `http://u:p@host:8080` is
 *     the most common way a credential ends up in a log. We take the endpoint
 *     and drop the rest — and we do NOT silently promote it to the credential
 *     fields, because a caller who put a password in a URL should be told, not
 *     quietly accommodated.
 *
 *  3. NO ATTESTATION, NO TRANSFER. Supplying a proxy or session without an
 *     `AccessAttestation` is rejected. Accepting the user's network while
 *     recording nobody as responsible for it produces a record that proves the
 *     opposite of what it appears to prove.
 */

import { sha256Utf8 } from './hash.js'

// ---------------------------------------------------------------------------
// Structural subsets of @w2l/contracts/access types.
// ---------------------------------------------------------------------------

export type AccessEgressOwner = 'operator' | 'user'
export type AccessSessionOwner = 'none' | 'user'

export interface AccessProxyConfig {
  url: string
  username?: string
  password?: string
}

export interface AccessSessionCookie {
  name: string
  value: string
  domain: string
  path: string
}

export interface AccessSessionConfig {
  cookies?: readonly AccessSessionCookie[]
  storageState?: string
}

export interface AccessAttestationInput {
  principal: string
  at: string
  statement: string
}

export interface AccessConfigInput {
  proxy?: AccessProxyConfig | null
  session?: AccessSessionConfig | null
  attestation?: AccessAttestationInput | null
}

export interface AccessFactShape {
  egressOwner: AccessEgressOwner
  proxyEndpoint: string | null
  proxyCredentialSha256: string | null
  sessionOwner: AccessSessionOwner
  sessionSha256: string | null
  attestedBy: string | null
  attestedAt: string | null
  attestationStatement: string | null
}

export const OPERATOR_ACCESS: AccessFactShape = {
  egressOwner: 'operator',
  proxyEndpoint: null,
  proxyCredentialSha256: null,
  sessionOwner: 'none',
  sessionSha256: null,
  attestedBy: null,
  attestedAt: null,
  attestationStatement: null,
}

// ---------------------------------------------------------------------------
// Rejections
// ---------------------------------------------------------------------------

export type AccessRejection =
  | 'malformed_proxy_url'
  | 'unsupported_proxy_scheme'
  | 'credentials_in_proxy_url'
  | 'missing_attestation'
  | 'empty_session'
  | 'incomplete_attestation'

export class AccessConfigError extends Error {
  constructor(readonly rejection: AccessRejection, message: string) {
    super(message)
    this.name = 'AccessConfigError'
  }
}

/** Proxy schemes we will route through. */
const PROXY_SCHEMES = new Set(['http:', 'https:', 'socks5:', 'socks4:'])

function hash(s: string): string {
  return sha256Utf8(s)
}

/**
 * `scheme://host:port`, with userinfo, path, query and fragment discarded.
 * Throws when the URL carries credentials: see rule 2 in the header.
 */
export function normalizeProxyEndpoint(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new AccessConfigError('malformed_proxy_url', `Proxy URL is not a valid URL: ${raw}`)
  }
  if (!PROXY_SCHEMES.has(url.protocol)) {
    throw new AccessConfigError(
      'unsupported_proxy_scheme',
      `Proxy scheme ${url.protocol} is not supported (http, https, socks4, socks5).`,
    )
  }
  if (url.username !== '' || url.password !== '') {
    throw new AccessConfigError(
      'credentials_in_proxy_url',
      'Proxy credentials must be passed as username/password fields, not embedded ' +
        'in the URL — a URL with userinfo leaks the password into every log line ' +
        'that prints the endpoint.',
    )
  }
  const port = url.port === '' ? '' : `:${url.port}`
  return `${url.protocol}//${url.hostname}${port}`
}

/**
 * Canonical session material for hashing: cookies sorted by (domain, path,
 * name) so the same session hashes identically regardless of the order the
 * caller listed them, and storageState appended verbatim.
 */
function sessionMaterial(session: AccessSessionConfig): string {
  const parts: string[] = []
  const cookies = [...(session.cookies ?? [])].sort((a, b) => {
    if (a.domain !== b.domain) return a.domain < b.domain ? -1 : 1
    if (a.path !== b.path) return a.path < b.path ? -1 : 1
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
  for (const c of cookies) parts.push(`${c.domain}\u0000${c.path}\u0000${c.name}\u0000${c.value}`)
  if (session.storageState !== undefined) parts.push(`storageState\u0000${session.storageState}`)
  return parts.join('\u0001')
}

function hasSessionMaterial(session: AccessSessionConfig): boolean {
  return (session.cookies?.length ?? 0) > 0 || (session.storageState ?? '').length > 0
}

/**
 * Normalize a caller's access config into the fact that goes in the record.
 *
 * Throws `AccessConfigError` rather than degrading quietly: every rejection
 * here is a case where proceeding would produce a record that misstates who is
 * responsible, and a misleading attestation is worse than no attestation.
 */
export function normalizeAccessConfig(config: AccessConfigInput | null | undefined): AccessFactShape {
  if (!config) return { ...OPERATOR_ACCESS }

  const proxy = config.proxy ?? null
  const session = config.session ?? null
  const usesUserAccess = proxy !== null || (session !== null && hasSessionMaterial(session))

  if (session !== null && !hasSessionMaterial(session)) {
    throw new AccessConfigError(
      'empty_session',
      'A session was supplied with no cookies and no storageState. An empty ' +
        'session would be recorded as user-owned access that carries nothing.',
    )
  }

  if (!usesUserAccess) return { ...OPERATOR_ACCESS }

  const attestation = config.attestation ?? null
  if (attestation === null) {
    throw new AccessConfigError(
      'missing_attestation',
      'Using your proxy or session moves responsibility for these fetches to ' +
        'you: your address is what the publisher sees, your account is what ' +
        'their terms bind. That transfer is recorded in the signed compliance ' +
        'record, so it requires an explicit attestation.',
    )
  }
  for (const [field, value] of Object.entries(attestation)) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new AccessConfigError(
        'incomplete_attestation',
        `Attestation field "${field}" is empty. A record naming nobody proves nothing.`,
      )
    }
  }

  let proxyEndpoint: string | null = null
  let proxyCredentialSha256: string | null = null
  if (proxy !== null) {
    proxyEndpoint = normalizeProxyEndpoint(proxy.url)
    const user = proxy.username ?? ''
    const pass = proxy.password ?? ''
    if (user !== '' || pass !== '') proxyCredentialSha256 = hash(`${user}\u0000${pass}`)
  }

  return {
    egressOwner: proxy !== null ? 'user' : 'operator',
    proxyEndpoint,
    proxyCredentialSha256,
    sessionOwner: session !== null ? 'user' : 'none',
    sessionSha256: session !== null ? hash(sessionMaterial(session)) : null,
    attestedBy: attestation.principal,
    attestedAt: attestation.at,
    attestationStatement: attestation.statement,
  }
}

/**
 * Does this fact describe access the user owns? Used by the record verifier
 * and by callers deciding whose problem a block is.
 */
export function isUserAccess(fact: AccessFactShape): boolean {
  return fact.egressOwner === 'user' || fact.sessionOwner === 'user'
}

/**
 * A record claiming user access must name who accepted it. Returns the
 * violations rather than a boolean, so a verifier can report which invariant
 * broke instead of just that something did.
 */
export function verifyAccessFact(fact: AccessFactShape): readonly string[] {
  const problems: string[] = []
  const attested = fact.attestedBy !== null && fact.attestedAt !== null
  if (isUserAccess(fact) && !attested) {
    problems.push('user-owned access with no attestation: responsibility transfer is unproven')
  }
  if (!isUserAccess(fact) && attested) {
    problems.push('operator-owned access carries an attestation: nobody was asked to accept it')
  }
  if (fact.egressOwner === 'user' && fact.proxyEndpoint === null) {
    problems.push('egress claimed user-owned but no proxy endpoint recorded')
  }
  if (fact.egressOwner === 'operator' && fact.proxyEndpoint !== null) {
    problems.push('operator egress carries a proxy endpoint')
  }
  if (fact.sessionOwner === 'user' && fact.sessionSha256 === null) {
    problems.push('session claimed user-owned but no session hash recorded')
  }
  if (fact.sessionOwner === 'none' && fact.sessionSha256 !== null) {
    problems.push('no session claimed but a session hash is present')
  }
  return problems
}
