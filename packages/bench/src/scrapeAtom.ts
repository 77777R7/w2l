/**
 * LadderRunner as a ScrapeAtom. Crawl composes this; it does not rewrite fetch.
 */

import type { ScrapeAtom, ScrapeOutcome } from '@w2l/contracts'
import { LadderRunner } from './routing/ladder.js'

export class LadderScrapeAtom implements ScrapeAtom {
  constructor(private readonly runner: LadderRunner) {}

  async scrape(url: string): Promise<ScrapeOutcome> {
    const run = await this.runner.run(url)
    return {
      result: run.result,
      links: run.result.links ?? [],
    }
  }

  async close(): Promise<void> {}
}
