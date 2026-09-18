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

  it('a slow subject factory is still awaited and torn down EXACTLY once; no fetch runs after the deadline', async () => {
    let fetches = 0
    let teardowns = 0

    const run = compareChannels(['https://a.example/1'], {
      armTimeoutMs: 60,
      overrides: {
        http: countingFactory([]).factory,
        browser_local: countingFactory([]).factory,
        steel: async () => {
          // The factory finishes AFTER the arm deadline fired.
          await new Promise((r) => setTimeout(r, 120))
          return {
            fetch: async () => {
              fetches++
              return okResult('https://a.example/1')
            },
            teardown: async () => {
              teardowns++
            },
          }
        },
      },
    })

    const { perUrl } = await run
    const steelArm = perUrl[0]!.arms.find((a) => a.arm === 'steel')!
    expect(steelArm.ok).toBe(false)
    expect(steelArm.error).toContain('timed out')

    // Give the slow factory time to finish (compareChannels already awaited
    // the pending creation in its teardown path before returning).
    await new Promise((r) => setTimeout(r, 250))

    // The subject was created late, but it was released — exactly once — and
    // never ran a fetch the run had already abandoned.
    expect(fetches).toBe(0)
    expect(teardowns).toBe(1)
  })

  it('a hanging fetch aborts on the arm signal and teardown still runs once', async () => {
    let teardowns = 0
    const { perUrl } = await compareChannels(['https://a.example/1'], {
      armTimeoutMs: 60,
      overrides: {
        http: countingFactory([]).factory,
        browser_local: countingFactory([]).factory,
        steel: async () => ({
          fetch: async (_url, signal) => {
            await new Promise<void>((resolve, reject) => {
              signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
            })
            return okResult('https://a.example/1')
          },
          teardown: async () => {
            teardowns++
          },
        }),
      },
    })

    const steelArm = perUrl[0]!.arms.find((a) => a.arm === 'steel')!
    expect(steelArm.ok).toBe(false)
    // The deadline and the abort race each other; either way the run stops
    // and the resource is released.
    expect(steelArm.error).toMatch(/timed out|aborted/)
    expect(teardowns).toBe(1)
  })
})

describe('live-compare deadline plumbing', () => {
  it('the REAL subject-creation promise is tracked: a slow creation is awaited and released exactly once, no late fetch', async () => {
    let fetches = 0
    let teardowns = 0
    const { perUrl } = await compareChannels(['https://a.example/1'], {
      armTimeoutMs: 60,
      keys: { browserbase: 'fake-key' },
      overrides: {
        http: countingFactory([]).factory,
        browser_local: countingFactory([]).factory,
      },
      vendorProviderSubjectImpl: async () => {
        // The REAL subject creation takes longer than the arm deadline.
        await new Promise((r) => setTimeout(r, 120))
        return {
          fetch: async () => {
            fetches++
            return okResult('https://a.example/1')
          },
          teardown: async () => {
            teardowns++
          },
        }
      },
    })

    const arm = perUrl[0]!.arms.find((a) => a.arm === 'browserbase')!
    expect(arm.ok).toBe(false)
    expect(arm.error).toContain('timed out')

    // close() awaited the pending REAL creation: after compareChannels
    // returns there is no background session creation in flight, the fetch
    // that the run abandoned never happened, and teardown ran exactly once.
    expect(fetches).toBe(0)
    expect(teardowns).toBe(1)
  })

  it('a 1234ms deadline maps to a 1234ms navigation timeout, never the 20000ms default', async () => {
    const { navigationTimeout } = await import('../src/vendors/cdp.js')
    const now = Date.now()
    expect(navigationTimeout(now + 1234, now)).toBe(1234)
    expect(navigationTimeout(now + 30_000, now)).toBe(20_000) // capped
    expect(navigationTimeout(undefined, now)).toBe(20_000) // no caller deadline
  })
})
