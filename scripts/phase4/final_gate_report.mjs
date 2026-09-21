import { readFile, writeFile } from 'node:fs/promises'

const optional = async (path) => {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null }
}

const pairStatsFromRuns = (report, kind) => {
  const rows = (report?.runs ?? []).filter((run) => run.kind === kind)
  const byTask = new Map()
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
    const hashes = list.map((row) => row.contentHash)
    if (hashes[0] && hashes.every((hash) => hash === hashes[0])) consistent += 1
  }
  return { pairs, consistent, runs: rows.length, correctComplete: rows.filter((row) => row.outcome === 'correct_complete').length }
}

const a5 = await optional('output/phase4/real-task-report-a5-v4.json')
const a6 = JSON.parse(await readFile('research/phase4_a6_gate_report.json', 'utf8'))
const cost = await optional('output/phase4/resource-cost-report.json') ?? await optional('research/phase4_resource_cost_report.json')
const correction = JSON.parse(await readFile('research/phase4_human_correction.json', 'utf8'))
const ai = a5?.summary?.byKind?.ai_knowledge?.repeatPairs != null ? a5.summary.byKind.ai_knowledge : pairStatsFromRuns(a5, 'ai_knowledge')
const product = a5?.summary?.byKind?.product_info?.repeatPairs != null ? a5.summary.byKind.product_info : pairStatsFromRuns(a5, 'product_info')
const aiPairs = { consistent: ai?.repeatPairsConsistent ?? ai?.consistent ?? null, total: ai?.repeatPairs ?? ai?.pairs ?? null, runsCorrectComplete: `${ai?.correctComplete ?? '?'}/${ai?.runs ?? '?'}` }
const productPairs = { consistent: product?.repeatPairsConsistent ?? product?.consistent ?? null, total: product?.repeatPairs ?? product?.pairs ?? null, runsCorrectComplete: `${product?.correctComplete ?? '?'}/${product?.runs ?? '?'}` }
const pairClosed = aiPairs.total > 0 && aiPairs.consistent === aiPairs.total && productPairs.total > 0 && productPairs.consistent === productPairs.total
const a5Open = []
if (!a5) a5Open.push('A5 live report missing from this checkout')
if (a5 && !pairClosed) a5Open.push('A5 repeat pairs not fully consistent')
if (correction.minutes == null) a5Open.push('human correction time')
if (cost?.usd !== 'unknown' || cost?.a5?.knownExternalCostUsd != null || cost?.a6run1?.knownExternalCostUsd != null || cost?.a6run2?.knownExternalCostUsd != null) {
  a5Open.push('billed USD must stay unknown unless invoiced; 0 is not an invoice')
}
const report = {
  generatedAt: new Date().toISOString(),
  a5: {
    status: a5Open.length === 0 ? 'quality_closed_unknown_billed_usd' : 'partial',
    scoring: {
      repeatUnit: 'task pair',
      note: 'Do not read 11/22 -> 22/22 as a 50% to 100% engine gain. Pair-consistent AI was already 11/11 before the shared-flag change.',
      aiPairs,
      productPairs,
    },
    manualCorrectionMinutes: correction.minutes,
    resourceMeters: a5?.summary?.resourceMeters ?? cost?.a5 ?? null,
    open: a5Open,
  },
  a6: {
    status: a6.status,
    scale: a6.scale,
    consistency: a6.consistency,
    conditions: a6.conditions,
    installValidation: a6.evidence.installValidation,
    recoveryValidation: a6.evidence.recoveryValidation,
    humanCorrectionMinutes: a6.evidence.humanCorrectionMinutes,
    cost: a6.evidence.cost,
    supportBoundary: a6.evidence.supportBoundary,
    open: a6.openGates,
    deferredExceptions: a6.deferredExceptions,
  },
  decision: a6.status === 'conditional_alpha_second_developer_deferred' && a5Open.length === 0
    ? 'Section A is a scoped developer alpha. A6 is not an unconditional pass: second-developer install is deferred, billed USD is unknown, and labeled A6 holdout is not independent.'
    : `Section A remains open: ${[...a5Open, ...a6.openGates].join(', ') || 'see A6 conditions'}.`,
}
await writeFile('output/phase4/final-gate-report.json', JSON.stringify(report, null, 2) + '\n')
await writeFile('research/phase4_final_gate_report.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ a5: report.a5.status, a6: report.a6.status, decision: report.decision, a6Open: report.a6.open }, null, 2))
