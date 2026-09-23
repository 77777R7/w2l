import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFixtureServer, type FixtureServer } from '@w2l/fixtures'
import { identityForRoute } from '@w2l/contracts'
import { W2L } from '@w2l/sdk'
import { buildChannels } from '@w2l/bench'
import { createApp } from '../src/app.js'
import { createApiEngine, type ApiEngine } from '../src/engine.js'

function httpOnlyChannels(mode: 'standard' | 'research' | 'authed') {
  return buildChannels(mode, {
    localSubjects: {
      browser_local: {
        fetch: async () => {
          throw new Error('API tests stay on HTTP; browser arm was reached')
        },
      },
    },
  })
}

describe('REST /v1/scrape and /v1/crawl', () => {
  let server: FixtureServer
  let engine: ApiEngine
  let taskRoot: string

  beforeAll(async () => {
    server = await startFixtureServer()
    taskRoot = await mkdtemp(join(tmpdir(), 'w2l-api-'))
    engine = createApiEngine({ taskRoot, channelsFor: httpOnlyChannels })
  })

  afterEach(async () => {
    await engine.close()
  })

  afterAll(async () => {
    await engine.close()
    await server.close()
    await rm(taskRoot, { recursive: true, force: true })
  })

  it('POST /v1/scrape returns a FetchResult for the listing fixture', async () => {
    const app = createApp(engine)
    const res = await app.request('/v1/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `${server.url}/crawl/listing` }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('success')
    expect(body.channelsTried).toEqual(['http'])
    expect(body.ladderTrace).toEqual(expect.any(Array))
    expect(body.summary.wallMs).toBeGreaterThanOrEqual(0)
    expect(body.markdown).toContain('Harbour lantern catalog')
    expect(body.links).toEqual(
      expect.arrayContaining([
        `${server.url}/crawl/item/1`,
        `${server.url}/crawl/listing`,
      ]),
    )
    expect(body).not.toHaveProperty('html')
  })

  it('returns a compact response before serialization and keeps debug opt-in', async () => {
    const app = createApp(engine)
    const request = async (debug: boolean) => app.request('/v1/scrape', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `${server.url}/crawl/listing`, formats: ['markdown'], debug }),
    })
    const compactText = await (await request(false)).text()
    const debugText = await (await request(true)).text()
    const compact = JSON.parse(compactText)
    expect(compact.markdown).toContain('Harbour lantern catalog')
    expect(compact).not.toHaveProperty('trace')
    expect(compact).not.toHaveProperty('ladderTrace')
    expect(compact).not.toHaveProperty('summary')
    expect(compact.usage.totalMs).toBeGreaterThanOrEqual(0)
    expect(JSON.parse(debugText).summary.attempts[0].result.markdown).toContain('Harbour lantern catalog')
    expect(Buffer.byteLength(compactText)).toBeLessThanOrEqual(Buffer.byteLength(debugText) * 0.6)
  })

  it('supports JSON-only and Markdown plus JSON without changing legacy defaults', async () => {
    const app = createApp(engine)
    const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }
    const scrape = async (formats: unknown[]) => (await app.request('/v1/scrape', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `${server.url}/crawl/listing`, formats, debug: false }),
    })).json()
    const only = await scrape([{ type: 'json', schema }])
    expect(only).not.toHaveProperty('markdown')
    expect(only.json.status).toBe('complete')
    expect(only.json.data.title).toBe('Harbour lantern catalog')
    const both = await scrape(['markdown', { type: 'json', schema }])
    expect(both.markdown).toContain('Harbour lantern catalog')
    expect(both.json.data.title).toBe('Harbour lantern catalog')
  })

  it('POST /v1/crawl is 202 and GET /v1/crawl/:id returns CrawlReport', async () => {
    const app = createApp(engine)
    const started = await app.request('/v1/crawl', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: `${server.url}/crawl/listing`,
        maxPages: 4,
        maxDepth: 2,
      }),
    })
    expect(started.status).toBe(202)
    const { taskId } = (await started.json()) as { taskId: string }
    expect(taskId.length).toBeGreaterThan(0)

    await engine.close()
    const got = await app.request(`/v1/crawl/${taskId}`)
    expect(got.status).toBe(200)
    const report = await got.json()
    expect(report.taskId).toBe(taskId)
    expect(report.pagesFetched).toBeGreaterThanOrEqual(4)
    expect(report.status).toBe('completed')
  })

  it('SDK scrape / crawl / getCrawl talk to the same contract', async () => {
    const app = createApp(engine)
    const client = new W2L({
      baseUrl: 'http://w2l.test',
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const path = new URL(url).pathname
        return app.request(path, init)
      }) as typeof fetch,
    })
    const page = await client.scrape(`${server.url}/crawl/listing`)
    expect(page.status).toBe('success')
    const accepted = await client.crawl(`${server.url}/crawl/listing`, { maxPages: 1 })
    await engine.close()
    const report = await client.getCrawl(accepted.taskId)
    expect(report.taskId).toBe(accepted.taskId)
    expect(report.pagesFetched).toBe(1)
  })

  it('returns paginated pages and errors after the engine is restarted', async () => {
    const app = createApp(engine)
    const started = await app.request('/v1/crawl', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `${server.url}/crawl/listing`, maxPages: 4, maxDepth: 2 }),
    })
    const { taskId } = (await started.json()) as { taskId: string }
    await engine.close()

    const restarted = createApiEngine({ taskRoot, channelsFor: httpOnlyChannels })
    const restartedApp = createApp(restarted)
    try {
      const first = await restartedApp.request(`/v1/crawl/${taskId}/pages?limit=2`)
      expect(first.status).toBe(200)
      const firstPage = await first.json() as { items: Array<{ markdown: string | null }>; nextCursor: string | null; hasMore: boolean }
      expect(firstPage.items).toHaveLength(2)
      expect(firstPage.items.every((item) => item.markdown !== null)).toBe(true)
      expect(firstPage.hasMore).toBe(true)

      const second = await restartedApp.request(`/v1/crawl/${taskId}/pages?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`)
      const secondPage = await second.json() as { items: unknown[]; hasMore: boolean }
      expect(secondPage.items).toHaveLength(2)
      expect(secondPage.hasMore).toBe(false)

      const errors = await restartedApp.request(`/v1/crawl/${taskId}/errors?limit=10`)
      expect(errors.status).toBe(200)
      expect((await errors.json()).items).toEqual([])
    } finally {
      await restarted.close()
    }
  })

  it('returns failed pages through the dedicated errors endpoint', async () => {
    const app = createApp(engine)
    const started = await app.request('/v1/crawl', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `${server.url}/error/404`, maxPages: 1 }),
    })
    const { taskId } = (await started.json()) as { taskId: string }
    await engine.close()

    const errors = await app.request(`/v1/crawl/${taskId}/errors?limit=10`)
    expect(errors.status).toBe(200)
    const body = await errors.json() as { items: Array<{ url: string; status: string; failureReason: string | null; trace: unknown[] }> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      url: `${server.url}/error/404`,
      status: 'failed',
      failureReason: 'http_error',
    })
    expect(body.items[0]?.trace).toEqual(expect.any(Array))
  })

  it('cancels a running crawl persistently and preserves completed pages', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slow = createApiEngine({
      taskRoot,
      workerCount: 1,
      channelsFor: () => [{
        id: 'http',
        identity: identityForRoute('standard'),
        fetch: async () => {
          await gate
          return (await httpOnlyChannels('standard')[0]!.fetch(`${server.url}/crawl/listing`))
        },
      }],
    })
    const slowApp = createApp(slow)
    try {
      const started = await slowApp.request('/v1/crawl', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: `${server.url}/crawl/listing`, maxPages: 4 }),
      })
      const { taskId } = (await started.json()) as { taskId: string }
      const cancelled = await slowApp.request(`/v1/crawl/${taskId}/cancel`, { method: 'POST' })
      expect(cancelled.status).toBe(200)
      expect((await cancelled.json()).status).toBe('cancelled')
      release()
      await slow.close()

      const restarted = createApiEngine({ taskRoot, channelsFor: httpOnlyChannels })
      try {
        const report = await restarted.getCrawl(taskId)
        expect(report?.status).toBe('cancelled')
        const pages = await restarted.getCrawlPages(taskId, { limit: 10 })
        expect(pages?.items.length).toBeGreaterThanOrEqual(0)
      } finally {
        await restarted.close()
      }
    } finally {
      release()
      await slow.close()
    }
  })

  it('GET /v1/crawl/:id is failed when scrape throws, not left running', async () => {
    const throwingRoot = await mkdtemp(join(tmpdir(), 'w2l-api-fail-'))
    const throwing = createApiEngine({
      taskRoot: throwingRoot,
      channelsFor: () => [
        {
          id: 'http',
          identity: identityForRoute('standard'),
          fetch: async () => {
            throw new Error('scrape exploded')
          },
        },
      ],
    })
    try {
      const app = createApp(throwing)
      const started = await app.request('/v1/crawl', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: `${server.url}/crawl/listing`, maxPages: 1 }),
      })
      expect(started.status).toBe(202)
      const { taskId } = (await started.json()) as { taskId: string }
      await throwing.close()
      const got = await app.request(`/v1/crawl/${taskId}`)
      expect(got.status).toBe(200)
      const report = await got.json()
      expect(report.taskId).toBe(taskId)
      expect(report.status).toBe('failed')
      expect(report.loopDetected).toBe(false)
    } finally {
      await throwing.close()
      await rm(throwingRoot, { recursive: true, force: true })
    }
  })

  it('hosted token rejects missing or wrong bearer, accepts the matching one', async () => {
    const app = createApp(engine, { token: 'secret' })
    const missing = await app.request('/v1/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `${server.url}/crawl/listing` }),
    })
    expect(missing.status).toBe(401)
    const wrong = await app.request('/v1/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer nope' },
      body: JSON.stringify({ url: `${server.url}/crawl/listing` }),
    })
    expect(wrong.status).toBe(401)
    const ok = await app.request('/v1/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: JSON.stringify({ url: `${server.url}/crawl/listing` }),
    })
    expect(ok.status).toBe(200)
  })

  it('engine close waits for an active standalone scrape before closing channels', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    let closed = false
    const slow = createApiEngine({
      channelsFor: () => [{
        id: 'http',
        identity: identityForRoute('standard'),
        fetch: async (url) => {
          await pending
          return (await (async () => {
            const result = await httpOnlyChannels('standard')[0]!.fetch(url)
            return result
          })())
        },
        close: async () => { closed = true },
      }],
    })
    const scrape = slow.scrape({ url: `${server.url}/crawl/listing` })
    let drained = false
    const closing = slow.close().then(() => { drained = true })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(drained).toBe(false)
    expect(closed).toBe(false)
    release()
    await scrape
    await closing
    expect(drained).toBe(true)
    expect(closed).toBe(true)
  })
})
