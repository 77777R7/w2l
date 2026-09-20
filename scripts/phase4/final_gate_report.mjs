import { readFile, writeFile } from 'node:fs/promises'

const a5 = JSON.parse(await readFile('output/phase4/real-task-report-a5-v2.json', 'utf8'))
const a6 = JSON.parse(await readFile('output/phase4/a6-gate-report.json', 'utf8'))
const report = {
  generatedAt: new Date().toISOString(),
  a5: {
    status: 'partial',
    dynamicPairsClassified: 4,
    knownCostRuns: 0,
    unknownCostRuns: a5.runCount,
    manualCorrectionMinutes: a5.summary.manualCorrectionMinutes,
    qualityBefore: { productCorrectComplete: 16, productRuns: 18, productRepeatConsistent: 5 },
    qualityAfter: { productCorrectComplete: a5.summary.byKind.product_info.correctComplete, productRuns: a5.summary.byKind.product_info.runs, productRepeatConsistent: a5.summary.byKind.product_info.repeatConsistent },
    efficiencyMeasured: false,
    open: ['human correction time', 'comparable cost meter', 'remaining dynamic/path pairs'],
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
