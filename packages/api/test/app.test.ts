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
    expect(body.markdown).toContain('Harbour lantern catalog')
    expect(body.links).toEqual(
      expect.arrayContaining([
        `${server.url}/crawl/item/1`,
        `${server.url}/crawl/listing`,
      ]),
    )
    expect(body).not.toHaveProperty('html')
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
})
