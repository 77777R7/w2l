import { describe, expect, it } from 'vitest'
import { buildBenchmarkGateReport } from '../src/benchmarkGate.js'
import type { BenchmarkRun } from '@w2l/contracts'

describe('Benchmark Gate', () => {
  it('blocks instead of declaring a winner when a comparator was not run', () => {
    const run = { runId: 'w2l', environment: { gitCommit: 'abc', gitDirty: false, nodeVersion: 'v20', platform: 'test', arch: 'x64', cpuModel: 'test', cpuCount: 1, totalMemoryBytes: 1, startedAt: '', dependencyVersions: {} }, suite: { name: 'fixtures', version: '1', curatedAt: '2026-09-19' }, subjects: [], lanesUnderTest: [], cases: [], outcomes: [], scores: [] } as unknown as BenchmarkRun
    const report = buildBenchmarkGateReport(run, [{ id: 'firecrawl-self-hosted', displayName: 'Firecrawl', status: 'not_run', version: null, command: 'firecrawl --version', rawOutputPath: null, reason: 'missing binary' }])
    expect(report.gate).toBe('blocked')
    expect(report.decision).toContain('firecrawl-self-hosted=not_run')
  })
})
