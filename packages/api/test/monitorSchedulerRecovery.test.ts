import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MonitorRevision, ScrapeOutcome } from '@w2l/contracts'
import { MonitorStore, runConfiguredMonitor } from '@w2l/runtime'

let root: string | undefined
let store: MonitorStore | undefined
const originalArgv = process.argv
afterEach(async () => {
  process.argv = originalArgv
  vi.doUnmock('../src/engine.js')
  vi.resetModules()
  vi.restoreAllMocks()
  store?.close()
  if (root) await rm(root, { recursive: true, force: true })
})

it('the scheduler resumes a crashed hourly monitor at its 60-second Retry-After', async () => {
  root = await mkdtemp(join(tmpdir(), 'w2l-scheduler-recovery-'))
  store = MonitorStore.open(join(root, 'control.sqlite'), { leaseMs: 30_000 })
  const activeStore = store
  const startedAt = 100_000
  let now = startedAt
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  vi.spyOn(process, 'on').mockReturnValue(process)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  process.argv = [...originalArgv, '--once']
  const url = 'https://source.example/product'
  const revision: MonitorRevision = { monitorId: 'hourly', revision: 1, url, ruleVersion: 'price/v1', intervalMs: 3_600_000, staleAfterMs: 7_200_000, createdAt: startedAt,
    config: { adapter: 'markdown-sections/v1', workspaceId: 'test', entityKey: 'price', viewKey: 'public', expectedTitle: 'Product', schemaVersion: 'price/v1', conditionalRequests: false, captureMode: 'http', fields: [{ name: 'price', heading: 'Price', type: 'decimal', required: true }] } }
  activeStore.createOrGetRevision(revision)
  const crashed = activeStore.startRun(revision.monitorId, 'original-trigger', startedAt)
  activeStore.noteRetryAfter(crashed, url, startedAt + 60_000, startedAt + 1)
  expect(activeStore.view(revision.monitorId, now).nextRunAt).toBe(startedAt + 3_600_000)
  const outcome: ScrapeOutcome = { result: { requestedUrl: url, status: 'success', failureReason: null, blockReason: null, budgetExceeded: null, lane: 'http', escalations: [], markdown: '# Product\n\n## Price\n10.00', truncated: false, truncatedAt: null, compliance: null,
    evidence: { finalUrl: url, httpStatus: 200, redirectChain: [], contentType: 'text/html', rawBodySha256: 'body', artifacts: [] },
    usage: { wallMs: 1, bytesWire: 1, bytesDecompressed: 1, requestCount: 1, attemptCount: 1, contentTokens: 1, browserMs: 0, externalCostUsd: null }, trace: [] }, links: [] }
  const capture = vi.fn(async () => outcome)
  const runMonitor = vi.fn(async () => runConfiguredMonitor(activeStore, revision, capture))
  const close = vi.fn(async () => {})
  vi.doMock('../src/engine.js', () => ({ createApiEngine: () => ({
    listMonitors: () => [activeStore.view(revision.monitorId, now)], runMonitor, close,
  }) }))
  const poll = async () => {
    vi.resetModules()
    // Execute the real scheduler selection and dispatch, not a copied predicate.
    await import('../../../scripts/section-b/monitor-scheduler.js')
  }

  now = startedAt + 30_000
  await poll()
  expect(runMonitor).toHaveBeenCalledTimes(1)
  expect(capture).not.toHaveBeenCalled()
  expect(activeStore.getRun(crashed.id)).toMatchObject({ state: 'waiting_retry', nextAttemptAt: startedAt + 60_000 })
  expect(activeStore.view(revision.monitorId, now).nextRunAt).toBe(startedAt + 60_000)

  now = startedAt + 59_999
  await poll()
  expect(runMonitor).toHaveBeenCalledTimes(1)
  expect(capture).not.toHaveBeenCalled()

  now = startedAt + 60_000
  await poll()
  expect(runMonitor).toHaveBeenCalledTimes(2)
  expect(capture).toHaveBeenCalledTimes(1)
  const view = activeStore.view(revision.monitorId, now)
  expect(view.runs).toHaveLength(1)
  expect(view.runs[0]).toMatchObject({ id: crashed.id, triggerKey: 'original-trigger', state: 'completed', change: 'initialized' })
  expect(activeStore.attempts(crashed.id)).toMatchObject([{ id: crashed.attemptId, state: 'interrupted' }, { recoveredFromAttemptId: crashed.attemptId, state: 'succeeded' }])
  expect(view.events).toHaveLength(1)
  expect(view.nextRunAt).toBe(now + 3_600_000)
  expect(close).toHaveBeenCalledTimes(3)
})
