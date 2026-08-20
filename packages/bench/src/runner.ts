import type { BenchmarkRun, CaseOutcome, GroundTruth, RunEnvironment, SuiteScore } from '@w2l/contracts'
import { CONTENTFUL_STATUS } from '@w2l/contracts'
import type { FetchResult } from '@w2l/contracts'
import { checkFalseSuccess, isFalseSuccess } from './checker.js'
import type { SubjectAdapter } from './subject.js'

/**
 * Reset the fixture server's stateful fixtures before each subject, so every
 * subject observes attempt 1 (the flaky fixture is global mutable state). The
 * control route is not part of the suite; this is the runner's contract with
 * the fixture server, not a subject behaviour.
 */
async function resetStatefulFixtures(cases: readonly GroundTruth[]): Promise<void> {
  const first = cases[0]
  if (!first) return
  const origin = new URL(first.target).origin
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
export async function runBenchmark(
  subjects: readonly SubjectAdapter[],
  cases: readonly GroundTruth[],
  lanesUnderTest: readonly string[],
): Promise<BenchmarkRun> {
  const env = await captureEnvironment()
  const outcomes: CaseOutcome[] = []

  for (const subject of subjects) {
    console.log(`\nRunning subject: ${subject.meta.displayName}`)
    // Every subject must start from attempt 1 of stateful fixtures.
    await resetStatefulFixtures(cases)
    for (const truth of cases) {
      console.log(`  - ${truth.id}`)

      // Wrap fetch in a timeout to prevent hanging fixtures from blocking the
      // pipeline. The timer must be cleared when the case completes normally —
      // a resolved-but-uncleared timeout keeps the process alive.
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<FetchResult>((resolve) => {
        timer = setTimeout(() => {
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
        }, 60_000) // 60 second timeout per case
      })

      let result: FetchResult
      try {
        result = await Promise.race([subject.fetch(truth.target), timeoutPromise])
      } finally {
        clearTimeout(timer)
      }
      const checks = checkFalseSuccess(result, truth)
      const statusMatched = result.status === truth.expectedStatus
      const laneMatched = result.lane === truth.expectedLane
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
      name: 'fixtures',
      version: '0.1.0',
      curatedAt: new Date().toISOString().split('T')[0]!,
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

  return {
    suite: {
      name: 'fixtures',
      version: '0.1.0',
      curatedAt: new Date().toISOString().split('T')[0]!,
    },
    subjectId,
    caseCount: subjectOutcomes.length,
    statusMatchCount: subjectOutcomes.filter((o) => o.statusMatched).length,
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
  }
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
