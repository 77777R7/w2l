/**
 * Gate classification: decide whether a non-contentful response is a *block*
 * — an access gate the site deliberately put in the way — rather than a plain
 * failure, and name which gate it is.
 *
 * Why this exists: `failed/http_error` and `blocked/<reason>` are very
 * different facts for the caller. The first says "something went wrong, a
 * retry might help"; the second says "the site refused you, and here is the
 * legitimate way in". Collapsing every gate into `http_error` makes a bot wall
 * indistinguishable from a 500, which is precisely the observability the
 * product claims to sell.
 *
 * PRECONDITION — this is what keeps the marker matching safe: `classifyGate`
 * is only consulted for responses that are *already* non-contentful (non-200,
 * or 200 whose extraction escalated). A normal article that happens to carry a
 * login modal or an embedded captcha widget extracts successfully and never
 * reaches this function, so "password field present" can be read as evidence
 * about the page's purpose rather than about one widget on it.
 *
 * Honesty rules, mirroring the page-type router's signal discipline:
 *  - a status code alone is only decisive where the code *means* the gate
 *    (429 rate limit, 451 legal, 401 auth). A bare 403 is NOT enough — it is
 *    indistinguishable from an ordinary permission error, so it classifies as
 *    nothing on its own and the caller keeps reporting `http_error`.
 *  - otherwise a strong vendor/interstitial signal is required, or two weak
 *    signals, or one weak signal plus a gate-shaped status.
 *  - every verdict carries the list of signals that fired, so the claim is
 *    auditable rather than asserted.
 *
 * Vendor attribution from page copy is weaker than a vendor header, and the
 * verdict's `signals` say which one applied. Misattributing one vendor for
 * another is cheap here: the escalation path for every JS interstitial is the
 * same. Claiming a gate where there is none is not cheap, which is why the
 * thresholds above lean conservative.
 *
 * Pure logic, no I/O, no dependency on the contracts package (see
 * `ResilientFailureReason` for the same convention): the union below is a
 * structural subset of the contract's `BlockReason`, and the subject layer's
 * assignment is the compile-time drift detector.
 */

/** Structural subset of the contract's `BlockReason`. */
export type GateBlockReason =
  | 'cloudflare_challenge'
  | 'captcha'
  | 'rate_limit'
  | 'login_wall'
  | 'geo_restricted'
  | 'bot_detected_generic'

/** Structural subset of the contract's `Lane`. */
export type GateLane = 'http' | 'browser_local' | 'browser_local_authed' | 'browser_proxy' | 'provider'

export interface GateResponse {
  /** Response status, or null when no response arrived (transport error). */
  status: number | null
  /** Case-insensitive single-value header lookup; null when absent. */
  header: (name: string) => string | null
  /** Response body text. May be empty. */
  body: string
}

export interface GateVerdict {
  reason: GateBlockReason
  /** Every signal that fired, in the order checked. Never empty. */
  signals: readonly string[]
}

/**
 * Only the head of the body is inspected. Gate pages are small and put their
 * markers early; this bounds the cost of lower-casing a multi-megabyte body.
 */
const HEAD_BYTES = 65_536

/** Vendor headers that identify a bot-management product outright. */
const VENDOR_HEADERS: readonly (readonly [name: string, reason: GateBlockReason, signal: string])[] = [
  ['cf-mitigated', 'cloudflare_challenge', 'header_cf_mitigated'],
  ['x-datadome', 'bot_detected_generic', 'header_x_datadome'],
  ['x-datadome-cid', 'bot_detected_generic', 'header_x_datadome_cid'],
  ['x-iinfo', 'bot_detected_generic', 'header_x_iinfo_imperva'],
  ['x-kasada-classification', 'bot_detected_generic', 'header_x_kasada'],
  ['x-sucuri-block', 'bot_detected_generic', 'header_x_sucuri_block'],
]

/** Cloudflare's managed-challenge plumbing. Any one of these is decisive. */
const CF_STRONG_MARKERS: readonly (readonly [marker: string, signal: string])[] = [
  ['/cdn-cgi/challenge-platform', 'cf_challenge_platform_script'],
  ['__cf_chl', 'cf_challenge_var'],
  ['cf_chl_opt', 'cf_challenge_opt'],
  ['cf-browser-verification', 'cf_browser_verification'],
  ['attention required! | cloudflare', 'cf_attention_required'],
]

/**
 * Cloudflare's managed-challenge interstitial copy. The pair is distinctive
 * enough to name the vendor; either half alone is only a weak signal.
 */
const CF_INTERSTITIAL_PAIR: readonly [string, string] = [
  'just a moment',
  'enable javascript and cookies',
]

/** Interactive human-verification widgets. Require a person, not a lane. */
const CAPTCHA_MARKERS: readonly (readonly [marker: string, signal: string])[] = [
  ['g-recaptcha', 'widget_recaptcha'],
  ['recaptcha/api.js', 'widget_recaptcha_api'],
  ['grecaptcha.', 'widget_recaptcha_js'],
  ['hcaptcha.com', 'widget_hcaptcha'],
  ['h-captcha', 'widget_hcaptcha_class'],
  ['cf-turnstile', 'widget_turnstile'],
  ['challenges.cloudflare.com/turnstile', 'widget_turnstile_script'],
  ['funcaptcha', 'widget_funcaptcha'],
  ['arkoselabs', 'widget_arkose'],
  ['data-sitekey', 'widget_sitekey'],
]

/** Phrases that make a login the page's purpose rather than one of its widgets. */
const LOGIN_INTENT_PHRASES: readonly string[] = [
  'sign in to continue',
  'sign in to read',
  'sign in to view',
  'log in to continue',
  'login to continue',
  'please sign in',
  'please log in',
  'subscribe to continue',
  'create an account to continue',
  'members only',
  'login required',
  'you must be logged in',
]

const PASSWORD_INPUT = /<input[^>]+type\s*=\s*["']?password/i
const TITLE_OR_H1 = /<(?:title|h1)\b[^>]*>([\s\S]{0,200}?)<\/(?:title|h1)>/gi
const BARE_LOGIN_HEADING = /^\s*(?:sign|log)\s*-?\s*in\b/i

const GEO_MARKERS: readonly (readonly [marker: string, signal: string])[] = [
  ['not available in your country', 'geo_not_in_country'],
  ['not available in your region', 'geo_not_in_region'],
  ['not available in your location', 'geo_not_in_location'],
  ['unavailable in your country', 'geo_unavailable_country'],
  ['european economic area', 'geo_eea_block'],
  ['due to legal reasons', 'geo_legal_reasons'],
]

/** Any one of these names a refusal outright. */
const BOT_STRONG_MARKERS: readonly (readonly [marker: string, signal: string])[] = [
  ['you have been blocked', 'text_you_have_been_blocked'],
  ['request unsuccessful. incapsula incident', 'text_incapsula_incident'],
  ['pardon our interruption', 'text_pardon_our_interruption'],
  ['unusual traffic from your computer network', 'text_unusual_traffic'],
  ['automated queries', 'text_automated_queries'],
  ['are you a robot', 'text_are_you_a_robot'],
  ['verify you are human', 'text_verify_you_are_human'],
  ['verifying you are human', 'text_verifying_you_are_human'],
  ['bot detected', 'text_bot_detected'],
  ['humans only', 'text_humans_only'],
]

/** Suggestive but not decisive: two of these, or one plus a gate-shaped status. */
const BOT_WEAK_MARKERS: readonly (readonly [marker: string, signal: string])[] = [
  ['just a moment', 'weak_just_a_moment'],
  ['please wait', 'weak_please_wait'],
  ['checking your browser', 'weak_checking_your_browser'],
  ['enable javascript and cookies', 'weak_enable_js_and_cookies'],
  ['enable javascript', 'weak_enable_javascript'],
  ['ddos protection', 'weak_ddos_protection'],
  ['security check', 'weak_security_check'],
  ['access denied', 'weak_access_denied'],
  ['access to this page has been denied', 'weak_access_to_page_denied'],
]

/**
 * Statuses that corroborate a single weak marker. 403 is here rather than in
 * the decisive set for exactly the reason stated above: alone it means nothing.
 */
const GATE_SHAPED_STATUS: readonly number[] = [403, 429, 503]

function matched(
  haystack: string,
  table: readonly (readonly [string, string])[],
): string[] {
  const hits: string[] = []
  for (const [marker, signal] of table) {
    if (haystack.includes(marker)) hits.push(signal)
  }
  return hits
}

function headingTexts(body: string): string[] {
  const out: string[] = []
  for (const m of body.matchAll(TITLE_OR_H1)) {
    const text = m[1]?.replace(/<[^>]*>/g, ' ').trim()
    if (text) out.push(text)
  }
  return out
}

/**
 * Classify a non-contentful response as a specific block, or return null when
 * the evidence does not support any gate claim (the caller then keeps
 * reporting the plain failure it already had).
 */
export function classifyGate(res: GateResponse): GateVerdict | null {
  // No response at all means a transport error, not a gate. Nothing to read.
  if (res.status === null) return null

  const head = res.body.slice(0, HEAD_BYTES)
  const lower = head.toLowerCase()

  // --- statuses whose meaning *is* the gate -------------------------------
  if (res.status === 429) {
    return { reason: 'rate_limit', signals: ['status_429'] }
  }
  if (res.status === 451) {
    return { reason: 'geo_restricted', signals: ['status_451'] }
  }
  if (res.status === 401) {
    return { reason: 'login_wall', signals: ['status_401'] }
  }

  // --- vendor headers: decisive, no body evidence needed ------------------
  for (const [name, reason, signal] of VENDOR_HEADERS) {
    if (res.header(name) !== null) return { reason, signals: [signal] }
  }

  // --- Cloudflare managed challenge --------------------------------------
  const cfStrong = matched(lower, CF_STRONG_MARKERS)
  if (cfStrong.length > 0) {
    return { reason: 'cloudflare_challenge', signals: cfStrong }
  }
  const [cfA, cfB] = CF_INTERSTITIAL_PAIR
  if (lower.includes(cfA) && lower.includes(cfB)) {
    return { reason: 'cloudflare_challenge', signals: ['cf_interstitial_text'] }
  }

  // --- interactive captcha widget ----------------------------------------
  // Reached only when no Cloudflare managed-challenge marker fired, so a
  // Turnstile hit here is a site that embedded the widget itself. A widget
  // needs a person, which is a different escalation than a JS interstitial.
  const captcha = matched(lower, CAPTCHA_MARKERS)
  if (captcha.length > 0) {
    return { reason: 'captcha', signals: captcha }
  }

  // --- login wall ---------------------------------------------------------
  const headings = headingTexts(head).map((h) => h.toLowerCase())
  const loginPhrases = LOGIN_INTENT_PHRASES.filter((p) => lower.includes(p))
  const bareLoginHeading = headings.some((h) => BARE_LOGIN_HEADING.test(h))
  if (PASSWORD_INPUT.test(head) && (loginPhrases.length > 0 || bareLoginHeading)) {
    const signals = ['input_password']
    if (loginPhrases.length > 0) signals.push(`text_${loginPhrases[0]!.replace(/\s+/g, '_')}`)
    if (bareLoginHeading) signals.push('heading_sign_in')
    return { reason: 'login_wall', signals }
  }

  // --- geo restriction ----------------------------------------------------
  const geo = matched(lower, GEO_MARKERS)
  if (geo.length > 0) {
    return { reason: 'geo_restricted', signals: geo }
  }

  // --- generic bot gate ---------------------------------------------------
  const botStrong = matched(lower, BOT_STRONG_MARKERS)
  if (botStrong.length > 0) {
    return { reason: 'bot_detected_generic', signals: botStrong }
  }
  const botWeak = matched(lower, BOT_WEAK_MARKERS)
  const gateShaped = GATE_SHAPED_STATUS.includes(res.status)
  if (botWeak.length >= 2 || (botWeak.length === 1 && gateShaped)) {
    const signals = [...botWeak]
    if (gateShaped) signals.push(`status_${res.status}`)
    return { reason: 'bot_detected_generic', signals }
  }

  // A 202 is never a legitimate answer to a page GET. It is the shape a gate
  // uses to swallow a request without admitting to it (Amazon returns it with
  // an empty or near-empty document to bot-shaped clients). The body check
  // would be redundant here: even a rendered skeleton over a 202 is the gate's
  // page, not the target's content.
  if (res.status === 202) {
    return { reason: 'bot_detected_generic', signals: ['status_202'] }
  }

  return null
}

export interface GateEscalation {
  from: GateLane
  to: GateLane
  trigger: string
}

/**
 * The legitimate next lane for a given gate, or null when no lane we offer
 * would honestly help. Null is a first-class answer here: telling the caller
 * "nothing we have clears this" is the product's claim, and inventing an
 * escalation that cannot work would break it.
 *
 * Note what is deliberately absent: no path routes through defeating the gate
 * (solving the captcha, rotating IPs to evade a ban, patching the automation
 * fingerprint). Every target below is either more capability we legitimately
 * have (a real browser), the user's own access (their session), or the user's
 * own network (their proxy).
 */
export function escalationForBlock(
  reason: GateBlockReason,
  from: GateLane,
): GateEscalation | null {
  const trigger = `blocked:${reason}`
  const to = nextLane(reason, from)
  return to === null ? null : { from, to, trigger }
}

function nextLane(reason: GateBlockReason, from: GateLane): GateLane | null {
  switch (reason) {
    // Slowing down is the fix; no lane clears a rate limit, and pretending
    // otherwise would just move the hammering to a more expensive lane.
    case 'rate_limit':
      return null

    // A JS interstitial can be cleared by actually running the JS, and failing
    // that by arriving from an IP with reputation the user owns.
    case 'cloudflare_challenge':
    case 'bot_detected_generic':
      if (from === 'http') return 'browser_local'
      if (from === 'browser_local') return 'browser_proxy'
      return null

    // Needs a human. The user has one; we hand off and reuse the session.
    case 'captcha':
    case 'login_wall':
      return from === 'browser_local_authed' ? null : 'browser_local_authed'

    // The user's own proxy in the right region is the legitimate answer.
    case 'geo_restricted':
      return from === 'browser_proxy' ? null : 'browser_proxy'
  }
}
