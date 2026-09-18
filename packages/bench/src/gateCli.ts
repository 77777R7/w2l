#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { bindSuite, startFixtureServer } from '@w2l/fixtures'
import { buildBenchmarkGateReport, detectComparator } from './benchmarkGate.js'
import { runBenchmark } from './runner.js'
import { BareHttpSubject } from './subjects/bareHttp.js'
import { ExtractTfSubject } from './subjects/extractTf.js'
import { ResilientHttpSubject } from './subjects/resilientHttp.js'
import { BrowserLocalSubject } from './subjects/browserLocal.js'
import { LadderSubject } from './subjects/ladderSubject.js'

async function main(): Promise<void> {
  const outputDir = process.env.W2L_BENCHMARK_OUT_DIR ?? 'output/benchmark-gate'
  await mkdir(outputDir, { recursive: true })
  const server = await startFixtureServer()
  try {
    const suite = bindSuite(server.url)
    const run = await runBenchmark(
      [new BareHttpSubject(), new ExtractTfSubject(), new ResilientHttpSubject(), new BrowserLocalSubject(), new LadderSubject()],
      suite.cases,
      ['http', 'browser_local'],
      { suiteMeta: { name: suite.name, version: suite.version, curatedAt: new Date().toISOString().slice(0, 10) } },
    )
    await writeFile(`${outputDir}/w2l-run.json`, JSON.stringify(run, null, 2) + '\n')
    const comparators = [
      detectComparator('firecrawl-self-hosted', 'Firecrawl self-hosted', process.env.W2L_FIRECRAWL_BIN ?? 'firecrawl', [], `${outputDir}/firecrawl.json`),
      detectComparator('crawl4ai-self-hosted', 'Crawl4AI self-hosted', process.env.W2L_CRAWL4AI_BIN ?? 'crawl4ai', [], `${outputDir}/crawl4ai.json`),
    ]
    const report = buildBenchmarkGateReport(run, comparators)
    await writeFile(`${outputDir}/gate.json`, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
    if (report.gate === 'blocked') process.exitCode = 2
  } finally {
    await server.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
