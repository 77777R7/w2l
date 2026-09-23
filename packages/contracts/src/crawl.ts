/**
 * Crawl composition contract: one scrape atom plus a crawl-level report.
 *
 * The orchestrator never opens Playwright. A page is one `scrape(url)`.
 * Types only — no I/O.
 */

import type { CrawlBudget, StepStatus, TaskStatus } from './checkpoint.js'
import type { CrawlMode } from './compliance.js'
import type { Evidence, FetchResult, LadderRunAudit, TraceEvent } from './result.js'
import type { Lane } from './status.js'
import type { BudgetKind } from './status.js'
import type { ExecutionContext } from './execution.js'

export interface ScrapeOutcome {
  result: FetchResult
  links: readonly string[]
  audit?: LadderRunAudit
  crawlDelayMs?: number | null
}

/**
 * One URL in, one page outcome out. The ladder is the production
 * implementation; Phase 4 tests inject a fake.
 */
export interface ScrapeAtom {
  scrape(url: string, context?: ExecutionContext): Promise<ScrapeOutcome>
  close(): Promise<void>
}

export interface CrawlSpec {
  seedUrl: string
  seedUrls?: readonly string[]
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
  costUnknown?: boolean
  contentTokens: number | null
  contentTokensUnknown?: boolean
}

export interface CrawlPage {
  id: string
  url: string
  canonicalUrl: string
  depth: number
  status: StepStatus
  lane: Lane | null
  markdown: string | null
  json?: import('./structured.js').StructuredExtractionResult | null
  failureReason: string | null
  blockReason: string | null
  budgetExceeded: BudgetKind | null
  evidence: Evidence | null
  trace: readonly TraceEvent[]
  audit?: LadderRunAudit
  cached: boolean
  contentHash: string | null
  createdAt: string
  updatedAt: string
}

export interface CrawlError extends CrawlPage {
  trace: readonly TraceEvent[]
}

export interface CrawlPageList<T> {
  items: readonly T[]
  nextCursor: string | null
  hasMore: boolean
}


export const DEFAULT_CRAWL_SPEC: Omit<CrawlSpec, 'seedUrl' | 'taskDir'> = {
  mode: 'standard',
  budget: { maxPages: null, maxWallMs: null, maxCostUsd: null, maxTokens: null },
  maxDepth: null,
  allowlistedDomains: [],
  resumeFrom: null,
  useCached: false,
}
