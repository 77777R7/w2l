import { readFile, writeFile } from 'node:fs/promises'

const first = JSON.parse(await readFile(process.argv[2] ?? 'output/phase4/a6-report.json', 'utf8'))
const second = JSON.parse(await readFile(process.argv[3] ?? 'output/phase4/a6-report-run2.json', 'utf8'))
const firstByTask = new Map(first.runs.map((run) => [run.taskId, run]))
const consistency = second.runs.map((run) => {
  const before = firstByTask.get(run.taskId)
  return { taskId: run.taskId, outcomeSame: before?.outcome === run.outcome, contentHashSame: before?.contentHash === run.contentHash, evaluationSet: run.evaluationSet }
})
const report = {
  phase: 'A6',
  generatedAt: new Date().toISOString(),
  scale: { pagesPerRun: second.taskCount, runs: first.runCount + second.runCount, domains: new Set(second.runs.map((run) => new URL(run.url).hostname)).size, holdoutPages: second.summary.holdoutRuns },
  consistency: { outcomeSame: consistency.filter((row) => row.outcomeSame).length, contentHashSame: consistency.filter((row) => row.contentHashSame).length, total: consistency.length },
  evidence: { installValidation: 'not_run', recoveryValidation: 'not_run', humanCorrectionMinutes: second.summary.manualCorrectionMinutes, cost: 'unknown' },
  status: 'scale_and_holdout_complete_waiting_for_install_recovery_support_gates',
  openGates: ['interrupt-and-resume on expanded tasks', 'another-developer install and first task', 'human correction minutes', 'supported scope and support boundary'],
}
await writeFile('output/phase4/a6-gate-report.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
