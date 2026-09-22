import { Hono } from 'hono'
import type { ApiEngine } from './engine.js'
import {
  parseCrawlStartRequest,
  parseCrawlPageQuery,
  parseFirecrawlCrawlRequest,
  parseFirecrawlScrapeRequest,
  parseScrapeRequest,
  RequestError,
  parseMonitorRevision,
  wrapCrawlAccepted,
  wrapCrawlStatus,
  wrapScrape,
  type ScrapeResponse,
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
    return c.json(await engine.scrape(req, { signal: c.req.raw.signal }), 200)
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

  app.get('/v1/crawl/:id/pages', async (c) => {
    const result = await engine.getCrawlPages(c.req.param('id'), parseCrawlPageQuery(c.req.query()))
    if (result === null) return c.json({ error: 'not found' }, 404)
    return c.json(result, 200)
  })

  app.get('/v1/crawl/:id/errors', async (c) => {
    const result = await engine.getCrawlErrors(c.req.param('id'), parseCrawlPageQuery(c.req.query()))
    if (result === null) return c.json({ error: 'not found' }, 404)
    return c.json(result, 200)
  })

  app.post('/v1/crawl/:id/cancel', async (c) => {
    const report = await engine.cancelCrawl(c.req.param('id'))
    if (report === null) return c.json({ error: 'not found' }, 404)
    return c.json(report, 200)
  })

  app.post('/v1/monitors/firecrawl-introduction/run', async (c) => {
    const body = await c.req.json() as { triggerKey?: unknown }
    if (!body || typeof body !== 'object' || Array.isArray(body) || (body.triggerKey !== undefined && (typeof body.triggerKey !== 'string' || !body.triggerKey.trim() || body.triggerKey.length > 200))) return c.json({ error: 'invalid triggerKey' }, 400)
    const triggerKey = body.triggerKey as string | undefined
    return c.json(await engine.runFirecrawlMonitor(triggerKey, { signal: c.req.raw.signal }), 200)
  })

  app.get('/v1/monitors/firecrawl-introduction', async (c) => {
    return c.json(await engine.getFirecrawlMonitor(), 200)
  })

  app.post('/v1/monitors', async (c) => {
    const body = await c.req.json()
    const revision = parseMonitorRevision({ ...body, createdAt: Date.now() })
    if (revision.revision !== 1) return c.json({ error: 'new monitor requires revision 1' }, 400)
    try { return c.json(engine.configureMonitor(revision), 201) }
    catch { return c.json({ error: 'monitor configuration conflict' }, 409) }
  })
  app.post('/v1/monitors/:id/revisions', async (c) => {
    const body = await c.req.json()
    const revision = parseMonitorRevision({ ...body, monitorId: c.req.param('id'), createdAt: Date.now() })
    try { return c.json(engine.configureMonitor(revision), 201) }
    catch { return c.json({ error: 'revision conflict; identity is immutable' }, 409) }
  })
  app.get('/v1/monitors', (c) => c.json(engine.listMonitors()))
  app.get('/v1/monitors/:id', (c) => {
    const view = engine.getMonitor(c.req.param('id'))
    return view ? c.json(view) : c.json({ error: 'monitor not found' }, 404)
  })
  app.post('/v1/monitors/:id/run', async (c) => {
    const body = await c.req.json() as { triggerKey?: unknown }
    if (!body || typeof body !== 'object' || Array.isArray(body) || (body.triggerKey !== undefined && (typeof body.triggerKey !== 'string' || !body.triggerKey.trim() || body.triggerKey.length > 200))) return c.json({ error: 'invalid triggerKey' }, 400)
    if (!engine.getMonitor(c.req.param('id'))) return c.json({ error: 'monitor not found' }, 404)
    return c.json(await engine.runMonitor(c.req.param('id'), body.triggerKey as string | undefined, { signal: c.req.raw.signal }))
  })

  app.post('/v1/monitors/:id/runs/:runId/cancel', (c) => {
    try { return c.json(engine.cancelMonitorRun(c.req.param('id'), c.req.param('runId'))) }
    catch { return c.json({error: 'monitor run not found'}, 404) }
  })
  for (const action of ['pause', 'resume'] as const) app.post(`/v1/monitors/:id/${action}`, (c) => {
    try { return c.json(engine.setMonitorEnabled(c.req.param('id'), action === 'resume')) }
    catch { return c.json({error: 'monitor not found'}, 404) }
  })
  app.post('/v1/delivery/destinations', async (c) => {
    try { return c.json(engine.createDeliveryDestination(await c.req.json()), 201) }
    catch (error) { return c.json({error: error instanceof Error ? error.message : 'invalid destination'}, 400) }
  })
  app.get('/v1/delivery/destinations', (c) => c.json(engine.listDeliveryDestinations(c.req.query('monitorId'))))
  for (const action of ['pause', 'resume'] as const) app.post(`/v1/delivery/destinations/:id/${action}`, (c) => {
    try { return c.json(engine.setDeliveryDestinationEnabled(c.req.param('id'), action === 'resume')) }
    catch { return c.json({error: 'destination not found'}, 404) }
  })
  app.get('/v1/deliveries', (c) => {
    const state = c.req.query('state')
    if (state && !['pending','delivering','delivered','dead_letter'].includes(state)) return c.json({error: 'invalid delivery state'}, 400)
    return c.json(engine.listDeliveries({monitorId: c.req.query('monitorId'), destinationId: c.req.query('destinationId'), state: state as import('@w2l/contracts').DeliveryState | undefined}))
  })
  app.get('/v1/deliveries/:id', (c) => {
    const detail = engine.getDelivery(c.req.param('id'))
    return detail ? c.json(detail) : c.json({error: 'delivery not found'}, 404)
  })
  app.post('/v1/deliveries/:id/retry', (c) => {
    try { return c.json(engine.retryDelivery(c.req.param('id'))) }
    catch (error) { return c.json({error: error instanceof Error ? error.message : 'retry conflict'}, 409) }
  })

  app.post('/v1/sessions/managed', async (c) => {
    const body = await c.req.json() as Record<string, unknown>
    if (typeof body.workspaceId !== 'string' || typeof body.accountRef !== 'string' || typeof body.originScope !== 'string') return c.json({ error: 'workspaceId, accountRef, and originScope are required' }, 400)
    return c.json(await engine.createManagedSession({ workspaceId: body.workspaceId, accountRef: body.accountRef, originScope: body.originScope, expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null }), 201)
  })

  app.post('/v1/sessions/:id/authorize', async (c) => {
    const body = await c.req.json() as Record<string, unknown>
    if (typeof body.accountRef !== 'string') return c.json({ error: 'accountRef is required' }, 400)
    try { return c.json(await engine.authorizeManagedSession(c.req.param('id'), body.accountRef), 200) }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : 'authorization rejected' }, 409) }
  })

  app.post('/v1/sessions/:id/revoke', async (c) => {
    try {
      await engine.revokeManagedSession(c.req.param('id'))
      return c.json({ sessionRef: c.req.param('id'), state: 'revoked' }, 200)
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'revoke rejected' }, 409) }
  })

  app.get('/v1/sessions/:id', async (c) => {
    try { return c.json(await engine.getManagedSession(c.req.param('id')), 200) }
    catch { return c.json({ error: 'session not found' }, 404) }
  })

  app.post('/v1/sessions/:id/renew', async (c) => {
    const body = await c.req.json() as Record<string, unknown>
    try { return c.json(await engine.renewManagedSession(c.req.param('id'), typeof body.expiresAt === 'string' ? body.expiresAt : null), 200) }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : 'renewal rejected' }, 409) }
  })

  app.post('/v1/sessions/:id/handoff', async (c) => {
    const body = await c.req.json() as Record<string, unknown>
    if (typeof body.reason !== 'string' || !body.reason.trim()) return c.json({ error: 'reason is required' }, 400)
    try { return c.json(await engine.requestManagedHandoff(c.req.param('id'), body.reason, typeof body.expiresAt === 'string' ? body.expiresAt : null), 200) }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : 'handoff rejected' }, 409) }
  })

  app.post('/v1/sessions/:id/capture', async (c) => {
    const body = await c.req.json() as Record<string, unknown>
    if (typeof body.workspaceId !== 'string' || typeof body.accountRef !== 'string' || typeof body.url !== 'string') return c.json({ error: 'workspaceId, accountRef, and url are required' }, 400)
    return c.json(await engine.captureManagedSession({ sessionRef: c.req.param('id'), workspaceId: body.workspaceId, accountRef: body.accountRef, url: body.url }), 200)
  })

  app.post('/fc/v1/scrape', async (c) => {
    const req = parseFirecrawlScrapeRequest(await c.req.json())
    return c.json(wrapScrape(await engine.scrape({ ...req, debug: true }) as ScrapeResponse), 200)
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
