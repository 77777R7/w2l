import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FIRECRAWL_MONITOR_ID, type MonitorView } from '@w2l/contracts'
import { createApiEngine, type ApiEngine } from '../src/engine.js'
import { createApp } from '../src/app.js'

let root: string | undefined
let source: Server | undefined
let engine: ApiEngine | undefined
afterEach(async () => {
  await engine?.close({ cancelActive: true })
  source?.closeAllConnections()
  if (source?.listening) await new Promise<void>(resolve => source!.close(() => resolve()))
  if (root) await rm(root, { recursive: true, force: true })
})

describe('synchronous Monitor HTTP request cancellation', () => {
  it.each(['configured', 'legacy'] as const)('propagates Request.signal through the %s run route to the origin', async route => {
    root = await mkdtemp(join(tmpdir(), 'w2l-http-cancel-'))
    let started!: () => void
    const active = new Promise<void>(resolve => { started = resolve })
    let closed = false
    source = createServer((req, res) => {
      if (req.url === '/robots.txt') { res.end('User-agent: *\nAllow: /'); return }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.write('<html><body><article>Streaming source')
      res.on('close', () => { closed = true })
      started()
    })
    await new Promise<void>(resolve => source!.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(source.address() as AddressInfo).port}/product`
    const id = route === 'legacy' ? FIRECRAWL_MONITOR_ID : 'price'
    engine = createApiEngine({ taskRoot: root })
    engine.configureMonitor({ monitorId: id, revision: 1, url, ruleVersion: 'price/v1', intervalMs: 60_000, staleAfterMs: 120_000, createdAt: Date.now(), config: {
      adapter: 'markdown-sections/v1', workspaceId: 'test', entityKey: 'price', viewKey: 'public', expectedTitle: 'Product', schemaVersion: 'price/v1', captureMode: 'http', conditionalRequests: false,
      fields: [{ name: 'price', heading: 'Price', type: 'decimal', required: true }],
    } })
    const controller = new AbortController()
    const app = createApp(engine)
    const pending = app.fetch(new Request(`http://w2l.local/v1/monitors/${id}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ triggerKey: 'cancel-request' }), signal: controller.signal }))
    await active
    controller.abort(new DOMException('caller stopped waiting', 'AbortError'))
    const response = await pending
    const view = await response.json() as MonitorView
    expect(response.status).toBe(200)
    expect(view.runs[0]?.state).toBe('cancelled')
    expect(view.events).toEqual([])
    expect(view.baseline).toBeNull()
    await expect.poll(() => closed).toBe(true)
  })
})
