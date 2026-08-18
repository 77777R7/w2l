import { DEFAULT_NETWORK_POLICY, estimateTokens } from '@w2l/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ALL_BOILERPLATE } from '../src/chrome.js'
import { FIXTURES, STATEFUL_FIXTURE_IDS, ZIP_BOMB_UNCOMPRESSED_BYTES } from '../src/fixtures.js'
import { startFixtureServer, type FixtureServer } from '../src/server.js'
import { FIXTURE_TRUTHS, bindSuite } from '../src/suite.js'

let server: FixtureServer

beforeAll(async () => {
  server = await startFixtureServer()
})

afterAll(async () => {
  await server.close()
})

/** Fixtures that deliberately never complete; fetching them would hang the suite. */
const HANGING = new Set(['timeout-headers', 'timeout-body'])
/** Resource-limit fixtures; the generic loop must not download them — they have their own tests. */
const OVERSIZED = new Set(['limit-zip-bomb', 'limit-huge-body'])
/** Fixtures whose response depends on prior fetches; only their own test may touch them. */
const STATEFUL = new Set(STATEFUL_FIXTURE_IDS)

async function get(path: string, redirect: RequestRedirect = 'manual'): Promise<Response> {
  return fetch(`${server.url}${path}`, { redirect })
}

describe('suite integrity', () => {
  it('has unique case ids', () => {
    const ids = FIXTURE_TRUTHS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('covers every category the benchmark design requires', () => {
    const categories = new Set(FIXTURE_TRUTHS.map((t) => t.category))
    for (const required of [
      'static',
      'spa',
      'empty',
      'blocked',
      'wrong_page',
      'redirect',
      'timeout',
      'resource_limit',
      'duplicate',
      'http_error',
      'listing',
      'long_content',
      'retry',
    ]) {
      expect(categories, `missing category ${required}`).toContain(required)
    }
  })

  it('annotates every case with a full budget', () => {
    for (const t of FIXTURE_TRUTHS) {
      expect(t.budget.maxTokens, t.id).toBeGreaterThan(0)
      expect(t.budget.maxWallMs, t.id).toBeGreaterThan(0)
      expect(t.budget.maxAttempts, t.id).toBeGreaterThan(0)
    }
  })

  it('gives every contentful case a token range, and every non-contentful case none', () => {
    for (const t of FIXTURE_TRUTHS) {
      if (t.expectedStatus === 'success' || t.expectedStatus === 'partial') {
        expect(t.expectedMainTokens, `${t.id} must carry a token range`).not.toBeNull()
        expect(t.expectedMainTokens!.min).toBeLessThanOrEqual(t.expectedMainTokens!.max)
      }
    }
  })

  it('marks empty as legitimate only where empty_verified is expected', () => {
    for (const t of FIXTURE_TRUTHS) {
      if (t.emptyIsLegit) expect(t.expectedStatus, t.id).toBe('empty_verified')
    }
  })

  it('requires banned boilerplate on every case that expects real content', () => {
    for (const t of FIXTURE_TRUTHS) {
      if (t.mustContain.length > 0 && t.category !== 'support') {
        expect(t.mustNotContain.length, `${t.id} must ban some boilerplate`).toBeGreaterThan(0)
      }
    }
  })

  it('binds relative targets to a live base url', () => {
    const suite = bindSuite(server.url)
    expect(suite.cases).toHaveLength(FIXTURE_TRUTHS.length)
    for (const c of suite.cases) expect(c.target.startsWith(server.url)).toBe(true)
  })
})

describe('served bytes match the annotations', () => {
  const reachable = FIXTURES.filter(
    (f) => !HANGING.has(f.truth.id) && !OVERSIZED.has(f.truth.id) && !STATEFUL.has(f.truth.id),
  )

  it.each(reachable.map((f) => [f.truth.id, f] as const))(
    '%s contains every mustContain string in the raw response',
    async (_id, fixture) => {
      const t = fixture.truth
      // SPA content only exists after script execution; redirects have no body.
      if (t.category === 'spa' || t.category === 'redirect' || t.mustContain.length === 0) return
      const body = await (await get(t.target)).text()
      for (const needle of t.mustContain) {
        expect(body, `${t.id} is missing ${JSON.stringify(needle)}`).toContain(needle)
      }
    },
  )

  it('serves SPA content only inside the inline script', async () => {
    for (const id of ['spa-shell', 'spa-delayed']) {
      const fixture = FIXTURES.find((f) => f.truth.id === id)!
      const body = await (await get(fixture.truth.target)).text()
      for (const needle of fixture.truth.mustContain) {
        expect(body).toContain(needle)
        const withoutScripts = body.replace(/<script[\s\S]*?<\/script>/g, '')
        expect(withoutScripts, `${id} leaks content outside <script>`).not.toContain(needle)
      }
    }
  })

  it('wraps content pages in the boilerplate they must not leak', async () => {
    const body = await (await get('/static/article')).text()
    for (const marker of ALL_BOILERPLATE) expect(body).toContain(marker)
  })

  it('produces deterministic bytes across requests', async () => {
    const a = await (await get('/static/long')).text()
    const b = await (await get('/static/long')).text()
    expect(a).toBe(b)
  })

  it('keeps long-content tokens inside the annotated range', async () => {
    const t = FIXTURE_TRUTHS.find((x) => x.id === 'static-long')!
    const body = await (await get(t.target)).text()
    const text = body.replace(/<[^>]+>/g, ' ')
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThanOrEqual(t.expectedMainTokens!.min)
    expect(tokens).toBeLessThanOrEqual(t.expectedMainTokens!.max)
  })

  it('keeps the CJK fixture inside its annotated range', async () => {
    const t = FIXTURE_TRUTHS.find((x) => x.id === 'static-cjk')!
    const body = await (await get(t.target)).text()
    const article = /<article>([\s\S]*?)<\/article>/.exec(body)![1]!
    const tokens = estimateTokens(article.replace(/<[^>]+>/g, ' '))
    expect(tokens).toBeGreaterThanOrEqual(t.expectedMainTokens!.min)
    expect(tokens).toBeLessThanOrEqual(t.expectedMainTokens!.max)
  })
})

describe('misbehaving responses', () => {
  it('serves the challenge page under 403 and under 200', async () => {
    const forbidden = await get('/block/challenge')
    expect(forbidden.status).toBe(403)
    expect(await forbidden.text()).toContain('Just a moment...')

    const ok = await get('/block/challenge-200')
    expect(ok.status).toBe(200)
    expect(await ok.text()).toContain('Just a moment...')
  })

  it('sets Retry-After on the rate-limit fixture', async () => {
    const res = await get('/block/rate-limit')
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('2')
  })

  it('returns the soft-404 body under HTTP 200 for unrouted paths', async () => {
    const res = await get('/definitely/not/a/real/path-9f3a')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('We could not find that page')
  })

  it('walks a three-hop redirect chain to the destination', async () => {
    let path = '/redirect/chain/3'
    let hops = 0
    for (;;) {
      const res = await get(path)
      if (res.status !== 302) {
        expect(res.status).toBe(200)
        expect(await res.text()).toContain('Arrived after three hops.')
        break
      }
      path = res.headers.get('location')!
      hops++
      expect(hops, 'chain did not terminate').toBeLessThan(10)
    }
    expect(hops).toBe(3)
  })

  it('loops forever between two redirect targets', async () => {
    const a = await get('/redirect/loop/a')
    const b = await get('/redirect/loop/b')
    expect(a.status).toBe(302)
    expect(a.headers.get('location')).toBe('/redirect/loop/b')
    expect(b.headers.get('location')).toBe('/redirect/loop/a')
  })

  it('redirects the wrong-page fixture to the homepage', async () => {
    const res = await get('/wrong/redirect-home')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/home')
  })

  it('ZIP_BOMB_UNCOMPRESSED_BYTES exceeds DEFAULT_NETWORK_POLICY.maxDecompressedBytes', () => {
    expect(ZIP_BOMB_UNCOMPRESSED_BYTES).toBeGreaterThan(DEFAULT_NETWORK_POLICY.maxDecompressedBytes)
  })

  it('serves a gzip payload whose decompressed size exceeds maxDecompressedBytes', async () => {
    const res = await fetch(`${server.url}/limit/zip-bomb`)
    expect(res.headers.get('content-encoding')).toBe('gzip')

    // The wire body is small — a maxBodyBytes check alone would not catch this.
    const wire = Number(res.headers.get('content-length'))
    expect(wire).toBeLessThan(DEFAULT_NETWORK_POLICY.maxBodyBytes)

    // fetch decodes content-encoding itself, so res.body yields the *decompressed*
    // bytes. Count them without accumulating 51 MB in memory.
    const reader = res.body!.getReader()
    let decompressed = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      decompressed += value!.length
    }

    expect(decompressed).toBe(ZIP_BOMB_UNCOMPRESSED_BYTES)
    expect(decompressed).toBeGreaterThan(DEFAULT_NETWORK_POLICY.maxDecompressedBytes)
    // The whole point of the fixture: the expansion ratio hides a 51 MB body
    // behind a wire payload small enough to pass a naive size check.
    expect(decompressed / wire).toBeGreaterThan(100)
  })

  it('HEAD returns Content-Length above maxBodyBytes without sending a body', async () => {
    const res = await fetch(`${server.url}/limit/huge-body`, { method: 'HEAD' })
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(
      DEFAULT_NETWORK_POLICY.maxBodyBytes,
    )
    // HEAD must not deliver any body bytes.
    expect(await res.text()).toBe('')
  })

  it('GET on huge-body streams more bytes than maxBodyBytes', async () => {
    const res = await fetch(`${server.url}/limit/huge-body`)
    const declared = Number(res.headers.get('content-length'))
    expect(declared).toBeGreaterThan(DEFAULT_NETWORK_POLICY.maxBodyBytes)

    // Count streamed bytes without accumulating them.
    const reader = res.body!.getReader()
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value!.length
    }
    expect(received).toBe(declared)
    expect(received).toBeGreaterThan(DEFAULT_NETWORK_POLICY.maxBodyBytes)
  })

  it('serves a PNG where HTML is expected', async () => {
    const res = await get('/limit/binary')
    expect(res.headers.get('content-type')).toBe('image/png')
    await res.body?.cancel()
  })

  it('serves an identical body at all three duplicate URLs', async () => {
    const bodies = await Promise.all(
      ['/duplicate/a', '/duplicate/b', '/duplicate/c?utm_source=x'].map(async (p) =>
        (await get(p)).text(),
      ),
    )
    expect(new Set(bodies).size).toBe(1)
  })

  it('returns an empty 200 for the empty-body fixture', async () => {
    const res = await get('/empty/body')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it('fails once then succeeds on the flaky fixture', async () => {
    await get('/__reset')
    const first = await get('/flaky/once')
    expect(first.status).toBe(503)
    await first.body?.cancel()
    const second = await get('/flaky/once')
    expect(second.status).toBe(200)
    expect(await second.text()).toContain('Succeeded on the second attempt.')
  })

  it('resets stateful fixtures back to attempt one', async () => {
    await get('/__reset')
    expect((await get('/flaky/once')).status).toBe(503)
    await get('/__reset')
    expect((await get('/flaky/once')).status).toBe(503)
  })

  it('never sends headers for the header-timeout fixture', async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 400)
    await expect(
      fetch(`${server.url}/timeout/headers`, { signal: controller.signal }),
    ).rejects.toThrow()
    clearTimeout(timer)
  })

  it('sends headers then dribbles the body forever', async () => {
    const controller = new AbortController()
    const res = await fetch(`${server.url}/timeout/body`, { signal: controller.signal })
    expect(res.status).toBe(200)
    const reader = res.body!.getReader()
    const first = await reader.read()
    expect(first.done).toBe(false)
    controller.abort()
    await reader.cancel().catch(() => {})
  })

  it('survives malformed markup and still carries the required fact', async () => {
    const body = await (await get('/static/malformed')).text()
    expect(body).toContain('The valve seized in the second winter.')
  })
})
