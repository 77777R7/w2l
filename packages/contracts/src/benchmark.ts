import type { FetchResult } from './result.js'
import type { CheckResult, GroundTruth, SuiteMeta } from './groundTruth.js'
import type { Lane } from './status.js'

/** A crawler under test. Adapters wrap our runtime and every baseline/competitor. */
export interface Subject {
  /** Stable identifier used in reports, e.g. 'bare-http', 'playwright', 'w2l'. */
  id: string
  displayName: string
  /** Version of the underlying tool, recorded per run. */
  version: string
  /**
   * Whether results from this subject are cloud-hosted. Cloud subjects are
   * reported in a separate column and never merged with self-hosted ones.
   */
  hosting: 'self_hosted' | 'cloud'
}

/** Reproducibility stamp. Recorded on every run; results without it are not comparable. */
export interface RunEnvironment {
  gitCommit: string | null
  gitDirty: boolean
  nodeVersion: string
  platform: string
  arch: string
  cpuModel: string
  cpuCount: number
  totalMemoryBytes: number
  /** ISO timestamp of run start. */
  startedAt: string
  /** Resolved versions of dependencies that affect extraction output. */
  dependencyVersions: Readonly<Record<string, string>>
}

export interface CaseOutcome {
  caseId: string
  subjectId: string
  /** Terminal status the subject produced, verbatim. */
  result: FetchResult
  /** Whether the terminal status matched the ground truth expectation. */
  statusMatched: boolean
  /** Whether the settled lane matched expectation. Null when the subject has no lane concept. */
  laneMatched: boolean | null
  /**
   * The five false-success checks. Every check appears exactly once, with
   * outcome 'unknown' where evidence is unavailable. Never silently omitted.
   */
  checks: readonly CheckResult[]
  /** Checks that were actually evaluated (outcome !== 'unknown'). */
  evaluatedChecks: readonly string[]
  /** True iff status is contentful and at least one check failed. */
  isFalseSuccess: boolean
  budgetRespected: boolean
}

export interface SuiteScore {
  suite: SuiteMeta
  subjectId: string
  caseCount: number
  /** Cases whose terminal status matched the ground truth. */
  statusMatchCount: number
  /** Cases that returned content (success | partial). */
  contentfulCount: number
  falseSuccessCount: number
  /**
   * falseSuccessCount / contentfulCount, or null when nothing was contentful.
   * Deliberately not blended into any composite score.
   */
  falseSuccessRate: number | null
  /** Per-check tallies, so an unknown-heavy canary run is visible rather than hidden. */
  checkTallies: Readonly<Record<string, { pass: number; fail: number; unknown: number }>>
  laneDistribution: Readonly<Partial<Record<Lane, number>>>
  medianWallMs: number
  p95WallMs: number
  medianContentTokens: number | null
  budgetViolations: number
}

export interface BenchmarkRun {
  runId: string
  environment: RunEnvironment
  suite: SuiteMeta
  subjects: readonly Subject[]
  /** Lanes this run was permitted to exercise. Public canary runs restrict to Tier 0+1a. */
  lanesUnderTest: readonly Lane[]
  cases: readonly GroundTruth[]
  outcomes: readonly CaseOutcome[]
  scores: readonly SuiteScore[]
}
