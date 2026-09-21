import { readFile, writeFile } from 'node:fs/promises'
import { evaluateAssertions } from '../../packages/bench/src/phase4RealTask.ts'

const readJson = async (path) => {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null }
}

const manifest = JSON.parse(await readFile('research/phase4_a6_real_tasks.json', 'utf8'))
const first = await readJson('output/phase4/a6-report.json')
const second = await readJson('output/phase4/a6-report-run2.json')
const source = second ?? first
if (source == null) {
  console.error('no A6 report to rescore')
  process.exit(1)
}
const byUrl = new Map(source.runs.map((run) => [run.url, run]))
const subset = manifest.tasks.filter((task) => task.qualitySubset === true)
const rows = subset.map((task) => {
  const run = byUrl.get(task.url)
  if (run?.result == null) return { taskId: task.id, url: task.url, outcome: 'missing_report', assertions: [] }
  const assertions = evaluateAssertions(run.result, task.assertions)
  const failed = assertions.some((row) => row.outcome !== 'pass')
  return {
    taskId: task.id,
    url: task.url,
    sampleRole: task.sampleRole,
    fetchStatus: run.result.status,
    outcome: failed ? 'partial_missing_fields' : 'correct_complete',
    assertions: assertions.filter((row) => row.outcome !== 'pass'),
  }
})
const report = {
  generatedAt: new Date().toISOString(),
  sourceReport: second ? 'output/phase4/a6-report-run2.json' : 'output/phase4/a6-report.json',
  summary: {
    qualitySubsetRuns: rows.length,
    qualitySubsetCorrectComplete: rows.filter((row) => row.outcome === 'correct_complete').length,
    missingReport: rows.filter((row) => row.outcome === 'missing_report').length,
  },
  rows,
}
await writeFile('output/phase4/a6-quality-subset.json', JSON.stringify(report, null, 2) + '\n')
await writeFile('research/phase4_a6_quality_subset.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report.summary, null, 2))
