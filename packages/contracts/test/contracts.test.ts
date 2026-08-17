import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_REQUIRED_CHECKS,
  CONTENTFUL_STATUS,
  DEFAULT_NETWORK_POLICY,
  EVIDENCE_ONLY_CHECKS,
  FALSE_SUCCESS_CHECK,
  PUBLIC_CANARY_LANES,
  RESULT_STATUS,
  isPublicCanaryLane,
} from '../src/index.js'
import type { NetworkPolicy, ResultStatus } from '../src/index.js'

describe('contract 4: a single ResultStatus enum', () => {
  it('has exactly the seven agreed statuses', () => {
    expect([...RESULT_STATUS]).toEqual([
      'success',
      'partial',
      'empty_verified',
      'blocked',
      'failed',
      'cancelled',
      'budget_exceeded',
    ])
  })

  it('does not resurrect the retired empty_legit/empty_suspicious names', () => {
    const retired = ['empty_legit', 'empty_suspicious', 'empty', 'ok', 'error']
    for (const name of retired) {
      expect(RESULT_STATUS as readonly string[]).not.toContain(name)
    }
  })

  it('treats only success and partial as carrying content', () => {
    const contentful = RESULT_STATUS.filter((s) => CONTENTFUL_STATUS.has(s))
    expect(contentful).toEqual(['success', 'partial'])
  })

  it('models unverified emptiness as a failure reason, not a status', () => {
    // empty_verified is a status because it is *proven*; the suspected case is a failure.
    expect(RESULT_STATUS as readonly string[]).toContain('empty_verified')
    const suspected: ResultStatus = 'failed'
    expect(CONTENTFUL_STATUS.has(suspected)).toBe(false)
  })
})

describe('contract 2: false-success check partitioning', () => {
  it('defines all five checks', () => {
    expect(FALSE_SUCCESS_CHECK).toHaveLength(5)
  })

  it('partitions checks into evidence-only and annotation-required with no overlap', () => {
    const union = [...EVIDENCE_ONLY_CHECKS, ...ANNOTATION_REQUIRED_CHECKS].sort()
    expect(union).toEqual([...FALSE_SUCCESS_CHECK].sort())
    const overlap = EVIDENCE_ONLY_CHECKS.filter((c) => ANNOTATION_REQUIRED_CHECKS.includes(c))
    expect(overlap).toEqual([])
  })

  it('keeps the annotation-dependent checks out of the canary-evaluable set', () => {
    expect(EVIDENCE_ONLY_CHECKS).not.toContain('missing_required_content')
    expect(EVIDENCE_ONLY_CHECKS).not.toContain('content_yield_below_floor')
  })
})

describe('contract 3: public canary lane restriction', () => {
  it('permits only Tier 0 and Tier 1a', () => {
    expect([...PUBLIC_CANARY_LANES]).toEqual(['http', 'browser_local'])
  })

  it('excludes authenticated, proxied and provider lanes', () => {
    expect(isPublicCanaryLane('browser_local_authed')).toBe(false)
    expect(isPublicCanaryLane('browser_proxy')).toBe(false)
    expect(isPublicCanaryLane('provider')).toBe(false)
  })
})

describe('contract 1: private-network access is operator-only', () => {
  it('defaults to request origin with an empty allowlist', () => {
    expect(DEFAULT_NETWORK_POLICY.origin).toBe('request')
    expect(DEFAULT_NETWORK_POLICY.privateAllowlist).toEqual([])
  })

  it('has no boolean escape hatch on the policy shape', () => {
    const keys = Object.keys(DEFAULT_NETWORK_POLICY)
    expect(keys).not.toContain('allowPrivateNetwork')
    expect(keys).toContain('privateAllowlist')
  })

  it('carries hard resource ceilings by default', () => {
    const p: NetworkPolicy = DEFAULT_NETWORK_POLICY
    expect(p.maxRedirects).toBeGreaterThan(0)
    expect(p.maxBodyBytes).toBeGreaterThan(0)
    expect(p.maxDecompressedBytes).toBeGreaterThanOrEqual(p.maxBodyBytes)
  })
})
