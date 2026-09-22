import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { localNetworkPolicy } from '@w2l/contracts'
import { W2L } from '@w2l/sdk'
import { createApp } from '../src/app.js'
import { createApiEngine, type ApiEngine } from '../src/engine.js'

describe('persistent URL-array batch', () => {
  const cleanup: Array<() => Promise<void>> = []
  afterEach(async () => { while (cleanup.length) await cleanup.pop()!() })

  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'w2l-batch-'))
    let slow = false
    let release = () => {}
    let slowStarted = () => {}
    const seen: string[] = []
    const server = createServer(async (req, res) => {
      if (req.url === '/robots.txt') { res.writeHead(200).end('User-agent: *\nAllow: /'); return }
      seen.push(req.url ?? '')
      if (req.url === '/item/2' && slow) {
        slowStarted()
        await new Promise<void>(resolve => { release = resolve })
      }
      if (res.destroyed) return
      const number = req.url?.split('/').at(-1) ?? '0'
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<html><head><title>Fixture item ${number}</title></head><body><main><article><h1>Fixture item ${number}</h1><p>This is a long and stable product page for item ${number}. It has enough independent body text for the extraction cascade to accept it as a real article, and it provides a deterministic title to map directly into the requested JSON schema.</p></article></main></body></html>`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const engine = () => createApiEngine({ taskRoot: root, networkPolicy: { ...localNetworkPolicy(), perHostConcurrency: 1, perHostMinDelayMs: 0 }, workerCount: 2 })
    cleanup.push(async () => { release(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }) })
    return { origin, root, engine, seen, setSlow: (value: boolean) => { slow = value }, setStarted: (fn: () => void) => { slowStarted = fn }, release: () => release() }
  }

  it('persists JSON-only results, paginates all URLs, and sends a terminal SSE event', async () => {
    const f = await fixture()
    const engine = f.engine()
    cleanup.push(() => engine.close())
    const app = createApp(engine)
    const client = new W2L({ baseUrl: 'http://w2l.test', fetch: ((input, init) => app.request(String(input), init)) as typeof fetch })
    const urls = [1, 2, 3].map(n => `${f.origin}/item/${n}`)
    const accepted = await client.batchScrape(urls, { formats: [{ type: 'json', schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }] })
    const report = await client.waitBatch(accepted.taskId)
    expect(report).toMatchObject({ status: 'completed', requested: 3, completed: 3, remaining: 0 })
    const first = await client.getBatchItems(accepted.taskId, { limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.hasMore).toBe(true)
    const second = await client.getBatchItems(accepted.taskId, { limit: 2, cursor: first.nextCursor! })
    expect(second.items).toHaveLength(1)
    const items = [...first.items, ...second.items]
    expect(new Set(items.map(item => item.url))).toEqual(new Set(urls))
    expect(items.every(item => item.markdown === null && item.json?.status === 'complete')).toBe(true)
    expect(items.map(item => (item.json?.data as { title: string }).title).sort()).toEqual(['Fixture item 1', 'Fixture item 2', 'Fixture item 3'])
    expect(items.every(item => item.audit === undefined && item.trace.length === 0)).toBe(true)
    const debug = await client.getBatchItems(accepted.taskId, { limit: 1, debug: true })
    expect(debug.items[0]?.audit?.summary).toBeDefined()
    expect(debug.items[0]?.audit?.summary.attempts[0]?.result.markdown).toBeNull()
    expect((await app.request(`/v1/batches/${accepted.taskId}/items?limit=51`)).status).toBe(400)
    const events = await app.request(`/v1/batches/${accepted.taskId}/events`)
    expect(events.headers.get('content-type')).toContain('text/event-stream')
    expect(await events.text()).toContain('event: complete')
  })

  it('recovers an interrupted URL without refetching completed items', async () => {
    const f = await fixture()
    f.setSlow(true)
    let started!: () => void
    const secondStarted = new Promise<void>(resolve => { started = resolve })
    f.setStarted(started)
    const engine1 = f.engine()
    const app1 = createApp(engine1)
    const client1 = new W2L({ baseUrl: 'http://w2l.test', fetch: ((input, init) => app1.request(String(input), init)) as typeof fetch })
    const accepted = await client1.batchScrape([`${f.origin}/item/1`, `${f.origin}/item/2`])
    await secondStarted
    await engine1.close({ cancelActive: true })
    const paused = await client1.getBatch(accepted.taskId)
    expect(paused.status).toBe('paused')
    f.setSlow(false); f.release()
    const engine2 = f.engine()
    cleanup.push(() => engine2.close())
    const app2 = createApp(engine2)
    const client2 = new W2L({ baseUrl: 'http://w2l.test', fetch: ((input, init) => app2.request(String(input), init)) as typeof fetch })
    const recovered = await client2.waitBatch(accepted.taskId)
    expect(recovered).toMatchObject({ status: 'completed', requested: 2, completed: 2, remaining: 0 })
    expect(f.seen.filter(url => url === '/item/1')).toHaveLength(1)
    expect(f.seen.filter(url => url === '/item/2')).toHaveLength(2)
  })

  it('pages a 100-URL durable batch without returning the whole result set at once', async () => {
    const f = await fixture()
    const engine = f.engine()
    cleanup.push(() => engine.close())
    const app = createApp(engine)
    const client = new W2L({ baseUrl: 'http://w2l.test', fetch: ((input, init) => app.request(String(input), init)) as typeof fetch })
    const urls = Array.from({ length: 100 }, (_, n) => `${f.origin}/item/${n + 1}`)
    const accepted = await client.batchScrape(urls)
    expect(await client.waitBatch(accepted.taskId)).toMatchObject({ status: 'completed', requested: 100, completed: 100 })
    const first = await client.getBatchItems(accepted.taskId, { limit: 50 })
    expect(first.items).toHaveLength(50)
    expect(first.hasMore).toBe(true)
    const second = await client.getBatchItems(accepted.taskId, { limit: 50, cursor: first.nextCursor! })
    expect(second.items).toHaveLength(50)
    expect(second.hasMore).toBe(false)
    expect(new Set([...first.items, ...second.items].map(item => item.url))).toEqual(new Set(urls))
    expect(first.items.every(item => item.audit === undefined && item.trace.length === 0)).toBe(true)
  })
})
