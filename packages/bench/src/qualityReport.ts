import type { BenchmarkRun } from '@w2l/contracts'

export function renderQualityReport(run: BenchmarkRun): string {
  const out = [
    `# L0-L2 Quality Benchmark`,
    '',
    `- Run: \`${run.runId}\``,
    `- Commit: \`${run.environment.gitCommit ?? 'unknown'}\``,
    `- Dirty: ${run.environment.gitDirty ? 'yes' : 'no'}`,
    `- Node: ${run.environment.nodeVersion}`,
    `- Platform: ${run.environment.platform}/${run.environment.arch}`,
    `- Suite: ${run.suite.name} v${run.suite.version} (${run.cases.length} cases)`,
    '',
    '## Subjects',
    '',
    '| Subject | verified completion | false success | P95 wall | cost / contentful | escalations |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ]
  for (const score of run.scores) {
    out.push(`| ${score.subjectId} | ${pct(score.verifiedCompletionRate)} | ${pct(score.falseSuccessRate)} | ${score.p95WallMs}ms | ${money(score.knownCostPerContentfulPageUsd)} | ${score.escalationCount} |`)
  }
  for (const tier of ['L0', 'L1', 'L2'] as const) {
    if (tier === 'L0') {
      out.push('', '## L0: identity and policy integrity', '', '> L0 status match is an integrity audit: cases without identity mismatch/unobserved events. It is not a content-correctness score.', '')
    } else {
      out.push('', `## ${tier}`, '')
    }
    out.push('| Subject | status match | contentful | false success | P95 wall | cost / contentful |', '| --- | ---: | ---: | ---: | ---: | ---: |')
    for (const score of run.scores) {
      const row = score.qualityByTier[tier]
      out.push(`| ${score.subjectId} | ${row.statusMatchCount}/${row.caseCount} | ${row.contentfulCount}/${row.caseCount} | ${pct(row.falseSuccessRate)} | ${row.p95WallMs}ms | ${money(row.knownCostPerContentfulPageUsd)} |`)
    }
  }
  return out.join('\n') + '\n'
}

const pct = (value: number | null): string => value === null ? 'unknown' : `${(value * 100).toFixed(1)}%`
const money = (value: number | null): string => value === null ? 'unknown' : `$${value.toFixed(4)}`
