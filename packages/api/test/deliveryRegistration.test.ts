import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { MonitorRevision, ScrapeOutcome } from '@w2l/contracts'
import { MonitorStore } from '../../runtime/src/monitorStore.js'
import { runConfiguredMonitor } from '../../runtime/src/monitorRunner.js'
import { createApiEngine } from '../src/engine.js'
import { createApp } from '../src/app.js'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

describe('atomic delivery destination registration', () => {
  it('rolls back subscription creation when historical enqueue fails and retries without an orphan destination', async () => {
    const taskRoot = mkdtempSync(join(tmpdir(), 'w2l-registration-'))
    cleanups.push(() => rmSync(taskRoot, { recursive: true, force: true }))
    const engine = createApiEngine({ taskRoot }); cleanups.push(() => engine.close())
    const dbPath = join(taskRoot, 'section-b-control.sqlite')
    const monitor = MonitorStore.open(dbPath); cleanups.push(() => monitor.close())
    const revision: MonitorRevision = {
      monitorId: 'registration-product', revision: 1, url: 'https://source.example/product', ruleVersion: 'product/v1', createdAt: Date.now(), intervalMs: 1_000, staleAfterMs: 2_000,
      config: { adapter: 'markdown-sections/v1', workspaceId: 'workspace-a', entityKey: 'product', viewKey: 'public', expectedTitle: 'Product', schemaVersion: 'product/v1', conditionalRequests: false, captureMode: 'http', fields: [{ name: 'price', heading: 'Price', type: 'decimal', required: true }] },
    }
    const outcome: ScrapeOutcome = { result: { requestedUrl: revision.url, status: 'success', failureReason: null, blockReason: null, budgetExceeded: null, lane: 'http', escalations: [], markdown: '# Product\n\n## Price\n10.00', truncated: false, truncatedAt: null, compliance: null, evidence: { finalUrl: revision.url, httpStatus: 200, redirectChain: [], contentType: 'text/html', rawBodySha256: 'sample', artifacts: [] }, usage: { wallMs: 1, bytesWire: 1, bytesDecompressed: 1, requestCount: 1, attemptCount: 1, contentTokens: 1, browserMs: 0, externalCostUsd: null }, trace: [] }, links: [] }
    const initial = await runConfiguredMonitor(monitor, revision, async () => outcome, 'historical-event')
    expect(initial.events).toHaveLength(1)
    const db = new Database(dbPath); cleanups.push(() => db.close())
    db.exec("CREATE TRIGGER reject_historical_delivery BEFORE INSERT ON webhook_deliveries BEGIN SELECT RAISE(ABORT,'injected historical enqueue failure'); END")
    const app = createApp(engine)
    const body = JSON.stringify({ id: 'atomic-receiver', monitorId: revision.monitorId, url: 'https://receiver.example/webhook' })
    const failed = await app.request('/v1/delivery/destinations', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    expect(failed.status).toBe(400)
    expect(await failed.json()).toEqual({ error: 'injected historical enqueue failure' })
    expect(engine.listDeliveryDestinations()).toHaveLength(0)
    expect(engine.listDeliveries()).toHaveLength(0)
    expect(monitor.view(revision.monitorId, Date.now()).outbox[0]?.state).toBe('pending')
    db.exec('DROP TRIGGER reject_historical_delivery')
    const success = await app.request('/v1/delivery/destinations', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    expect(success.status).toBe(201)
    expect(engine.listDeliveryDestinations()).toHaveLength(1)
    expect(engine.listDeliveries()).toHaveLength(1)
    expect(engine.listDeliveries()[0]?.eventId).toBe(initial.events[0]?.id)
    const replay = await app.request('/v1/delivery/destinations', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    expect(replay.status).toBe(201)
    expect(engine.listDeliveries()).toHaveLength(1)
  })
})
