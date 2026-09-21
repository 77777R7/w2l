import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { DOCUMENT_RULE_VERSION, FIRECRAWL_INTRO_URL, FIRECRAWL_MONITOR_ID, monitorIdentity, type MonitorRevision, type ScrapeOutcome } from '@w2l/contracts'
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
}

function cacheable(outcome: ScrapeOutcome): boolean {
  const e = outcome.result.evidence
  // Conservative public cache: no varying or cookie-bearing representations.
  return e.cacheControl !== undefined && !/\b(no-store|private)\b/i.test(e.cacheControl ?? '') && !e.vary?.trim() && e.setsCookie === false
}

export async function runConfiguredMonitor(store: MonitorStore, revision: MonitorRevision, capture: (options: MonitorCaptureOptions) => Promise<ScrapeOutcome>, triggerKey?: string) {
  initializeMonitor(store, revision)
  const stored = store.getRevision(revision.monitorId)
  if (stored.revision !== revision.revision) throw new Error('stale monitor revision')
  revision = stored
  const now = Date.now()
  const run = store.claim(revision.monitorId, now, triggerKey)
  if (!run) return store.view(revision.monitorId, Date.now())
  const started = performance.now()
  let outcome: ScrapeOutcome | null = null
  let validationOutcome: ScrapeOutcome | null = null
  let error: string | null = null
  const key = createHash('sha256').update(JSON.stringify({ ...monitorIdentity(revision), monitorId: revision.monitorId, method: 'GET', variant: 'w2l-standard-http/v1' })).digest('hex')
  const cached = revision.config?.conditionalRequests ? store.representation(key) : null
  const usable = cached && cached.outcome.result.markdown !== null && cacheable(cached.outcome) ? cached : null
  const signal = AbortSignal.timeout(Math.max(1, (run.deadlineAt ?? now + 300_000) - Date.now()))
  const validators = usable?.etag ? { etag: usable.etag } : usable?.lastModified ? { lastModified: usable.lastModified } : {}
  let reusedFrom: string | undefined
  try {
    outcome = await capture({ ...validators, signal })
    if (outcome.result.evidence.httpStatus === 304) {
      if (!usable || !Object.keys(validators).length || outcome.result.evidence.finalUrl !== usable.outcome.result.evidence.finalUrl || (outcome.result.evidence.etag && usable.etag !== outcome.result.evidence.etag)) {
        store.deleteRepresentation(key)
        throw new Error('304 has no matching cached representation')
      }
      // Keep the actual 304 outcome/usage in the observation. Reassess cached content
      // under current rules, never promote the old trusted baseline by assumption.
      validationOutcome = usable.outcome
      reusedFrom = usable.outcome.result.evidence.rawBodySha256 ?? undefined
      if (!cacheable(outcome)) store.deleteRepresentation(key)
    } else {
      validationOutcome = outcome
      if (revision.config?.conditionalRequests) {
        if (outcome.result.evidence.httpStatus === 200 && cacheable(outcome) && outcome.result.markdown !== null) {
          store.saveRepresentation({ key, url: revision.url, etag: outcome.result.evidence.etag ?? null, lastModified: outcome.result.evidence.lastModified ?? null, outcome, storedAt: Date.now() })
        } else store.deleteRepresentation(key)
      }
    }
  } catch (e) { error = e instanceof Error ? e.message : String(e) }
  const observationId = crypto.randomUUID(); const assessmentId = crypto.randomUUID()
  const result = error ? null : validationOutcome?.result ?? null
  const assessment = revision.config ? assessConfiguredDocument(result, revision) : assessFirecrawlIntroduction(result)
  store.recordObservation({ id: observationId, runId: run.id, attemptId: run.attemptId!, observedAt: Date.now(), clientWallMs: performance.now() - started, markdownSha256: result?.markdown == null ? null : createHash('sha256').update(result.markdown).digest('hex'), transport: outcome?.result ? { etag: outcome.result.evidence.etag ?? null, lastModified: outcome.result.evidence.lastModified ?? null, representationKey: key, reusedFrom, responseStatus: outcome.result.evidence.httpStatus } : null, outcome, error }, assessmentId, assessment)
  store.commit(run.id, observationId, assessmentId, assessment, Date.now())
  return store.view(revision.monitorId, Date.now())
}

export async function runFirecrawlMonitor(store: MonitorStore, capture: () => Promise<ScrapeOutcome>, triggerKey?: string) {
  return runConfiguredMonitor(store, { monitorId: FIRECRAWL_MONITOR_ID, revision: 1, url: FIRECRAWL_INTRO_URL, ruleVersion: DOCUMENT_RULE_VERSION, intervalMs: 86_400_000, staleAfterMs: 172_800_000, createdAt: Date.now() }, capture, triggerKey)
}
