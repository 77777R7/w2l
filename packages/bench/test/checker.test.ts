import { describe, expect, it } from 'vitest'
import type { FetchResult, GroundTruth } from '@w2l/contracts'
import { checkFalseSuccess, isFalseSuccess } from '../src/checker.js'

/** Minimal valid GroundTruth for checker-focused tests. */
function truth(over: Partial<GroundTruth> = {}): GroundTruth {
  return {
    id: 't',
    target: 'http://x.test/page',
    kind: 'fixture',
    category: 'static',
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: { maxTokens: 1000, maxWallMs: 10_000, maxAttempts: 1 },
    expectedStatus: 'success',
    ...over,
  }
}

/** Minimal successful FetchResult. */
function result(over: Partial<FetchResult> = {}): FetchResult {
  return {
    requestedUrl: 'http://x.test/page',
    status: 'success',
    failureReason: null,
    blockReason: null,
    budgetExceeded: null,
    lane: 'http',
    escalations: [],
    markdown: 'A page body.',
    truncated: false,
    truncatedAt: null,
    evidence: {
      finalUrl: 'http://x.test/page',
      httpStatus: 200,
      redirectChain: [],
      contentType: 'text/html',
      rawBodySha256: null,
      artifacts: [],
    },
    usage: {
      wallMs: 10,
      bytesWire: 100,
      bytesDecompressed: 100,
      requestCount: 1,
      attemptCount: 1,
      contentTokens: 10,
      browserMs: 0,
      externalCostUsd: null,
    },
    trace: [],
    ...over,
  }
}

function check4(r: FetchResult, t: GroundTruth) {
  return checkFalseSuccess(r, t).find((c) => c.check === 'wrong_page_content')!
}

describe('check 4: wrong_page_content (content-aware redirect)', () => {
  it('passes a followed redirect whose content carries every required fact', () => {
    const t = truth({ mustContain: ['Arrived after three hops.'] })
    const r = result({
      markdown: 'Arrived after three hops.',
      evidence: {
        finalUrl: 'http://x.test/dest',
        httpStatus: 200,
        redirectChain: ['http://x.test/a', 'http://x.test/b'],
        contentType: 'text/html',
        rawBodySha256: null,
        artifacts: [],
      },
    })
    const c = check4(r, t)
    expect(c.outcome).toBe('pass')
    expect(isFalseSuccess(r, checkFalseSuccess(r, t))).toBe(false)
  })

  it('fails a followed redirect whose content is missing a required fact', () => {
    const t = truth({ mustContain: ['Arrived after three hops.'] })
    const r = result({
      markdown: 'Welcome to the fixture site',
      evidence: {
        finalUrl: 'http://x.test/home',
        httpStatus: 200,
        redirectChain: ['http://x.test/page'],
        contentType: 'text/html',
        rawBodySha256: null,
        artifacts: [],
      },
    })
    const c = check4(r, t)
    expect(c.outcome).toBe('fail')
    expect(isFalseSuccess(r, checkFalseSuccess(r, t))).toBe(true)
  })

  it('reports unknown for a redirect without a mustContain annotation', () => {
    const r = result({
      evidence: {
        finalUrl: 'http://x.test/home',
        httpStatus: 200,
        redirectChain: ['http://x.test/page'],
        contentType: 'text/html',
        rawBodySha256: null,
        artifacts: [],
      },
    })
    const c = check4(r, truth())
    expect(c.outcome).toBe('unknown')
    expect(isFalseSuccess(r, checkFalseSuccess(r, truth()))).toBe(false)
  })

  it('passes a same-URL result (no redirect) regardless of annotation', () => {
    const t = truth({ mustContain: [] })
    const c = check4(result(), t)
    expect(c.outcome).toBe('pass')
  })
})
