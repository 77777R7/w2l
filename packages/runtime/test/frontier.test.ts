import { describe, expect, it } from 'vitest'
import { DEFAULT_NETWORK_POLICY } from '@w2l/contracts'
import { Frontier } from '../src/frontier.js'

const SEED = 'https://fixture.test/listing'

function seeded(overrides: ConstructorParameters<typeof Frontier>[0] = { seedUrl: SEED }): Frontier {
  const frontier = new Frontier({ seedUrl: SEED, ...overrides })
  const result = frontier.seed()
  expect(result.accepted).toBe(true)
  return frontier
}

describe('Frontier seed / enqueue / visited', () => {
  it('seeds the canonical URL once and treats a second seed as duplicate', () => {
    const frontier = new Frontier({ seedUrl: `${SEED}?utm_source=nav` })
    expect(frontier.seed()).toMatchObject({
      accepted: true,
      canonicalUrl: SEED,
      reason: 'seeded',
    })
    expect(frontier.seed()).toMatchObject({ accepted: false, reason: 'duplicate' })
    expect(frontier.pendingCount()).toBe(1)
    expect(frontier.has(SEED)).toBe(true)
  })

  it('keeps /duplicate/a and /duplicate/c distinct after stripping utm on c', () => {
    const frontier = seeded()
    expect(frontier.enqueue('https://fixture.test/duplicate/a', 1)).toMatchObject({
      accepted: true,
      canonicalUrl: 'https://fixture.test/duplicate/a',
    })
    expect(frontier.enqueue('https://fixture.test/duplicate/c?utm_source=x', 1)).toMatchObject({
      accepted: true,
      canonicalUrl: 'https://fixture.test/duplicate/c',
    })
    expect(frontier.enqueue('https://fixture.test/duplicate/c', 1).reason).toBe('duplicate')
    expect(frontier.pendingCount()).toBe(3)
  })

  it('defaults to the seed host and refuses a different host', () => {
    const frontier = seeded()
    expect(frontier.enqueue('https://other.test/p', 1)).toMatchObject({
      accepted: false,
      reason: 'host_denied',
    })
  })

  it('uses the governance allowlist (exact / *.domain, never substring) when set', () => {
    const frontier = new Frontier({
      seedUrl: 'https://example.com/',
      allowlistedDomains: ['*.example.com'],
    })
    expect(frontier.seed().accepted).toBe(true)
    expect(frontier.enqueue('https://shop.example.com/p', 1).accepted).toBe(true)
    expect(frontier.enqueue('https://example.com.evil.net/p', 1).reason).toBe('host_denied')
    expect(frontier.enqueue('https://fixture.test/p', 1).reason).toBe('host_denied')
  })

  it('drops URLs past maxDepth', () => {
    const frontier = seeded({ maxDepth: 1 })
    expect(frontier.enqueue('https://fixture.test/a', 1).accepted).toBe(true)
    expect(frontier.enqueue('https://fixture.test/b', 2).reason).toBe('depth')
  })

  it('does not enqueue sitemap XML as a discovery path of its own', () => {
    const frontier = seeded()
    expect(frontier.enqueue('https://fixture.test/sitemap.xml', 1).accepted).toBe(true)
    expect(frontier.pendingCount()).toBe(2)
  })
})

describe('Frontier dequeue host limits', () => {
  it('honours DEFAULT_NETWORK_POLICY.perHostConcurrency = 2 after the min delay', () => {
    const frontier = new Frontier({ seedUrl: SEED })
    frontier.seed()
    frontier.enqueue('https://fixture.test/a', 1)
    frontier.enqueue('https://fixture.test/b', 1)

    const t0 = 1_000
    const delay = DEFAULT_NETWORK_POLICY.perHostMinDelayMs
    expect(frontier.dequeue(t0).item?.canonicalUrl).toBe(SEED)
    expect(frontier.dequeue(t0).item).toBeNull()
    expect(frontier.dequeue(t0 + delay).item?.canonicalUrl).toBe('https://fixture.test/a')
    expect(frontier.inFlightCount('fixture.test')).toBe(2)
    expect(frontier.dequeue(t0 + delay).item).toBeNull()
    expect(frontier.pendingCount()).toBe(1)

    frontier.release(SEED)
    expect(frontier.dequeue(t0 + delay * 2).item?.canonicalUrl).toBe('https://fixture.test/b')
  })

  it('waits perHostMinDelayMs = 250 before the next start on the same host', () => {
    const frontier = new Frontier({
      seedUrl: SEED,
      perHostConcurrency: 1,
      perHostMinDelayMs: 250,
    })
    frontier.seed()
    frontier.enqueue('https://fixture.test/a', 1)

    const t0 = 5_000
    expect(frontier.dequeue(t0).item?.canonicalUrl).toBe(SEED)
    frontier.release(SEED)

    const tooSoon = frontier.dequeue(t0 + 249)
    expect(tooSoon.item).toBeNull()
    expect(tooSoon.nextReadyAtMs).toBe(t0 + 250)

    const ready = frontier.dequeue(t0 + 250)
    expect(ready.item?.canonicalUrl).toBe('https://fixture.test/a')
  })

  it('uses robots crawlDelayMs when it is stricter than perHostMinDelayMs', () => {
    const frontier = new Frontier({
      seedUrl: SEED,
      perHostConcurrency: 1,
      perHostMinDelayMs: 250,
      crawlDelayMsByHost: new Map([['fixture.test', 2500]]),
    })
    frontier.seed()
    frontier.enqueue('https://fixture.test/a', 1)

    const t0 = 10_000
    expect(frontier.dequeue(t0).item).not.toBeNull()
    frontier.release(SEED)
    expect(frontier.hostDelayMs('fixture.test')).toBe(2500)
    expect(frontier.dequeue(t0 + 250).item).toBeNull()
    expect(frontier.dequeue(t0 + 2500).item?.canonicalUrl).toBe('https://fixture.test/a')
  })

  it('lets a second host proceed while the first is at concurrency', () => {
    const frontier = new Frontier({
      seedUrl: 'https://a.test/',
      allowlistedDomains: ['a.test', 'b.test'],
      perHostConcurrency: 1,
      perHostMinDelayMs: 250,
    })
    frontier.seed('https://a.test/')
    frontier.enqueue('https://b.test/', 0)

    const t0 = 1
    expect(frontier.dequeue(t0).item?.host).toBe('a.test')
    expect(frontier.dequeue(t0).item?.host).toBe('b.test')
  })
})

describe('Frontier does not fetch', () => {
  it('exports only the queue, not a scrape subject', async () => {
    const frontier = await import('../src/frontier.js')
    expect(Object.keys(frontier)).toEqual(['Frontier'])
  })
})
