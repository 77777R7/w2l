import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RESILIENT_CONFIG,
  resilientFetch,
  type ResilientFetcher,
  type ResilientResponseLike,
} from '../src/resilient.js'

function res(
  status: number,
  headers: Record<string, string> = {},
  body = '',
): ResilientResponseLike {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return {
    status,
    headers: { get: (n: string) => lower[n.toLowerCase()] ?? null },
    bodyText: async () => body,
  }
}

/** Fetcher that replays scripted steps in order and records each URL. */
function scripted(steps: Array<ResilientResponseLike | Error>): ResilientFetcher & { calls: string[] } {
  const calls: string[] = []
  const fetcher = (async (url: string) => {
    calls.push(url)
    const step = steps.shift()
    if (!step) throw new Error(`scripted fetcher exhausted at ${url}`)
    if (step instanceof Error) throw step
    return step
  }) as ResilientFetcher & { calls: string[] }
  fetcher.calls = calls
  return fetcher
}

const U = 'http://x.test/page'

describe('resilientFetch: plain responses', () => {
  it('returns a 200 without redirects: one request, one attempt', async () => {
    const f = scripted([res(200, {}, 'body')])
    const out = await resilientFetch(U, f)
    expect(out.kind).toBe('ok')
    expect(out.status).toBe(200)
    expect(out.finalUrl).toBe(U)
    expect(out.redirectChain).toEqual([U])
    expect(out.requestCount).toBe(1)
    expect(out.attemptCount).toBe(1)
    expect(await out.bodyText()).toBe('body')
  })

  it('returns non-retryable statuses as terminal ok-kind (subject maps them)', async () => {
    const f = scripted([res(404)])
    const out = await resilientFetch(U, f)
    expect(out.kind).toBe('ok')
    expect(out.status).toBe(404)
    expect(out.requestCount).toBe(1)
  })

  it('treats 304 as a terminal representation response, not a redirect', async () => {
    const f = scripted([res(304, { etag: '"v1"' })])
    const out = await resilientFetch(U, f)
    expect(out.kind).toBe('ok')
    expect(out.status).toBe(304)
    expect(out.redirectChain).toEqual([U])
    expect(out.requestCount).toBe(1)
  })
})

describe('resilientFetch: redirects', () => {
  it('follows a 3-hop chain and returns the destination body', async () => {
    const f = scripted([
      res(302, { location: '/hop/2' }),
      res(302, { location: '/hop/1' }),
      res(302, { location: '/dest' }),
      res(200, {}, 'Arrived after three hops.'),
    ])
    const out = await resilientFetch(U, f)
    expect(out.kind).toBe('ok')
    expect(out.status).toBe(200)
    expect(out.finalUrl).toBe('http://x.test/dest')
    expect(out.redirectChain).toEqual([
      U,
      'http://x.test/hop/2',
      'http://x.test/hop/1',
      'http://x.test/dest',
    ])
    expect(out.requestCount).toBe(4)
    expect(out.attemptCount).toBe(1)
    expect(await out.bodyText()).toBe('Arrived after three hops.')
  })

  it('resolves relative Location values against the current URL', async () => {
    const f = scripted([res(301, { location: 'sibling' }), res(200)])
    const out = await resilientFetch('http://x.test/a/b', f)
    expect(out.finalUrl).toBe('http://x.test/a/sibling')
  })

  it('detects an a->b->a loop and fails with redirect_loop', async () => {
    const f = scripted([
      res(302, { location: '/loop/b' }),
      res(302, { location: '/loop/a' }),
    ])
    const out = await resilientFetch('http://x.test/loop/a', f)
    expect(out.kind).toBe('failure')
    expect(out.failureReason).toBe('redirect_loop')
    expect(out.requestCount).toBe(2)
    expect(out.trace.some((t) => t.event === 'redirect_loop')).toBe(true)
  })

  it('stops at maxRedirects with redirect_limit', async () => {
    const steps = Array.from({ length: 7 }, (_, i) => res(302, { location: `/n/${i}` }))
    const f = scripted(steps)
    const out = await resilientFetch(U, f, { maxRedirects: 5 })
    expect(out.kind).toBe('failure')
    expect(out.failureReason).toBe('redirect_limit')
    // initial request + 5 followed hops; the 6th redirect response trips the limit
    expect(out.requestCount).toBe(6)
  })

  it('denies non-http(s) redirect targets with policy_denied', async () => {
    const f = scripted([res(302, { location: 'ftp://evil.test/x' })])
    const out = await resilientFetch(U, f)
    expect(out.kind).toBe('failure')
    expect(out.failureReason).toBe('policy_denied')
  })

  it('calls assertUrl on the seed and every redirect hop', async () => {
    const seen: string[] = []
    const f = scripted([res(302, { location: '/b' }), res(200, {}, 'ok')])
    const out = await resilientFetch('http://x.test/a', f, {
      assertUrl: async (url) => {
        seen.push(url)
      },
    })
    expect(out.kind).toBe('ok')
    expect(seen).toEqual(['http://x.test/a', 'http://x.test/b'])
  })

  it('does not fetch a redirect hop that assertUrl rejects', async () => {
    const f = scripted([res(302, { location: 'http://169.254.169.254/' }), res(200, {}, 'metadata')])
    const out = await resilientFetch(U, f, {
      assertUrl: async (url) => {
        if (url.includes('169.254.169.254')) throw new Error('metadata')
      },
    })
    expect(out.kind).toBe('failure')
    expect(out.failureReason).toBe('policy_denied')
    expect(f.calls).toEqual([U])
    expect(out.trace.some((t) => t.event === 'ssrf_denied')).toBe(true)
  })

  it('fails a 3xx without a Location header as http_error', async () => {
    const f = scripted([res(302)])
    const out = await resilientFetch(U, f)
    expect(out.kind).toBe('failure')
    expect(out.failureReason).toBe('http_error')
  })
})

describe('resilientFetch: retry', () => {
  it('retries a 503 once and succeeds on the second attempt', async () => {
    const f = scripted([res(503), res(200, {}, 'Succeeded on the second attempt.')])
    const out = await resilientFetch(U, f)
    expect(out.kind).toBe('ok')
    expect(out.status).toBe(200)
    expect(out.attemptCount).toBe(2)
    expect(out.requestCount).toBe(2)
    // A retry is a re-visit, not a redirect: the chain stays clean.
    expect(out.redirectChain).toEqual([U])
    expect(out.trace.filter((t) => t.event === 'retry')).toHaveLength(1)
  })

  it('retries at the redirect destination, not the requested URL', async () => {
    // A -> B (302), B answers 503: the retry must re-enter at B — that is
    // where the content lives; re-fetching A would re-run the whole chain.
    const f = scripted([
      res(302, { location: '/b' }),
      res(503),
      res(200, {}, 'recovered'),
    ])
    const out = await resilientFetch('http://x.test/a', f)
    expect(f.calls).toEqual(['http://x.test/a', 'http://x.test/b', 'http://x.test/b'])
    expect(out.kind).toBe('ok')
    expect(out.status).toBe(200)
    expect(out.finalUrl).toBe('http://x.test/b')
    expect(out.redirectChain).toEqual(['http://x.test/a', 'http://x.test/b'])
    expect(out.attemptCount).toBe(2)
    expect(out.requestCount).toBe(3)
  })

  it('does not retry past maxRetries: second 503 is terminal', async () => {
    const f = scripted([res(503), res(503)])
    const out = await resilientFetch(U, f, { maxRetries: 1 })
    expect(out.kind).toBe('ok')
    expect(out.status).toBe(503)
    expect(out.attemptCount).toBe(2)
  })

  it('honours Retry-After capped at retryAfterCapMs', async () => {
    const f = scripted([res(503, { 'retry-after': '9999' }), res(200)])
    const out = await resilientFetch(U, f, { retryAfterCapMs: 50 })
    const retry = out.trace.find((t) => t.event === 'retry')
    expect(retry?.detail?.delayMs).toBe(50)
  })

  it('parses HTTP-date Retry-After and waits the server-directed delay up to the cap', async () => {
    const now = Date.parse('2026-09-21T00:00:00.000Z')
    const sleeps: number[] = []
    const f = scripted([res(503, { 'retry-after': new Date(now + 1000).toUTCString() }), res(200)])
    const out = await resilientFetch(U, f, { retryAfterCapMs: 1000 }, { now: () => now, sleep: async (ms) => { sleeps.push(ms) }, random: () => 0 })
    expect(out.status).toBe(200)
    expect(sleeps).toEqual([1000])
  })

  it('uses bounded exponential backoff with injected jitter when Retry-After is invalid', async () => {
    const sleeps: number[] = []
    const f = scripted([res(503, { 'retry-after': 'invalid' }), res(200)])
    await resilientFetch(U, f, { retryAfterCapMs: 1000, retryBackoffBaseMs: 100, retryJitterMs: 20 }, { sleep: async (ms) => { sleeps.push(ms) }, random: () => 0.5 })
    expect(sleeps).toEqual([110])
  })

  it('never retries a 429, even with Retry-After present', async () => {
    const f = scripted([res(429, { 'retry-after': '2' })])
    const out = await resilientFetch(U, f)
    expect(out.kind).toBe('ok')
    expect(out.status).toBe(429)
    expect(out.requestCount).toBe(1)
    expect(out.trace.some((t) => t.event === 'retry')).toBe(false)
  })
})

describe('resilientFetch: transport errors', () => {
  it('maps undici timeout error names to timeout', async () => {
    const err = new Error('headers timeout')
    err.name = 'HeadersTimeoutError'
    const f = scripted([err])
    const out = await resilientFetch(U, f)
    expect(out.kind).toBe('failure')
    expect(out.failureReason).toBe('timeout')
  })

  it('maps other thrown errors to connection_error', async () => {
    const f = scripted([new Error('ECONNREFUSED')])
    const out = await resilientFetch(U, f)
    expect(out.kind).toBe('failure')
    expect(out.failureReason).toBe('connection_error')
  })
})

describe('resilientFetch: defaults', () => {
  it('ships the fixture-aligned default config', () => {
    expect(DEFAULT_RESILIENT_CONFIG.maxRedirects).toBe(5)
    expect(DEFAULT_RESILIENT_CONFIG.maxRetries).toBe(1)
  })
})
