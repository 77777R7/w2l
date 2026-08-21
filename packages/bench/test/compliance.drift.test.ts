import { describe, expect, it } from 'vitest'
import {
  buildComplianceRecord,
  type ComplianceMode,
  type ComplianceRateLimitFact,
  type ComplianceRobotsDecision,
  type ComplianceSentHeadersFact,
} from '@w2l/http-core'
import type {
  CrawlMode,
  ComplianceRecord as ContractComplianceRecord,
  RateLimitFact,
  RobotsDecision,
  SentHeadersFact,
} from '@w2l/contracts'

/**
 * Cross-package drift guard for the compliance record types. http-core stays
 * dependency-free and declares its own structural subsets (see compliance.ts);
 * these compile-time assignments are where the two are compared, so a field
 * added to a contract type without a matching http-core counterpart fails here
 * instead of shipping as a record that can't be built or verified.
 */

describe('compliance structural subsets match the contract', () => {
  it('ComplianceMode is assignable to CrawlMode', () => {
    const m: ComplianceMode = 'research'
    const asContract: CrawlMode = m
    expect(asContract).toBe(m)
  })

  it('ComplianceRobotsDecision is assignable to RobotsDecision', () => {
    const d: ComplianceRobotsDecision = {
      robotsUrl: null,
      robotsSha256: null,
      matchedUserAgentGroup: null,
      appliedRules: [{ pattern: '/', allow: true }],
      decision: 'allowed',
      skippedFetch: false,
    }
    const asContract: RobotsDecision = d
    expect(asContract).toBe(d)
  })

  it('ComplianceSentHeadersFact is assignable to SentHeadersFact', () => {
    const h: ComplianceSentHeadersFact = { headers: [{ name: 'user-agent', value: 'x' }] }
    const asContract: SentHeadersFact = h
    expect(asContract).toBe(h)
  })

  it('ComplianceRateLimitFact is assignable to RateLimitFact', () => {
    const r: ComplianceRateLimitFact = {
      previousRequestAtMs: null,
      observedDelayMs: null,
      requiredDelayMs: 250,
      compliant: true,
      recentSameHostCount: 0,
    }
    const asContract: RateLimitFact = r
    expect(asContract).toBe(r)
  })

  it('a built ComplianceRecord is assignable to the contract ComplianceRecord', () => {
    const built = buildComplianceRecord({
      recordId: 'rec-drift',
      mode: 'research',
      requestedUrl: 'https://example.com/',
      finalUrl: null,
      requestedAt: '2026-08-21T00:00:00.000Z',
      robots: {
        robotsUrl: null,
        robotsSha256: null,
        matchedUserAgentGroup: null,
        appliedRules: [],
        decision: 'no_robots',
        skippedFetch: false,
      },
      sentHeaders: { headers: [] },
      rateLimit: {
        previousRequestAtMs: null,
        observedDelayMs: null,
        requiredDelayMs: 250,
        compliant: true,
        recentSameHostCount: 0,
      },
      prevRecordHash: null,
    })
    const asContract: ContractComplianceRecord = built
    expect(asContract.contentHash).toBe(built.contentHash)
    expect(asContract.signature).toBeNull()
  })
})
