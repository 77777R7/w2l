/**
 * The single canonical result status. There is no second enum.
 *
 * Resolution of the earlier empty_legit/empty_suspicious vs empty_verified/partial
 * conflict: a suspected-bad empty result is `failed` with reason `empty_unverified`,
 * not a status of its own. Only *proven* emptiness gets a status.
 */
export const RESULT_STATUS = [
  'success',
  'partial',
  'empty_verified',
  'blocked',
  'failed',
  'cancelled',
  'budget_exceeded',
] as const

export type ResultStatus = (typeof RESULT_STATUS)[number]

/** Statuses that carry usable extracted content. */
export const CONTENTFUL_STATUS: ReadonlySet<ResultStatus> = new Set<ResultStatus>([
  'success',
  'partial',
])

export const FAILURE_REASON = [
  'empty_unverified',
  'timeout',
  'dns_error',
  'connection_error',
  'tls_error',
  'http_error',
  'redirect_limit',
  'redirect_loop',
  'body_too_large',
  'decompressed_too_large',
  'unsupported_content_type',
  'parse_error',
  'loop_detected',
  'policy_denied',
  'provider_error',
  'internal_error',
] as const

export type FailureReason = (typeof FAILURE_REASON)[number]

export const BLOCK_REASON = [
  'cloudflare_challenge',
  'captcha',
  'rate_limit',
  'login_wall',
  'geo_restricted',
  'bot_detected_generic',
] as const

export type BlockReason = (typeof BLOCK_REASON)[number]

export const BUDGET_KIND = ['tokens', 'time', 'cost', 'pages', 'retries'] as const
export type BudgetKind = (typeof BUDGET_KIND)[number]

/** Execution tiers of the escalation ladder (PHASE1_ENGINEERING_NOTES §2.5). */
export const LANE = [
  'http',
  'browser_local',
  'browser_local_authed',
  'browser_proxy',
  'provider',
] as const

export type Lane = (typeof LANE)[number]

/**
 * Public canary benchmarks only evaluate these lanes. Authenticated and
 * proxied/provider lanes are reported separately with owned test accounts.
 */
export const PUBLIC_CANARY_LANES: readonly Lane[] = ['http', 'browser_local']

export function isPublicCanaryLane(lane: Lane): boolean {
  return PUBLIC_CANARY_LANES.includes(lane)
}
