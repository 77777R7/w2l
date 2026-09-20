import { describe, expect, it } from 'vitest'
import { runRealTasks } from '../src/phase4RealTask.js'

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
    expect(report.summary.byKind.ai_knowledge.repeatConsistent).toBe(2)
    expect(report.runs[0]?.outcome).toBe('correct_complete')
    expect(report.runs[0]?.result?.usage.externalCostUsd).toBeNull()
    expect(report.summary.holdoutRuns).toBe(2)
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
    expect(report.summary.byKind.product_info.repeatConsistent).toBe(0)
  })
})
