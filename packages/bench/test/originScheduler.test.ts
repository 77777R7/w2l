import { describe, expect, it } from 'vitest'
import { localNetworkPolicy } from '@w2l/contracts'
import { OriginScheduler } from '../src/subjects/originScheduler.js'
import { RobotsOriginCache } from '../src/robotsLookup.js'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

describe('bounded origin scheduling', () => {
  it('rejects invalid policy values and hard-caps an oversized internal ceiling', async () => {
    expect(() => new OriginScheduler({ ...localNetworkPolicy(), perHostConcurrency: Number.NaN })).toThrow('perHostConcurrency')
    const scheduler = new OriginScheduler({ ...localNetworkPolicy(), perHostConcurrency: 100, perHostMinDelayMs: 0 })
    const permits = await Promise.all(Array.from({ length: 4 }, () => scheduler.acquire('https://shop.example')))
    const controller = new AbortController()
    const fifth = scheduler.acquire('https://shop.example', controller.signal)
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(fifth).rejects.toMatchObject({ name: 'AbortError' })
    permits.forEach(permit => permit.release())
  })

  async function run(limit: number) {
    const scheduler = new OriginScheduler({ ...localNetworkPolicy(), perHostConcurrency: limit, perHostMinDelayMs: 20 })
    let active = 0, peak = 0
    const starts: number[] = []
    const began = performance.now()
    await Promise.all(Array.from({ length: 6 }, async () => {
      const permit = await scheduler.acquire('https://shop.example')
      active++; peak = Math.max(peak, active); starts.push(performance.now())
      await new Promise(resolve => setTimeout(resolve, 80))
      active--; permit.release()
    }))
    return { elapsedMs: performance.now() - began, peak, gaps: starts.slice(1).map((start, i) => start - starts[i]!) }
  }

  it('compares 1 and 2, then 4 only after both are healthy', async () => {
    const one = await run(1)
    const two = await run(2)
    expect(one.peak).toBe(1)
    expect(two.peak).toBe(2)
    expect(one.gaps.every(gap => gap >= 15)).toBe(true)
    expect(two.gaps.every(gap => gap >= 15)).toBe(true)
    expect(two.elapsedMs).toBeLessThan(one.elapsedMs)
    const four = await run(4)
    expect(four.peak).toBeLessThanOrEqual(4)
    expect(four.peak).toBeGreaterThanOrEqual(3)
    expect(four.gaps.every(gap => gap >= 15)).toBe(true)
    expect(four.elapsedMs).toBeLessThan(two.elapsedMs)
  })

  it('shares Retry-After, cancels waiters without leaking slots, and leaves other origins available', async () => {
    const scheduler = new OriginScheduler({ ...localNetworkPolicy(), perHostConcurrency: 2, perHostMinDelayMs: 0 })
    const origin = 'https://shop.example'
    const retryAt = Date.now() + 120
    scheduler.cooldown(origin, retryAt)
    const controller = new AbortController()
    const cancelled = scheduler.acquire(origin, controller.signal)
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    const other = await scheduler.acquire('https://other.example')
    other.release()
    const started = Date.now()
    const permit = await scheduler.acquire(origin)
    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
    expect(permit.cooldownWaitMs).toBeGreaterThanOrEqual(100)
    permit.release()
  })

  it('shares one robots lookup while preserving each caller cancellation', async () => {
    let hits = 0
    const server = createServer((_req, res) => {
      hits++
      setTimeout(() => res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nAllow: /'), 60)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      const cache = new RobotsOriginCache(localNetworkPolicy())
      const controller = new AbortController()
      const cancelled = cache.lookup(`${origin}/a`, 'W2L', { signal: controller.signal })
      const continued = cache.lookup(`${origin}/b`, 'W2L')
      controller.abort(new DOMException('cancelled', 'AbortError'))
      await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
      expect((await continued)?.robots).not.toBeNull()
      expect(hits).toBe(1)
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
