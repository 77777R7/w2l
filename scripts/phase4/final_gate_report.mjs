import { readFile, writeFile } from 'node:fs/promises'

const a5 = JSON.parse(await readFile('output/phase4/real-task-report-a5-v4.json', 'utf8'))
const a6 = JSON.parse(await readFile('output/phase4/a6-gate-report.json', 'utf8'))
const ai = a5.summary.byKind.ai_knowledge
const product = a5.summary.byKind.product_info
const qualityClosed = ai.correctComplete === ai.runs && ai.repeatConsistent === ai.runs && product.correctComplete === product.runs && product.repeatConsistent === product.runs
const report = {
  generatedAt: new Date().toISOString(),
  a5: {
    status: qualityClosed ? 'quality_closed_waiting_for_cost_and_correction' : 'partial',
    dynamicPairsClassified: 4,
    knownCostRuns: 0,
    unknownCostRuns: a5.runCount,
    manualCorrectionMinutes: a5.summary.manualCorrectionMinutes,
    qualityBefore: { productCorrectComplete: 16, productRuns: 18, productRepeatConsistent: 5, aiCorrectComplete: 18, aiRuns: 22, aiRepeatConsistent: 11 },
    qualityAfter: { productCorrectComplete: product.correctComplete, productRuns: product.runs, productRepeatConsistent: product.repeatConsistent, aiCorrectComplete: ai.correctComplete, aiRuns: ai.runs, aiRepeatConsistent: ai.repeatConsistent },
    efficiencyMeasured: false,
    open: ['human correction time', 'comparable cost meter'],
  },
  a6: {
    status: a6.status,
    scale: a6.scale,
    consistency: a6.consistency,
    installValidation: a6.evidence.installValidation,
    recoveryValidation: a6.evidence.recoveryValidation,
    humanCorrectionMinutes: a6.evidence.humanCorrectionMinutes,
    cost: a6.evidence.cost,
    open: a6.openGates,
  },
  decision: 'A5 and A6 remain partial until human correction, comparable cost, recovery, second-developer installation, and support-boundary evidence are recorded.',
}
await writeFile('output/phase4/final-gate-report.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
