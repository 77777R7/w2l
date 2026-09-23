import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { identityForRoute, localNetworkPolicy, type MonitorRevision, type MonitorView } from '@w2l/contracts'
import { ResilientHttpSubject } from '@w2l/bench'
import { W2L } from '@w2l/sdk'
import { createApiEngine, type ApiEngine } from '../src/engine.js'
import { createApp } from '../src/app.js'

describe('Gate 2 real HTTP Monitor reliability', () => {
  let root: string, url: string, server: Server, engine: ApiEngine, client: W2L
  let price: string, title: string, force304: boolean, delay: boolean, injectedCalls: number, amazonLike: boolean
  let requests: { validator: string | undefined; status: number }[]
  let started: (() => void) | undefined
  let release: (() => void) | undefined

  function config(id = 'price', options: Partial<MonitorRevision['config']> = {}): Omit<MonitorRevision, 'createdAt'> {
    return { monitorId: id, revision: 1, url, ruleVersion: 'price/v1', intervalMs: 60_000, staleAfterMs: 120_000,
      config: { adapter: 'markdown-sections/v1', workspaceId: 'workspace-a', entityKey: 'product-a', viewKey: 'public',
        expectedTitle: 'Product', schemaVersion: 'price/v1', captureMode: 'http', conditionalRequests: true,
        fields: [{ name: 'price', heading: 'Price', type: 'decimal', required: true }], ...options } }
  }

  function query<T>(sql: string): T[] {
    const db = new Database(join(root, 'section-b-control.sqlite'))
    try { return db.prepare(sql).all() as T[] } finally { db.close() }
  }

  function mutate(sql: string, ...params: unknown[]): void {
    const db = new Database(join(root, 'section-b-control.sqlite'))
    try { db.prepare(sql).run(...params) } finally { db.close() }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'w2l-gate2-http-'))
    price = '10.00'; title = 'Product'; force304 = false; delay = false; injectedCalls = 0; requests = []; amazonLike = false
    started = undefined; release = undefined
    server = createServer(async (req, res) => {
      if (req.url === '/robots.txt') { res.writeHead(200).end('User-agent: *\nAllow: /'); return }
      if (delay) { started?.(); await new Promise<void>((resolve) => { release = resolve }) }
      if (res.destroyed) return
      const etag = `"${title}:${price}"`
      const validator = typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : undefined
      const status = !amazonLike && (force304 || validator === etag) ? 304 : 200
      requests.push({ validator, status })
      if (status === 304) { res.writeHead(304, { etag }).end(); return }
      res.writeHead(200, amazonLike
        ? { 'content-type': 'text/html', 'cache-control': 'no-cache', 'set-cookie': 'session=fixture; Path=/' }
        : { 'content-type': 'text/html', etag, 'cache-control': 'public, max-age=0' })
      res.end(`<html><head><title>${title}</title></head><body><main><article><h1>${title}</h1><h2>Price</h2><p>${price}</p><h2>Description</h2><p>This controlled fixture describes a publicly available sample product with an exact price field. The surrounding description provides stable content so that extraction can preserve the document identity and the complete price section. Changes in the price are the only business changes evaluated by this deterministic integration test.</p></article></main></body></html>`)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/product`
    const subject = new ResilientHttpSubject('standard', localNetworkPolicy())
    engine = createApiEngine({ taskRoot: root, monitorLeaseMs: 120, monitorAttemptTimeoutMs: 5_000,
      channelsFor: () => [{ id: 'http', identity: identityForRoute('standard'), fetch: async (target, _session, execution) => {
        injectedCalls++
        return subject.fetch(target, execution?.deadlineAt, execution?.signal)
      } }],
    })
    const app = createApp(engine)
    client = new W2L({ baseUrl: 'http://w2l.local', fetch: ((input, init) => app.request(String(input), init)) as typeof fetch })
  })

  afterEach(async () => {
    release?.()
    await engine?.close()
    server?.closeAllConnections()
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('captures A/B/A/B as four committed versions and distinct events, then validates a 304 body end to end', async () => {
    await client.createMonitor(config())
    const views: MonitorView[] = []
    for (const [index, value] of ['10.00', '20.00', '10.00', '20.00'].entries()) {
      price = value
      const view = await client.runMonitor('price', { triggerKey: `change:${index}` })
      expect(view.runs[0]?.quality).toBe('valid')
      views.push(view)
    }
    expect(views.map((view) => view.baseline?.version)).toEqual([1, 2, 3, 4])
    expect(views.map((view) => view.runs[0]?.change)).toEqual(['initialized', 'changed', 'changed', 'changed'])
    const final = views[3]!
    expect(new Set(final.events.map((event) => event.id)).size).toBe(4)
    expect(new Set(final.events.map((event) => event.toSnapshotId)).size).toBe(4)
    const unchanged = await client.runMonitor('price', { triggerKey: 'not-modified' })
    expect(requests.at(-1)).toMatchObject({ validator: '"Product:20.00"', status: 304 })
    expect(unchanged.runs[0]).toMatchObject({ quality: 'valid', change: 'unchanged' })
    expect(unchanged.baseline?.id).toBe(final.baseline?.id)
    expect(unchanged.events).toHaveLength(4)
    const observations = query<{ transport_json: string }>('SELECT transport_json FROM monitor_observations')
    expect(JSON.parse(observations.at(-1)!.transport_json)).toMatchObject({ responseStatus: 304, reusedFrom: expect.any(String) })
  })

  it('previews without persistence, queues a manual run, and resumes it after engine restart', async () => {
    const preview = await client.previewMonitor(config())
    expect(preview.assessment.quality).toBe('valid')
    expect(preview.assessment.evidence.length).toBeGreaterThan(0)
    expect(await client.listMonitors()).toEqual([])
    await client.createMonitor({...config(),enabled:false})
    expect((await client.getMonitor('price')).enabled).toBe(false)
    await client.createDeliveryDestination({id:'inbox',monitorId:'price',url:'https://receiver.example/webhook'})
    await client.resumeMonitor('price')
    const queued = await client.enqueueMonitorRun('price',{triggerKey:'first-use'})
    expect(queued.state).toBe('queued')
    expect((await client.enqueueMonitorRun('price',{triggerKey:'first-use'})).id).toBe(queued.id)
    await engine.close()
    engine = createApiEngine({taskRoot:root,networkPolicy:localNetworkPolicy()})
    client = new W2L({baseUrl:'http://w2l.local',fetch:((input,init)=>createApp(engine).request(String(input),init)) as typeof fetch})
    expect((await client.getMonitorRun('price',queued.id)).run.state).toBe('queued')
    await engine.runMonitor('price')
    const detail = await client.getMonitorRun('price',queued.id)
    expect(detail.run).toMatchObject({state:'completed',quality:'valid',change:'initialized'})
    expect(detail.assessment).toMatchObject({quality:'valid',reasons:[]})
    expect(detail.assessment!.evidence.length).toBeGreaterThan(0)
    const page = await client.getDeliveriesPage({monitorId:'price',limit:1})
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.eventId).toBe((await client.getMonitor('price')).events[0]?.id)
  })

  it('reassesses a cached body with the current revision instead of accepting 304 as proof of validity', async () => {
    const initial = config()
    await client.createMonitor(initial)
    const verified = await client.runMonitor('price', { triggerKey: 'valid' })
    const { monitorId: _id, ...next } = initial
    await client.reviseMonitor('price', { ...next, revision: 2, ruleVersion: 'price/v2', config: { ...initial.config!,
      fields: [{ name: 'price', heading: 'New Price', type: 'decimal', required: true }] } })
    const rejected = await client.runMonitor('price', { triggerKey: 'new-rule' })
    expect(requests.at(-1)?.status).toBe(304)
    expect(rejected.runs[0]).toMatchObject({ quality: 'partial', change: 'cannot_verify' })
    expect(rejected.baseline?.id).toBe(verified.baseline?.id)
    expect(rejected.lastVerifiedAt).toBe(verified.lastVerifiedAt)
    expect(rejected.events).toHaveLength(1)
  })

  it.each(['missing', 'corrupt'] as const)('rejects 304 when its cached body is %s', async (kind) => {
    await client.createMonitor(config())
    const first = await client.runMonitor('price', { triggerKey: 'valid' })
    if (kind === 'missing') mutate('DELETE FROM monitor_transport')
    else {
      const row = query<{ key: string; body: string }>('SELECT key,body FROM monitor_transport')[0]!
      const representation = JSON.parse(row.body)
      representation.outcome.result.markdown += '\ncorrupted storage bytes'
      mutate('UPDATE monitor_transport SET body=? WHERE key=?', JSON.stringify(representation), row.key)
    }
    force304 = true
    const rejected = await client.runMonitor('price', { triggerKey: kind })
    expect(requests.at(-1)).toEqual({ validator: undefined, status: 304 })
    expect(rejected.runs[0]).toMatchObject({ quality: 'unknown', change: 'cannot_verify' })
    expect(rejected.baseline?.id).toBe(first.baseline?.id)
    expect(rejected.lastVerifiedAt).toBe(first.lastVerifiedAt)
    expect(rejected.events).toHaveLength(1)
  })

  it('retains the last verified baseline after an invalid 200 representation followed by 304', async () => {
    await client.createMonitor(config())
    const verified = await client.runMonitor('price', { triggerKey: 'valid' })
    title = 'Other product'
    const invalid = await client.runMonitor('price', { triggerKey: 'wrong-title' })
    expect(invalid.runs[0]).toMatchObject({ quality: 'invalid', change: 'cannot_verify' })
    const repeated = await client.runMonitor('price', { triggerKey: 'invalid-304' })
    expect(requests.at(-1)?.status).toBe(304)
    expect(repeated.runs[0]).toMatchObject({ quality: 'invalid', change: 'cannot_verify' })
    expect(repeated.baseline?.id).toBe(verified.baseline?.id)
    expect(repeated.lastVerifiedAt).toBe(verified.lastVerifiedAt)
    expect(repeated.events).toHaveLength(1)
  })

  it('isolates concurrent Monitors sharing a URL and trigger keys across workspace/entity identities', async () => {
    await client.createMonitor(config('one'))
    await client.createMonitor(config('two', { workspaceId: 'workspace-b', entityKey: 'product-b' }))
    const initial = await Promise.all(['one', 'two'].map((id) => client.runMonitor(id, { triggerKey: 'same-trigger' })))
    expect(initial.map((view) => view.baseline?.version)).toEqual([1, 1])
    expect(initial[0]!.baseline?.id).not.toBe(initial[1]!.baseline?.id)
    expect(requests.map((request) => request.validator)).toEqual([undefined, undefined])
    expect(query('SELECT key FROM monitor_transport')).toHaveLength(2)
    price = '30.00'
    const changed = await Promise.all(['one', 'two'].map((id) => client.runMonitor(id, { triggerKey: 'same-change' })))
    expect(changed.map((view) => view.baseline?.version)).toEqual([2, 2])
    for (const view of changed) {
      expect(view.events).toHaveLength(2)
      expect(view.events.every((event) => event.monitorId === view.revision.monitorId)).toBe(true)
      expect(view.runs.map((run) => run.triggerKey).sort()).toEqual(['same-change', 'same-trigger'])
      expect(view.outbox.every((item) => view.events.some((event) => event.id === item.eventId))).toBe(true)
    }
    const replay = await client.runMonitor('one', { triggerKey: 'same-trigger' })
    expect(replay.runs).toHaveLength(2)
    expect(new Set(changed.flatMap((view) => view.events.map((event) => event.id))).size).toBe(4)
  })

  it('keeps capture mode independent from cache settings and rejects unsupported combinations', async () => {
    await client.createMonitor(config('http-no-cache', { conditionalRequests: false }))
    await client.runMonitor('http-no-cache', { triggerKey: 'one' })
    await client.runMonitor('http-no-cache', { triggerKey: 'two' })
    expect(injectedCalls).toBe(0)
    expect(requests.map((request) => request.validator)).toEqual([undefined, undefined])
    await client.createMonitor(config('ladder', { captureMode: 'ladder', conditionalRequests: false }))
    expect((await client.runMonitor('ladder', { triggerKey: 'one' })).runs[0]?.quality).toBe('valid')
    expect(injectedCalls).toBe(1)
    await expect(client.createMonitor(config('unsupported', { captureMode: 'ladder', conditionalRequests: true }))).rejects.toThrow('400')
  })

  it('does not claim 304 reuse or store a public body for cookie-bearing no-cache pages without validators', async () => {
    amazonLike = true
    await client.createMonitor(config('cookie-page'))
    await client.runMonitor('cookie-page', { triggerKey: 'first' })
    await client.runMonitor('cookie-page', { triggerKey: 'second' })
    expect(requests).toEqual([{ validator: undefined, status: 200 }, { validator: undefined, status: 200 }])
    expect(query('SELECT key FROM monitor_transport')).toHaveLength(0)
    const observations = query<{ outcome_json: string }>('SELECT outcome_json FROM monitor_observations ORDER BY observed_at')
    expect(observations).toHaveLength(2)
    for (const row of observations) {
      const outcome = JSON.parse(row.outcome_json)
      expect(outcome.result.evidence).toMatchObject({ cacheControl: 'no-cache', setsCookie: true, etag: null, lastModified: null })
    }
  })

  it('cancels actual delayed capture, fences its result, and preserves pause/resume controls', async () => {
    await client.createMonitor(config())
    delay = true
    const requestStarted = new Promise<void>((resolve) => { started = resolve })
    const running = client.runMonitor('price', { triggerKey: 'slow' })
    await requestStarted
    const run = (await client.getMonitor('price')).runs[0]!
    const cancelled = await client.cancelMonitorRun('price', run.id)
    expect(cancelled.runs[0]?.state).toBe('cancelled')
    const result = await running
    expect(result.baseline).toBeNull()
    expect(result.events).toHaveLength(0)
    expect(result.runs[0]?.state).toBe('cancelled')
    release?.(); delay = false
    expect((await client.pauseMonitor('price')).enabled).toBe(false)
    expect((await client.resumeMonitor('price')).enabled).toBe(true)
    expect((await client.runMonitor('price', { triggerKey: 'after-cancel' })).baseline?.version).toBe(1)
  })

  it.each(['deadline', 'signal'] as const)('propagates an execution %s through a delayed real HTTP capture', async (kind) => {
    await client.createMonitor(config())
    delay = true
    const controller = new AbortController()
    const requestStarted = new Promise<void>((resolve) => { started = resolve })
    const running = engine.runMonitor('price', kind, kind === 'deadline'
      ? { deadlineAt: Date.now() + 100 }
      : { signal: controller.signal })
    await requestStarted
    if (kind === 'signal') controller.abort(new Error('caller cancelled'))
    const view = await running
    expect(view.runs[0]?.state).toBe(kind === 'deadline' ? 'expired' : 'cancelled')
    expect(view.baseline).toBeNull()
    expect(view.events).toEqual([])
    expect(requests).toEqual([])
  })
})
