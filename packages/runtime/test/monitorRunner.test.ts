import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runFirecrawlMonitor } from '../src/monitorRunner.js'
import { MonitorStore } from '../src/monitorStore.js'
import { FIRECRAWL_INTRO_URL } from '@w2l/contracts'

const markdown = `# Introduction
The web data API for AI agents. Firecrawl is the web data API for AI agents.
## [​](#search)Search
Search the web and get full page content from results in one call.
## [​](#scrape)Scrape
Scrape any URL and get its content in markdown, HTML, or other formats.
## [​](#interact)Interact
Scrape a page, then keep working with it: click buttons, fill forms, extract dynamic content.`

function outcome() {
  return { result: { requestedUrl: FIRECRAWL_INTRO_URL, status: 'success' as const, failureReason: null, blockReason: null, budgetExceeded: null, lane: 'http' as const, escalations: [], markdown, truncated: false, truncatedAt: null, compliance: null, evidence: { finalUrl: FIRECRAWL_INTRO_URL, httpStatus: 200, redirectChain: [], contentType: 'text/html', rawBodySha256: 'hash', artifacts: [] }, usage: { wallMs: 1, bytesWire: 1, bytesDecompressed: 1, requestCount: 1, attemptCount: 1, contentTokens: 1, browserMs: 0, externalCostUsd: null }, trace: [] }, links: [] }
}

describe('monitor runner', () => {
  it('does not capture again when the same trigger is replayed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'w2l-runner-'))
    const store = MonitorStore.open(join(dir, 'control.sqlite'))
    let captures = 0
    try {
      const capture = async () => { captures += 1; return outcome() }
      const first = await runFirecrawlMonitor(store, capture, 'same-trigger')
      const second = await runFirecrawlMonitor(store, capture, 'same-trigger')
      expect(captures).toBe(1)
      expect(first.baseline?.version).toBe(1)
      expect(second.baseline?.version).toBe(1)
      expect(second.events).toHaveLength(1)
    } finally { store.close(); await rm(dir, { recursive: true, force: true }) }
  })
})
