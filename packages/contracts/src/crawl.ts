/**
 * Crawl composition contract: one scrape atom plus a crawl-level report.
 *
 * The orchestrator never opens Playwright. A page is one `scrape(url)`.
 * Types only — no I/O.
 */

import type { CrawlBudget, TaskStatus } from './checkpoint.js'
import type { CrawlMode } from './compliance.js'
import type { FetchResult, LadderRunAudit } from './result.js'
import type { BudgetKind } from './status.js'

export interface ScrapeOutcome {
  result: FetchResult
  links: readonly string[]
  audit?: LadderRunAudit
}

/**
 * One URL in, one page outcome out. The ladder is the production
 * implementation; Phase 4 tests inject a fake.
 */
export interface ScrapeAtom {
  scrape(url: string): Promise<ScrapeOutcome>
  close(): Promise<void>
}

export interface CrawlSpec {
  seedUrl: string
  taskDir: string
  mode: CrawlMode
  budget: CrawlBudget
  maxDepth: number | null
  allowlistedDomains: readonly string[]
  resumeFrom: string | null
  useCached: boolean
  /** When set, openRun updates this existing task instead of inserting a new id. */
  taskId?: string
}

export interface CrawlReport {
  taskId: string
  attemptId: string
  status: TaskStatus
  pagesFetched: number
  cachedPages: number
  budgetExceeded: BudgetKind | null
  loopDetected: boolean
  wallMs: number
  costUsd: number | null
  contentTokens: number | null
}

export const DEFAULT_CRAWL_SPEC: Omit<CrawlSpec, 'seedUrl' | 'taskDir'> = {
  mode: 'standard',
  budget: { maxPages: null, maxWallMs: null, maxCostUsd: null, maxTokens: null },
  maxDepth: null,
  allowlistedDomains: [],
  resumeFrom: null,
  useCached: false,
}
