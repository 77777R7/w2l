/**
 * Governance: the policy that decides what the escalation ladder may do.
 *
 * Three guards, all applied BEFORE a channel runs:
 *
 *  1. Mode. `public` means HTTP + local browser only, on public pages. The
 *     more capable channels (vendor, authed session, handoff) exist for
 *     higher modes (`assisted`, `authed`) and cannot be reached otherwise.
 *
 *  2. Domain allowlist. When the policy carries allowlistedDomains, a URL
 *     whose host is not on it is refused before any network work. The
 *     allowlist is checked against the exact host (with a wildcard prefix
 *     form), not a substring — "example.com" must not authorize
 *     "example.com.evil.net".
 *
 *  3. Audit. Every escalation the ladder performs is reported through the
 *     FetchResult trace as an `audit` event, so the decision trail is part of
 *     the same signed record as the fetch itself. Governance without a trail
 *     is a policy statement; with it, it is a fact a publisher can verify.
 */

// Structural subset of the contract's `CrawlMode`, http-core convention:
// zero dependency on @w2l/contracts; @w2l/bench asserts assignability.
// 'standard' maps to public-only, 'research' may assist, 'authed' may take
// user sessions and hand off to a human.
export type GovernedMode = 'standard' | 'research' | 'authed'

/** Which channels a mode permits. */
export const MODE_CHANNELS: Readonly<Record<GovernedMode, readonly string[]>> = {
  standard: ['http', 'browser_local'],
  research: ['http', 'browser_local', 'provider'],
  authed: ['http', 'browser_local', 'provider', 'authed_session', 'handoff'],
}

export interface CrawlPolicy {
  mode: GovernedMode
  /**
   * Hosts the run is authorized to touch. Empty = no restriction (the
   * caller's own judgment); non-empty = exact host or `*.example.com`
   * wildcard. Checked per request, before robots even.
   */
  allowlistedDomains?: readonly string[]
}

export const PUBLIC_POLICY: CrawlPolicy = { mode: 'standard' }

export interface GovernanceDecision {
  allowed: boolean
  /** Channel names permitted for this URL under the current policy. */
  permittedChannels: readonly string[]
  /** Human-readable reason for a refusal, verbatim for the record. */
  reason: string | null
}

/**
 * Match a host against an allowlist entry. Exact or `*.domain` wildcard.
 * Substring matching is deliberately NOT used: a list is an authorization,
 * and authorizations must not be fuzzy.
 */
export function hostMatchesAllowlist(host: string, entry: string): boolean {
  const h = host.toLowerCase()
  const normalized = entry.toLowerCase()
  if (normalized.startsWith('*.')) {
    const suffix = normalized.slice(1) // ".example.com"
    return h === normalized.slice(2) || h.endsWith(suffix)
  }
  return h === normalized
}

/**
 * Decide whether `url` may be fetched under `policy`, and through which
 * channels. Pure function — the ladder calls it before any network work and
 * records the decision in the trace.
 */
export function evaluateGovernance(url: string, policy: CrawlPolicy): GovernanceDecision {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return { allowed: false, permittedChannels: [], reason: `malformed url: ${url}` }
  }

  const list = policy.allowlistedDomains ?? []
  if (list.length > 0 && !list.some((entry) => hostMatchesAllowlist(host, entry))) {
    return {
      allowed: false,
      permittedChannels: [],
      reason: `host ${host} is not on the domain allowlist`,
    }
  }

  const permitted = MODE_CHANNELS[policy.mode]
  if (permitted === undefined) {
    return { allowed: false, permittedChannels: [], reason: `unknown mode: ${policy.mode}` }
  }

  return { allowed: true, permittedChannels: permitted, reason: null }
}
