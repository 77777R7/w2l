#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { CANARY_SUITE } from '@w2l/canary'
import { runBenchmark } from './runner.js'
import { BareHttpSubject } from './subjects/bareHttp.js'
import { GoldenConverterSubject } from './subjects/goldenConverter.js'
import { ExtractTfSubject } from './subjects/extractTf.js'
import { ResilientHttpSubject } from './subjects/resilientHttp.js'
import { BrowserLocalSubject } from './subjects/browserLocal.js'

/**
 * Open-web canary run: the five arms against curated real pages. This is
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
    new BrowserLocalSubject(),
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
  out.push('| Arm | tier | contentful | blocked | failed | budget | median tokens | median wall |')
  out.push('|---|---|---|---|---|---|---|---|')
  for (const s of run.scores) {
    for (const tier of ['1', '2']) {
      const os = run.outcomes.filter(
        (o) => o.subjectId === s.subjectId && o.caseId.startsWith(`canary${tier === '1' ? '-' : '2-'}`),
      )
      if (os.length === 0) continue
      const blocked = os.filter((o) => o.result.status === 'blocked').length
      const failed = os.filter((o) => o.result.status === 'failed').length
      const contentful = os.filter((o) => ['success', 'partial'].includes(o.result.status)).length
      const tokens = os
        .map((o) => o.result.usage.contentTokens)
        .filter((t): t is number => t !== null)
        .sort((a, b) => a - b)
      const median = tokens.length > 0 ? tokens[Math.floor(tokens.length / 2)] : null
      out.push(
        `| ${s.subjectId} | ${tier} | ${contentful}/${os.length} | ${blocked} | ${failed} | ${
          os.filter((o) => !o.budgetRespected).length
        } | ${median ?? '-'} | ${s.medianWallMs}ms |`,
      )
    }
  }
  out.push('')

  out.push('## Per-case detail', '')
  out.push('| case | bare-http | golden | extract-tf | resilient-http | browser-local |')
  out.push('|---|---|---|---|---|---|')
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
      `| [${c.id}](${c.target}) | ${brief('bare-http')} | ${brief('golden-converter')} | ${brief('extract-tf')} | ${brief('resilient-http')} | ${brief('browser-local')} |`,
    )
  }
  out.push('')

  out.push('## Gates named', '')
  out.push('Observed, not graded: a live site\'s gate drifts run-to-run, so no')
  out.push('canary case carries an `expectedBlockReason`. The right-hand column is')
  out.push('the honest counterweight — non-contentful results the classifier could')
  out.push('*not* name. A gate hiding in there reads as a plain failure, which is')
  out.push('the exact defect this section exists to keep visible.')
  out.push('')
  out.push('| Arm | gates named | breakdown | unnamed non-contentful |')
  out.push('|---|---|---|---|')
  for (const s of run.scores) {
    const os = run.outcomes.filter((o) => o.subjectId === s.subjectId)
    const tally = new Map<string, number>()
    for (const o of os) {
      if (o.result.status !== 'blocked') continue
      const key = o.result.blockReason ?? 'unnamed'
      tally.set(key, (tally.get(key) ?? 0) + 1)
    }
    const named = [...tally.values()].reduce((a, b) => a + b, 0)
    const breakdown =
      tally.size === 0
        ? '—'
        : [...tally.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([reason, n]) => `${reason}×${n}`)
            .join(', ')
    const unnamed = os.filter((o) => o.result.status === 'failed').length
    out.push(`| ${s.subjectId} | ${named} | ${breakdown} | ${unnamed} |`)
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
  out.push('- Tier 1 is expected to clear on the http lane alone. Tier 2 is NOT: every tier-2 failure mode (bot gate, auth wall, JS shell) is precisely what the browser lane exists to solve — the tier-2 contentful rate IS the browser-lane value case, measured.')
  out.push('- browser-local is the escalation target the http arms flag into: same extract-tf cascade, real Chromium. Its tier-2 delta against resilient-http is the measured value of the browser lane.')
  out.push('- challenge_text_returned failures on real pages double as bot-gate measurements.')
  out.push('- a gate named `blocked (<reason>)` says the site refused us and which door it used; `failed (http_error)` on a page the curation notes call a bot gate is a classification miss, not a site outage. The Gates-named table is where that distinction is auditable.')
  out.push('')
  return out
}

main().catch((err) => {
  console.error('Canary run failed:', err)
  process.exit(1)
})
