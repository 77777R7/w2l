import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { localNetworkPolicy } from '@w2l/contracts'
import { createGuardedDispatcher } from '../src/egress.js'
import { RobotsOriginCache } from '../src/robotsLookup.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

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
    await cache.teardown()
    await cache.teardown()
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

  it('fails closed for hosted public requests on robots 5xx and network errors, while 4xx stays unavailable', async () => {
    const url = `${origin}/page`
    const decision = async (fetcher: () => Promise<Response>, failClosed = true) => {
      vi.stubGlobal('fetch', fetcher)
      const cache = new RobotsOriginCache(undefined, undefined, failClosed)
      try {
        const entry = await cache.lookup(url, 'w2l-test')
        return { entry, result: cache.decision(entry, url, 'w2l-test') }
      } finally { await cache.teardown() }
    }
    expect((await decision(async () => response('temporarily unavailable', 503))).result.decision).toBe('disallowed')
    const unreachable = await decision(async () => { throw new Error('connection refused') })
    expect(unreachable.entry?.absent).toBe(false)
    expect(unreachable.result.decision).toBe('disallowed')
    const absent = await decision(async () => response('not found', 404))
    expect(absent.entry?.absent).toBe(true)
    expect(absent.result.decision).toBe('no_robots')
    expect((await decision(async () => response('temporarily unavailable', 503), false)).result.decision).toBe('no_robots')
  })

  it('treats a redirected robots 404 as unavailable, not as a redirect failure', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/different-robots.txt' } }))
      .mockResolvedValueOnce(response('not found', 404))
    vi.stubGlobal('fetch', fetcher)
    const cache = new RobotsOriginCache(undefined, undefined, true)
    try {
      const entry = await cache.lookup(`${origin}/page`, 'w2l-test')
      expect(entry?.absent).toBe(true)
      expect(cache.decision(entry, `${origin}/page`, 'w2l-test').decision).toBe('no_robots')
    } finally { await cache.teardown() }
  })

  it('uses the guarded connector for a real robots request', async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/plain')
      res.end('User-agent: *\nDisallow: /private\n')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing fixture port')
    const resolver = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }])
    const policy = localNetworkPolicy()
    const dispatcher = createGuardedDispatcher(policy, resolver)
    try {
      const cache = new RobotsOriginCache(policy, dispatcher)
      const entry = await cache.lookup(`http://localhost:${address.port}/page`, 'w2l-test')
      expect(entry?.robots?.groups).toHaveLength(1)
      expect(resolver).toHaveBeenCalled()
    } finally {
      await dispatcher.close()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
