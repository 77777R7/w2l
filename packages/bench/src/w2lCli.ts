#!/usr/bin/env node
/**
 * `w2l scrape <url>` — product entry. `w2l fetch` is the same ladder.
 */
import { pathToFileURL } from 'node:url'
import { parseArgs, runLadder, USAGE } from './ladderCli.js'

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    console.log(USAGE)
    return argv.length === 0 ? 1 : 0
  }
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
