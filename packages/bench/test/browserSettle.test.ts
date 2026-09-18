import { describe, expect, it } from 'vitest'
import { waitForRenderedStability } from '../src/browserSettle.js'

describe('waitForRenderedStability', () => {
  it('does not accept a stable shell before the minimum observation window', async () => {
    let now = 0
    let reads = 0
    const page = {
      async evaluate() {
        reads++
        return now < 800 ? '{"size":10,"text":""}' : '{"size":40,"text":"delayed fact"}'
      },
      async waitForTimeout(ms: number) { now += ms },
    }
    await waitForRenderedStability(page, { minMs: 500, maxMs: 1_000, sampleMs: 100 })
    expect(now).toBeGreaterThanOrEqual(900)
    expect(reads).toBeGreaterThan(5)
  })

  it('uses text as well as DOM size when detecting stability', async () => {
    let now = 0
    let reads = 0
    const page = {
      async evaluate() {
        reads++
        const text = reads < 8 ? 'a' : 'b'
        return JSON.stringify({ size: 20, text })
      },
      async waitForTimeout(ms: number) { now += ms },
    }
    await waitForRenderedStability(page, { minMs: 500, maxMs: 1_000, sampleMs: 100 })
    expect(now).toBeGreaterThanOrEqual(700)
  })
})
