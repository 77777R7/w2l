import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { checkFalseSuccess, isFalseSuccess } from './checker.js'
import type { FetchResult, GroundTruth } from '@w2l/contracts'

type ExternalRecord = { id: string; success: boolean; markdown: string; error: string; wallMs: number; raw?: unknown; rawResponse?: unknown; rawResult?: unknown }

function result(record: ExternalRecord): FetchResult {
  return {
    requestedUrl: record.id,
    status: record.success ? 'success' : 'failed',
    failureReason: record.success ? null : 'internal_error',
    blockReason: null, budgetExceeded: null, lane: 'http', escalations: [], markdown: record.markdown || null,
    truncated: false, truncatedAt: null, compliance: null,
    evidence: { finalUrl: record.id, httpStatus: record.success ? 200 : null, redirectChain: [], contentType: 'text/html', rawBodySha256: null, artifacts: [] },
    usage: { wallMs: record.wallMs, bytesWire: null, bytesDecompressed: 0, requestCount: 1, attemptCount: 1, contentTokens: null, browserMs: 0, externalCostUsd: null },
    trace: [],
  }
}

async function main(): Promise<void> {
  const manifestPath = process.env.W2L_PHASE3_MANIFEST ?? 'output/phase3-gate/manifest.json'
  const outputDir = process.env.W2L_PHASE3_OUT_DIR ?? 'output/phase3-gate'
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { fixtureBaseUrl: string; suite: { cases: readonly GroundTruth[] } }
  const cases = manifest.suite.cases
  const tools = ['w2l', 'firecrawl', 'crawl4ai', 'crawl4ai-filtered']
  const reports: Record<string, unknown> = {}
  for (const tool of tools) {
    const records = tool === 'w2l'
      ? w2lRecords(JSON.parse(await readFile(`${outputDir}/w2l/benchmark-l0-l2.json`, 'utf8')))
      : JSON.parse(await readFile(`${outputDir}/${tool}/raw.json`, 'utf8')) as ExternalRecord[]
    const byId = new Map(records.map((record) => [record.id, record]))
    const outcomes = cases.map((truth) => {
      const record = byId.get(truth.id)
      if (record === undefined) throw new Error(`${tool} missing case ${truth.id}`)
      const fetched = result(record)
      const checks = checkFalseSuccess(fetched, truth)
      return { id: truth.id, set: truth.evaluationSet ?? 'development', expectedStatus: truth.expectedStatus, status: fetched.status, raw: record.raw ?? record.rawResponse ?? record.rawResult ?? null, statusMatched: fetched.status === truth.expectedStatus, falseSuccess: isFalseSuccess(fetched, checks), wallMs: fetched.usage.wallMs, error: record.error }
    })
    const contentful = outcomes.filter((outcome) => outcome.status === 'success')
    const falseSuccesses = outcomes.filter((outcome) => outcome.falseSuccess)
    const positive = outcomes.filter((outcome) => outcome.expectedStatus === 'success' || outcome.expectedStatus === 'partial')
    const negative = outcomes.filter((outcome) => !positive.includes(outcome))
    reports[tool] = {
      caseCount: outcomes.length,
      statusMatches: outcomes.filter((outcome) => outcome.statusMatched).length,
      verifiedCompletion: contentful.filter((outcome) => !outcome.falseSuccess).length / outcomes.length,
      falseSuccessRate: contentful.length > 0 ? falseSuccesses.length / contentful.length : null,
      p95WallMs: percentile(outcomes.map((outcome) => outcome.wallMs), 0.95),
      failureExplainability: failureExplainability(outcomes.map((outcome) => ({ success: outcome.status === 'success', error: outcome.error }))),
      costPerVerifiedPageUsd: null,
      recoveryCorrectness: tool === 'w2l' ? 'not_run' : 'unsupported',
      positive: { caseCount: positive.length, contentCompletion: positive.filter((outcome) => outcome.statusMatched && !outcome.falseSuccess).length / Math.max(1, positive.length), falseSuccessRate: positive.filter((outcome) => outcome.status === 'success' || outcome.status === 'partial').length > 0 ? positive.filter((outcome) => outcome.falseSuccess).length / positive.filter((outcome) => outcome.status === 'success' || outcome.status === 'partial').length : null },
      negative: { caseCount: negative.length, expectedRefusalAccuracy: negative.filter((outcome) => outcome.statusMatched).length / Math.max(1, negative.length), wrongSuccessCount: negative.filter((outcome) => outcome.status === 'success' || outcome.status === 'partial').length, failureClassificationAccuracy: null },
      outcomes,
    }
  }
  await mkdir(outputDir, { recursive: true })
  const leaders = metricLeaders(reports)
  const evidenceComplete = tools.every((tool) => recordsPresent(outputDir, tool)) && !Object.values(reports).some((report) => (report as { caseCount: number }).caseCount !== cases.length)
  const measured = { verifiedCompletion: true, falseSuccessRate: true, failureExplainability: true, p95Latency: true, costPerVerifiedPage: false, recoveryCorrectness: false }
  const comparison = { generatedAt: new Date().toISOString(), evidenceComplete, measured, tools: reports, leaders, decision: evidenceComplete ? `page-quality evidence complete; W2L leads: ${leaders.filter((leader) => leader.tool === 'w2l').map((leader) => leader.metric).join(', ') || 'none'}. Cost and recovery remain unmeasured.` : 'blocked: raw evidence is missing for one or more comparator' }
  await writeFile(`${outputDir}/comparison.json`, JSON.stringify(comparison, null, 2) + '\n')
  const rows = Object.entries(reports).map(([tool, report]) => {
    const value = report as { verifiedCompletion: number; falseSuccessRate: number | null; failureExplainability: number | null; p95WallMs: number; statusMatches: number; caseCount: number }
    return `| ${tool} | ${value.statusMatches}/${value.caseCount} | ${(value.verifiedCompletion * 100).toFixed(1)}% | ${value.falseSuccessRate === null ? 'unknown' : (value.falseSuccessRate * 100).toFixed(1) + '%'} | ${value.failureExplainability === null ? 'unknown' : (value.failureExplainability * 100).toFixed(1) + '%'} | ${value.p95WallMs}ms |`
  })
  await writeFile(`${outputDir}/comparison.md`, `# Phase 3 Benchmark Comparison\n\nEvidence complete: **${evidenceComplete ? 'yes' : 'no'}**\n\nDecision: ${comparison.decision}\n\n| Tool | status matches | verified completion | false success | failure explainability | P95 wall |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${rows.join('\n')}\n\n## Metric leaders\n\n${leaders.length === 0 ? '- none: evidence incomplete' : leaders.map((leader) => `- ${leader.metric}: ${leader.tool}`).join('\n')}\n\n## Unmeasured\n\n- Cost per verified page: unavailable because the self-hosted adapters do not expose a comparable dollar-cost meter.\n- Recovery correctness: unavailable because this run is page-level and does not execute equivalent kill/resume workflows in each comparator.\n`)
}

function w2lRecords(run: { outcomes: Array<{ caseId: string; result: FetchResult }> }): ExternalRecord[] {
  return run.outcomes.map((outcome) => ({
    id: outcome.caseId,
    success: outcome.result.status === 'success' || outcome.result.status === 'partial',
    markdown: outcome.result.markdown ?? '',
    error: outcome.result.failureReason ?? outcome.result.blockReason ?? '',
    wallMs: outcome.result.usage.wallMs,
  }))
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
}

function failureExplainability(outcomes: Array<{ success: boolean; error: string }>): number | null {
  const failures = outcomes.filter((outcome) => !outcome.success)
  return failures.length === 0 ? null : failures.filter((outcome) => outcome.error.length > 0).length / failures.length
}

function recordsPresent(outputDir: string, tool: string): boolean {
  try {
    return tool === 'w2l'
      ? existsSync(`${outputDir}/w2l/benchmark-l0-l2.json`)
      : existsSync(`${outputDir}/${tool}/raw.json`)
  } catch {
    return false
  }
}

function metricLeaders(reports: Record<string, unknown>): Array<{ metric: string; tool: string; value: number }> {
  const rows = Object.entries(reports) as Array<[string, { verifiedCompletion: number; falseSuccessRate: number | null; failureExplainability: number | null; p95WallMs: number }]>
  const leaders: Array<{ metric: string; tool: string; value: number }> = []
  const highest = (metric: string, values: Array<[string, number]>): void => {
    if (values.length === 0) return
    const max = Math.max(...values.map(([, value]) => value))
    const winner = values.find(([, value]) => value === max)
    if (winner !== undefined) leaders.push({ metric, tool: winner[0], value: winner[1] })
  }
  highest('verifiedCompletion', rows.map(([tool, row]) => [tool, row.verifiedCompletion] as [string, number]))
  highest('failureExplainability', rows.filter(([, row]) => row.failureExplainability !== null).map(([tool, row]) => [tool, row.failureExplainability!] as [string, number]))
  const falseRates = rows.filter(([, row]) => row.falseSuccessRate !== null).map(([tool, row]) => [tool, row.falseSuccessRate!] as [string, number])
  if (falseRates.length > 0) {
    const min = Math.min(...falseRates.map(([, value]) => value))
    const winner = falseRates.find(([, value]) => value === min)
    if (winner !== undefined) leaders.push({ metric: 'falseSuccessRate', tool: winner[0], value: winner[1] })
  }
  const walls = rows.map(([tool, row]) => [tool, row.p95WallMs] as [string, number])
  if (walls.length > 0) {
    const min = Math.min(...walls.map(([, value]) => value))
    const winner = walls.find(([, value]) => value === min)
    if (winner !== undefined) leaders.push({ metric: 'p95Latency', tool: winner[0], value: winner[1] })
  }
  return leaders
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
