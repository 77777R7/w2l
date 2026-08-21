import type { BlockReason, BudgetKind, FailureReason, Lane, ResultStatus } from './status.js'
import type { ComplianceRecord } from './compliance.js'

/** Why the runtime moved from one lane to the next. Logged for the escalation corpus. */
export interface Escalation {
  from: Lane
  to: Lane
  /** Machine-readable trigger, e.g. 'low_text_yield' | 'spa_marker' | 'blocked' */
  trigger: string
  /** Whether the escalation actually improved the outcome. Null until known. */
  improved: boolean | null
}

export interface ResourceUsage {
  wallMs: number
  /** Bytes received on the wire (compressed). */
  bytesWire: number
  /** Bytes after decompression. Guarded by a decompressed-size cap. */
  bytesDecompressed: number
  requestCount: number
  attemptCount: number
  /** Token count of the emitted main content. Null if not tokenized. */
  contentTokens: number | null
  browserMs: number
  /**
   * Cost incurred outside this process, paid by the user to a third party
   * (BYO proxy egress, provider browser minutes, model calls).
   * `null` means no external cost path was used — never means "free".
   */
  externalCostUsd: number | null
}

export interface Evidence {
  /** Final URL after redirects. */
  finalUrl: string
  httpStatus: number | null
  redirectChain: readonly string[]
  contentType: string | null
  /** sha256 of the raw response body, for canary drift detection. */
  rawBodySha256: string | null
  /** Relative artifact paths (raw body, screenshot, DOM snapshot). */
  artifacts: readonly string[]
}

export interface TraceEvent {
  at: number
  lane: Lane
  event: string
  detail?: Record<string, unknown>
}

/**
 * A page-level fetch outcome. `status` is the single source of truth
 * (see RESULT_STATUS); the reason fields narrow it.
 */
export interface FetchResult {
  requestedUrl: string
  status: ResultStatus
  /** Set iff status === 'failed'. */
  failureReason: FailureReason | null
  /** Set iff status === 'blocked'. */
  blockReason: BlockReason | null
  /** Set iff status === 'budget_exceeded'. */
  budgetExceeded: BudgetKind | null
  /** The lane that produced this result. */
  lane: Lane
  escalations: readonly Escalation[]
  /** Extracted main content as Markdown. Null unless status is contentful. */
  markdown: string | null
  /** True when content was cut to fit a token budget. */
  truncated: boolean
  /** Character offset where truncation occurred; null when not truncated. */
  truncatedAt: number | null
  /**
   * Tamper-evident record of what the fetch actually did (robots.txt decision,
   * exact headers sent, rate-limit facts). Null until a subject wires the
   * record builder in; contentful subjects are expected to produce one per
   * fetch so the premium "provable politeness" tier is not a bolt-on.
   */
  compliance: ComplianceRecord | null
  evidence: Evidence
  usage: ResourceUsage
  trace: readonly TraceEvent[]
}
