import { describe, expect, it } from 'vitest'
import { compareChannels } from '../src/liveCompareCli.js'
import type { FetchResult } from '@w2l/contracts'

function okResult(url: string): FetchResult {
  return {
    requestedUrl: url,
    status: 'success',
    failureReason: null,
    blockReason: null,
    budgetExceeded: null,
    lane: 'http',
    escalations: [],
    handoff: null,
    markdown: 'MAIN CONTENT',
    truncated: false,
    truncatedAt: null,
    compliance: null,
    evidence: { finalUrl: url, httpStatus: 200, redirectChain: [], contentType: 'text/html', rawBodySha256: null, artifacts: [] },
    usage: { wallMs: 5, bytesWire: 1, bytesDecompressed: 1, requestCount: 1, attemptCount: 1, contentTokens: 12, browserMs: 0, externalCostUsd: null },
    trace: [],
  }
}

/** A fake subject factory that counts how many times it was invoked. */
function countingFactory(teardowns: string[]) {
  let created = 0
  return {
    created: () => created,
    factory: async () => {
      created++
      return {
        fetch: async (url: string) => okResult(url),
        teardown: async () => {
          teardowns.push(`teardown-${created}`)
        },
      }
    },
  }
}

describe('w2l-live-compare resource handling', () => {
  it('reuses ONE subject per vendor arm across all URLs', async () => {
    const teardowns: string[] = []
    const bb = countingFactory(teardowns)
    const steel = countingFactory(teardowns)

    await compareChannels(['https://a.example/1', 'https://a.example/2'], {
      overrides: {
        http: countingFactory(teardowns).factory,
        browser_local: countingFactory(teardowns).factory,
        browserbase: bb.factory,
        steel: steel.factory,
      },
    })

    expect(bb.created()).toBe(1)
    expect(steel.created()).toBe(1)
    expect(teardowns).toContain('teardown-1')
  })

  it('releases every arm in finally even when one arm throws', async () => {
    const teardowns: string[] = []
    const bb = countingFactory(teardowns)
    const steel = countingFactory(teardowns)

    await compareChannels(['https://a.example/1'], {
      overrides: {
        http: async () => {
          throw new Error('boom')
        },
        browser_local: countingFactory(teardowns).factory,
        browserbase: bb.factory,
        steel: steel.factory,
      },
    })

    // http threw, but the other three arms ran AND were torn down.
    expect(bb.created()).toBe(1)
    expect(steel.created()).toBe(1)
    expect(teardowns.filter((t) => t === 'teardown-1')).toHaveLength(3)
  })

  it('the arm deadline is real: a hanging arm reports a timeout, and cleanup still runs', async () => {
    const teardowns: string[] = []
    const hang = async () => {
      await new Promise((resolve) => setTimeout(resolve, 60_000))
      return okResult('https://a.example/1')
    }
    const bb = countingFactory(teardowns)
    const steel = countingFactory(teardowns)

    const { perUrl } = await compareChannels(['https://a.example/1'], {
      armTimeoutMs: 50,
      overrides: {
        http: hang,
        browser_local: countingFactory(teardowns).factory,
        browserbase: bb.factory,
        steel: steel.factory,
      },
    })

    const httpArm = perUrl[0]!.arms.find((a) => a.arm === 'http')!
    expect(httpArm.ok).toBe(false)
    expect(httpArm.error).toContain('timed out after 50ms')
    // The other arms completed and were released despite http's timeout.
    expect(bb.created()).toBe(1)
    expect(steel.created()).toBe(1)
    expect(teardowns.filter((t) => t === 'teardown-1')).toHaveLength(3)
  })

  it('a skipped vendor arm (no key, no override) is reported as SKIPPED, not silent', async () => {
    const teardowns: string[] = []
    const { perUrl } = await compareChannels(['https://a.example/1'], {
      overrides: {
        http: countingFactory(teardowns).factory,
        browser_local: countingFactory(teardowns).factory,
      },
      keys: { browserbase: '', steel: '' },
    })
    const arms = perUrl[0]!.arms
    expect(arms.find((a) => a.arm === 'browserbase')?.error).toContain('SKIPPED')
    expect(arms.find((a) => a.arm === 'steel')?.error).toContain('SKIPPED')
  })
})
