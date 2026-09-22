import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { MonitorRevision, ScrapeOutcome } from '@w2l/contracts'
import { MonitorStore } from '../src/monitorStore.js'
import { runConfiguredMonitor } from '../src/monitorRunner.js'
import * as configured from '../src/configuredAssessment.js'

let dir: string | undefined
let store: MonitorStore | undefined
let inspect: Database.Database | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  inspect?.close()
  store?.close()
  if (dir) await rm(dir, { recursive: true, force: true })
})
const url = 'https://source.example/product'
const revision: MonitorRevision = { monitorId: 'deadline', revision: 1, url, ruleVersion: 'price/v1', intervalMs: 60_000, staleAfterMs: 120_000, createdAt: 100_000,
  config: { adapter: 'markdown-sections/v1', workspaceId: 'test', entityKey: 'price', viewKey: 'public', expectedTitle: 'Product', schemaVersion: 'price/v1', conditionalRequests: true, captureMode: 'http', fields: [{ name: 'price', heading: 'Price', type: 'decimal', required: true }] } }
const outcome: ScrapeOutcome = { result: { requestedUrl: url, status: 'success', failureReason: null, blockReason: null, budgetExceeded: null, lane: 'http', escalations: [], markdown: '# Product\n\n## Price\n10.00', truncated: false, truncatedAt: null, compliance: null,
  evidence: { finalUrl: url, httpStatus: 200, redirectChain: [], contentType: 'text/html', rawBodySha256: 'body', artifacts: [], etag: '"price"', cacheControl: 'public,max-age=0', vary: null, setsCookie: false },
  usage: { wallMs: 1, bytesWire: 1, bytesDecompressed: 1, requestCount: 1, attemptCount: 1, contentTokens: 1, browserMs: 0, externalCostUsd: null }, trace: [] }, links: [] }
async function setup() {
  dir = await mkdtemp(join(tmpdir(), 'w2l-monitor-deadline-'))
  const path = join(dir, 'control.sqlite')
  store = MonitorStore.open(path)
  inspect = new Database(path)
  return store
}
function count(table: string) { return (inspect!.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count }

describe('Monitor deadline through synchronous validation and persistence', () => {
  it('expires after assessment consumes the caller budget, without any transport or baseline writes', async () => {
    const store = await setup()
    let now = 100_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const assess = configured.assessConfiguredDocument
    vi.spyOn(configured, 'assessConfiguredDocument').mockImplementation((...args) => { const result = assess(...args); now = 100_101; return result })
    const view = await runConfiguredMonitor(store, revision, async () => outcome, 'deadline', { deadlineAt: 100_100 })
    expect(view.runs[0]).toMatchObject({ state: 'expired', deadlineAt: 100_100 })
    expect(view.events).toEqual([])
    expect(view.baseline).toBeNull()
    expect(count('monitor_transport')).toBe(0)
    expect(count('monitor_observations')).toBe(0)
  })

  it('samples time after a SQLite write lock is acquired and expires instead of leaving running', async () => {
    const store = await setup()
    let now = 100_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const original = Database.prototype.transaction
    vi.spyOn(Database.prototype, 'transaction').mockImplementation(function (this: Database.Database, fn: (...args: unknown[]) => unknown) {
      // Called after BEGIN IMMEDIATE has acquired the lock. Advance wall time at
      // observation persistence to model a blocked lock without timing flakiness.
      return original.call(this, (...args: unknown[]) => {
        if (fn.toString().includes('stale observation attempt')) now = 100_101
        return fn(...args)
      })
    } as typeof Database.prototype.transaction)
    const view = await runConfiguredMonitor(store, revision, async () => outcome, 'lock-deadline', { deadlineAt: 100_100 })
    expect(view.runs[0]?.state).toBe('expired')
    expect(count('monitor_transport')).toBe(0)
    expect(count('monitor_observations')).toBe(0)
    expect(view.events).toEqual([])
  })

  it('rolls back transport and observation if serialization exhausts the persisted deadline', async () => {
    const store = await setup()
    let now = 100_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const save = store.saveRepresentation.bind(store)
    vi.spyOn(store, 'saveRepresentation').mockImplementation(value => { save(value); now = 100_101 })
    const view = await runConfiguredMonitor(store, revision, async () => outcome, 'write-deadline', { deadlineAt: 100_100 })
    expect(view.runs[0]?.state).toBe('expired')
    expect(count('monitor_transport')).toBe(0)
    expect(count('monitor_observations')).toBe(0)
    expect(count('monitor_assessments')).toBe(0)
    expect(view.baseline).toBeNull()
  })

  it('checks the persisted deadline inside the final commit transaction', async () => {
    const store = await setup()
    let now = 100_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const commit = store.commit.bind(store)
    vi.spyOn(store, 'commit').mockImplementation((...args) => { now = 100_101; return commit(...args) })
    const view = await runConfiguredMonitor(store, revision, async () => outcome, 'commit-deadline', { deadlineAt: 100_100 })
    expect(view.runs[0]?.state).toBe('expired')
    expect(count('monitor_observations')).toBe(1)
    expect(count('monitor_events')).toBe(0)
    expect(count('monitor_baselines')).toBe(0)
  })

  it('rolls back snapshot, event, outbox and finishRun when the commit itself crosses the deadline', async () => {
    const store = await setup()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000)
    const commit = store.commit.bind(store)
    vi.spyOn(store, 'commit').mockImplementation((...args) => {
      // Permit transaction entry, then expire at the end-of-transaction check.
      clock.mockReturnValueOnce(100_000).mockReturnValue(100_101)
      return commit(...args)
    })
    const view = await runConfiguredMonitor(store, revision, async () => outcome, 'commit-overrun', { deadlineAt: 100_100 })
    expect(view.runs[0]?.state).toBe('expired')
    expect(count('monitor_observations')).toBe(1)
    for (const table of ['monitor_snapshots', 'monitor_baselines', 'monitor_events', 'monitor_outbox']) expect(count(table)).toBe(0)
    expect(view.lastVerifiedAt).toBeNull()
  })

  it('renews against the persisted effective deadline even when the caller holds a larger value', async () => {
    const store = await setup()
    vi.spyOn(Date, 'now').mockReturnValue(100_000)
    store.createOrGetRevision(revision)
    const owner = store.claim(revision.monitorId, undefined, 'renew', 100_100)!
    expect(store.renew({ ...owner, deadlineAt: 200_000 })).toBe(true)
    expect(store.getRun(owner.id)?.leaseUntil).toBe(100_100)
  })

})
