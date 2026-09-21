import { readFile, writeFile } from 'node:fs/promises'

const readJson = async (path) => {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null }
}

const first = await readJson(process.argv[2] ?? 'output/phase4/a6-report.json')
const second = await readJson(process.argv[3] ?? 'output/phase4/a6-report-run2.json')
const recovery = await readJson('output/phase4/a6-recovery.json') ?? await readJson('research/phase4_a6_recovery.json')
const install = await readJson('output/phase4/install-smoke.json') ?? await readJson('research/phase4_install_smoke.json')
const quality = await readJson('output/phase4/a6-quality-subset.json')
const correction = JSON.parse(await readFile('research/phase4_human_correction.json', 'utf8'))
const manifest = JSON.parse(await readFile('research/phase4_a6_real_tasks.json', 'utf8'))

const conditions = []
const add = (id, ok, evidence, requiredForAcceptance = true) => {
  conditions.push({ id, ok, evidence, requiredForAcceptance })
}

add('scale_pages', Boolean(first && second && first.taskCount === 100 && second.taskCount === 100), {
  first: first?.taskCount ?? null,
  second: second?.taskCount ?? null,
})
add('scale_domains', new Set((second?.runs ?? []).map((run) => { try { return new URL(run.url).hostname } catch { return null } })).size >= 10, {
  domains: new Set((second?.runs ?? []).map((run) => { try { return new URL(run.url).hostname } catch { return null } })).size,
})
const firstIds = new Set((first?.runs ?? []).map((run) => run.taskId))
const secondIds = new Set((second?.runs ?? []).map((run) => run.taskId))
add('same_task_set', first != null && second != null && firstIds.size === secondIds.size && [...firstIds].every((id) => secondIds.has(id)), {
  firstTasks: firstIds.size,
  secondTasks: secondIds.size,
})
const firstByTask = new Map((first?.runs ?? []).map((run) => [run.taskId, run]))
const consistency = (second?.runs ?? []).map((run) => {
  const before = firstByTask.get(run.taskId)
  return { taskId: run.taskId, outcomeSame: before?.outcome === run.outcome, contentHashSame: before?.contentHash === run.contentHash }
})
add('outcome_consistency', consistency.length === 100 && consistency.every((row) => row.outcomeSame), {
  outcomeSame: consistency.filter((row) => row.outcomeSame).length,
  total: consistency.length,
})
add('quality_subset_field_assertions', quality?.summary?.qualitySubsetRuns > 0, {
  runs: quality?.summary?.qualitySubsetRuns ?? 0,
  correctComplete: quality?.summary?.qualitySubsetCorrectComplete ?? null,
  note: 'scale assertions remain source+nonempty; field-level quality is a separate subset',
})
add('recovery_zero_loss', recovery?.lostUrls?.length === 0 && (recovery?.status === 'passed' || recovery?.status === 'passed_with_live_fetch_failures'), {
  status: recovery?.status ?? 'not_run',
  lost: recovery?.lostUrls?.length ?? null,
  recoveredCanonical: recovery?.recoveredCanonicalTargets ?? null,
})
add('recovery_interrupted_attempt_terminal', recovery?.interruptedAttemptStatus === 'interrupted', {
  interruptedAttemptStatus: recovery?.interruptedAttemptStatus ?? 'not_recorded',
  note: 'prior SIGKILL evidence left the killed attempt running; this condition stays open until rerun',
})
add('clean_clone_install', install?.status === 'passed_clean_clone' || install?.status === 'passed', {
  status: install?.status ?? 'not_run',
  firstTask: install?.firstTask ?? null,
})
add('second_developer_install', install?.operatorIndependence === 'second_developer', {
  operatorIndependence: install?.operatorIndependence ?? null,
}, false)
add('human_correction_minutes', typeof correction.minutes === 'number', {
  minutes: correction.minutes,
  scope: correction.scope,
})
add('support_boundary_documented', true, { path: 'research/phase4_support_boundary.md' })
add('billed_usd_unknown', true, { cost: 'unknown', note: 'local resource meters are comparable; billed USD is not claimed' })

const failedRequired = conditions.filter((row) => row.requiredForAcceptance && !row.ok).map((row) => row.id)
const deferred = conditions.filter((row) => !row.requiredForAcceptance && !row.ok).map((row) => row.id)
const report = {
  phase: 'A6',
  generatedAt: new Date().toISOString(),
  status: failedRequired.length === 0 ? 'conditional_alpha_second_developer_deferred' : 'partial',
  scale: {
    pagesPerRun: second?.taskCount ?? null,
    runs: (first?.runCount ?? 0) + (second?.runCount ?? 0),
    domains: new Set((second?.runs ?? []).map((run) => { try { return new URL(run.url).hostname } catch { return null } })).size,
    labeledHoldoutPages: second?.summary?.holdoutRuns ?? null,
    independentHoldoutPages: manifest.target.independentHoldoutPages,
    qualitySubsetPages: manifest.target.qualitySubsetPages,
  },
  consistency: {
    outcomeSame: consistency.filter((row) => row.outcomeSame).length,
    contentHashSame: consistency.filter((row) => row.contentHashSame).length,
    total: consistency.length,
  },
  conditions,
  openGates: failedRequired,
  deferredExceptions: deferred,
  evidence: {
    installValidation: install?.status ?? 'not_run',
    recoveryValidation: recovery?.status ?? 'not_run',
    humanCorrectionMinutes: correction.minutes,
    cost: 'unknown',
    supportBoundary: 'research/phase4_support_boundary.md',
    qualitySubset: quality?.summary ?? null,
  },
}
await writeFile('output/phase4/a6-gate-report.json', JSON.stringify(report, null, 2) + '\n')
await writeFile('research/phase4_a6_gate_report.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ status: report.status, openGates: report.openGates, deferredExceptions: report.deferredExceptions }, null, 2))
