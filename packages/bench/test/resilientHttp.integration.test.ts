import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from '@w2l/fixtures'
import { ResilientHttpSubject } from '../src/subjects/resilientHttp.js'

/**
 * Transport-resilience integration test against real fixture-server bytes:
 * the four cases the resilient arm exists for, asserted per-fixture (status,
 * failure reason, chain, attempt counts, delivered facts) — not via bench
 * aggregate inference.
 */

let server: FixtureServer
const subject = new ResilientHttpSubject()

beforeAll(async () => {
  server = await startFixtureServer()
})

afterAll(async () => {
  await server.close()
})

async function reset(): Promise<void> {
  const res = await fetch(`${server.url}/__reset`)
  expect(res.status).toBe(204)
  await res.body?.cancel()
}

describe('resilient subject on served fixture bytes', () => {
  it('redirect-chain: follows three hops and delivers the destination fact', async () => {
    const out = await subject.fetch(`${server.url}/redirect/chain/3`)
    expect(out.status).toBe('success')
    expect(out.markdown).toContain('Arrived after three hops.')
    expect(out.evidence.finalUrl).toBe(`${server.url}/redirect/chain/0`)
    expect(out.evidence.redirectChain).toHaveLength(4)
    expect(out.usage.requestCount).toBe(4)
    expect(out.usage.attemptCount).toBe(1)
  })

  it('redirect-loop: terminates with redirect_loop, never spins', async () => {
    const out = await subject.fetch(`${server.url}/redirect/loop/a`)
    expect(out.status).toBe('failed')
    expect(out.failureReason).toBe('redirect_loop')
    expect(out.usage.attemptCount).toBe(1)
    // a -> b -> a: the loop is provable after two wire requests
    expect(out.usage.requestCount).toBe(2)
  })

  it('flaky-once: retries the 503 and succeeds on attempt 2', async () => {
    await reset()
    const out = await subject.fetch(`${server.url}/flaky/once`)
    expect(out.status).toBe('success')
    expect(out.markdown).toContain('Succeeded on the second attempt.')
    expect(out.usage.attemptCount).toBe(2)
    expect(out.usage.requestCount).toBe(2)
    // Retry is a re-visit, not a redirect.
    expect(out.evidence.redirectChain).toHaveLength(0)
  })

  it('block-rate-limit: 429 is blocked/rate_limit with exactly one request', async () => {
    const out = await subject.fetch(`${server.url}/block/rate-limit`)
    expect(out.status).toBe('blocked')
    expect(out.blockReason).toBe('rate_limit')
    expect(out.usage.requestCount).toBe(1)
  })

  it('redirect-to-home: follows to /home; check 4 has no annotation to refute it', async () => {
    // Documented semantic gap for this phase: transport-wise the redirect is
    // followed correctly (finalUrl = /home). Deciding that the DELIVERED
    // content belongs to the wrong page needs the wrong-page probe
    // (content-identity), which is a later milestone. The fixture's
    // expectedStatus stays 'failed', so this arm records a status mismatch
    // there — visible in the bench, not hidden by this test.
    const out = await subject.fetch(`${server.url}/wrong/redirect-home`)
    expect(out.evidence.finalUrl).toBe(`${server.url}/home`)
    expect(out.evidence.redirectChain).toHaveLength(2)
    expect(out.status).toBe('success')
  })
})
