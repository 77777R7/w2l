#!/usr/bin/env node
import { startFixtureServer } from '@w2l/fixtures'
import { bindSuite } from '@w2l/fixtures'
import { runBenchmark } from './runner.js'
import { BareHttpSubject } from './subjects/bareHttp.js'
import { GoldenConverterSubject } from './subjects/goldenConverter.js'
import { ExtractTfSubject } from './subjects/extractTf.js'
import { ResilientHttpSubject } from './subjects/resilientHttp.js'
import { BrowserLocalSubject } from './subjects/browserLocal.js'

async function main() {
  console.log('Starting benchmark runner...\n')

  // Start fixture server
  const server = await startFixtureServer()
  console.log(`Fixture server listening on ${server.url}\n`)

  // Bind suite to the live server
  const suite = bindSuite(server.url)
  console.log(`Suite: ${suite.name} v${suite.version} (${suite.cases.length} cases)\n`)

  // Run benchmark: bare HTTP floor, golden converter reference, extract-tf,
  // resilient transport, and the browser lane the http arms escalate into
  // (the SPA fixtures' expectedLane is browser_local)
  const subjects = [
    new BareHttpSubject(),
    new GoldenConverterSubject(),
    new ExtractTfSubject(),
    new ResilientHttpSubject(),
    new BrowserLocalSubject(),
  ]
  const result = await runBenchmark(subjects, suite.cases, ['http', 'browser_local'])

  // Print summary
  console.log('\n=== Benchmark Results ===\n')
  for (const score of result.scores) {
    console.log(`Subject: ${score.subjectId}`)
    console.log(`  Cases: ${score.caseCount}`)
    console.log(`  Status matches: ${score.statusMatchCount}/${score.caseCount}`)
    // Printed as a pair against the graded count, not the case count: a subject
    // that names 4 of 4 gates has not scored 4/41, and a subject that names none
    // should read as 0/4 rather than as an absent metric.
    console.log(
      `  Gate names: ${score.blockReasonMatchCount}/${score.blockReasonGradedCount} graded`,
    )
    console.log(`  Contentful: ${score.contentfulCount}`)
    console.log(`  False successes: ${score.falseSuccessCount}`)
    console.log(
      `  False success rate: ${score.falseSuccessRate !== null ? (score.falseSuccessRate * 100).toFixed(1) + '%' : 'N/A'}`,
    )
    console.log(`  Median wall time: ${score.medianWallMs}ms`)
    console.log(`  Budget violations: ${score.budgetViolations}`)
    console.log()
  }

  // Clean up
  await server.close()
  console.log('Done.')
}

main().catch((err) => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
