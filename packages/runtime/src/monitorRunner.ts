import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { DOCUMENT_RULE_VERSION, FIRECRAWL_INTRO_URL, FIRECRAWL_MONITOR_ID, monitorIdentity, type ExecutionContext, type MonitorRevision, type ScrapeOutcome, type TransportRepresentation } from '@w2l/contracts'
import { createExecutionScope, raceWithSignal, throwIfExecutionStopped } from '@w2l/http-core'
import { MonitorStore } from './monitorStore.js'
import { assessFirecrawlIntroduction } from './documentAssessment.js'
import { assessConfiguredDocument } from './configuredAssessment.js'

export function initializeFirecrawlMonitor(store: MonitorStore): void {
  if (store.hasMonitor(FIRECRAWL_MONITOR_ID)) return
  store.createOrGetRevision({ monitorId: FIRECRAWL_MONITOR_ID, revision: 1, url: FIRECRAWL_INTRO_URL,
    ruleVersion: DOCUMENT_RULE_VERSION, intervalMs: 86_400_000, staleAfterMs: 172_800_000, createdAt: Date.now() })
}
export function initializeMonitor(store: MonitorStore, revision: MonitorRevision): void {
  if (!store.hasMonitor(revision.monitorId)) store.createOrGetRevision(revision)
}
export interface MonitorCaptureOptions {
  etag?: string
  lastModified?: string
  signal: AbortSignal
  deadlineAt: number
  captureMode: 'http' | 'ladder'
  onRetryAfter: (url: string, retryAt: number) => void
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function cacheable(outcome: ScrapeOutcome): boolean {
  const e = outcome.result.evidence
  return e.cacheControl !== undefined && !/\b(no-store|private)\b/i.test(e.cacheControl ?? '') && !e.vary?.trim() && e.setsCookie === false
}

export async function runConfiguredMonitor(store: MonitorStore, revision: MonitorRevision, capture: (options: MonitorCaptureOptions) => Promise<ScrapeOutcome>, triggerKey?: string, context: ExecutionContext = {}) {
  throwIfExecutionStopped(context)
  initializeMonitor(store, revision)
  const stored = store.getRevision(revision.monitorId)
  if (stored.revision !== revision.revision) throw new Error('stale monitor revision')
  revision = stored
  const captureMode = revision.config?.captureMode ?? 'ladder'
  if (revision.config?.conditionalRequests && captureMode !== 'http') throw new Error('conditionalRequests requires explicit captureMode: http; create a new monitor revision')
  const run = store.claim(revision.monitorId, undefined, triggerKey, context.deadlineAt)
  if (!run) return store.view(revision.monitorId, Date.now())
  const deadlineAt = Math.min(run.deadlineAt!, context.deadlineAt ?? Infinity)
  const controller = new AbortController()
  const scope = createExecutionScope({ signal: context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal, deadlineAt })
  const heartbeat = setInterval(() => {
    try { if (!store.renew(run)) controller.abort(new DOMException('Execution ownership lost or cancelled', 'AbortError')) }
    catch (error) { controller.abort(error) }
  }, Math.max(5, Math.min(250, Math.floor(store.leaseMs / 3))))
  const started = performance.now()
  let outcome: ScrapeOutcome | null = null, validationOutcome: ScrapeOutcome | null = null
  let error: string | null = null, reusedFrom: string | undefined
  try {
  const key = hash(JSON.stringify({ ...monitorIdentity(revision), monitorId: revision.monitorId, method: 'GET', captureMode, variant: 'w2l-standard-http/v1' }))
  const cached = revision.config?.conditionalRequests ? store.representation(key) : null
  const usable = cached && cached.outcome.result.markdown !== null && cached.bodySha256 === hash(cached.outcome.result.markdown) && cacheable(cached.outcome) ? cached : null
  const validators = usable?.etag ? { etag: usable.etag } : usable?.lastModified ? { lastModified: usable.lastModified } : {}
  let transportChange: {key: string; representation: TransportRepresentation | null} | undefined
    try {
      throwIfExecutionStopped(scope)
      outcome = await raceWithSignal(capture({ ...validators, signal: scope.signal, deadlineAt, captureMode, onRetryAfter: (url, retryAt) => { store.noteRetryAfter(run, url, retryAt); context.onRetryAfter?.(url, retryAt) } }), scope.signal)
      throwIfExecutionStopped(scope)
      store.assertExecution(run)
      if (outcome.result.evidence.httpStatus === 304) {
        const e = outcome.result.evidence
        if (!usable || !Object.keys(validators).length || e.finalUrl !== usable.outcome.result.evidence.finalUrl || (e.etag && usable.etag !== e.etag) || e.vary?.trim() || e.setsCookie) {
          transportChange = { key, representation: null }
          throw new Error('304 has no matching cached representation')
        }
        validationOutcome = usable.outcome
        reusedFrom = usable.bodySha256
        const merged = { ...usable.outcome, result: { ...usable.outcome.result, evidence: { ...usable.outcome.result.evidence, cacheControl: e.cacheControl ?? usable.outcome.result.evidence.cacheControl, etag: e.etag ?? usable.etag, lastModified: e.lastModified ?? usable.lastModified } } }
        transportChange = {key, representation: cacheable(merged) ? {...usable, outcome: merged, storedAt: Date.now()} : null}
      } else {
        validationOutcome = outcome
        if (revision.config?.conditionalRequests && !outcome.result.retryAt) {
          const e = outcome.result.evidence
          transportChange = {key, representation: e.httpStatus === 200 && cacheable(outcome) && outcome.result.markdown !== null
            ? {key, url: revision.url, etag: e.etag ?? null, lastModified: e.lastModified ?? null, outcome, bodySha256: hash(outcome.result.markdown), storedAt: Date.now()} : null}
        }
      }
    } catch (caught) { error = caught instanceof Error ? caught.message : String(caught) }
    if (scope.signal.aborted || Date.now() >= deadlineAt || outcome?.result.budgetExceeded === 'time') {
      if (scope.signal.reason?.name === 'ShutdownError') store.interrupt(run)
      else store.endAttempt(run, Date.now() >= deadlineAt || scope.signal.reason?.name === 'TimeoutError' || outcome?.result.budgetExceeded === 'time' ? 'expired' : 'cancelled', error ?? String(scope.signal.reason))
      return store.view(revision.monitorId, Date.now())
    }
    // This check also rejects a result returned after a different process reclaimed the run.
    store.assertExecution(run)
    const observationId = crypto.randomUUID(), assessmentId = crypto.randomUUID()
    const result = error ? null : validationOutcome?.result ?? null
    const assessment = revision.config ? assessConfiguredDocument(result, revision) : assessFirecrawlIntroduction(result)
    throwIfExecutionStopped(scope)
    store.assertExecution(run)
    store.recordObservation({ id: observationId, runId: run.id, attemptId: run.attemptId!, observedAt: Date.now(), clientWallMs: performance.now() - started, markdownSha256: result?.markdown == null ? null : hash(result.markdown), transport: outcome?.result ? { etag: outcome.result.evidence.etag ?? null, lastModified: outcome.result.evidence.lastModified ?? null, representationKey: key, reusedFrom, responseStatus: outcome.result.evidence.httpStatus } : null, outcome, error }, assessmentId, assessment, transportChange)
    if (outcome?.result.retryAt && outcome.result.retryAt > Date.now()) store.deferRun(run, Math.ceil(outcome.result.retryAt))
    else store.commit(run.id, observationId, assessmentId, assessment)
    return store.view(revision.monitorId, Date.now())
  } catch (caught) {
    // A synchronous assessment or blocked SQLite transaction may exhaust the
    // deadline before the timer has a chance to run. Normalize it explicitly.
    const current = store.getRun(run.id)
    if (scope.signal.aborted || Date.now() >= deadlineAt || current?.state !== 'running' || current.attemptId !== run.attemptId) {
      if (scope.signal.reason?.name === 'ShutdownError') store.interrupt(run)
      else store.endAttempt(run, Date.now() >= deadlineAt || scope.signal.reason?.name === 'TimeoutError' ? 'expired' : 'cancelled', caught instanceof Error ? caught.message : String(caught))
      return store.view(revision.monitorId, Date.now())
    }
    throw caught
  } finally { clearInterval(heartbeat); scope.dispose() }
}

export async function runFirecrawlMonitor(store: MonitorStore, capture: (options: MonitorCaptureOptions) => Promise<ScrapeOutcome>, triggerKey?: string, context?: ExecutionContext) {
  initializeFirecrawlMonitor(store)
  return runConfiguredMonitor(store, store.getRevision(FIRECRAWL_MONITOR_ID), capture, triggerKey, context)
}
