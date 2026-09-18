/**
 * LadderRunner as a ScrapeAtom. Crawl composes this; it does not rewrite fetch.
 */

import type { ScrapeAtom, ScrapeOutcome } from '@w2l/contracts'
import { LadderRunner } from './routing/ladder.js'

export class LadderScrapeAtom implements ScrapeAtom {
  constructor(private readonly runner: LadderRunner) {}

  async scrape(url: string): Promise<ScrapeOutcome> {
    const run = await this.runner.run(url)
    const robotsTrace = run.result.trace.find((event) => event.event === 'robots_checked')
    const crawlDelayMs = typeof robotsTrace?.detail?.crawlDelayMs === 'number' ? robotsTrace.detail.crawlDelayMs : null
    return {
      result: run.result,
      links: run.result.links ?? [],
      audit: {
        channelsTried: run.channelsTried,
        ladderTrace: run.ladderTrace,
        summary: run.summary,
      },
      crawlDelayMs,
    }
  }

  async close(): Promise<void> {}
}
