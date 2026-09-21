import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MonitorStore } from '../src/monitorStore.js'
import { DOCUMENT_RULE_VERSION, FIRECRAWL_INTRO_URL, FIRECRAWL_MONITOR_ID, type DocumentAssessment } from '@w2l/contracts'

const assessment: DocumentAssessment = {
  ruleVersion: DOCUMENT_RULE_VERSION, quality: 'valid', reasons: [],
  fields: { title: 'Introduction', introduction: 'Firecrawl intro', searchDescription: 'Search content', scrapeDescription: 'Scrape content', interactDescription: 'Interact content' },
  evidence: [],
}
const outcome = { result: { status: 'success' as const, markdown: '# Introduction', evidence: { finalUrl: FIRECRAWL_INTRO_URL }, usage: { wallMs: 1, browserMs: 0, requestCount: 1, contentTokens: 1, bytesWire: 1, externalCostUsd: null } } }

describe('MonitorStore B1/B2 slice', () => {
  let dir: string | undefined
  let store: MonitorStore | undefined
  afterEach(async () => { store?.close(); if (dir) await rm(dir, { recursive: true, force: true }) })

  it('initializes one snapshot/event and is idempotent by trigger key', async () => {
    dir = await mkdtemp(join(tmpdir(), 'w2l-monitor-'))
    store = MonitorStore.open(join(dir, 'control.sqlite'))
    const now = Date.now()
    store.createOrGetRevision({ monitorId: FIRECRAWL_MONITOR_ID, revision: 1, url: FIRECRAWL_INTRO_URL, ruleVersion: DOCUMENT_RULE_VERSION, intervalMs: 1000, staleAfterMs: 2000, createdAt: now })
    const run = store.startRun(FIRECRAWL_MONITOR_ID, 'slot:1', now)
    const observationId = 'obs-1'
    store.recordObservation({ id: observationId, runId: run.id, attemptId: run.attemptId!, observedAt: now, clientWallMs: 1, markdownSha256: 'hash', outcome: outcome as never, error: null }, 'assessment-1', assessment)
    const event = store.commit(run.id, observationId, 'assessment-1', assessment, now + 1)
    expect(event?.kind).toBe('initialized')
    expect(store.startRun(FIRECRAWL_MONITOR_ID, 'slot:1', now).id).toBe(run.id)
    expect(store.view(FIRECRAWL_MONITOR_ID, now).baseline?.version).toBe(1)
  })

  it('does not advance the baseline for an invalid assessment', async () => {
    dir = await mkdtemp(join(tmpdir(), 'w2l-monitor-'))
    store = MonitorStore.open(join(dir, 'control.sqlite'))
    const now = Date.now()
    store.createOrGetRevision({ monitorId: FIRECRAWL_MONITOR_ID, revision: 1, url: FIRECRAWL_INTRO_URL, ruleVersion: DOCUMENT_RULE_VERSION, intervalMs: 1000, staleAfterMs: 2000, createdAt: now })
    const run = store.startRun(FIRECRAWL_MONITOR_ID, 'slot:1', now)
    const invalid = { ...assessment, quality: 'invalid' as const, fields: null, reasons: ['wrong_document'] }
    store.recordObservation({ id: 'obs-1', runId: run.id, attemptId: run.attemptId!, observedAt: now, clientWallMs: 1, markdownSha256: null, outcome: null, error: null }, 'assessment-1', invalid)
    expect(store.commit(run.id, 'obs-1', 'assessment-1', invalid, now + 1)).toBeNull()
    expect(store.view(FIRECRAWL_MONITOR_ID, now).baseline).toBeNull()
  })

  it('preserves the last valid baseline when a later refresh is invalid', async () => {
    dir = await mkdtemp(join(tmpdir(), 'w2l-monitor-'))
    store = MonitorStore.open(join(dir, 'control.sqlite'))
    const now = Date.now()
    store.createOrGetRevision({ monitorId: FIRECRAWL_MONITOR_ID, revision: 1, url: FIRECRAWL_INTRO_URL, ruleVersion: DOCUMENT_RULE_VERSION, intervalMs: 1000, staleAfterMs: 2000, createdAt: now })
    const first = store.startRun(FIRECRAWL_MONITOR_ID, 'slot:valid', now)
    store.recordObservation({ id: 'obs-valid', runId: first.id, attemptId: first.attemptId!, observedAt: now, clientWallMs: 1, markdownSha256: 'h1', outcome: outcome as never, error: null }, 'assessment-valid', assessment)
    store.commit(first.id, 'obs-valid', 'assessment-valid', assessment, now + 1)
    const invalidRun = store.startRun(FIRECRAWL_MONITOR_ID, 'slot:invalid', now + 2)
    const invalid = { ...assessment, quality: 'invalid' as const, fields: null, reasons: ['login_wall'] }
    store.recordObservation({ id: 'obs-invalid', runId: invalidRun.id, attemptId: invalidRun.attemptId!, observedAt: now + 2, clientWallMs: 1, markdownSha256: null, outcome: null, error: null }, 'assessment-invalid', invalid)
    expect(store.commit(invalidRun.id, 'obs-invalid', 'assessment-invalid', invalid, now + 3)).toBeNull()
    const view = store.view(FIRECRAWL_MONITOR_ID, now + 3)
    expect(view.baseline?.version).toBe(1)
    expect(view.baseline?.fields.title).toBe('Introduction')
    expect(view.lastVerifiedAt).toBe(now + 1)
  })

  it('keeps the baseline version and event stream stable when fields are unchanged', async () => {
    dir = await mkdtemp(join(tmpdir(), 'w2l-monitor-'))
    store = MonitorStore.open(join(dir, 'control.sqlite'))
    const now = Date.now()
    store.createOrGetRevision({ monitorId: FIRECRAWL_MONITOR_ID, revision: 1, url: FIRECRAWL_INTRO_URL, ruleVersion: DOCUMENT_RULE_VERSION, intervalMs: 1000, staleAfterMs: 2000, createdAt: now })
    const first = store.startRun(FIRECRAWL_MONITOR_ID, 'slot:1', now)
    store.recordObservation({ id: 'obs-1', runId: first.id, attemptId: first.attemptId!, observedAt: now, clientWallMs: 1, markdownSha256: 'h1', outcome: outcome as never, error: null }, 'assessment-1', assessment)
    store.commit(first.id, 'obs-1', 'assessment-1', assessment, now + 1)
    const second = store.startRun(FIRECRAWL_MONITOR_ID, 'slot:2', now + 2)
    store.recordObservation({ id: 'obs-2', runId: second.id, attemptId: second.attemptId!, observedAt: now + 2, clientWallMs: 1, markdownSha256: 'h1', outcome: outcome as never, error: null }, 'assessment-2', assessment)
    expect(store.commit(second.id, 'obs-2', 'assessment-2', assessment, now + 3)).toBeNull()
    const view = store.view(FIRECRAWL_MONITOR_ID, now + 3)
    expect(view.baseline?.version).toBe(1)
    expect(view.events).toHaveLength(1)
    expect(view.runs[0]?.change).toBe('unchanged')
  })

  it('advances the baseline and emits typed changes when a field changes', async () => {
    dir = await mkdtemp(join(tmpdir(), 'w2l-monitor-'))
    store = MonitorStore.open(join(dir, 'control.sqlite'))
    const now = Date.now()
    store.createOrGetRevision({ monitorId: FIRECRAWL_MONITOR_ID, revision: 1, url: FIRECRAWL_INTRO_URL, ruleVersion: DOCUMENT_RULE_VERSION, intervalMs: 1000, staleAfterMs: 2000, createdAt: now })
    const first = store.startRun(FIRECRAWL_MONITOR_ID, 'slot:1', now)
    store.recordObservation({ id: 'obs-1', runId: first.id, attemptId: first.attemptId!, observedAt: now, clientWallMs: 1, markdownSha256: 'h1', outcome: outcome as never, error: null }, 'assessment-1', assessment)
    store.commit(first.id, 'obs-1', 'assessment-1', assessment, now + 1)
    const second = store.startRun(FIRECRAWL_MONITOR_ID, 'slot:2', now + 2)
    const changed = { ...assessment, fields: { ...assessment.fields!, scrapeDescription: 'Scrape changed content' } }
    store.recordObservation({ id: 'obs-2', runId: second.id, attemptId: second.attemptId!, observedAt: now + 2, clientWallMs: 1, markdownSha256: 'h2', outcome: outcome as never, error: null }, 'assessment-2', changed)
    const event = store.commit(second.id, 'obs-2', 'assessment-2', changed, now + 3)
    expect(event?.kind).toBe('changed')
    expect(event?.changes).toEqual([{ field: 'scrapeDescription', before: 'Scrape content', after: 'Scrape changed content' }])
    expect(store.view(FIRECRAWL_MONITOR_ID, now + 3).baseline?.version).toBe(2)
  })

  it('rolls back baseline, event, and outbox when commit fails mid-transaction', async () => {
    dir = await mkdtemp(join(tmpdir(), 'w2l-monitor-'))
    store = MonitorStore.open(join(dir, 'control.sqlite'), { failCommitAfter: 'event' })
    const now = Date.now()
    store.createOrGetRevision({ monitorId: FIRECRAWL_MONITOR_ID, revision: 1, url: FIRECRAWL_INTRO_URL, ruleVersion: DOCUMENT_RULE_VERSION, intervalMs: 1000, staleAfterMs: 2000, createdAt: now })
    const run = store.startRun(FIRECRAWL_MONITOR_ID, 'slot:rollback', now)
    store.recordObservation({ id: 'obs-rollback', runId: run.id, attemptId: run.attemptId!, observedAt: now, clientWallMs: 1, markdownSha256: 'h1', outcome: outcome as never, error: null }, 'assessment-rollback', assessment)
    expect(() => store.commit(run.id, 'obs-rollback', 'assessment-rollback', assessment, now + 1)).toThrow(/injected commit failure/)
    const view = store.view(FIRECRAWL_MONITOR_ID, now + 1)
    expect(view.baseline).toBeNull()
    expect(view.events).toHaveLength(0)
    expect(view.outbox).toHaveLength(0)
  })

  it('interrupts an expired attempt and fences its stale observation', async () => {
    dir = await mkdtemp(join(tmpdir(), 'w2l-monitor-'))
    store = MonitorStore.open(join(dir, 'control.sqlite'))
    const now = Date.now()
    store.createOrGetRevision({ monitorId: FIRECRAWL_MONITOR_ID, revision: 1, url: FIRECRAWL_INTRO_URL, ruleVersion: DOCUMENT_RULE_VERSION, intervalMs: 1000, staleAfterMs: 2000, createdAt: now })
    const old = store.startRun(FIRECRAWL_MONITOR_ID, 'slot:lease', now)
    const recovered = store.startRun(FIRECRAWL_MONITOR_ID, 'slot:recovery', now + 300_001)
    expect(recovered.id).toBe(old.id)
    expect(recovered.attemptId).not.toBe(old.attemptId)
    expect(store.attempts(old.id).find((attempt) => attempt.id === old.attemptId)?.state).toBe('interrupted')
    expect(() => store.recordObservation({ id: 'stale', runId: old.id, attemptId: old.attemptId!, observedAt: now + 300_002, clientWallMs: 1, markdownSha256: null, outcome: null, error: null }, 'stale-assessment', { ...assessment, quality: 'unknown', fields: null, reasons: ['stale'] })).toThrow(/stale observation attempt/)
  })

  it('allows only one active run across two independent SQLite connections', async () => {
    dir = await mkdtemp(join(tmpdir(), 'w2l-monitor-'))
    const firstStore = MonitorStore.open(join(dir, 'control.sqlite'))
    const secondStore = MonitorStore.open(join(dir, 'control.sqlite'))
    store = firstStore
    const now = Date.now()
    firstStore.createOrGetRevision({ monitorId: FIRECRAWL_MONITOR_ID, revision: 1, url: FIRECRAWL_INTRO_URL, ruleVersion: DOCUMENT_RULE_VERSION, intervalMs: 1000, staleAfterMs: 2000, createdAt: now })
    const first = firstStore.startRun(FIRECRAWL_MONITOR_ID, 'connection-a', now)
    expect(() => secondStore.startRun(FIRECRAWL_MONITOR_ID, 'connection-b', now + 1)).toThrow(/active run/)
    expect(first.state).toBe('running')
    secondStore.close()
  })

  it('uses persisted nextRunAt after reopening the control database', async () => {
    dir = await mkdtemp(join(tmpdir(), 'w2l-monitor-'))
    const firstStore = MonitorStore.open(join(dir, 'control.sqlite'))
    const now = Date.now()
    firstStore.createOrGetRevision({ monitorId: FIRECRAWL_MONITOR_ID, revision: 1, url: FIRECRAWL_INTRO_URL, ruleVersion: DOCUMENT_RULE_VERSION, intervalMs: 1000, staleAfterMs: 2000, createdAt: now - 5000 })
    firstStore.close()
    store = MonitorStore.open(join(dir, 'control.sqlite'))
    const run = store.dueRun(FIRECRAWL_MONITOR_ID, now)
    expect(run?.triggerKey).toMatch(/^scheduled:firecrawl-introduction:1:/)
  })
})
