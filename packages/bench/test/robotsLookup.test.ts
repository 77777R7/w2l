import { afterEach, describe, expect, it, vi } from 'vitest'
import { RobotsOriginCache } from '../src/robotsLookup.js'

afterEach(() => vi.restoreAllMocks())

function response(body: string, status = 200, headers: Record<string, string> = { 'content-type': 'text/plain' }): Response {
  return new Response(body, { status, headers })
}

describe('RobotsOriginCache reliability boundaries', () => {
  const origin = 'http://127.0.0.1:8787'
  it('coalesces concurrent origin lookups', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      await new Promise((resolve) => setTimeout(resolve, 5))
      return response('User-agent: *\nCrawl-delay: 2\n')
    })
    const cache = new RobotsOriginCache()
    const results = await Promise.all([
      cache.lookup(`${origin}/a`, '*'),
      cache.lookup(`${origin}/b`, '*'),
      cache.lookup(`${origin}/c`, '*'),
    ])
    expect(calls).toBe(1)
    expect(results.every((entry) => entry?.robots !== null)).toBe(true)
  })

  it('follows robots redirects manually and caps oversized bodies', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/robots-2.txt' } }))
      .mockResolvedValueOnce(response('User-agent: *\nDisallow: /private\n'))
    vi.stubGlobal('fetch', fetcher)
    const cache = new RobotsOriginCache()
    const entry = await cache.lookup(`${origin}/a`, '*')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(entry?.robots?.groups).toHaveLength(1)

    const oversized = new RobotsOriginCache()
    vi.stubGlobal('fetch', async () => response('x'.repeat(1024 * 1024 + 1)))
    const bounded = await oversized.lookup(`${origin}/large`, '*')
    expect(bounded?.robots).toBeNull()
    expect(bounded?.absent).toBe(false)
  })
})
