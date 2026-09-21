import { Hono } from 'hono'
import type { ApiEngine } from './engine.js'
import {
  parseCrawlStartRequest,
  parseFirecrawlCrawlRequest,
  parseFirecrawlScrapeRequest,
  parseScrapeRequest,
  RequestError,
  wrapCrawlAccepted,
  wrapCrawlStatus,
  wrapScrape,
} from '@w2l/contracts'

export interface AppOptions {
  token?: string | null
}

export function createApp(engine: ApiEngine, options: AppOptions = {}): Hono {
  const app = new Hono()
  const token = options.token ?? null

  if (token !== null && token.length > 0) {
    app.use('*', async (c, next) => {
      const header = c.req.header('authorization') ?? ''
      const presented = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
      if (presented.length === 0 || presented !== token) {
        return c.json({ error: 'unauthorized' }, 401)
      }
      await next()
    })
  }

  app.post('/v1/scrape', async (c) => {
    const req = parseScrapeRequest(await c.req.json())
    return c.json(await engine.scrape(req), 200)
  })

  app.post('/v1/crawl', async (c) => {
    const req = parseCrawlStartRequest(await c.req.json())
    return c.json(await engine.startCrawl(req), 202)
  })

  app.get('/v1/crawl/:id', async (c) => {
    const id = c.req.param('id')
    const report = await engine.getCrawl(id)
    if (report === null) return c.json({ error: 'not found' }, 404)
    return c.json(report, 200)
  })

  app.post('/v1/monitors/firecrawl-introduction/run', async (c) => {
    const body = await c.req.json() as { triggerKey?: unknown }
    if (!body || typeof body !== 'object' || Array.isArray(body) || (body.triggerKey !== undefined && (typeof body.triggerKey !== 'string' || !body.triggerKey.trim() || body.triggerKey.length > 200))) return c.json({ error: 'invalid triggerKey' }, 400)
    const triggerKey = body.triggerKey as string | undefined
    return c.json(await engine.runFirecrawlMonitor(triggerKey), 200)
  })

  app.get('/v1/monitors/firecrawl-introduction', async (c) => {
    return c.json(await engine.getFirecrawlMonitor(), 200)
  })

  app.post('/fc/v1/scrape', async (c) => {
    const req = parseFirecrawlScrapeRequest(await c.req.json())
    return c.json(wrapScrape(await engine.scrape(req)), 200)
  })

  app.post('/fc/v1/crawl', async (c) => {
    const body = await c.req.json()
    const req = parseFirecrawlCrawlRequest(body)
    const accepted = await engine.startCrawl(req)
    return c.json(wrapCrawlAccepted(accepted, req.url), 200)
  })

  app.get('/fc/v1/crawl/:id', async (c) => {
    const id = c.req.param('id')
    const detail = await engine.getCrawlWithSteps(id)
    if (detail === null) return c.json({ error: 'not found' }, 404)
    return c.json(wrapCrawlStatus(detail.report, detail.steps), 200)
  })

  app.onError((err, c) => {
    if (err instanceof RequestError) return c.json({ error: err.message }, 400)
    if (err instanceof SyntaxError) return c.json({ error: 'body must be JSON' }, 400)
    return c.json({ error: err instanceof Error ? err.message : 'internal error' }, 500)
  })

  return app
}
