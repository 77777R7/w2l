import type { BenchmarkRun, CaseOutcome, GroundTruth, RunEnvironment, SuiteScore, SuiteMeta } from '@w2l/contracts'
import { CONTENTFUL_STATUS } from '@w2l/contracts'
import type { FetchResult } from '@w2l/contracts'
import { checkFalseSuccess, isFalseSuccess } from './checker.js'
import type { SubjectAdapter } from './subject.js'

/**
 * Reset the fixture server's stateful fixtures before each subject, so every
 * subject observes attempt 1 (the flaky fixture is global mutable state). The
 * control route is not part of the suite; this is the runner's contract with
 * the fixture server, not a subject behaviour.
 *
 * Only fixture-kind cases carry a fixture-server origin. A canary suite
 * (absolute URLs to real sites) must never receive a /__reset request —
 * derive the origin from the first fixture case, and skip when there is none.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function resetStatefulFixtures(cases: readonly GroundTruth[]): Promise<void> {
  const firstFixture = cases.find((c) => c.kind === 'fixture')
  if (!firstFixture) return
  const origin = new URL(firstFixture.target).origin
  const res = await fetch(`${origin}/__reset`)
  if (res.status !== 204) {
    throw new Error(`fixture reset failed: ${res.status} ${origin}/__reset`)
  }
  await res.body?.cancel()
}

/**
 * Run one subject against all cases in a suite.
 * Returns a complete BenchmarkRun with outcomes, scores, and environment metadata.
 */
export interface RunOptions {
  /** Delay between cases, for open-web politeness. Fixture runs use 0. */
  interCaseDelayMs?: number
  /** Suite identity when cases come from outside the fixture server. */
  suiteMeta?: SuiteMeta
  caseTimeoutMs?: number
}

export async function runBenchmark(
  subjects: readonly SubjectAdapter[],
  cases: readonly GroundTruth[],
  lanesUnderTest: readonly string[],
  options: RunOptions = {},
): Promise<BenchmarkRun> {
  const env = await captureEnvironment()
  const outcomes: CaseOutcome[] = []
  const { interCaseDelayMs = 0, suiteMeta, caseTimeoutMs = 60_000 } = options

  for (const subject of subjects) {
    console.log(`\nRunning subject: ${subject.meta.displayName}`)
    // Every subject must start from attempt 1 of stateful fixtures.
    await resetStatefulFixtures(cases)
    for (const truth of cases) {
      console.log(`  - ${truth.id}`)
      if (interCaseDelayMs > 0) await sleep(interCaseDelayMs)

      // Wrap fetch in a timeout to prevent hanging fixtures from blocking the
      // pipeline. The timer must be cleared when the case completes normally —
      // a resolved-but-uncleared timeout keeps the process alive.
      let timer: ReturnType<typeof setTimeout> | undefined
      const controller = new AbortController()
      const timeoutPromise = new Promise<FetchResult>((resolve) => {
        timer = setTimeout(() => {
          controller.abort()
          resolve({
            requestedUrl: truth.target,
            status: 'budget_exceeded',
            failureReason: null,
            blockReason: null,
            budgetExceeded: 'time',
            lane: 'http',
            escalations: [],
            markdown: null,
            truncated: false,
            truncatedAt: null,
            compliance: null,
            evidence: {
              finalUrl: truth.target,
              httpStatus: null,
              redirectChain: [],
              contentType: null,
              rawBodySha256: null,
              artifacts: [],
            },
            usage: {
              wallMs: 60_000,
              bytesWire: 0,
              bytesDecompressed: 0,
              requestCount: 1,
              attemptCount: 1,
              contentTokens: null,
              browserMs: 0,
              externalCostUsd: null,
            },
            trace: [
              { at: 0, lane: 'http', event: 'request_start' },
              { at: 60_000, lane: 'http', event: 'timeout', detail: { reason: 'case_timeout_60s' } },
            ],
          })
        }, caseTimeoutMs)
      })

      let result: FetchResult
      try {
        result = await Promise.race([subject.fetch(truth.target, caseTimeoutMs, controller.signal), timeoutPromise])
      } finally {
        clearTimeout(timer)
      }
      const checks = checkFalseSuccess(result, truth)
      const statusMatched = result.status === truth.expectedStatus
      const laneMatched = result.lane === truth.expectedLane
      // Graded only where the case says which gate it is. An absent annotation
      // must read as "not graded", not as a pass — otherwise every unannotated
      // case would inflate the reason score.
      const blockReasonMatched =
        truth.expectedBlockReason == null
          ? null
          : result.blockReason === truth.expectedBlockReason
      const evaluatedChecks = checks.filter((c) => c.outcome !== 'unknown').map((c) => c.check)
      const budgetRespected =
        result.usage.wallMs <= truth.budget.maxWallMs &&
        result.usage.attemptCount <= truth.budget.maxAttempts &&
        (result.usage.contentTokens === null || result.usage.contentTokens <= truth.budget.maxTokens)

      outcomes.push({
        caseId: truth.id,
        subjectId: subject.meta.id,
        result,
        statusMatched,
        laneMatched,
        blockReasonMatched,
        checks,
        evaluatedChecks,
        isFalseSuccess: isFalseSuccess(result, checks),
        budgetRespected,
      })
    }
    await subject.teardown()
  }

  const scores = subjects.map((s) => scoreSubject(s.meta.id, outcomes, cases))

  return {
    runId: `run-${Date.now()}`,
    environment: env,
    suite: {
      name: suiteMeta?.name ?? 'fixtures',
      version: suiteMeta?.version ?? '0.1.0',
      curatedAt: suiteMeta?.curatedAt ?? new Date().toISOString().split('T')[0]!,
    },
    subjects: subjects.map((s) => s.meta),
    lanesUnderTest: lanesUnderTest as any,
    cases,
    outcomes,
    scores,
  }
}

function scoreSubject(
  subjectId: string,
  outcomes: readonly CaseOutcome[],
  cases: readonly GroundTruth[],
): SuiteScore {
  const subjectOutcomes = outcomes.filter((o) => o.subjectId === subjectId)
  const contentfulOutcomes = subjectOutcomes.filter((o) =>
    CONTENTFUL_STATUS.has(o.result.status),
  )
  const falseSuccesses = subjectOutcomes.filter((o) => o.isFalseSuccess)

  const checkTallies: Record<string, { pass: number; fail: number; unknown: number }> = {}
  for (const outcome of subjectOutcomes) {
    for (const check of outcome.checks) {
      if (!checkTallies[check.check]) {
        checkTallies[check.check] = { pass: 0, fail: 0, unknown: 0 }
      }
      checkTallies[check.check]![check.outcome]++
    }
  }

  const laneDistribution: Record<string, number> = {}
  for (const outcome of subjectOutcomes) {
    const lane = outcome.result.lane
    laneDistribution[lane] = (laneDistribution[lane] ?? 0) + 1
  }

  const wallTimes = subjectOutcomes.map((o) => o.result.usage.wallMs).sort((a, b) => a - b)
  const medianWallMs = wallTimes[Math.floor(wallTimes.length / 2)] ?? 0
  const p95WallMs = wallTimes[Math.floor(wallTimes.length * 0.95)] ?? 0

  const tokenCounts = subjectOutcomes
    .map((o) => o.result.usage.contentTokens)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b)
  const medianContentTokens =
    tokenCounts.length > 0 ? tokenCounts[Math.floor(tokenCounts.length / 2)]! : null

  const qualityByTier = {
    L0: identityTierScore(subjectOutcomes),
    L1: tierScore(subjectOutcomes, cases, 'L1'),
    L2: tierScore(subjectOutcomes, cases, 'L2'),
  } as const
  const knownCostOutcomes = subjectOutcomes.filter((o) => CONTENTFUL_STATUS.has(o.result.status) && o.result.usage.externalCostUsd !== null)
  const contentfulCost = knownCostOutcomes.reduce((sum, o) => sum + (o.result.usage.externalCostUsd ?? 0), 0)
  const verifiedContentful = contentfulOutcomes.filter((outcome) => !outcome.isFalseSuccess).length
  const escalationCount = subjectOutcomes.reduce((sum, o) => sum + o.result.escalations.length, 0)

  return {
    suite: {
      name: 'fixtures',
      version: '0.1.0',
      curatedAt: new Date().toISOString().split('T')[0]!,
    },
    subjectId,
    caseCount: subjectOutcomes.length,
    statusMatchCount: subjectOutcomes.filter((o) => o.statusMatched).length,
    blockReasonMatchCount: subjectOutcomes.filter((o) => o.blockReasonMatched === true).length,
    blockReasonGradedCount: subjectOutcomes.filter((o) => o.blockReasonMatched !== null).length,
    contentfulCount: contentfulOutcomes.length,
    falseSuccessCount: falseSuccesses.length,
    falseSuccessRate:
      contentfulOutcomes.length > 0
        ? falseSuccesses.length / contentfulOutcomes.length
        : null,
    checkTallies,
    laneDistribution: laneDistribution as any,
    medianWallMs,
    p95WallMs,
    medianContentTokens,
    budgetViolations: subjectOutcomes.filter((o) => !o.budgetRespected).length,
    qualityByTier,
    verifiedCompletionRate: subjectOutcomes.length > 0 ? verifiedContentful / subjectOutcomes.length : null,
    knownCostPerContentfulPageUsd: knownCostOutcomes.length === verifiedContentful && verifiedContentful > 0 ? contentfulCost / verifiedContentful : null,
    escalationCount,
  }
}

function tierScore(
  outcomes: readonly CaseOutcome[],
  cases: readonly GroundTruth[],
  tier: 'L0' | 'L1' | 'L2',
): import('@w2l/contracts').TierScore {
  const tierCases = new Set(cases.filter((truth) => tierFor(truth) === tier).map((truth) => truth.id))
  const rows = outcomes.filter((outcome) => tierCases.has(outcome.caseId))
  const contentful = rows.filter((row) => CONTENTFUL_STATUS.has(row.result.status))
  const falseSuccesses = rows.filter((row) => row.isFalseSuccess)
  const knownCosts = contentful.filter((row) => row.result.usage.externalCostUsd !== null)
  const walls = rows.map((row) => row.result.usage.wallMs).sort((a, b) => a - b)
  const knownCost = knownCosts.reduce((sum, row) => sum + (row.result.usage.externalCostUsd ?? 0), 0)
  return {
    caseCount: rows.length,
    statusMatchCount: rows.filter((row) => row.statusMatched).length,
    contentfulCount: contentful.length,
    falseSuccessCount: falseSuccesses.length,
    falseSuccessRate: contentful.length > 0 ? falseSuccesses.length / contentful.length : null,
    p95WallMs: walls.length > 0 ? walls[Math.min(walls.length - 1, Math.floor(walls.length * 0.95))]! : 0,
    knownCostPerContentfulPageUsd: knownCosts.length === contentful.length && contentful.length > 0 ? knownCost / contentful.length : null,
  }
}

function identityTierScore(outcomes: readonly CaseOutcome[]): import('@w2l/contracts').TierScore {
  const violations = outcomes.filter((outcome) => outcome.result.trace.some((event) => event.event === 'identity_mismatch' || event.event === 'identity_unobserved'))
  const contentful = outcomes.filter((outcome) => CONTENTFUL_STATUS.has(outcome.result.status))
  const falseSuccesses = outcomes.filter((outcome) => outcome.isFalseSuccess)
  const walls = outcomes.map((outcome) => outcome.result.usage.wallMs).sort((a, b) => a - b)
  return {
    caseCount: outcomes.length,
    statusMatchCount: outcomes.length - violations.length,
    contentfulCount: contentful.length,
    falseSuccessCount: falseSuccesses.length,
    falseSuccessRate: contentful.length > 0 ? falseSuccesses.length / contentful.length : null,
    p95WallMs: walls.length > 0 ? walls[Math.min(walls.length - 1, Math.floor(walls.length * 0.95))]! : 0,
    knownCostPerContentfulPageUsd: null,
  }
}

function tierFor(truth: GroundTruth): 'L0' | 'L1' | 'L2' {
  if (truth.category === 'identity' || truth.category === 'policy') return 'L0'
  if (truth.category === 'spa' || truth.expectedLane === 'browser_local') return 'L2'
  return 'L1'
}

async function captureEnvironment(): Promise<RunEnvironment> {
  const os = await import('node:os')
  const { execSync } = await import('node:child_process')

  let gitCommit: string | null = null
  let gitDirty = false
  try {
    gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
    gitDirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0
  } catch {
    // not a git repo or git not available
  }

  return {
    gitCommit,
    gitDirty,
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    startedAt: new Date().toISOString(),
    dependencyVersions: {},
  }
}
