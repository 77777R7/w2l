import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { DOCUMENT_RULE_VERSION, FIRECRAWL_INTRO_URL, FIRECRAWL_MONITOR_ID, type MonitorRevision, type ScrapeOutcome } from '@w2l/contracts'
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

export async function runConfiguredMonitor(store: MonitorStore, revision: MonitorRevision, capture: () => Promise<ScrapeOutcome>, triggerKey?: string) {
  initializeMonitor(store, revision)
  const now = Date.now()
  const run = store.claim(revision.monitorId, now, triggerKey)
  if (!run) return store.view(revision.monitorId, Date.now())
  const started = performance.now()
  let outcome: ScrapeOutcome | null = null
  let error: string | null = null
  try { outcome = await capture() } catch (e) { error = e instanceof Error ? e.message : String(e) }
  const observationId = crypto.randomUUID(); const assessmentId = crypto.randomUUID()
  const assessment = revision.config ? assessConfiguredDocument(outcome?.result ?? null, revision) : assessFirecrawlIntroduction(outcome?.result ?? null)
  store.recordObservation({ id: observationId, runId: run.id, attemptId: run.attemptId!, observedAt: Date.now(), clientWallMs: performance.now() - started, markdownSha256: outcome?.result.markdown == null ? null : createHash('sha256').update(outcome.result.markdown).digest('hex'), transport: outcome?.result ? { etag: outcome.result.evidence.etag ?? null, lastModified: outcome.result.evidence.lastModified ?? null, representationKey: outcome.result.evidence.rawBodySha256 ?? outcome.result.evidence.finalUrl } : null, outcome, error }, assessmentId, assessment)
  store.commit(run.id, observationId, assessmentId, assessment, Date.now())
  return store.view(revision.monitorId, Date.now())
}

export async function runFirecrawlMonitor(store: MonitorStore, capture: () => Promise<ScrapeOutcome>, triggerKey?: string) {
  return runConfiguredMonitor(store, { monitorId: FIRECRAWL_MONITOR_ID, revision: 1, url: FIRECRAWL_INTRO_URL, ruleVersion: DOCUMENT_RULE_VERSION, intervalMs: 86_400_000, staleAfterMs: 172_800_000, createdAt: Date.now() }, capture, triggerKey)
}
