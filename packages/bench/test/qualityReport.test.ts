import { describe, expect, it } from 'vitest'
import { renderQualityReport } from '../src/qualityReport.js'
import type { BenchmarkRun, SuiteScore } from '@w2l/contracts'

describe('renderQualityReport', () => {
  it('labels L0 as an identity/policy audit and preserves unknown cost', () => {
    const tier = { caseCount: 1, statusMatchCount: 1, contentfulCount: 1, falseSuccessCount: 0, falseSuccessRate: 0, p95WallMs: 1, knownCostPerContentfulPageUsd: null }
    const score: SuiteScore = {
      suite: { name: 'fixtures', version: '1', curatedAt: '2026-09-19' }, subjectId: 'w2l-ladder', caseCount: 1, statusMatchCount: 1,
      blockReasonMatchCount: 0, blockReasonGradedCount: 0, contentfulCount: 1, falseSuccessCount: 0, falseSuccessRate: 0,
      checkTallies: {}, laneDistribution: {}, medianWallMs: 1, p95WallMs: 1, medianContentTokens: null, budgetViolations: 0,
      qualityByTier: { L0: tier, L1: { ...tier, caseCount: 0, contentfulCount: 0, statusMatchCount: 0 }, L2: { ...tier, caseCount: 0, contentfulCount: 0, statusMatchCount: 0 } },
      verifiedCompletionRate: 1, knownCostPerContentfulPageUsd: null, escalationCount: 1,
    }
    const run = {
      runId: 'run-test', environment: { gitCommit: 'abc', gitDirty: false, nodeVersion: 'v20', platform: 'test', arch: 'arm64', cpuModel: 'test', cpuCount: 1, totalMemoryBytes: 1, startedAt: '2026-09-19T00:00:00.000Z', dependencyVersions: {} },
      suite: score.suite, subjects: [], lanesUnderTest: [], cases: [], outcomes: [], scores: [score],
    } satisfies BenchmarkRun
    const report = renderQualityReport(run)
    expect(report).toContain('identity and policy integrity')
    expect(report).toContain('| w2l-ladder | 100.0% | 0.0% | 1ms | unknown | 1 |')
  })
})
