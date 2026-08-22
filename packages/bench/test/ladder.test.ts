import { describe, expect, it } from 'vitest'
import type { FetchResult, HandoffRequest } from '@w2l/contracts'
import { LadderRunner, type Channel, type HumanHandoff } from '../src/routing/ladder.js'
import { MemoryRoutingHistory } from '../src/routing/vendorRouter.js'
import { MemorySessionStore, type SessionSnapshot } from '../src/routing/sessionStore.js'

function blockedResult(url: string, blockReason: FetchResult['blockReason']): FetchResult {
  return {
    requestedUrl: url,
    status: 'blocked',
    failureReason: null,
    blockReason,
    budgetExceeded: null,
    lane: 'http',
    escalations: [],
    handoff: null,
    markdown: null,
    truncated: false,
    truncatedAt: null,
    compliance: null,
    evidence: { finalUrl: url, httpStatus: 403, redirectChain: [], contentType: 'text/html', rawBodySha256: null, artifacts: [] },
    usage: { wallMs: 10, bytesWire: 0, bytesDecompressed: 0, requestCount: 1, attemptCount: 1, contentTokens: null, browserMs: 0, externalCostUsd: null },
    trace: [],
  }
}

function contentfulResult(url: string, lane: FetchResult['lane'], wallMs = 50): FetchResult {
  return {
    requestedUrl: url,
    status: 'success',
    failureReason: null,
    blockReason: null,
    budgetExceeded: null,
    lane,
    escalations: [],
    handoff: null,
    markdown: 'MAIN CONTENT',
    truncated: false,
    truncatedAt: null,
    compliance: null,
    evidence: { finalUrl: url, httpStatus: 200, redirectChain: [], contentType: 'text/html', rawBodySha256: null, artifacts: [] },
    usage: { wallMs, bytesWire: 1, bytesDecompressed: 1, requestCount: 1, attemptCount: 1, contentTokens: 12, browserMs: 0, externalCostUsd: null },
    trace: [],
  }
}

function failedResult(url: string, failureReason: FetchResult['failureReason']): FetchResult {
  return {
    ...blockedResult(url, null),
    status: 'failed',
    failureReason,
  }
}

function providerErrorResult(url: string, vendorId: string): FetchResult {
  return {
    ...failedResult(url, 'provider_error'),
    lane: 'provider',
    trace: [{ at: 0, lane: 'provider', event: 'provider_failed', detail: { vendor: vendorId } }],
  }
}

function channel(id: string, responses: readonly FetchResult[], vendorId?: string): Channel & { calls: string[] } {
  const calls: string[] = []
  return {
    id,
    vendorId,
    calls,
    async fetch(url: string): Promise<FetchResult> {
      calls.push(url)
      const r = responses.shift()
      if (r === undefined) throw new Error(`channel ${id} exhausted`)
      return r
    },
  }
}

const ALLOWED_ALL: Parameters<typeof LadderRunner.prototype.run>['1'] = { mode: 'authed', allowlistedDomains: ['example.com', '*.example.net'] }

describe('LadderRunner', () => {
  it('stops at http when http is contentful — no escalation is cheaper', async () => {
    const http = channel('http', [contentfulResult('https://example.com/p', 'http')])
    const browser = channel('browser_local', [contentfulResult('https://example.com/p', 'browser_local')])
    const runner = new LadderRunner([http, browser], { mode: 'authed' })

    const run = await runner.run('https://example.com/p')
    expect(run.result.status).toBe('success')
    expect(run.result.lane).toBe('http')
    expect(run.channelsTried).toEqual(['http'])
    expect(browser.calls).toEqual([])
  })

  it('escalates bot_gate from http to the next channel', async () => {
    const http = channel('http', [blockedResult('https://example.com/p', 'cloudflare_challenge')])
    const browser = channel('browser_local', [contentfulResult('https://example.com/p', 'browser_local')])
    const runner = new LadderRunner([http, browser], { mode: 'authed' })

    const run = await runner.run('https://example.com/p')
    expect(run.result.lane).toBe('browser_local')
    expect(run.channelsTried).toEqual(['http', 'browser_local'])
  })

  it('does NOT escalate rate_limited — slowing down is the fix, not a stronger lane', async () => {
    const http = channel('http', [blockedResult('https://example.com/p', 'rate_limit')])
    const browser = channel('browser_local', [contentfulResult('https://example.com/p', 'browser_local')])
    const runner = new LadderRunner([http, browser], { mode: 'authed' })

    const run = await runner.run('https://example.com/p')
    expect(run.result.blockReason).toBe('rate_limit')
    expect(run.channelsTried).toEqual(['http'])
    expect(browser.calls).toEqual([])
  })

  it('governance refuses a URL outside the allowlist before any channel runs', async () => {
    const http = channel('http', [contentfulResult('https://evil.test/p', 'http')])
    const runner = new LadderRunner([http], ALLOWED_ALL)

    const run = await runner.run('https://evil.test/p')
    expect(run.result.status).toBe('failed')
    expect(run.result.failureReason).toBe('policy_denied')
    expect(run.channelsTried).toEqual([])
    expect(http.calls).toEqual([])
  })

  it('governance admits wildcarded hosts', async () => {
    const http = channel('http', [contentfulResult('https://shop.example.net/p', 'http')])
    const runner = new LadderRunner([http], ALLOWED_ALL)
    const run = await runner.run('https://shop.example.net/p')
    expect(run.result.status).toBe('success')
  })

  it('mode gates channels: standard mode never reaches a provider', async () => {
    const http = channel('http', [blockedResult('https://example.com/p', 'cloudflare_challenge')])
    const browser = channel('browser_local', [blockedResult('https://example.com/p', 'cloudflare_challenge')])
    const vendor = channel('provider', [contentfulResult('https://example.com/p', 'provider')], 'steel')
    const runner = new LadderRunner([http, browser, vendor], { mode: 'standard' })

    const run = await runner.run('https://example.com/p')
    expect(run.result.status).toBe('blocked')
    expect(run.channelsTried).toEqual(['http', 'browser_local'])
    expect(vendor.calls).toEqual([])
  })
})

describe('LadderRunner — multi-vendor routing', () => {
  it('tries vendors in declaration order with no history', async () => {
    const http = channel('http', [blockedResult('https://example.com/p', 'bot_detected_generic')])
    const browser = channel('browser_local', [blockedResult('https://example.com/p', 'bot_detected_generic')])
    const bb = channel('provider', [contentfulResult('https://example.com/p', 'provider')], 'browserbase')
    const steel = channel('provider', [contentfulResult('https://example.com/p', 'provider')], 'steel')
    const runner = new LadderRunner([http, browser, bb, steel], { mode: 'authed' })

    const run = await runner.run('https://example.com/p')
    expect(run.result.status).toBe('success')
    expect(bb.calls).toHaveLength(1)
    expect(steel.calls).toHaveLength(0)
  })

  it('fails over to the second vendor on provider_error', async () => {
    const http = channel('http', [blockedResult('https://example.com/p', 'bot_detected_generic')])
    const browser = channel('browser_local', [blockedResult('https://example.com/p', 'bot_detected_generic')])
    const bb = channel('provider', [providerErrorResult('https://example.com/p', 'browserbase')], 'browserbase')
    const steel = channel('provider', [contentfulResult('https://example.com/p', 'provider')], 'steel')
    const runner = new LadderRunner([http, browser, bb, steel], { mode: 'authed' })

    const run = await runner.run('https://example.com/p')
    expect(run.result.status).toBe('success')
    expect(bb.calls).toHaveLength(1)
    expect(steel.calls).toHaveLength(1)
    expect(run.channelsTried).toEqual(['http', 'browser_local', 'provider', 'provider'])
  })

  it('history ranking promotes a vendor with better domain success', async () => {
    const history = new MemoryRoutingHistory()
    // Steel has 5/5 contentful on this domain, Browserbase 0/3.
    for (let i = 0; i < 5; i++) {
      await history.record('example.com', 'steel', { contentful: true, wallMs: 800, costUsd: 0.01, failureClass: null })
    }
    for (let i = 0; i < 3; i++) {
      await history.record('example.com', 'browserbase', { contentful: false, wallMs: 900, costUsd: 0.01, failureClass: 'provider_error' })
    }

    const http = channel('http', [blockedResult('https://example.com/p', 'bot_detected_generic')])
    const browser = channel('browser_local', [blockedResult('https://example.com/p', 'bot_detected_generic')])
    const bb = channel('provider', [contentfulResult('https://example.com/p', 'provider')], 'browserbase')
    const steel = channel('provider', [contentfulResult('https://example.com/p', 'provider')], 'steel')
    const runner = new LadderRunner([http, browser, bb, steel], { mode: 'authed' }, history)

    const run = await runner.run('https://example.com/p')
    expect(run.result.status).toBe('success')
    // Steel went first and won; browserbase never ran.
    expect(steel.calls).toHaveLength(1)
    expect(bb.calls).toHaveLength(0)
  })

  it('records vendor outcomes against domain history', async () => {
    const history = new MemoryRoutingHistory()
    const http = channel('http', [blockedResult('https://example.com/p', 'bot_detected_generic')])
    const browser = channel('browser_local', [blockedResult('https://example.com/p', 'bot_detected_generic')])
    const bb = channel('provider', [contentfulResult('https://example.com/p', 'provider')], 'browserbase')
    const runner = new LadderRunner([http, browser, bb], { mode: 'authed' }, history)

    await runner.run('https://example.com/p')
    const recorded = await history.read('example.com')
    expect(recorded.vendors.browserbase).toMatchObject({ attempts: 1, contentful: 1 })
  })
})

describe('LadderRunner — human handoff', () => {
  const handoffRequest: HandoffRequest = {
    reason: 'captcha_required',
    liveViewUrl: 'https://live.example/session-1',
    rationale: 'The target demands human verification.',
  }

  it('pauses and returns the handoff request when a channel asks for it', async () => {
    const http = channel('http', [blockedResult('https://example.com/p', 'cloudflare_challenge')])
    const browser = channel('browser_local', [blockedResult('https://example.com/p', 'cloudflare_challenge')])
    const vendor = channel('provider', [
      { ...blockedResult('https://example.com/p', 'captcha'), handoff: handoffRequest },
    ], 'steel')
    const runner = new LadderRunner([http, browser, vendor], { mode: 'authed' })

    const run = await runner.run('https://example.com/p')
    expect(run.handoffRequested).toBe(true)
    expect(run.result.handoff?.liveViewUrl).toBe('https://live.example/session-1')
    expect(run.channelsTried).toEqual(['http', 'browser_local', 'provider'])
  })

  it('invokes the human, saves nothing, and retries the same channel with the snapshot', async () => {
    const session: SessionSnapshot = {
      domain: 'example.com',
      attestedBy: 'test',
      attestedAt: new Date().toISOString(),
      vendor: 'browser_local_authed',
      cookies: [{ name: 'sid', value: 'secret', domain: '.example.com', path: '/' }],
    }
    const vendor = channel('provider', [
      { ...blockedResult('https://example.com/p', 'captcha'), handoff: handoffRequest },
      contentfulResult('https://example.com/p', 'provider'),
    ], 'steel')
    const received: { url: string; request: HandoffRequest }[] = []
    const handoff: HumanHandoff = {
      async takeOver(url, request) {
        received.push({ url, request })
        return session
      },
    }
    const runner = new LadderRunner([vendor], { mode: 'authed' }, null, handoff)

    const run = await runner.run('https://example.com/p')
    expect(received).toHaveLength(1)
    expect(received[0]!.request.liveViewUrl).toBe('https://live.example/session-1')
    expect(run.result.status).toBe('success')
    expect(run.channelsTried).toEqual(['provider', 'provider(retry)'])
    expect(run.handoffRequested).toBe(true)
  })

  it('aborts when the human declines', async () => {
    const vendor = channel('provider', [
      { ...blockedResult('https://example.com/p', 'captcha'), handoff: handoffRequest },
      contentfulResult('https://example.com/p', 'provider'),
    ], 'steel')
    const handoff: HumanHandoff = { async takeOver() { return null } }
    const runner = new LadderRunner([vendor], { mode: 'authed' }, null, handoff)

    const run = await runner.run('https://example.com/p')
    expect(run.result.status).toBe('blocked')
    expect(run.channelsTried).toEqual(['provider'])
  })

  it('with no human configured, reports the pause point instead of looping', async () => {
    const vendor = channel('provider', [
      { ...blockedResult('https://example.com/p', 'captcha'), handoff: handoffRequest },
    ], 'steel')
    const runner = new LadderRunner([vendor], { mode: 'authed' })

    const run = await runner.run('https://example.com/p')
    expect(run.handoffRequested).toBe(true)
    expect(run.channelsTried).toEqual(['provider'])
  })
})

describe('LadderRunner — consuming FetchResult.escalations', () => {
  function thinHttpSuccess(url: string): FetchResult {
    const r = contentfulResult(url, 'http')
    return {
      ...r,
      usage: { ...r.usage, contentTokens: 60 },
      trace: [
        ...r.trace,
        { at: 10, lane: 'http', event: 'quality_low_yield', detail: { contentTokens: 60, confidence: 0.2 } },
      ],
    }
  }

  function emptyUnverified(url: string): FetchResult {
    return {
      ...failedResult(url, 'empty_unverified'),
      escalations: [{ from: 'http', to: 'browser_local', trigger: 'extract_low_confidence', improved: null }],
    }
  }

  it('honours an empty_unverified subject escalation and tries the next rung', async () => {
    const http = channel('http', [emptyUnverified('https://example.com/p')])
    const browser = channel('browser_local', [contentfulResult('https://example.com/p', 'browser_local')])
    const runner = new LadderRunner([http, browser], { mode: 'authed' })

    const run = await runner.run('https://example.com/p')
    expect(run.result.lane).toBe('browser_local')
    expect(run.channelsTried).toEqual(['http', 'browser_local'])
  })

  it('escalates a thin, low-confidence http success to the browser (quality signal)', async () => {
    const http = channel('http', [thinHttpSuccess('https://example.com/p')])
    const browser = channel('browser_local', [contentfulResult('https://example.com/p', 'browser_local')])
    const runner = new LadderRunner([http, browser], { mode: 'authed' })

    const run = await runner.run('https://example.com/p')
    expect(run.result.lane).toBe('browser_local')
    expect(run.channelsTried).toEqual(['http', 'browser_local'])
  })

  it('accepts the browser result even when it is also thin — one quality pass, not a loop', async () => {
    const http = channel('http', [thinHttpSuccess('https://example.com/p')])
    const browser = channel('browser_local', [thinHttpSuccess('https://example.com/p')])
    const runner = new LadderRunner([http, browser], { mode: 'authed' })

    const run = await runner.run('https://example.com/p')
    expect(run.result.lane).toBe('http') // the browser's thin success IS the answer
    expect(run.result.trace.some((t) => t.event === 'quality_low_yield')).toBe(true)
    expect(run.channelsTried).toEqual(['http', 'browser_local'])
  })

  it('audits every step with channel, vendor and escalation reason', async () => {
    const http = channel('http', [emptyUnverified('https://example.com/p')])
    const browser = channel('browser_local', [contentfulResult('https://example.com/p', 'browser_local')])
    const runner = new LadderRunner([http, browser], { mode: 'authed' })

    const run = await runner.run('https://example.com/p')
    const steps = run.ladderTrace.filter((t) => t.event === 'ladder_step')
    expect(steps).toHaveLength(2)
    expect(steps[0]).toMatchObject({
      channel: 'http',
      detail: { status: 'failed', escalate: 'subject_escalations' },
    })
    expect(steps[1]).toMatchObject({ channel: 'browser_local', detail: { escalate: null } })
  })
})

describe('LadderRunner — session store wiring', () => {
  it('loads a saved session for the domain when the caller passes none', async () => {
    const snapshot: SessionSnapshot = {
      domain: 'example.com',
      attestedBy: 't',
      attestedAt: '2026-08-22T00:00:00.000Z',
      vendor: 'browser_local_authed',
      cookies: [{ name: 'sid', value: 'v', domain: '.example.com', path: '/' }],
    }
    const store = new MemorySessionStore()
    await store.save(snapshot)

    const received: (SessionSnapshot | null | undefined)[] = []
    const http = channel('http', [contentfulResult('https://example.com/p', 'http')])
    const orig = http.fetch
    http.fetch = async (url, session) => {
      received.push(session)
      return orig(url, session)
    }

    const runner = new LadderRunner([http], { mode: 'authed' }, null, null, store)
    await runner.run('https://example.com/p')

    expect(received).toHaveLength(1)
    expect(received[0]?.domain).toBe('example.com')
    expect(received[0]?.cookies?.[0]?.name).toBe('sid')
  })

  it('saves the handoff snapshot so the next run resumes', async () => {
    const session: SessionSnapshot = {
      domain: 'example.com',
      attestedBy: 'human',
      attestedAt: '2026-08-22T00:00:00.000Z',
      vendor: 'steel',
      resume: { steelProfileId: 'prof-1' },
    }
    const store = new MemorySessionStore()
    const request: HandoffRequest = {
      reason: 'captcha_required',
      liveViewUrl: 'https://live.example/session-1',
      rationale: 'The target demands human verification.',
    }
    const vendor = channel('provider', [
      { ...blockedResult('https://example.com/p', 'captcha'), handoff: request },
      contentfulResult('https://example.com/p', 'provider'),
    ], 'steel')
    const handoff: HumanHandoff = { async takeOver() { return session } }
    const runner = new LadderRunner([vendor], { mode: 'authed' }, null, handoff, store)

    await runner.run('https://example.com/p')
    const saved = await store.load('example.com')
    expect(saved?.vendor).toBe('steel')
    expect(saved?.resume).toEqual({ steelProfileId: 'prof-1' })
  })
})
