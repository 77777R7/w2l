import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { DeliveryStore } from '@w2l/runtime'
import { W2L } from '@w2l/sdk'
import { createApiEngine, type ApiEngine } from '../src/engine.js'
import { createApp } from '../src/app.js'

describe('Delivery API and transactional Monitor integration', () => {
  let root: string, server: Server, engine: ApiEngine, client: W2L, deliveryStore: DeliveryStore
  let price: string, valid: boolean
  let app: ReturnType<typeof createApp>
  const destination = { id: 'receiver-one', monitorId: 'catalog', url: 'https://receiver.example/webhook', secretEnv: 'W2L_WEBHOOK_SECRET_TEST' }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'w2l-api-delivery-'))
    price = '10'; valid = true
    server = createServer((req, res) => {
      if (req.url === '/robots.txt') { res.writeHead(200).end('User-agent: *\nAllow: /'); return }
      res.writeHead(200, { 'content-type': 'text/html' }).end(`<html><body><main><article><h1>${valid ? 'Catalog' : 'Unrelated page'}</h1><h2>Price</h2><p>${price}</p><h2>Description</h2><p>A controlled sample catalog provides stable product identity and an exact decimal price. These integration tests validate that verified source changes create durable event deliveries, while unchanged content and invalid identities leave downstream records untouched. This description supplies enough original page text for deterministic extraction.</p></article></main></body></html>`)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    engine = createApiEngine({ taskRoot: root })
    app = createApp(engine)
    client = new W2L({ baseUrl: 'http://w2l.local', fetch: ((input, init) => app.request(String(input), init)) as typeof fetch })
    deliveryStore = DeliveryStore.open(join(root, 'section-b-control.sqlite'))
    await client.createMonitor({ monitorId: 'catalog', revision: 1, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/catalog`,
      ruleVersion: 'catalog/v1', intervalMs: 60_000, staleAfterMs: 120_000,
      config: { adapter: 'markdown-sections/v1', workspaceId: 'demo', entityKey: 'catalog', viewKey: 'public',
        expectedTitle: 'Catalog', schemaVersion: 'v1', captureMode: 'http', conditionalRequests: false,
        fields: [{ name: 'price', heading: 'Price', type: 'decimal', required: true }] } })
  })

  afterEach(async () => {
    deliveryStore?.close()
    await engine?.close()
    server?.closeAllConnections()
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('backfills existing events idempotently and atomically enqueues only new valid changes', async () => {
    const initial = await client.runMonitor('catalog', { triggerKey: 'initial' })
    expect(await client.listDeliveries()).toEqual([])
    const created = await client.createDeliveryDestination(destination)
    expect(created).toMatchObject(destination)
    expect(await client.createDeliveryDestination(destination)).toEqual(created)
    expect(await client.listDeliveryDestinations({ monitorId: 'catalog' })).toEqual([created])
    expect(await client.listDeliveryDestinations({ monitorId: 'different' })).toEqual([])
    const first = await client.listDeliveries({ monitorId: 'catalog', destinationId: destination.id, state: 'pending' })
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ eventId: initial.events[0]!.id, eventVersion: 1, payload: {
      eventId: initial.events[0]!.id, workspaceId: 'demo', entityKey: 'catalog', viewKey: 'public',
      snapshot: { id: initial.baseline!.id, version: 1 },
    } })
    expect(await client.getDelivery(first[0]!.id)).toEqual({ delivery: first[0], attempts: [] })
    await client.runMonitor('catalog', { triggerKey: 'unchanged' })
    valid = false
    await client.runMonitor('catalog', { triggerKey: 'invalid' })
    expect(await client.listDeliveries()).toHaveLength(1)
    valid = true; price = '12'
    const changed = await client.runMonitor('catalog', { triggerKey: 'change' })
    const deliveries = await client.listDeliveries({ monitorId: 'catalog' })
    expect(deliveries).toHaveLength(2)
    expect(new Set(deliveries.map((delivery) => delivery.eventId))).toEqual(new Set(changed.events.map((event) => event.id)))
    expect(deliveries.map((delivery) => delivery.eventVersion).sort()).toEqual([1, 2])
    expect(changed.outbox.every((outbox) => deliveries.some((delivery) => delivery.eventId === outbox.eventId))).toBe(true)
  })

  it('keeps destination queues independent and resumes events created during a pause', async () => {
    await client.createDeliveryDestination(destination)
    await client.createDeliveryDestination({ ...destination, id: 'receiver-two', url: 'https://second.example/webhook' })
    await client.runMonitor('catalog', { triggerKey: 'initial' })
    expect(await client.listDeliveries()).toHaveLength(2)
    expect((await client.pauseDeliveryDestination(destination.id)).enabled).toBe(false)
    price = '15'
    const changed = await client.runMonitor('catalog', { triggerKey: 'while-paused' })
    const claim = deliveryStore.claim(Date.now(), 10_000)!
    expect(claim.destination.id).toBe('receiver-two')
    expect(deliveryStore.complete(claim.delivery.id, claim.delivery.fencingToken, { state: 'delivered', status: 200, error: null })).toBe(true)
    expect((await client.resumeDeliveryDestination(destination.id)).enabled).toBe(true)
    for (const id of [destination.id, 'receiver-two']) {
      const deliveries = await client.listDeliveries({ destinationId: id })
      expect(deliveries).toHaveLength(2)
      expect(new Set(deliveries.map((delivery) => delivery.eventId))).toEqual(new Set(changed.events.map((event) => event.id)))
    }
    expect(await client.listDeliveries({ destinationId: destination.id, state: 'delivered' })).toEqual([])
    expect(await client.listDeliveries({ destinationId: 'receiver-two', state: 'delivered' })).toHaveLength(1)
  })

  it('exposes attempts and retries a dead letter with the same delivery, event and payload identities', async () => {
    await client.createDeliveryDestination({ ...destination, maxAttempts: 1 })
    await client.runMonitor('catalog', { triggerKey: 'initial' })
    const claim = deliveryStore.claim(Date.now(), 10_000)!
    expect(deliveryStore.complete(claim.delivery.id, claim.delivery.fencingToken, { state: 'dead_letter', status: 410, error: 'receiver gone' })).toBe(true)
    const before = await client.getDelivery(claim.delivery.id)
    expect(before.delivery.state).toBe('dead_letter')
    expect(before.attempts).toHaveLength(1)
    expect(before.attempts[0]).toMatchObject({ outcome: 'dead_letter', status: 410, error: 'receiver gone' })
    const after = await client.retryDelivery(claim.delivery.id)
    expect(after).toMatchObject({ id: before.delivery.id, eventId: before.delivery.eventId, eventVersion: before.delivery.eventVersion,
      state: 'pending', attemptCount: 1, payload: before.delivery.payload })
    expect((await client.getDelivery(after.id)).attempts).toEqual(before.attempts)
    await expect(client.retryDelivery(after.id)).rejects.toThrow('409')
  })

  it('rolls back snapshot, event, outbox and delivery together if enqueueing fails during commit', async () => {
    await client.createDeliveryDestination(destination)
    const baseline = await client.runMonitor('catalog', { triggerKey: 'initial' })
    const db = new Database(join(root, 'section-b-control.sqlite'))
    try {
      db.exec("CREATE TRIGGER reject_delivery BEFORE INSERT ON webhook_deliveries BEGIN SELECT RAISE(ABORT, 'controlled delivery storage failure'); END")
      price = '20'
      await expect(client.runMonitor('catalog', { triggerKey: 'failed-commit' })).rejects.toThrow('500')
      const after = await client.getMonitor('catalog')
      expect(after.baseline?.id).toBe(baseline.baseline?.id)
      expect(after.events).toEqual(baseline.events)
      expect(after.outbox).toEqual(baseline.outbox)
      expect(await client.listDeliveries()).toHaveLength(1)
      expect((db.prepare('SELECT COUNT(*) AS count FROM monitor_snapshots').get() as { count: number }).count).toBe(1)
    } finally { db.exec('DROP TRIGGER reject_delivery'); db.close() }
  })

  it('returns stable client errors for missing IDs, invalid states and invalid destination configuration', async () => {
    expect((await app.request('/v1/deliveries/missing')).status).toBe(404)
    expect((await app.request('/v1/deliveries?state=sent')).status).toBe(400)
    expect((await app.request('/v1/delivery/destinations/missing/pause', { method: 'POST' })).status).toBe(404)
    expect((await app.request('/v1/delivery/destinations/missing/resume', { method: 'POST' })).status).toBe(404)
    expect((await app.request('/v1/deliveries/missing/retry', { method: 'POST' })).status).toBe(409)
    for (const input of [{ ...destination, monitorId: 'missing' }, { ...destination, url: 'http://receiver.example/webhook' },
      { ...destination, maxAttempts: 0 }, { ...destination, secretEnv: 'HOME' }]) {
      await expect(client.createDeliveryDestination(input)).rejects.toThrow('400')
    }
    await client.createDeliveryDestination(destination)
    await expect(client.createDeliveryDestination({ ...destination, url: 'https://other.example/webhook' })).rejects.toThrow('400')
  })
})
