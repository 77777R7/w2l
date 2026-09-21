import { describe, expect, it } from 'vitest'
import { runRealTasks, sourceMatches } from '../src/phase4RealTask.js'

describe('Phase 4 real task harness', () => {
  it('preserves field assertions, hashes, repeats, and unknown cost', async () => {
    const client = {
      async scrape(url: string) {
        return {
          requestedUrl: url, status: 'success' as const, failureReason: null, blockReason: null, budgetExceeded: null,
          lane: 'http' as const, escalations: [], markdown: `Title ${url} required fact`, truncated: false, truncatedAt: null,
          compliance: null, evidence: { finalUrl: url, httpStatus: 200, redirectChain: [], contentType: 'text/html', rawBodySha256: null, artifacts: [] },
          usage: { wallMs: 1, bytesWire: 1, bytesDecompressed: 1, requestCount: 1, attemptCount: 1, contentTokens: 2, browserMs: 0, externalCostUsd: null }, trace: [],
        }
      },
    }
    const report = await runRealTasks(client as never, [{ id: 'task', kind: 'ai_knowledge', url: 'https://example.com', source: 'test', evaluationSet: 'holdout', repeats: 2, assertions: [{ field: 'fact', mustContain: ['required fact'] }] }])
    expect(report.runCount).toBe(2)
    expect(report.runs[0]?.repeatConsistent).toBe(true)
    expect(report.runs[1]?.repeatConsistent).toBe(true)
    expect(report.summary.byKind.ai_knowledge.repeatPairs).toBe(1)
    expect(report.summary.byKind.ai_knowledge.repeatPairsConsistent).toBe(1)
    expect(report.summary.byKind.ai_knowledge.repeatConsistentRuns).toBe(2)
    expect(report.runs[0]?.outcome).toBe('correct_complete')
    expect(report.runs[0]?.result?.usage.externalCostUsd).toBeNull()
    expect(report.summary.holdoutRuns).toBe(2)
    expect(report.summary.resourceMeters.unknownCostRuns).toBe(2)
    expect(report.summary.resourceMeters.knownExternalCostUsd).toBeNull()
    expect(report.summary.resourceMeters.wallMs).toBe(2)
    expect(report.summary.manualCorrectionMinutes).toBeNull()
  })

  it('does not treat a numeric zero as known billed USD', async () => {
    const client = {
      async scrape(url: string) {
        return {
          requestedUrl: url, status: 'success' as const, failureReason: null, blockReason: null, budgetExceeded: null,
          lane: 'http' as const, escalations: [], markdown: `Title ${url} required fact`, truncated: false, truncatedAt: null,
          compliance: null, evidence: { finalUrl: url, httpStatus: 200, redirectChain: [], contentType: 'text/html', rawBodySha256: null, artifacts: [] },
          usage: { wallMs: 1, bytesWire: 1, bytesDecompressed: 1, requestCount: 1, attemptCount: 1, contentTokens: 2, browserMs: 0, externalCostUsd: null },
          summary: { wallMs: 1, browserMs: 0, requestCount: 1, contentTokens: 2, bytesWire: 1, externalCostUsd: null, externalCost: { knownSubtotal: 0, unknown: true } },
          trace: [],
        }
      },
    }
    const report = await runRealTasks(client as never, [{ id: 'task', kind: 'ai_knowledge', url: 'https://example.com', source: 'test', evaluationSet: 'development', repeats: 1, assertions: [{ field: 'fact', mustContain: ['required fact'] }] }])
    expect(report.summary.resourceMeters.knownExternalCostUsd).toBeNull()
    expect(report.summary.resourceMeters.unknownCostRuns).toBe(1)
  })

  it('marks every run in an inconsistent pair as not repeat-consistent', async () => {
    let n = 0
    const client = {
      async scrape(url: string) {
        n += 1
        return {
          requestedUrl: url, status: 'success' as const, failureReason: null, blockReason: null, budgetExceeded: null,
          lane: 'http' as const, escalations: [], markdown: `Title ${url} required fact ${n}`, truncated: false, truncatedAt: null,
          compliance: null, evidence: { finalUrl: url, httpStatus: 200, redirectChain: [], contentType: 'text/html', rawBodySha256: null, artifacts: [] },
          usage: { wallMs: 1, bytesWire: 1, bytesDecompressed: 1, requestCount: 1, attemptCount: 1, contentTokens: 2, browserMs: 0, externalCostUsd: null }, trace: [],
        }
      },
    }
    const report = await runRealTasks(client as never, [{ id: 'task', kind: 'product_info', url: 'https://example.com/p', source: 'test', evaluationSet: 'development', repeats: 2, assertions: [{ field: 'fact', mustContain: ['required fact'] }] }])
    expect(report.runs[0]?.repeatConsistent).toBe(false)
    expect(report.runs[1]?.repeatConsistent).toBe(false)
    expect(report.summary.byKind.product_info.repeatPairs).toBe(1)
    expect(report.summary.byKind.product_info.repeatPairsConsistent).toBe(0)
  })

  it('matches source origin instead of string prefix and marks identity mismatch as false success', async () => {
    expect(sourceMatches('https://developer.mozilla.org/en-US/docs/Web/API/AbortController', 'https://developer.mozilla.org')).toBe(true)
    expect(sourceMatches('https://developer.mozilla.org.evil.example/docs', 'https://developer.mozilla.org')).toBe(false)
    const client = {
      async scrape(url: string) {
        return {
          requestedUrl: url, status: 'success' as const, failureReason: null, blockReason: null, budgetExceeded: null,
          lane: 'http' as const, escalations: [], markdown: 'Unrelated navigation page with plenty of text.', truncated: false, truncatedAt: null,
          compliance: null, evidence: { finalUrl: 'https://example.net/nav', httpStatus: 200, redirectChain: [], contentType: 'text/html', rawBodySha256: null, artifacts: [] },
          usage: { wallMs: 1, bytesWire: 1, bytesDecompressed: 1, requestCount: 1, attemptCount: 1, contentTokens: 2, browserMs: 0, externalCostUsd: null }, trace: [],
        }
      },
    }
    const report = await runRealTasks(client as never, [{ id: 'task', kind: 'ai_knowledge', url: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortController', source: 'test', evaluationSet: 'development', qualitySubset: true, repeats: 1, assertions: [{ field: 'source_url', sourceUrl: 'https://developer.mozilla.org' }, { field: 'title', mustContain: ['AbortController'] }] }])
    expect(report.runs[0]?.outcome).toBe('false_success')
    expect(report.summary.falseSuccessRuns).toBe(1)
    expect(report.summary.qualitySubsetRuns).toBe(1)
    expect(report.summary.qualitySubsetCorrectComplete).toBe(0)
  })
})
