/**
 * Canonical failure classification for ROUTING decisions.
 *
 * The contract's `BlockReason` and `FailureReason` are fine-grained facts for
 * the compliance record ("which Cloudflare signal fired"). This module is the
 * coarse, stable taxonomy the escalation ladder routes on: seven classes that
 * every channel (HTTP, local browser, vendor, authed session) reports into.
 *
 * Why a second taxonomy exists at all: routing needs a decision ("try the
 * browser now", "this vendor is broken, try the other", "a human must look")
 * and those decisions must not change every time a new vendor header is
 * discovered. Seven classes, fixed, one pure mapping function.
 *
 * CHALLENGE PAGES ARE NEVER SUCCESS. `classifyFetchFailure` only runs on
 * non-contentful results; a challenge page that slips through as contentful
 * is caught by the false-success checks (challenge_text_returned), not here.
 * This classifier exists to route failures correctly, not to launder them.
 */

// ---------------------------------------------------------------------------
// Structural subset (http-core stays zero-dependency: same convention as
// GateBlockReason / ResilientFailureReason; @w2l/bench asserts assignability)
// ---------------------------------------------------------------------------

/** Structural subset of the contract's `FetchResult`. */
export interface RoutableFetchResult {
  status: string
  blockReason: string | null
  failureReason: string | null
  trace: readonly { lane: string; event: string; detail?: Record<string, unknown> }[]
}

export const ROUTING_FAILURE_CLASS = [
  'bot_gate',
  'captcha_required',
  'login_required',
  'rate_limited',
  'geo_blocked',
  'provider_error',
  'identity_mismatch',
] as const

export type RoutingFailureClass = (typeof ROUTING_FAILURE_CLASS)[number]

/**
 * Whether a class means "the answer is a capability we have" (escalatable)
 * versus "the answer is someone else's responsibility" (terminal for the
 * ladder, and the honest report to the user).
 */
export const ESCALATABLE_FAILURE_CLASS: ReadonlySet<RoutingFailureClass> = new Set([
  'bot_gate',
  'captcha_required',
  'login_required',
  'geo_blocked',
])

export const VENDOR_LEVEL_FAILURE_CLASS: ReadonlySet<RoutingFailureClass> = new Set([
  'provider_error',
  'identity_mismatch',
])

/**
 * Classes that keep the ladder walking. Vendor-level failures are
 * escalatable in a different sense: the answer is not "a stronger lane" but
 * "the other vendor" — both keep the loop moving, so the ladder treats them
 * the same and the vendor router decides which one applies.
 */
export const LADDER_CONTINUES_FAILURE_CLASS: ReadonlySet<RoutingFailureClass> = new Set([
  ...ESCALATABLE_FAILURE_CLASS,
  ...VENDOR_LEVEL_FAILURE_CLASS,
])

/**
 * Map a finished fetch result to one of the seven classes. Order matters:
 * identity_mismatch first (it is a finding about the channel, not the site),
 * provider_error second, then the block reasons.
 */
export function classifyFetchFailure(result: RoutableFetchResult): RoutingFailureClass | null {
  if (result.status === 'success' || result.status === 'partial' || result.status === 'empty_verified') {
    return null // nothing to route on
  }

  if (result.trace.some((t) => t.event === 'identity_mismatch')) return 'identity_mismatch'
  if (result.failureReason === 'provider_error') return 'provider_error'

  switch (result.blockReason) {
    case 'cloudflare_challenge':
    case 'bot_detected_generic':
      return 'bot_gate'
    case 'captcha':
      return 'captcha_required'
    case 'login_wall':
      return 'login_required'
    case 'rate_limit':
      return 'rate_limited'
    case 'geo_restricted':
      return 'geo_blocked'
    default:
      break
  }

  // Infrastructure failures (timeout, dns, connection, tls, http_error) have
  // no routing class: the ladder's answer is retry-at-same-level, not
  // escalation. Null means exactly that, and the router reports it as such.
  return null
}
