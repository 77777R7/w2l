/**
 * Checkpoint contract: `task → attempt → step` at URL granularity.
 *
 * Persistence lives behind TaskStore (ADR 0003). This file is types only —
 * no I/O, no SQL. Callers generate UUIDs; the store never autoincrements.
 *
 * Granularity is the page. A partial parse inside a page is not a step; the
 * whole URL is retried. Block-level checkpoint is out of Phase 1.
 */

import type { CrawlMode } from './compliance.js'
import type { FetchResult, LadderRunAudit } from './result.js'
import type { ScrapeFormat } from './structured.js'
import type { BudgetKind, Lane, ResultStatus } from './status.js'

export const TASK_STATUS = ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'] as const
export type TaskStatus = (typeof TASK_STATUS)[number]

export const ATTEMPT_STATUS = ['running', 'completed', 'failed', 'cancelled', 'interrupted'] as const
export type AttemptStatus = (typeof ATTEMPT_STATUS)[number]

export const STEP_STATUS = [
  'pending',
  'running',
  'success',
  'partial',
  'empty_verified',
  'blocked',
  'failed',
  'cancelled',
  'budget_exceeded',
  'duplicate',
] as const
export type StepStatus = (typeof STEP_STATUS)[number]

/**
 * Hard caps for one crawl task. Null means "this dimension is not bounded".
 * Spent meters live on Attempt, not here — the spec is the ceiling.
 */
export interface CrawlBudget {
  maxPages: number | null
  maxWallMs: number | null
  maxCostUsd: number | null
  maxTokens: number | null
}

export const DEFAULT_CRAWL_BUDGET: CrawlBudget = {
  maxPages: null,
  maxWallMs: null,
  maxCostUsd: null,
  maxTokens: null,
}

/** One crawl job. The SQLite file sits next to `taskDir`. */
export interface Task {
  id: string
  seedUrl: string
  taskDir: string
  mode: CrawlMode
  status: TaskStatus
  budget: CrawlBudget
  /** Present only for an explicit URL-array batch. Stored with the checkpoint. */
  batch?: { urls: readonly string[]; formats: readonly ScrapeFormat[]; includeLinks: boolean }
  createdAt: string
  updatedAt: string
}

/**
 * One execution of a task. A resume after crash opens a new attempt against
 * the same task so history is not overwritten (PHASE1 / PRODUCT_PLAN_V2 §4.3).
 */
export interface Attempt {
  id: string
  taskId: string
  status: AttemptStatus
  startedAt: string
  endedAt: string | null
  pagesFetched: number
  wallMs: number
  costUsd: number | null
  costUnknown?: boolean
  contentTokens: number
  contentTokensUnknown?: boolean
  /** Which budget dimension stopped this attempt, if any. */
  budgetExceeded: BudgetKind | null
  /** Set when this attempt resumes a previously interrupted attempt. */
  recoveredFromAttemptId?: string | null
}

/**
 * One URL inside one attempt. The atomic checkpoint unit.
 *
 * `canonicalUrl` is the dedupe key the frontier will use later; this slice
 * stores whatever the caller supplies and does not normalize.
 * `contentHash` is the body hash used on resume to decide refetch vs cache.
 * `result` is the page FetchResult when one exists; null while pending/running.
 */
export interface StepRecord {
  id: string
  taskId: string
  attemptId: string
  url: string
  canonicalUrl: string
  depth: number
  status: StepStatus
  lane: Lane | null
  contentHash: string | null
  cached: boolean
  result: FetchResult | null
  audit?: LadderRunAudit
  createdAt: string
  updatedAt: string
}

/** ResultStatus and StepStatus share the terminal page outcomes. */
export function stepStatusFromResult(status: ResultStatus): StepStatus {
  return status
}
