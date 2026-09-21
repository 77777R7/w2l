import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { CONTENTFUL_STATUS, type FetchResult, type LadderExecutionSummary } from '@w2l/contracts'
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
  sampleRole?: 'development' | 'regression' | 'independent_holdout'
  qualitySubset?: boolean
  expectedRejection?: boolean
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
  result: (FetchResult & { summary?: LadderExecutionSummary }) | null
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
    byKind: Record<RealTaskKind, {
      tasks: number
      runs: number
      correctComplete: number
      repeatConsistentRuns: number
      repeatPairs: number
      repeatPairsConsistent: number
      unknownCost: number
    }>
    holdoutRuns: number
    independentHoldoutRuns: number
    qualitySubsetRuns: number
    qualitySubsetCorrectComplete: number
    falseSuccessRuns: number
    manualCorrectionMinutes: number | null
    resourceMeters: {
      wallMs: number
      browserMs: number
      requestCount: number
      contentTokens: number | null
      bytesWire: number | null
      unknownCostRuns: number
      knownExternalCostUsd: number | null
      bytesWireUnknownRuns: number
      contentTokensUnknownRuns: number
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
        const outcome = classifyRealTask(result, assertions, task)
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

export function sourceMatches(finalUrl: string, expected: string): boolean {
  try {
    const actual = new URL(finalUrl)
    const want = new URL(expected)
    if (actual.origin !== want.origin) return false
    const prefix = want.pathname === '' || want.pathname === '/' ? '/' : want.pathname
    return actual.pathname === prefix || actual.pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`) || actual.pathname.startsWith(prefix)
  } catch {
    return false
  }
}

export function evaluateAssertions(result: FetchResult, assertions: readonly RealTaskAssertion[]) {
  return assertions.map((assertion) => {
    if (!CONTENTFUL_STATUS.has(result.status) || result.markdown === null) return { field: assertion.field, outcome: 'unknown' as const, detail: 'content was not available' }
    const missing = (assertion.mustContain ?? []).filter((value) => !result.markdown!.includes(value))
    const forbidden = (assertion.mustNotContain ?? []).filter((value) => result.markdown!.includes(value))
    const sourceMismatch = assertion.sourceUrl !== undefined && !sourceMatches(result.evidence.finalUrl, assertion.sourceUrl)
    const requiredMissing = assertion.required === true && result.markdown.trim().length === 0
    if (missing.length === 0 && forbidden.length === 0 && !sourceMismatch && !requiredMissing) return { field: assertion.field, outcome: 'pass' as const, detail: null }
    return { field: assertion.field, outcome: 'fail' as const, detail: `missing=${missing.join(',')}; forbidden=${forbidden.join(',')}; sourceMismatch=${sourceMismatch}; requiredMissing=${requiredMissing}` }
  })
}

function classifyRealTask(
  result: FetchResult,
  assertions: readonly { field: string; outcome: string }[],
  task: RealTaskSpec,
): RealTaskOutcome {
  const failed = assertions.filter((assertion) => assertion.outcome === 'fail' || assertion.outcome === 'unknown')
  if (CONTENTFUL_STATUS.has(result.status) && failed.length === 0) {
    return task.expectedRejection === true ? 'false_success' : 'correct_complete'
  }
  if (CONTENTFUL_STATUS.has(result.status) && failed.length > 0) {
    const identityFail = failed.some((assertion) => assertion.field === 'source_url' || assertion.field === 'title' || assertion.field === 'product_name')
    if (identityFail && (result.markdown ?? '').trim().length > 0) return 'false_success'
    return 'partial_missing_fields'
  }
  if (result.status === 'blocked' || result.status === 'empty_verified') {
    return task.expectedRejection === true ? 'reasonable_rejection' : 'non_retryable_failure'
  }
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

function metersOf(result: NonNullable<RealTaskRun['result']>) {
  return result.summary ?? {
    wallMs: result.usage.wallMs,
    browserMs: result.usage.browserMs,
    requestCount: result.usage.requestCount,
    contentTokens: result.usage.contentTokens,
    bytesWire: result.usage.bytesWire,
    externalCostUsd: result.usage.externalCostUsd,
  }
}

function pairStats(rows: readonly RealTaskRun[]) {
  const byTask = new Map<string, RealTaskRun[]>()
  for (const row of rows) {
    const list = byTask.get(row.taskId) ?? []
    list.push(row)
    byTask.set(row.taskId, list)
  }
  let pairs = 0
  let consistent = 0
  for (const list of byTask.values()) {
    if (list.length < 2) continue
    pairs += 1
    if (list.every((row) => row.repeatConsistent === true)) consistent += 1
  }
  return { pairs, consistent }
}

function buildReport(tasks: readonly RealTaskSpec[], runs: readonly RealTaskRun[]): Phase4Report {
  const specById = new Map(tasks.map((task) => [task.id, task]))
  const byKind = (kind: RealTaskKind) => {
    const taskIds = new Set(tasks.filter((task) => task.kind === kind).map((task) => task.id))
    const rows = runs.filter((run) => taskIds.has(run.taskId))
    const pairs = pairStats(rows)
    return {
      tasks: taskIds.size,
      runs: rows.length,
      correctComplete: rows.filter((row) => row.outcome === 'correct_complete').length,
      repeatConsistentRuns: rows.filter((row) => row.repeatConsistent === true).length,
      repeatPairs: pairs.pairs,
      repeatPairsConsistent: pairs.consistent,
      unknownCost: rows.filter((row) => row.result?.usage.externalCostUsd === null).length,
    }
  }
  const corrections = runs.map((run) => run.humanCorrectionMinutes).filter((value): value is number => value !== null)
  const withResult = runs.filter((run) => run.result !== null)
  const knownCosts = withResult.map((run) => metersOf(run.result!).externalCostUsd).filter((value): value is number => value !== null)
  const bytesKnown = withResult.every((run) => metersOf(run.result!).bytesWire !== null)
  const tokensKnown = withResult.every((run) => metersOf(run.result!).contentTokens !== null)
  const qualityRows = runs.filter((run) => specById.get(run.taskId)?.qualitySubset === true)
  return {
    generatedAt: new Date().toISOString(), manifestVersion: 'phase4-v0.1', taskCount: tasks.length, runCount: runs.length, runs,
    summary: {
      byKind: { ai_knowledge: byKind('ai_knowledge'), product_info: byKind('product_info') },
      holdoutRuns: runs.filter((run) => run.evaluationSet === 'holdout').length,
      independentHoldoutRuns: runs.filter((run) => specById.get(run.taskId)?.sampleRole === 'independent_holdout').length,
      qualitySubsetRuns: qualityRows.length,
      qualitySubsetCorrectComplete: qualityRows.filter((row) => row.outcome === 'correct_complete').length,
      falseSuccessRuns: runs.filter((run) => run.outcome === 'false_success').length,
      manualCorrectionMinutes: corrections.length > 0 ? corrections.reduce((sum, value) => sum + value, 0) : null,
      resourceMeters: {
        wallMs: withResult.reduce((sum, run) => sum + metersOf(run.result!).wallMs, 0),
        browserMs: withResult.reduce((sum, run) => sum + metersOf(run.result!).browserMs, 0),
        requestCount: withResult.reduce((sum, run) => sum + metersOf(run.result!).requestCount, 0),
        contentTokens: tokensKnown ? withResult.reduce((sum, run) => sum + (metersOf(run.result!).contentTokens ?? 0), 0) : null,
        bytesWire: bytesKnown ? withResult.reduce((sum, run) => sum + (metersOf(run.result!).bytesWire ?? 0), 0) : null,
        unknownCostRuns: withResult.filter((run) => metersOf(run.result!).externalCostUsd === null).length,
        knownExternalCostUsd: knownCosts.length === withResult.length && withResult.length > 0 ? knownCosts.reduce((sum, value) => sum + value, 0) : null,
        bytesWireUnknownRuns: withResult.filter((run) => metersOf(run.result!).bytesWire === null).length,
        contentTokensUnknownRuns: withResult.filter((run) => metersOf(run.result!).contentTokens === null).length,
      },
    },
  }
}
