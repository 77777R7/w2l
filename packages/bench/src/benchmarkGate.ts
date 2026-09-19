import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { BenchmarkRun, SuiteMeta } from '@w2l/contracts'

export type ComparatorStatus = 'ready' | 'not_run' | 'blocked'

export interface ComparatorEvidence {
  id: string
  displayName: string
  status: ComparatorStatus
  version: string | null
  command: string | null
  rawOutputPath: string | null
  reason: string | null
}

export interface BenchmarkGateReport {
  gate: 'blocked' | 'ready' | 'passed' | 'failed'
  generatedAt: string
  gitCommit: string | null
  suite: SuiteMeta
  comparators: readonly ComparatorEvidence[]
  w2lRun: string
  decision: string
}

/**
 * Phase 3 gate contract. A comparison cannot pass when a required comparator
 * was not actually run; missing tools are evidence of an incomplete gate.
 */
export function buildBenchmarkGateReport(
  run: BenchmarkRun,
  comparators: readonly ComparatorEvidence[],
): BenchmarkGateReport {
  const missing = comparators.filter((comparator) => comparator.status !== 'ready')
  const gate = missing.length > 0 ? 'blocked' : 'ready'
  return {
    gate,
    generatedAt: new Date().toISOString(),
    gitCommit: run.environment.gitCommit,
    suite: run.suite,
    comparators,
    w2lRun: run.runId,
    decision: missing.length > 0
      ? `blocked: ${missing.map((comparator) => `${comparator.id}=${comparator.status}`).join(', ')}`
      : 'ready for metric comparison; no winner is declared by the harness',
  }
}

export function detectComparator(
  id: string,
  displayName: string,
  command: string,
  args: readonly string[],
  rawOutputPath: string,
): ComparatorEvidence {
  try {
    const version = execFileSync(command, [...args, '--version'], { encoding: 'utf8', timeout: 10_000 }).trim()
    if (!existsSync(rawOutputPath)) {
      return { id, displayName, status: 'not_run', version, command: [command, ...args].join(' '), rawOutputPath: null, reason: 'version command succeeded but comparator evidence is missing' }
    }
    return { id, displayName, status: 'ready', version, command: [command, ...args].join(' '), rawOutputPath, reason: null }
  } catch (error) {
    return {
      id,
      displayName,
      status: 'not_run',
      version: null,
      command: [command, ...args].join(' '),
      rawOutputPath: existsSync(rawOutputPath) ? rawOutputPath : null,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export function readGateJson(path: string): BenchmarkGateReport {
  return JSON.parse(readFileSync(path, 'utf8')) as BenchmarkGateReport
}
