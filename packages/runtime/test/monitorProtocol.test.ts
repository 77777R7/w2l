import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { DocumentAssessment, MonitorRevision, MonitorRun, ScrapeOutcome } from '@w2l/contracts'
import { MonitorStore, type MonitorStoreTestOptions } from '../src/monitorStore.js'
import { DeliveryStore } from '../src/deliveryStore.js'
import { runConfiguredMonitor } from '../src/monitorRunner.js'

const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()) })
function path(): string {
  const dir = mkdtempSync(join(tmpdir(), 'w2l-monitor-protocol-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return join(dir, 'control.sqlite')
}
function openStore(dbPath = path(), options: MonitorStoreTestOptions = {}): MonitorStore {
  const store = MonitorStore.open(dbPath, options)
  cleanups.push(() => { try { store.close() } catch {} })
  return store
}
function revision(id = 'monitor-a', url = 'https://source.example/product', cached = false): MonitorRevision {
  return { monitorId: id, revision: 1, url, ruleVersion: 'product/v1', intervalMs: 1_000, staleAfterMs: 2_000, createdAt: 1_000,
    config: { adapter: 'markdown-sections/v1', workspaceId: 'workspace-a', entityKey: id, viewKey: 'public', expectedTitle: 'Product', schemaVersion: 'product/v1', conditionalRequests: cached, captureMode: 'http', fields: [{ name: 'price', heading: 'Price', type: 'decimal', required: true }] } }
}
function outcome(url = 'https://source.example/product', value = '10.00'): ScrapeOutcome {
  return { result: { requestedUrl: url, status: 'success', failureReason: null, blockReason: null, budgetExceeded: null, lane: 'http', escalations: [], markdown: `# Product\n\n## Price\n${value}`, truncated: false, truncatedAt: null, compliance: null, evidence: { finalUrl: url, httpStatus: 200, redirectChain: [], contentType: 'text/html', rawBodySha256: 'source-hash', artifacts: [], etag: '"price-a"', cacheControl: 'public,max-age=0', setsCookie: false, vary: null }, usage: { wallMs: 1, bytesWire: 1, bytesDecompressed: 1, requestCount: 1, attemptCount: 1, contentTokens: 1, browserMs: 0, externalCostUsd: null }, trace: [] }, links: [] }
}
const assessment: DocumentAssessment = { ruleVersion: 'product/v1', quality: 'valid', reasons: [], fields: { price: { state: 'present', value: '10', evidenceRefs: ['price:20:25'] } }, evidence: [{ field: 'price', start: 20, end: 25, quote: '10.00' }] }
function observe(store: MonitorStore, run: MonitorRun, id: string, now: number, value: DocumentAssessment = assessment): void {
  store.recordObservation({ id: `observation-${id}`, runId: run.id, attemptId: run.attemptId!, observedAt: now, clientWallMs: 1, markdownSha256: 'source-body', outcome: outcome(), error: null }, `assessment-${id}`, value, undefined, now)
}
function commit(store: MonitorStore, run: MonitorRun, id: string, now: number, value: DocumentAssessment = assessment) { return store.commit(run.id, `observation-${id}`, `assessment-${id}`, value, now) }

describe('Monitor execution and commit protocol', () => {
  it.each(['{', '{}'])('ignores malformed transport cache %s and completes an unconditional capture', async body => {
    const dbPath = path()
    // This case tests malformed-cache recovery, not timing. Keep its lease
    // above busy-runner scheduling jitter; lease expiry is tested separately.
    const store = openStore(dbPath, { leaseMs: 5_000, attemptTimeoutMs: 30_000 })
    const config = revision(undefined, undefined, true)
    await runConfiguredMonitor(store, config, async () => outcome(), 'initial')
    const db = new Database(dbPath); cleanups.push(() => db.close())
    expect(db.prepare('SELECT COUNT(*) AS count FROM monitor_transport').get()).toEqual({ count: 1 })
    db.prepare('UPDATE monitor_transport SET body=?').run(body)
    let captured = false
    const view = await runConfiguredMonitor(store, config, async options => {
      captured = true
      expect(options.etag).toBeUndefined()
      expect(options.lastModified).toBeUndefined()
      return outcome()
    }, 'after-corruption')
    expect(captured).toBe(true)
    expect(view.runs.find(run => run.triggerKey === 'after-corruption')).toMatchObject({ state: 'completed', change: 'unchanged' })
    expect(view.baseline?.version).toBe(1)
    expect(view.events).toHaveLength(1)
    expect(JSON.parse((db.prepare('SELECT body FROM monitor_transport').get() as { body: string }).body).outcome.result.markdown).toContain('10.00')
  })
  it('makes redundant resume idempotent while an attempt owns the monitor', () => {
    const store = openStore()
    store.createOrGetRevision(revision())
    const owner = store.startRun('monitor-a', 'trigger', 1_000)
    const before = store.view('monitor-a', 1_000)
    const after = store.setEnabled('monitor-a', true, 1_001)
    expect(after.controlEpoch).toBe(before.controlEpoch)
    expect(after.nextRunAt).toBe(before.nextRunAt)
    expect(() => store.assertExecution(owner, 1_002)).not.toThrow()
    expect(store.claim('monitor-a', 1_003, 'trigger')).toBeNull()
  })
  it('persists origin Retry-After across pause/resume, cancellation, manual triggers and other monitors', () => {
    const dbPath = path()
    const store = openStore(dbPath)
    store.createOrGetRevision(revision())
    store.createOrGetRevision(revision('monitor-b', 'https://source.example/another-product'))
    store.createOrGetRevision(revision('monitor-other', 'https://other.example/product'))
    const owner = store.startRun('monitor-a', 'rate-limited', 1_000)
    store.deferRun(owner, 61_000, 1_001)
    store.setEnabled('monitor-a', false, 1_002)
    store.setEnabled('monitor-a', true, 1_003)
    expect(store.view('monitor-a', 1_003).nextRunAt).toBe(61_000)
    const waiting = store.startRun('monitor-a', 'manual-after-resume', 1_004)
    expect(waiting).toMatchObject({ state: 'waiting_retry', nextAttemptAt: 61_000, attemptId: null })
    store.cancel('monitor-a', waiting.id, 1_005)
    const secondWaiting = store.startRun('monitor-a', 'manual-after-cancel', 1_006)
    expect(secondWaiting).toMatchObject({ state: 'waiting_retry', nextAttemptAt: 61_000 })
    expect(store.startRun('monitor-b', 'same-origin', 1_007)).toMatchObject({ state: 'waiting_retry', nextAttemptAt: 61_000 })
    expect(store.startRun('monitor-other', 'different-origin', 1_007).state).toBe('running')
    store.close()
    const reopened = openStore(dbPath)
    expect(reopened.claim('monitor-a', 60_999)).toBeNull()
    const recovered = reopened.claim('monitor-a', 61_000)!
    expect(recovered.id).toBe(secondWaiting.id)
    expect(recovered.state).toBe('running')
    expect(recovered.attemptId).not.toBeNull()
  })
  it('interrupts shutdown without cancelling the logical run and resumes it after reopening', async () => {
    const dbPath = path()
    const store = openStore(dbPath)
    const config = revision()
    const controller = new AbortController()
    const view = await runConfiguredMonitor(store, config, async () => {
      controller.abort(new DOMException('service shutdown', 'ShutdownError'))
      return await new Promise<ScrapeOutcome>(() => {})
    }, 'shutdown-trigger', { signal: controller.signal })
    const interrupted = view.runs[0]!
    expect(interrupted.state).toBe('waiting_retry')
    expect(store.attempts(interrupted.id)[0]?.state).toBe('interrupted')
    expect(view.events).toHaveLength(0)
    store.close()
    const reopened = openStore(dbPath)
    const resumed = await runConfiguredMonitor(reopened, config, async () => outcome(), 'shutdown-trigger')
    expect(resumed.runs).toHaveLength(1)
    expect(resumed.runs[0]).toMatchObject({ id: interrupted.id, state: 'completed', change: 'initialized' })
    expect(resumed.runs[0]?.attemptId).not.toBe(interrupted.attemptId)
    expect(resumed.events).toHaveLength(1)
  })
  it('rejects both old observations and old commits after a different connection reclaims the lease', () => {
    const dbPath = path()
    const first = openStore(dbPath, { leaseMs: 30, attemptTimeoutMs: 1_000 })
    const second = openStore(dbPath, { leaseMs: 30, attemptTimeoutMs: 1_000 })
    first.createOrGetRevision(revision())
    const stale = first.startRun('monitor-a', 'same-logical-run', 1_000)
    observe(first, stale, 'stale', 1_001)
    const owner = second.claim('monitor-a', 1_031)!
    expect(owner.id).toBe(stale.id)
    expect(() => observe(first, stale, 'late', 1_032)).toThrow('stale observation attempt')
    expect(() => commit(first, stale, 'stale', 1_032)).toThrow('unbound or modified assessment')
    observe(second, owner, 'fresh', 1_032)
    commit(second, owner, 'fresh', 1_033)
    expect(() => commit(first, stale, 'stale', 1_034)).toThrow('unbound or modified assessment')
    expect(first.view('monitor-a', 1_035).events).toHaveLength(1)
  })
  it('replays a lost commit receipt without creating a second event or delivery', () => {
    const dbPath = path()
    const store = openStore(dbPath)
    const deliveries = DeliveryStore.open(dbPath); cleanups.push(() => deliveries.close())
    store.createOrGetRevision(revision())
    deliveries.createDestination({ id: 'receipt-sink', monitorId: 'monitor-a', url: 'https://receiver.example/webhook' }, 1_000)
    const run = store.startRun('monitor-a', 'receipt-trigger', 1_000)
    observe(store, run, 'receipt', 1_001)
    const original = commit(store, run, 'receipt', 1_002)
    const retried = commit(store, run, 'receipt', 1_003)
    expect(retried).toEqual(original)
    expect(store.startRun('monitor-a', 'receipt-trigger', 1_004).id).toBe(run.id)
    expect(store.view('monitor-a', 1_004).events).toHaveLength(1)
    expect(deliveries.listDeliveries()).toHaveLength(1)
    expect(deliveries.listDeliveries()[0]?.eventId).toBe(original?.id)
  })
  it('rejects stale expected-baseline state before creating another event', () => {
    const dbPath = path()
    const store = openStore(dbPath)
    store.createOrGetRevision(revision())
    const initial = store.startRun('monitor-a', 'initial', 1_000)
    observe(store, initial, 'initial', 1_001); commit(store, initial, 'initial', 1_002)
    const next = store.startRun('monitor-a', 'conflicted', 1_003)
    const changed = { ...assessment, fields: { price: { state: 'present' as const, value: '12', evidenceRefs: ['new'] } } }
    observe(store, next, 'conflicted', 1_004, changed)
    const db = new Database(dbPath); cleanups.push(() => db.close())
    // Simulate a baseline moved by a competing/migrating writer after this run claimed it.
    db.prepare('UPDATE monitor_baselines SET snapshot_id=? WHERE monitor_id=?').run('competing-snapshot', 'monitor-a')
    expect(() => commit(store, next, 'conflicted', 1_005, changed)).toThrow('baseline conflict')
    expect(db.prepare('SELECT COUNT(*) AS count FROM monitor_events').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM monitor_snapshots').get()).toEqual({ count: 1 })
  })
  it.each(['snapshot', 'event'] as const)('rolls back the whole baseline/event/outbox/delivery transaction after %s insertion', point => {
    const dbPath = path()
    const store = openStore(dbPath, { failCommitAfter: point })
    const deliveries = DeliveryStore.open(dbPath); cleanups.push(() => deliveries.close())
    store.createOrGetRevision(revision())
    deliveries.createDestination({ id: 'rollback-sink', monitorId: 'monitor-a', url: 'https://receiver.example/webhook' }, 1_000)
    const owner = store.startRun('monitor-a', 'rollback', 1_000)
    observe(store, owner, 'rollback', 1_001)
    expect(() => commit(store, owner, 'rollback', 1_002)).toThrow('injected commit failure')
    const view = store.view('monitor-a', 1_002)
    expect(view.baseline).toBeNull()
    expect(view.events).toHaveLength(0)
    expect(view.outbox).toHaveLength(0)
    expect(deliveries.listDeliveries()).toHaveLength(0)
    expect(view.runs[0]?.state).toBe('running')
  })
})
