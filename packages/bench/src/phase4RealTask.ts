import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { CONTENTFUL_STATUS, type FetchResult } from '@w2l/contracts'
import { W2L } from '@w2l/sdk'

export type RealTaskKind = 'ai_knowledge' | 'product_info'
export type RealTaskOutcome = 'correct_complete' | 'partial_missing_fields' | 'false_success' | 'reasonable_rejection' | 'retryable_failure' | 'non_retryable_failure'

export interface RealTaskAssertion {
  field: string
  required?: boolean
  sourceUrl?: string
  mustContain?: readonly string[]
  mustNotContain?: readonly string[]
}

export interface RealTaskSpec {
  id: string
  kind: RealTaskKind
  url: string
  source: string
  evaluationSet: 'development' | 'holdout'
  assertions: readonly RealTaskAssertion[]
  repeats: number
  /** Task-scoped volatile patterns only; raw Markdown/evidence remains unchanged. */
  dynamicNoisePatterns?: readonly string[]
  humanCorrectionMinutes?: number | null
}

export interface RealTaskRun {
  taskId: string
  kind: RealTaskKind
  url: string
  source: string
  evaluationSet: RealTaskSpec['evaluationSet']
  repeat: number
  startedAt: string
  finishedAt: string
  outcome: RealTaskOutcome
  assertions: readonly { field: string; outcome: 'pass' | 'fail' | 'unknown'; detail: string | null }[]
  result: FetchResult | null
  contentHash: string | null
  evidenceHash: string | null
  normalizationApplied: readonly string[]
  repeatConsistent: boolean | null
  humanCorrectionMinutes: number | null
  error: string | null
}

export interface Phase4Report {
  generatedAt: string
  manifestVersion: string
  taskCount: number
  runCount: number
  runs: readonly RealTaskRun[]
  summary: {
    byKind: Record<RealTaskKind, { tasks: number; runs: number; correctComplete: number; repeatConsistent: number; unknownCost: number }>
    holdoutRuns: number
    manualCorrectionMinutes: number | null
    resourceMeters: {
      wallMs: number
      browserMs: number
      requestCount: number
      contentTokens: number
      bytesWire: number
      unknownCostRuns: number
      knownExternalCostUsd: number | null
    }
  }
}

export async function runRealTasks(
  client: W2L,
  tasks: readonly RealTaskSpec[],
): Promise<Phase4Report> {
  const runs: RealTaskRun[] = []
  for (const task of tasks) {
    const start = runs.length
    for (let repeat = 1; repeat <= Math.max(1, task.repeats); repeat++) {
      const started = new Date().toISOString()
      try {
        if (task.kind === 'product_info') {
          // Product pages use the same canonical FetchResult today; field
          // extraction is asserted against the delivered Markdown evidence.
        }
        const result = await client.scrape(task.url)
        const assertions = evaluateAssertions(result, task.assertions)
        const outcome = classifyRealTask(result, assertions)
        const normalizationApplied = task.dynamicNoisePatterns ?? []
        const contentHash = normalizedContentHash(result.markdown, normalizationApplied)
        const evidenceHash = result.evidence.rawBodySha256
        runs.push({
          taskId: task.id, kind: task.kind, url: task.url, source: task.source, evaluationSet: task.evaluationSet, repeat,
          startedAt: started, finishedAt: new Date().toISOString(), outcome, assertions, result, contentHash,
          evidenceHash,
          normalizationApplied,
          repeatConsistent: null,
          humanCorrectionMinutes: task.humanCorrectionMinutes ?? null, error: null,
        })
      } catch (error) {
        runs.push({
          taskId: task.id, kind: task.kind, url: task.url, source: task.source, evaluationSet: task.evaluationSet, repeat,
          startedAt: started, finishedAt: new Date().toISOString(), outcome: 'non_retryable_failure', assertions: [], result: null,
          contentHash: null, evidenceHash: null, normalizationApplied: task.dynamicNoisePatterns ?? [], repeatConsistent: null, humanCorrectionMinutes: task.humanCorrectionMinutes ?? null, error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    applyRepeatConsistency(runs, start)
  }
  return buildReport(tasks, runs)
}

function applyRepeatConsistency(runs: RealTaskRun[], start: number): void {
  const slice = runs.slice(start)
  if (slice.length < 2) return
  const firstHash = slice[0]?.contentHash ?? null
  const consistent = firstHash !== null && slice.every((run) => run.contentHash === firstHash)
  for (const run of slice) run.repeatConsistent = consistent
}

export async function writePhase4Report(path: string, report: Phase4Report): Promise<void> {
  await mkdir(path.split('/').slice(0, -1).join('/') || '.', { recursive: true })
  await writeFile(path, JSON.stringify(report, null, 2) + '\n')
}

export function evaluateAssertions(result: FetchResult, assertions: readonly RealTaskAssertion[]) {
  return assertions.map((assertion) => {
    if (!CONTENTFUL_STATUS.has(result.status) || result.markdown === null) return { field: assertion.field, outcome: 'unknown' as const, detail: 'content was not available' }
    const missing = (assertion.mustContain ?? []).filter((value) => !result.markdown!.includes(value))
    const forbidden = (assertion.mustNotContain ?? []).filter((value) => result.markdown!.includes(value))
    const sourceMismatch = assertion.sourceUrl !== undefined && !result.evidence.finalUrl.startsWith(assertion.sourceUrl)
    const requiredMissing = assertion.required === true && result.markdown.trim().length === 0
    if (missing.length === 0 && forbidden.length === 0 && !sourceMismatch && !requiredMissing) return { field: assertion.field, outcome: 'pass' as const, detail: null }
    return { field: assertion.field, outcome: 'fail' as const, detail: `missing=${missing.join(',')}; forbidden=${forbidden.join(',')}; sourceMismatch=${sourceMismatch}; requiredMissing=${requiredMissing}` }
  })
}

function classifyRealTask(result: FetchResult, assertions: readonly { outcome: string }[]): RealTaskOutcome {
  if (CONTENTFUL_STATUS.has(result.status) && assertions.some((assertion) => assertion.outcome === 'unknown')) return 'partial_missing_fields'
  if (CONTENTFUL_STATUS.has(result.status) && assertions.some((assertion) => assertion.outcome === 'fail')) return 'partial_missing_fields'
  if (CONTENTFUL_STATUS.has(result.status)) return 'correct_complete'
  if (result.status === 'blocked' || result.status === 'empty_verified') return 'reasonable_rejection'
  if (result.failureReason === 'timeout' || result.failureReason === 'connection_error' || result.failureReason === 'provider_error') return 'retryable_failure'
  return 'non_retryable_failure'
}

function hashMarkdown(markdown: string | null): string | null {
  return markdown === null ? null : createHash('sha256').update(markdown).digest('hex')
}

function normalizedContentHash(markdown: string | null, patterns: readonly string[]): string | null {
  if (markdown === null) return null
  let normalized = markdown.replace(/\s+/g, ' ').trim()
  for (const pattern of patterns) {
    try { normalized = normalized.replace(new RegExp(pattern, 'g'), '[dynamic-noise]') } catch { /* manifest validation reports invalid patterns separately */ }
  }
  return hashMarkdown(normalized)
}

function buildReport(tasks: readonly RealTaskSpec[], runs: readonly RealTaskRun[]): Phase4Report {
  const byKind = (kind: RealTaskKind) => {
    const taskIds = new Set(tasks.filter((task) => task.kind === kind).map((task) => task.id))
    const rows = runs.filter((run) => taskIds.has(run.taskId))
    return {
      tasks: taskIds.size,
      runs: rows.length,
      correctComplete: rows.filter((row) => row.outcome === 'correct_complete').length,
      repeatConsistent: rows.filter((row) => row.repeatConsistent === true).length,
      unknownCost: rows.filter((row) => row.result?.usage.externalCostUsd === null).length,
    }
  }
  const corrections = runs.map((run) => run.humanCorrectionMinutes).filter((value): value is number => value !== null)
  const withResult = runs.filter((run) => run.result !== null)
  const knownCosts = withResult.map((run) => run.result!.usage.externalCostUsd).filter((value): value is number => value !== null)
  return {
    generatedAt: new Date().toISOString(), manifestVersion: 'phase4-v0.1', taskCount: tasks.length, runCount: runs.length, runs,
    summary: {
      byKind: { ai_knowledge: byKind('ai_knowledge'), product_info: byKind('product_info') },
      holdoutRuns: runs.filter((run) => run.evaluationSet === 'holdout').length,
      manualCorrectionMinutes: corrections.length > 0 ? corrections.reduce((sum, value) => sum + value, 0) : null,
      resourceMeters: {
        wallMs: withResult.reduce((sum, run) => sum + (run.result!.usage.wallMs ?? 0), 0),
        browserMs: withResult.reduce((sum, run) => sum + (run.result!.usage.browserMs ?? 0), 0),
        requestCount: withResult.reduce((sum, run) => sum + (run.result!.usage.requestCount ?? 0), 0),
        contentTokens: withResult.reduce((sum, run) => sum + (run.result!.usage.contentTokens ?? 0), 0),
        bytesWire: withResult.reduce((sum, run) => sum + (run.result!.usage.bytesWire ?? 0), 0),
        unknownCostRuns: withResult.filter((run) => run.result!.usage.externalCostUsd === null).length,
        knownExternalCostUsd: knownCosts.length === withResult.length && withResult.length > 0 ? knownCosts.reduce((sum, value) => sum + value, 0) : null,
      },
    },
  }
}
