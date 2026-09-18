import { describe, expect, it } from 'vitest'
import {
  classifyFetchFailure,
  ROUTING_FAILURE_CLASS,
  type RoutableFetchResult,
} from '../src/failureClass.js'

function result(partial: Partial<RoutableFetchResult>): RoutableFetchResult {
  return {
    status: 'blocked',
    blockReason: null,
    failureReason: null,
    trace: [],
    ...partial,
  }
}

describe('classifyFetchFailure — the seven routing classes', () => {
  it('covers exactly the seven agreed classes', () => {
    expect([...ROUTING_FAILURE_CLASS]).toEqual([
      'bot_gate',
      'captcha_required',
      'login_required',
      'rate_limited',
      'geo_blocked',
      'provider_error',
      'identity_mismatch',
    ])
  })

  it('returns null for contentful results — success is not a failure to route', () => {
    expect(classifyFetchFailure(result({ status: 'success' }))).toBeNull()
    expect(classifyFetchFailure(result({ status: 'partial' }))).toBeNull()
    expect(classifyFetchFailure(result({ status: 'empty_verified' }))).toBeNull()
  })

  it('maps both detection-gate reasons to bot_gate', () => {
    expect(classifyFetchFailure(result({ blockReason: 'cloudflare_challenge' }))).toBe('bot_gate')
    expect(classifyFetchFailure(result({ blockReason: 'bot_detected_generic' }))).toBe('bot_gate')
  })

  it('maps captcha / login / rate / geo to their routing classes', () => {
    expect(classifyFetchFailure(result({ blockReason: 'captcha' }))).toBe('captcha_required')
    expect(classifyFetchFailure(result({ blockReason: 'login_wall' }))).toBe('login_required')
    expect(classifyFetchFailure(result({ blockReason: 'rate_limit' }))).toBe('rate_limited')
    expect(classifyFetchFailure(result({ blockReason: 'geo_restricted' }))).toBe('geo_blocked')
  })

  it('maps provider_error to itself', () => {
    expect(
      classifyFetchFailure(result({ status: 'failed', failureReason: 'provider_error' })),
    ).toBe('provider_error')
  })

  it('maps an identity_mismatch trace event to identity_mismatch — even over a block reason', () => {
    const r = result({
      blockReason: 'bot_detected_generic',
      trace: [{ lane: 'provider', event: 'identity_mismatch' }],
    })
    expect(classifyFetchFailure(r)).toBe('identity_mismatch')
  })

  it('returns null for infrastructure failures — the ladder retries, it does not escalate', () => {
    expect(classifyFetchFailure(result({ status: 'failed', failureReason: 'timeout' }))).toBeNull()
    expect(classifyFetchFailure(result({ status: 'failed', failureReason: 'connection_error' }))).toBeNull()
    expect(classifyFetchFailure(result({ status: 'failed', failureReason: 'http_error' }))).toBeNull()
  })
})
