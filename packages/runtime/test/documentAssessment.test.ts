import { describe, expect, it } from 'vitest'
import { assessFirecrawlIntroduction } from '../src/documentAssessment.js'
import { FIRECRAWL_INTRO_URL } from '@w2l/contracts'

const base = {
  requestedUrl: FIRECRAWL_INTRO_URL,
  status: 'success' as const,
  failureReason: null,
  blockReason: null,
  budgetExceeded: null,
  lane: 'http' as const,
  escalations: [],
  truncated: false,
  truncatedAt: null,
  compliance: null,
  evidence: { finalUrl: FIRECRAWL_INTRO_URL, httpStatus: 200, redirectChain: [], contentType: 'text/html', rawBodySha256: 'x', artifacts: [] },
  usage: { wallMs: 1, bytesWire: 1, bytesDecompressed: 1, requestCount: 1, attemptCount: 1, contentTokens: 1, browserMs: 0, externalCostUsd: null },
  trace: [],
}

describe('Firecrawl introduction quality contract', () => {
  it('rejects a navigation page from the wrong source', () => {
    const result = { ...base, markdown: '# Introduction\nThis looks complete but is from another source.', evidence: { ...base.evidence, finalUrl: 'https://example.com/nav' } }
    expect(assessFirecrawlIntroduction(result).quality).toBe('invalid')
  })

  it('rejects missing capability sections', () => {
    const result = { ...base, markdown: '# Introduction\nFirecrawl is the web data API for AI agents.' }
    const assessment = assessFirecrawlIntroduction(result)
    expect(assessment.quality).toBe('invalid')
    expect(assessment.reasons).toContain('missing_or_ambiguous_search_section')
  })

  it('rejects truncated content', () => {
    const result = { ...base, truncated: true, markdown: '# Introduction\nFirecrawl is the web data API for AI agents.' }
    expect(assessFirecrawlIntroduction(result).quality).toBe('partial')
  })
})
