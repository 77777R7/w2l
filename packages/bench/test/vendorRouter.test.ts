import { describe, expect, it } from 'vitest'
import {
  MemoryRoutingHistory,
  rankVendors,
  startingVendor,
  type DomainHistory,
} from '../src/routing/vendorRouter.js'

function entry(partial: Partial<{ attempts: number; contentful: number; latency: number; cost: number; last: string | null; samples: number[] }>) {
  const samples = partial.samples ?? [partial.latency ?? 0]
  return {
    attempts: partial.attempts ?? 1,
    contentful: partial.contentful ?? 0,
    latencyTotalMs: partial.latency ?? 0,
    latencySamplesMs: samples,
    costTotalUsd: partial.cost ?? 0,
    lastFailureClass: (partial.last ?? null) as DomainHistory['vendors'][string]['lastFailureClass'],
  }
}

describe('rankVendors', () => {
  it('gives untried vendors a small exploration bonus, lower than any proven winner', () => {
    const history: DomainHistory = {
      vendors: {
        proven: entry({ attempts: 10, contentful: 9, latency: 5_000, cost: 0.05 }),
      },
      lastVendor: 'proven',
    }
    const ranked = rankVendors(history, ['proven', 'newcomer'])
    expect(ranked[0]!.vendorId).toBe('proven')
    // The newcomer still gets a score — one chance to prove itself.
    expect(ranked[1]!.vendorId).toBe('newcomer')
    expect(ranked[1]!.score).toBeGreaterThan(0)
  })

  it('prefers the vendor with the better success rate', () => {
    const history: DomainHistory = {
      vendors: {
        good: entry({ attempts: 10, contentful: 8, latency: 5_000, cost: 0.05 }),
        bad: entry({ attempts: 10, contentful: 2, latency: 1_000, cost: 0.01 }),
      },
      lastVendor: null,
    }
    const ranked = rankVendors(history, ['good', 'bad'])
    // Success dominates latency and cost — a fast cheap failure is still a
    // failure, and the ladder should not learn to love it.
    expect(ranked[0]!.vendorId).toBe('good')
  })

  it('breaks equal success rates on latency, then cost', () => {
    const history: DomainHistory = {
      vendors: {
        fast: entry({ attempts: 5, contentful: 5, latency: 2_500, cost: 0.1 }),
        slow: entry({ attempts: 5, contentful: 5, latency: 10_000, cost: 0.1 }),
      },
      lastVendor: null,
    }
    const ranked = rankVendors(history, ['slow', 'fast'])
    expect(ranked[0]!.vendorId).toBe('fast')
  })

  it('ranks on the TRUE MEDIAN, so one outlier attempt cannot buy or break a vendor', () => {
    // steady has median 100 (one 5s outlier); spiky has median 800 (one 100ms
    // outlier). An average would rank spiky's cheap outlier over steady's
    // consistent performance — the median must not.
    const history: DomainHistory = {
      vendors: {
        steady: entry({ attempts: 5, contentful: 5, samples: [100, 100, 100, 100, 5_000], cost: 0.1 }),
        spiky: entry({ attempts: 5, contentful: 5, samples: [100, 800, 800, 800, 800], cost: 0.1 }),
      },
      lastVendor: null,
    }
    const ranked = rankVendors(history, ['spiky', 'steady'])
    expect(ranked[0]!.vendorId).toBe('steady')
    expect(ranked[0]!.medianLatencyMs).toBe(100)
    expect(ranked[1]!.medianLatencyMs).toBe(800)
  })
})

describe('startingVendor', () => {
  it('starts from the ranked winner when no vendor-level failure just happened', () => {
    const history: DomainHistory = {
      vendors: {
        a: entry({ attempts: 5, contentful: 5, last: null }),
        b: entry({ attempts: 1, contentful: 0 }),
      },
      lastVendor: 'a',
    }
    const ranked = rankVendors(history, ['a', 'b'])
    expect(startingVendor(ranked, history)).toBe('a')
  })

  it('rotates to the next vendor after a provider_error', () => {
    const history: DomainHistory = {
      vendors: {
        a: entry({ attempts: 5, contentful: 5, last: 'provider_error' }),
        b: entry({ attempts: 5, contentful: 4, last: null }),
      },
      lastVendor: 'a',
    }
    const ranked = rankVendors(history, ['a', 'b'])
    expect(startingVendor(ranked, history)).toBe('b')
  })

  it('rotates after an identity_mismatch too', () => {
    const history: DomainHistory = {
      vendors: {
        a: entry({ attempts: 3, contentful: 3, last: 'identity_mismatch' }),
        b: entry({ attempts: 0 }),
      },
      lastVendor: 'a',
    }
    const ranked = rankVendors(history, ['a', 'b'])
    expect(startingVendor(ranked, history)).toBe('b')
  })

  it('does NOT rotate after a site-level bot_gate — the vendor did not break', () => {
    const history: DomainHistory = {
      vendors: {
        a: entry({ attempts: 5, contentful: 3, last: 'bot_gate' }),
        b: entry({ attempts: 1, contentful: 0 }),
      },
      lastVendor: 'a',
    }
    const ranked = rankVendors(history, ['a', 'b'])
    expect(startingVendor(ranked, history)).toBe('a')
  })
})

describe('MemoryRoutingHistory', () => {
  it('accumulates outcomes per domain per vendor', async () => {
    const h = new MemoryRoutingHistory()
    await h.record('example.com', 'steel', { contentful: true, wallMs: 100, costUsd: 0.01, failureClass: null })
    await h.record('example.com', 'steel', { contentful: false, wallMs: 200, costUsd: 0.01, failureClass: 'bot_gate' })
    await h.record('other.example', 'steel', { contentful: true, wallMs: 300, costUsd: 0.02, failureClass: null })

    const example = await h.read('example.com')
    expect(example.vendors.steel).toMatchObject({ attempts: 2, contentful: 1, latencyTotalMs: 300 })
    const other = await h.read('other.example')
    expect(other.vendors.steel).toMatchObject({ attempts: 1, contentful: 1 })
  })
})
