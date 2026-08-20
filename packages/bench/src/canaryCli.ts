#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { CANARY_SUITE } from '@w2l/canary'
import { runBenchmark } from './runner.js'
import { BareHttpSubject } from './subjects/bareHttp.js'
import { GoldenConverterSubject } from './subjects/goldenConverter.js'
import { ExtractTfSubject } from './subjects/extractTf.js'
import { ResilientHttpSubject } from './subjects/resilientHttp.js'

/**
 * Open-web canary run: the four arms against curated real pages. This is
 * the W2L extraction claim's first contact with the real world — the report
 * it writes under research/canary_reports/ is committed evidence, not CI.
 *
 * Politesse: one request per case per arm, a real user-agent (see ua.ts),
 * and a 1s inter-case delay. The fixture suite is unaffected.
 */
async function main() {
  console.log('Starting canary run...\n')
  const subjects = [
    new BareHttpSubject(),
    new GoldenConverterSubject(),
    new ExtractTfSubject(),
    new ResilientHttpSubject(),
  ]
  const run = await runBenchmark(subjects, CANARY_SUITE.cases, ['http'], {
    interCaseDelayMs: 1000,
    suiteMeta: { name: CANARY_SUITE.name, version: CANARY_SUITE.version, curatedAt: CANARY_SUITE.curatedAt },
  })
  const lines = reportLines(run)
  const dir = 'research/canary_reports'
  mkdirSync(dir, { recursive: true })
  const path = `${dir}/${new Date().toISOString().split('T')[0]}.md`
  writeFileSync(path, lines.join('\n') + '\n')
  console.log(lines.join('\n'))
  console.log(`\nReport written to ${path}`)
}

function reportLines(run: Awaited<ReturnType<typeof runBenchmark>>): string[] {
  const out: string[] = []
  out.push(`# Canary run ${run.runId}`, '')
  out.push(`- suite: ${run.suite.name} (curated ${run.suite.curatedAt})`)
  out.push(`- cases: ${run.cases.length}`)
  out.push('')

  out.push('## Summary', '')
  out.push('| Arm | contentful | blocked | failed | budget | median tokens | median wall |')
  out.push('|---|---|---|---|---|---|---|')
  for (const s of run.scores) {
    const os = run.outcomes.filter((o) => o.subjectId === s.subjectId)
    const blocked = os.filter((o) => o.result.status === 'blocked').length
    const failed = os.filter((o) => o.result.status === 'failed').length
    out.push(
      `| ${s.subjectId} | ${s.contentfulCount}/${s.caseCount} | ${blocked} | ${failed} | ${s.budgetViolations} | ${s.medianContentTokens ?? '-'} | ${s.medianWallMs}ms |`,
    )
  }
  out.push('')

  out.push('## Per-case detail', '')
  out.push('| case | bare-http | golden | extract-tf | resilient-http |')
  out.push('|---|---|---|---|---|')
  for (let i = 0; i < run.cases.length; i++) {
    const c = run.cases[i]!
    const cells = run.outcomes.filter((o) => o.caseId === c.id)
    const brief = (subjectId: string) => {
      const o = cells.find((x) => x.subjectId === subjectId)!
      const status = o.result.status
      if (status === 'success') {
        const tokens = o.result.usage.contentTokens
        return `ok (${tokens ?? '?'} tok)`
      }
      if (status === 'blocked') return `blocked (${o.result.blockReason})`
      if (status === 'budget_exceeded') return 'budget'
      return `failed (${o.result.failureReason ?? '?'})`
    }
    out.push(
      `| [${c.id}](${c.target}) | ${brief('bare-http')} | ${brief('golden-converter')} | ${brief('extract-tf')} | ${brief('resilient-http')} |`,
    )
  }
  out.push('')

  out.push('## Challenge check tallies (evidence-only on canaries)', '')
  out.push('| Arm | challenge pass | fail | unknown |')
  out.push('|---|---|---|---|')
  for (const s of run.scores) {
    const t = s.checkTallies['challenge_text_returned'] ?? { pass: 0, fail: 0, unknown: 0 }
    out.push(`| ${s.subjectId} | ${t.pass} | ${t.fail} | ${t.unknown} |`)
  }
  out.push('')

  out.push('## Reading the numbers', '')
  out.push('- bare-http sends no user-agent and no extraction: its blocked/failed counts are the open-web floor, not a regression.')
  out.push('- golden/extract-tf/resilient share the polite UA; differences among them are extraction quality, not politeness.')
  out.push('- A contentful count below ~7/10 on the polite arms means the http lane alone cannot carry the product thesis — that is the browser-lane trigger.')
  out.push('- challenge_text_returned failures on real pages double as bot-gate measurements.')
  out.push('')
  return out
}

main().catch((err) => {
  console.error('Canary run failed:', err)
  process.exit(1)
})
