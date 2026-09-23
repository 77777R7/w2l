import { describe, expect, it } from 'vitest'
import { parseListen } from '../src/listen.js'

describe('operator origin tuning', () => {
  it('accepts bounded 1, 2, 4 and a positive delay', () => {
    for (const value of ['1', '2', '4']) {
      const policy = parseListen([], { W2L_PER_HOST_CONCURRENCY: value, W2L_PER_HOST_MIN_DELAY_MS: '250' }).networkPolicy
      expect(policy.perHostConcurrency).toBe(Number(value))
      expect(policy.perHostMinDelayMs).toBe(250)
    }
  })
  it('rejects unlimited concurrency and no request interval', () => {
    expect(() => parseListen([], { W2L_PER_HOST_CONCURRENCY: '5' })).toThrow('W2L_PER_HOST_CONCURRENCY')
    expect(() => parseListen([], { W2L_PER_HOST_MIN_DELAY_MS: '0' })).toThrow('W2L_PER_HOST_MIN_DELAY_MS')
  })
})
