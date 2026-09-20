import { readFile, writeFile } from 'node:fs/promises'

const first = JSON.parse(await readFile(process.argv[2] ?? 'output/phase4/a6-report.json', 'utf8'))
const second = JSON.parse(await readFile(process.argv[3] ?? 'output/phase4/a6-report-run2.json', 'utf8'))
const firstByTask = new Map(first.runs.map((run) => [run.taskId, run]))
const consistency = second.runs.map((run) => {
  const before = firstByTask.get(run.taskId)
  return { taskId: run.taskId, outcomeSame: before?.outcome === run.outcome, contentHashSame: before?.contentHash === run.contentHash, evaluationSet: run.evaluationSet }
})
const readJson = async (path) => {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null }
}
const recovery = await readJson('output/phase4/a6-recovery.json')
const install = await readJson('output/phase4/install-smoke.json')
const correction = JSON.parse(await readFile('research/phase4_human_correction.json', 'utf8'))
const recoveryStatus = recovery && typeof recovery === 'object' ? recovery.status : 'not_run'
const installStatus = install && typeof install === 'object' ? install.status : 'not_run'
const openGates = []
if (recoveryStatus !== 'passed' && recoveryStatus !== 'passed_with_live_fetch_failures') openGates.push('interrupt-and-resume on expanded tasks')
if (installStatus !== 'passed_clean_clone' && installStatus !== 'passed') openGates.push('clean-clone install and first task')
if (correction.minutes == null) openGates.push('human correction minutes')
const report = {
  phase: 'A6',
  generatedAt: new Date().toISOString(),
  scale: { pagesPerRun: second.taskCount, runs: first.runCount + second.runCount, domains: new Set(second.runs.map((run) => new URL(run.url).hostname)).size, holdoutPages: second.summary.holdoutRuns },
  consistency: { outcomeSame: consistency.filter((row) => row.outcomeSame).length, contentHashSame: consistency.filter((row) => row.contentHashSame).length, total: consistency.length },
  evidence: { installValidation: installStatus, recoveryValidation: recoveryStatus, humanCorrectionMinutes: correction.minutes, cost: 'unknown', supportBoundary: 'research/phase4_support_boundary.md' },
  status: openGates.length === 0 ? 'accepted_with_unknown_external_usd' : 'scale_and_holdout_complete_waiting_for_install_recovery_support_gates',
  openGates,
}
await writeFile('output/phase4/a6-gate-report.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
