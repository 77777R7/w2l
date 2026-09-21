import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { DOCUMENT_RULE_VERSION, FIRECRAWL_INTRO_URL, FIRECRAWL_MONITOR_ID, type ScrapeOutcome } from '@w2l/contracts'
import { MonitorStore } from './monitorStore.js'
import { assessFirecrawlIntroduction } from './documentAssessment.js'

export function initializeFirecrawlMonitor(store: MonitorStore): void {
  if (store.hasMonitor(FIRECRAWL_MONITOR_ID)) return
  store.createOrGetRevision({ monitorId: FIRECRAWL_MONITOR_ID, revision: 1, url: FIRECRAWL_INTRO_URL,
    ruleVersion: DOCUMENT_RULE_VERSION, intervalMs: 86_400_000, staleAfterMs: 172_800_000, createdAt: Date.now() })
}

export async function runFirecrawlMonitor(store: MonitorStore, capture: () => Promise<ScrapeOutcome>, triggerKey?: string) {
  initializeFirecrawlMonitor(store)
  const now = Date.now()
  const run = store.claim(FIRECRAWL_MONITOR_ID, now, triggerKey)
  if (!run) return store.view(FIRECRAWL_MONITOR_ID, Date.now())
  const started = performance.now()
  let outcome: ScrapeOutcome | null = null
  let error: string | null = null
  try { outcome = await capture() } catch (e) { error = e instanceof Error ? e.message : String(e) }
  const observationId = crypto.randomUUID()
  const assessmentId = crypto.randomUUID()
  const assessment = assessFirecrawlIntroduction(outcome?.result ?? null)
  store.recordObservation({ id: observationId, runId: run.id, attemptId: run.attemptId!, observedAt: Date.now(),
    clientWallMs: performance.now() - started, markdownSha256: outcome?.result.markdown == null ? null : createHash('sha256').update(outcome.result.markdown).digest('hex'), outcome, error }, assessmentId, assessment)
  store.commit(run.id, observationId, assessmentId, assessment, Date.now())
  return store.view(FIRECRAWL_MONITOR_ID, Date.now())
}
