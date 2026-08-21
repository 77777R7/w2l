import { describe, expect, it } from 'vitest'
import {
  buildComplianceRecord,
  ComplianceChain,
  normalizeAccessConfig,
  verifyLedger,
  type AccessFactShape,
  type ComplianceMode,
  type ComplianceRateLimitFact,
  type ComplianceRobotsDecision,
  type ComplianceSentHeadersFact,
} from '@w2l/http-core'
import type {
  AccessConfig,
  AccessFact,
  CrawlMode,
  ComplianceLedger as ContractComplianceLedger,
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

  it('AccessFactShape is assignable to AccessFact', () => {
    const f: AccessFactShape = normalizeAccessConfig({
      proxy: { url: 'http://gate.proxy.example:8080' },
      attestation: {
        principal: 'acct_drift',
        at: '2026-08-21T00:00:00.000Z',
        statement: 'I own this proxy.',
      },
    })
    const asContract: AccessFact = f
    expect(asContract.egressOwner).toBe('user')
  })

  it('a contract AccessConfig is accepted by normalizeAccessConfig', () => {
    // The input direction matters as much as the output one: a field the
    // contract offers callers but http-core cannot read would be a documented
    // option that silently does nothing.
    const config: AccessConfig = {
      proxy: { url: 'http://gate.proxy.example:8080', username: 'u', password: 'p' },
      session: {
        cookies: [
          {
            name: 'session-id',
            value: 'v',
            domain: '.example.com',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
          },
        ],
      },
      attestation: {
        principal: 'acct_drift',
        at: '2026-08-21T00:00:00.000Z',
        statement: 'I own this proxy and session.',
      },
    }
    const fact = normalizeAccessConfig(config)
    expect(fact.egressOwner).toBe('user')
    expect(fact.sessionOwner).toBe('user')
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

  it('a chained ledger is assignable to the contract ComplianceLedger', () => {
    const chain = new ComplianceChain('run-drift', 'research')
    chain.append({
      recordId: 'rec-drift-1',
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
    })
    const asContract: ContractComplianceLedger = chain.toLedger()
    expect(asContract.records).toHaveLength(1)
    expect(verifyLedger(asContract).valid).toBe(true)
  })
})
