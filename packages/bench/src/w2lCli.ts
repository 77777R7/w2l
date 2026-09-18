#!/usr/bin/env node
/**
 * `w2l scrape <url>` / `w2l crawl <url>` — product entry.
 */
import { pathToFileURL } from 'node:url'
import { parseCrawlArgs, runCrawl, CRAWL_USAGE } from './crawlCli.js'
import { parseArgs, runLadder, USAGE } from './ladderCli.js'

const HELP = `${USAGE}\n${CRAWL_USAGE}`

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    console.log(HELP)
    return argv.length === 0 ? 1 : 0
  }
  if (argv[0] === 'crawl') return runCrawl(parseCrawlArgs(argv))
  return runLadder(parseArgs(argv))
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exitCode = 1
    })
}
