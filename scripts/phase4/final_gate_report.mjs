import { readFile, writeFile } from 'node:fs/promises'

const optional = async (path) => {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null }
}

const a5 = JSON.parse(await readFile('output/phase4/real-task-report-a5-v4.json', 'utf8'))
const a6 = JSON.parse(await readFile('output/phase4/a6-gate-report.json', 'utf8'))
const recovery = await optional('output/phase4/a6-recovery.json')
const install = await optional('output/phase4/install-smoke.json')
const cost = await optional('output/phase4/resource-cost-report.json')
const correction = JSON.parse(await readFile('research/phase4_human_correction.json', 'utf8'))
const ai = a5.summary.byKind.ai_knowledge
const product = a5.summary.byKind.product_info
const qualityClosed = ai.correctComplete === ai.runs && ai.repeatConsistent === ai.runs && product.correctComplete === product.runs && product.repeatConsistent === product.runs
const recoveryPassed = recovery?.status === 'passed' || recovery?.status === 'passed_with_live_fetch_failures'
const installPassed = install?.status === 'passed_clean_clone' || install?.status === 'passed'
const costRecorded = cost?.comparable === 'resource_meters' && cost?.usd === 'unknown'
const open = []
if (!qualityClosed) open.push('A5 quality scores')
if (correction.minutes == null) open.push('human correction time')
if (!costRecorded) open.push('comparable cost meter')
if (!recoveryPassed) open.push('interrupt-and-resume on expanded tasks')
if (!installPassed) open.push('clean-clone install and first task')
const a5Status = qualityClosed && correction.minutes != null && costRecorded ? 'accepted_with_unknown_external_usd' : 'partial'
const a6Status = recoveryPassed && installPassed && correction.minutes != null ? 'accepted_with_unknown_external_usd' : 'partial'
const report = {
  generatedAt: new Date().toISOString(),
  a5: {
    status: a5Status,
    knownCostRuns: 0,
    unknownCostRuns: a5.runCount,
    manualCorrectionMinutes: correction.minutes,
    resourceMeters: a5.summary.resourceMeters ?? cost?.a5 ?? null,
    qualityBefore: { productCorrectComplete: 16, productRuns: 18, productRepeatConsistent: 5, aiCorrectComplete: 18, aiRuns: 22, aiRepeatConsistent: 11 },
    qualityAfter: { productCorrectComplete: product.correctComplete, productRuns: product.runs, productRepeatConsistent: product.repeatConsistent, aiCorrectComplete: ai.correctComplete, aiRuns: ai.runs, aiRepeatConsistent: ai.repeatConsistent },
    open: open.filter((item) => item.startsWith('A5') || item === 'human correction time' || item === 'comparable cost meter'),
  },
  a6: {
    status: a6Status,
    scale: a6.scale,
    consistency: a6.consistency,
    installValidation: install?.status ?? 'not_run',
    recoveryValidation: recovery?.status ?? 'not_run',
    humanCorrectionMinutes: correction.minutes,
    cost: cost?.usd ?? 'unknown',
    supportBoundary: 'research/phase4_support_boundary.md',
    open: open.filter((item) => item.includes('resume') || item.includes('install')),
  },
  decision: open.length === 0
    ? 'A5 quality and A6 scale/recovery/install/support evidence are recorded. External billed USD remains unknown; local resource meters are the comparable cost.'
    : `A5 and A6 remain partial: ${open.join(', ')}.`,
}
await writeFile('output/phase4/final-gate-report.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
