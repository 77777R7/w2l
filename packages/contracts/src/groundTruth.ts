import type { Lane, ResultStatus } from './status.js'
import type { ExpectedTable } from './tableMarkdown.js'

/** The five false-success checks. Fixtures evaluate all five; canaries evaluate the evidence-bearing subset. */
export const FALSE_SUCCESS_CHECK = [
  /** 1. A required fact from the ground truth is absent. Needs annotation. */
  'missing_required_content',
  /** 2. Challenge-page boilerplate returned as if it were article text. Self-evident. */
  'challenge_text_returned',
  /** 3. Main content below the annotated floor, or banned boilerplate present. Needs annotation. */
  'content_yield_below_floor',
  /** 4. Content belongs to a different URL (soft 404, redirect to home/login). Self-evident. */
  'wrong_page_content',
  /** 5. Content was cut short without setting truncatedAt. Self-evident. */
  'silent_truncation',
] as const

export type FalseSuccessCheck = (typeof FALSE_SUCCESS_CHECK)[number]

/**
 * Checks computable without per-page annotation. Canary runs evaluate exactly these;
 * the annotation-dependent ones are reported as unknown, never as pass.
 */
export const EVIDENCE_ONLY_CHECKS: readonly FalseSuccessCheck[] = [
  'challenge_text_returned',
  'wrong_page_content',
  'silent_truncation',
]

export const ANNOTATION_REQUIRED_CHECKS: readonly FalseSuccessCheck[] = [
  'missing_required_content',
  'content_yield_below_floor',
]

export type CheckOutcome = 'pass' | 'fail' | 'unknown'

export interface CheckResult {
  check: FalseSuccessCheck
  outcome: CheckOutcome
  /** Why it failed, or why it could not be evaluated. */
  detail: string | null
}

export interface CaseBudget {
  maxTokens: number
  maxWallMs: number
  maxAttempts: number
}

/**
 * Ground truth for one benchmark case.
 * Fixtures carry the full annotation; canaries may omit the annotation-only fields.
 */
export interface GroundTruth {
  /** Stable case id, unique across the suite. */
  id: string
  /** Path relative to the fixture server root, or an absolute https URL for canaries. */
  target: string
  kind: 'fixture' | 'canary'
  /** What this case is designed to probe. */
  category: string
  /** Substrings that MUST appear in the extracted markdown. */
  mustContain: readonly string[]
  /** Substrings that MUST NOT appear (nav, footer, cookie banner, ads). */
  mustNotContain: readonly string[]
  /**
   * Structural table assertion, evaluated by check `missing_required_content`
   * against the extracted markdown. Omitted for cases without table annotation.
   * Use unique cell strings so cells/anchors locate unambiguously.
   */
  expectedTable?: ExpectedTable | null
  /** The lane the runtime is expected to settle on. */
  expectedLane: Lane
  /** True when an empty extraction is the correct answer. */
  emptyIsLegit: boolean
  /** Inclusive token range for the main content. Null when unannotated (canary). */
  expectedMainTokens: { min: number; max: number } | null
  budget: CaseBudget
  /** Expected terminal status. Lets non-success cases (blocked, failed) be asserted too. */
  expectedStatus: ResultStatus
  notes?: string
}

export interface SuiteMeta {
  name: string
  version: string
  /** ISO date the suite content was last curated. */
  curatedAt: string
}

export interface Suite extends SuiteMeta {
  cases: readonly GroundTruth[]
}
