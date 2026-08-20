/**
 * Resilient HTTP engine: redirect following and 503 retry as pure logic
 * over an injected fetcher. No network I/O of its own, no undici import —
 * the subject layer supplies the transport so this stays unit-testable
 * with a scripted mock and the fixture suite exercises it over real bytes.
 *
 * Scope (v1, fixture-driven):
 *  - follow 3xx chains within maxRedirects, record every visited URL
 *  - detect redirect loops via a per-attempt seen set
 *  - allow http/https targets only; anything else is policy_denied
 *  - retry ONLY a 503 response (the flaky fixture shape), at most
 *    maxRetries times; 429 and every other status never retry
 *  - honour Retry-After (integer seconds) capped at retryAfterCapMs
 *  - map thrown transport errors by name: undici HeadersTimeoutError /
 *    BodyTimeoutError -> timeout, everything else -> connection_error
 *
 * Counting semantics: `attemptCount` counts logical attempts (the outer
 * loop; one attempt may contain a whole redirect chain), `requestCount`
 * counts wire requests (hops + retries). The flaky fixture's budget of
 * maxAttempts 2 means exactly one retry — matching this definition.
 */

export interface ResilientHttpConfig {
  /** Maximum redirects followed per logical attempt. */
  maxRedirects: number
  /** Retry count for a 503 response. */
  maxRetries: number
  /** Ceiling on a Retry-After delay, ms. */
  retryAfterCapMs: number
  headersTimeoutMs: number
  bodyTimeoutMs: number
}

export const DEFAULT_RESILIENT_CONFIG: ResilientHttpConfig = {
  maxRedirects: 5,
  maxRetries: 1,
  retryAfterCapMs: 2000,
  headersTimeoutMs: 10_000,
  bodyTimeoutMs: 30_000,
}

export interface ResilientRequestInit {
  headersTimeoutMs: number
  bodyTimeoutMs: number
}

/** Minimal response shape the engine needs; subjects adapt real responses to it. */
export interface ResilientResponseLike {
  status: number
  headers: { get(name: string): string | null }
  bodyText(): Promise<string>
}

/** One wire request. Throws are mapped by error name inside the engine. */
export type ResilientFetcher = (
  url: string,
  init: ResilientRequestInit,
) => Promise<ResilientResponseLike>

export type ResilientFailureReason =
  | 'timeout'
  | 'connection_error'
  | 'http_error'
  | 'redirect_loop'
  | 'redirect_limit'
  | 'policy_denied'

export interface ResilientOutcome {
  kind: 'ok' | 'failure'
  /** Terminal HTTP status of the final response (null when a transport error fired). */
  status: number | null
  failureReason: ResilientFailureReason | null
  /** Last URL the engine acted on. */
  finalUrl: string
  /** Every URL visited, in order, starting with the requested one. */
  redirectChain: string[]
  /** Wire requests issued (redirect hops + retries). */
  requestCount: number
  /** Logical attempts (one attempt may span a redirect chain). */
  attemptCount: number
  headers: ResilientResponseLike['headers'] | null
  bodyText(): Promise<string>
  trace: Array<{ at: number; event: string; detail?: Record<string, unknown> }>
}

/** Transport-independent retry policy shared by every lane's client. */
export function isRetryableStatus(status: number): boolean {
  return status === 503
}

/** Parse Retry-After as integer seconds; anything else yields null (no delay). */
export function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value.trim())
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return seconds * 1000
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveNextUrl(base: string, location: string): string | null {
  try {
    return new URL(location, base).href
  } catch {
    return null
  }
}

function emptyOutcomeFields(chain: string[], requestCount: number, attemptCount: number, trace: ResilientOutcome['trace']) {
  return {
    redirectChain: chain,
    requestCount,
    attemptCount,
    bodyText: async () => '',
    trace,
  }
}

export async function resilientFetch(
  initialUrl: string,
  fetcher: ResilientFetcher,
  config: Partial<ResilientHttpConfig> = {},
): Promise<ResilientOutcome> {
  const cfg = { ...DEFAULT_RESILIENT_CONFIG, ...config }
  const start = Date.now()
  const trace: ResilientOutcome['trace'] = []
  const chain: string[] = [initialUrl]
  let current = initialUrl
  let requestCount = 0
  let attemptCount = 0
  let retriesLeft = cfg.maxRetries

  // Outer loop: logical attempts. A 503 with retries left re-enters here.
  for (;;) {
    attemptCount++
    const seen = new Set<string>([current])
    let hops = 0

    // Inner loop: one attempt's redirect chain.
    for (;;) {
      requestCount++
      const at = Date.now() - start
      let response: ResilientResponseLike
      try {
        response = await fetcher(current, {
          headersTimeoutMs: cfg.headersTimeoutMs,
          bodyTimeoutMs: cfg.bodyTimeoutMs,
        })
      } catch (err) {
        const name = err instanceof Error ? err.name : ''
        const reason: ResilientFailureReason =
          name === 'HeadersTimeoutError' || name === 'BodyTimeoutError'
            ? 'timeout'
            : 'connection_error'
        trace.push({ at, event: 'request_failed', detail: { reason, error: name || String(err) } })
        return {
          kind: 'failure',
          status: null,
          failureReason: reason,
          finalUrl: current,
          ...emptyOutcomeFields(chain, requestCount, attemptCount, trace),
          headers: null,
        }
      }

      trace.push({ at, event: 'request_complete', detail: { status: response.status } })

      // Redirect handling.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          return {
            kind: 'failure',
            status: response.status,
            failureReason: 'http_error',
            finalUrl: current,
            ...emptyOutcomeFields(chain, requestCount, attemptCount, trace),
            headers: response.headers,
          }
        }
        const next = resolveNextUrl(current, location)
        if (next === null) {
          return {
            kind: 'failure',
            status: response.status,
            failureReason: 'http_error',
            finalUrl: current,
            ...emptyOutcomeFields(chain, requestCount, attemptCount, trace),
            headers: response.headers,
          }
        }
        const protocol = new URL(next).protocol
        if (protocol !== 'http:' && protocol !== 'https:') {
          trace.push({ at, event: 'redirect_policy_denied', detail: { to: next } })
          return {
            kind: 'failure',
            status: response.status,
            failureReason: 'policy_denied',
            finalUrl: current,
            ...emptyOutcomeFields(chain, requestCount, attemptCount, trace),
            headers: response.headers,
          }
        }
        if (seen.has(next)) {
          trace.push({ at, event: 'redirect_loop', detail: { to: next } })
          return {
            kind: 'failure',
            status: response.status,
            failureReason: 'redirect_loop',
            finalUrl: next,
            ...emptyOutcomeFields(chain, requestCount, attemptCount, trace),
            headers: response.headers,
          }
        }
        if (hops >= cfg.maxRedirects) {
          trace.push({ at, event: 'redirect_limit', detail: { to: next, limit: cfg.maxRedirects } })
          return {
            kind: 'failure',
            status: response.status,
            failureReason: 'redirect_limit',
            finalUrl: current,
            ...emptyOutcomeFields(chain, requestCount, attemptCount, trace),
            headers: response.headers,
          }
        }
        hops++
        seen.add(next)
        chain.push(next)
        trace.push({ at, event: 'redirect', detail: { from: current, to: next, status: response.status } })
        current = next
        continue
      }

      // Retry only 503, at most maxRetries times. 429 and friends never retry.
      // The retry shows up in trace/requestCount/attemptCount, NOT in the
      // redirect chain — the chain records redirects, not re-visits.
      if (isRetryableStatus(response.status) && retriesLeft > 0) {
        retriesLeft--
        const parsed = parseRetryAfterMs(response.headers.get('retry-after'))
        const delayMs = Math.min(parsed ?? 0, cfg.retryAfterCapMs)
        trace.push({
          at,
          event: 'retry',
          detail: { attempt: attemptCount, status: response.status, delayMs },
        })
        if (delayMs > 0) await sleep(delayMs)
        break
      }

      // Terminal response of this attempt.
      return {
        kind: 'ok',
        status: response.status,
        failureReason: null,
        finalUrl: current,
        redirectChain: chain,
        requestCount,
        attemptCount,
        headers: response.headers,
        bodyText: () => response.bodyText(),
        trace,
      }
    }
  }
}
