import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BLOCK_REASON, type BlockReason } from '@w2l/contracts'
import { FIXTURE_TRUTHS, startFixtureServer, type FixtureServer } from '@w2l/fixtures'
import { classifyGate, type GateBlockReason } from '@w2l/http-core'
import { ExtractTfSubject } from '../src/subjects/extractTf.js'
import { ResilientHttpSubject } from '../src/subjects/resilientHttp.js'

/**
 * Gate-classification integration test on real fixture-server bytes.
 *
 * The unit tests in @w2l/http-core prove the classifier's logic on hand-built
 * responses. This proves the wiring: that the subjects actually consult it, on
 * bytes a server really sent, and turn the verdict into a `blocked` result with
 * a named reason and a legitimate escalation — rather than the `failed/
 * http_error` that made a bot wall indistinguishable from a 500.
 *
 * Lives in @w2l/bench because this is the only package where the contract
 * vocabulary, the classifier and the subjects are all legitimately visible;
 * @w2l/fixtures is the independent oracle and never imports a subject.
 */

let server: FixtureServer
const extractTfSubject = new ExtractTfSubject()
const resilientSubject = new ResilientHttpSubject()

beforeAll(async () => {
  server = await startFixtureServer()
})

afterAll(async () => {
  await server.close()
})

/** The four gates the fixture suite serves, and the reason each must produce. */
const GATES: ReadonlyArray<{
  readonly path: string
  readonly reason: BlockReason
  readonly why: string
}> = [
  {
    path: '/block/challenge',
    reason: 'cloudflare_challenge',
    why: '403 with a cf-mitigated header — vendor named from headers alone',
  },
  {
    path: '/block/challenge-200',
    reason: 'cloudflare_challenge',
    why: '200 with the interstitial copy — the case status codes cannot catch',
  },
  {
    path: '/block/rate-limit',
    reason: 'rate_limit',
    why: '429, decisive from the status',
  },
  {
    path: '/block/login-wall',
    reason: 'login_wall',
    why: '200 with a password field behind a sign-in-to-continue heading',
  },
]

describe.each([
  ['extract-tf', extractTfSubject] as const,
  ['resilient-http', resilientSubject] as const,
])('%s names the gate on served bytes', (_label, subject) => {
  it.each(GATES.map((g) => [g.path, g] as const))('%s → blocked', async (path, gate) => {
    const out = await subject.fetch(`${server.url}${path}`)
    expect(out.status, gate.why).toBe('blocked')
    expect(out.blockReason, gate.why).toBe(gate.reason)
    expect(out.failureReason).toBeNull()
    // A blocked result must never carry content: returning the challenge page
    // as markdown is the false success this whole classification exists to stop.
    expect(out.markdown).toBeNull()
  })

  it('records the signals that fired, so the claim is auditable', async () => {
    const out = await subject.fetch(`${server.url}/block/challenge-200`)
    const event = out.trace.find((t) => t.event === 'gate_detected')
    expect(event, 'gate_detected trace event').toBeDefined()
    expect(event!.detail?.blockReason).toBe('cloudflare_challenge')
    expect(event!.detail?.signals).toEqual(['cf_interstitial_text'])
  })

  it('offers the browser lane for an interstitial and nothing for a rate limit', async () => {
    const challenge = await subject.fetch(`${server.url}/block/challenge`)
    expect(challenge.escalations).toEqual([
      { from: 'http', to: 'browser_local', trigger: 'blocked:cloudflare_challenge', improved: null },
    ])

    // No lane clears a rate limit; offering one would just move the hammering.
    const rateLimit = await subject.fetch(`${server.url}/block/rate-limit`)
    expect(rateLimit.escalations).toEqual([])
  })

  it('offers a human handoff for a login wall, never a bypass', async () => {
    const out = await subject.fetch(`${server.url}/block/login-wall`)
    expect(out.escalations).toEqual([
      { from: 'http', to: 'browser_local_authed', trigger: 'blocked:login_wall', improved: null },
    ])
  })

  it('leaves an ordinary failure alone rather than inventing a gate', async () => {
    // /error/500 is a plain server error with no gate evidence. Classifying it
    // as a block would be the opposite failure mode from the one being fixed.
    const out = await subject.fetch(`${server.url}/error/500`)
    expect(out.status).toBe('failed')
    expect(out.failureReason).toBe('http_error')
    expect(out.blockReason).toBeNull()
  })

  it('still succeeds on an ordinary article', async () => {
    const out = await subject.fetch(`${server.url}/static/article`)
    expect(out.status).toBe('success')
    expect(out.blockReason).toBeNull()
  })
})

describe('classifier vocabulary matches the contract', () => {
  it('every contract BlockReason is emittable by the classifier', () => {
    // The cross-package drift guard. http-core stays dependency-free and
    // declares its own structural subset of BlockReason; this is where the two
    // are compared, so a reason added to the contract without a classification
    // path fails here instead of shipping as a dead value.
    const emitted = new Set<GateBlockReason>()
    const shapes = [
      { status: 429, body: '' },
      { status: 451, body: '' },
      { status: 401, body: '' },
      { status: 403, body: '<script src="/cdn-cgi/challenge-platform/x"></script>' },
      { status: 403, body: '<div class="g-recaptcha"></div>' },
      { status: 403, body: '<h1>You have been blocked</h1>' },
    ]
    for (const shape of shapes) {
      const v = classifyGate({ ...shape, header: () => null })
      if (v) emitted.add(v.reason)
    }
    expect([...emitted].sort()).toEqual([...BLOCK_REASON].sort())
  })

  it('a GateBlockReason is assignable to a contract BlockReason', () => {
    // Compile-time subset assertion; the runtime body is incidental.
    const fromGate: GateBlockReason = 'cloudflare_challenge'
    const asContract: BlockReason = fromGate
    expect(asContract).toBe(fromGate)
  })
})

describe('the oracle grades every gate it serves', () => {
  it('every blocked fixture declares which gate it is', () => {
    // Without this, `expectedBlockReason` would be an annotation nobody has to
    // supply — and an unscored reason field is one that silently drifts.
    const missing = FIXTURE_TRUTHS.filter(
      (t) => t.expectedStatus === 'blocked' && t.expectedBlockReason == null,
    ).map((t) => t.id)
    expect(missing).toEqual([])
  })

  it('only blocked fixtures declare a gate', () => {
    const stray = FIXTURE_TRUTHS.filter(
      (t) => t.expectedStatus !== 'blocked' && t.expectedBlockReason != null,
    ).map((t) => t.id)
    expect(stray).toEqual([])
  })
})
