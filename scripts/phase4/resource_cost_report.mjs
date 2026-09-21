import { mkdir, readFile, writeFile } from 'node:fs/promises'

function metersOf(result) {
  return result.summary ?? result.usage
}

function meters(report) {
  const rows = report.runs.filter((run) => run.result)
  const known = rows.map((run) => metersOf(run.result).externalCostUsd).filter((value) => value !== null)
  const bytesKnown = rows.every((run) => metersOf(run.result).bytesWire != null)
  const tokensKnown = rows.every((run) => metersOf(run.result).contentTokens != null)
  return {
    runs: rows.length,
    wallMs: rows.reduce((sum, run) => sum + (metersOf(run.result).wallMs ?? 0), 0),
    browserMs: rows.reduce((sum, run) => sum + (metersOf(run.result).browserMs ?? 0), 0),
    requestCount: rows.reduce((sum, run) => sum + (metersOf(run.result).requestCount ?? 0), 0),
    contentTokens: tokensKnown ? rows.reduce((sum, run) => sum + (metersOf(run.result).contentTokens ?? 0), 0) : null,
    bytesWire: bytesKnown ? rows.reduce((sum, run) => sum + (metersOf(run.result).bytesWire ?? 0), 0) : null,
    unknownCostRuns: rows.filter((run) => metersOf(run.result).externalCostUsd === null).length,
    knownExternalCostUsd: known.length === rows.length && rows.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null,
    bytesWireUnknownRuns: rows.filter((run) => metersOf(run.result).bytesWire == null).length,
    contentTokensUnknownRuns: rows.filter((run) => metersOf(run.result).contentTokens == null).length,
  }
}

const a5 = JSON.parse(await readFile('output/phase4/real-task-report-a5-v4.json', 'utf8'))
const a6a = JSON.parse(await readFile('output/phase4/a6-report.json', 'utf8'))
const a6b = JSON.parse(await readFile('output/phase4/a6-report-run2.json', 'utf8'))
const report = {
  generatedAt: new Date().toISOString(),
  rule: 'externalCostUsd stays null unless a vendor stated a billed cost. Local wall/browser/request/token/byte meters are comparable resource cost, not USD.',
  a5: meters(a5),
  a6run1: meters(a6a),
  a6run2: meters(a6b),
  comparable: 'resource_meters',
  usd: 'unknown',
}
await mkdir('output/phase4', { recursive: true })
await writeFile('output/phase4/resource-cost-report.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
