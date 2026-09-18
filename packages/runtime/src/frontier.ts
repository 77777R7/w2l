/**
 * In-memory crawl frontier: canonicalize, visited, depth, host politeness.
 *
 * No fetch. The orchestrator (Phase 4/5) calls seed/enqueue/dequeue/release.
 * Host delay is max(perHostMinDelayMs, robots crawlDelayMs for that host).
 * Default host filter is the seed host; a non-empty allowlist uses the same
 * exact / `*.domain` match as governance.
 */

import { DEFAULT_NETWORK_POLICY } from '@w2l/contracts'
import { hostMatchesAllowlist } from '@w2l/http-core'
import { canonicalizeUrl, hostOf } from './canonicalize.js'

export interface FrontierItem {
  url: string
  canonicalUrl: string
  depth: number
  host: string
}

export interface FrontierEnqueueResult {
  accepted: boolean
  canonicalUrl: string | null
  reason:
    | 'enqueued'
    | 'seeded'
    | 'duplicate'
    | 'malformed'
    | 'depth'
    | 'host_denied'
    | 'scheme_denied'
}

export interface FrontierDequeue {
  item: FrontierItem | null
  /** When `item` is null and the queue is not empty, the next host delay expiry. */
  nextReadyAtMs: number | null
}

export interface FrontierOptions {
  seedUrl: string
  maxDepth?: number | null
  allowlistedDomains?: readonly string[]
  perHostConcurrency?: number
  perHostMinDelayMs?: number
  /** robots.txt Crawl-delay per host, already parsed to milliseconds. */
  crawlDelayMsByHost?: ReadonlyMap<string, number>
}

export class Frontier {
  readonly seedCanonicalUrl: string
  private readonly seedHost: string
  private readonly maxDepth: number | null
  private readonly allowlistedDomains: readonly string[]
  private readonly perHostConcurrency: number
  private readonly perHostMinDelayMs: number
  private crawlDelayMsByHost: ReadonlyMap<string, number>
  private readonly pending: FrontierItem[] = []
  private readonly visited = new Set<string>()
  private readonly inFlight = new Map<string, number>()
  private readonly lastStartedAtMs = new Map<string, number>()

  constructor(options: FrontierOptions) {
    const seed = canonicalizeUrl(options.seedUrl)
    if (seed === null) throw new Error(`Frontier seed is not an http(s) URL: ${options.seedUrl}`)
    this.seedCanonicalUrl = seed
    this.seedHost = hostOf(seed)
    this.maxDepth = options.maxDepth === undefined ? null : options.maxDepth
    this.allowlistedDomains = options.allowlistedDomains ?? []
    this.perHostConcurrency = options.perHostConcurrency ?? DEFAULT_NETWORK_POLICY.perHostConcurrency
    this.perHostMinDelayMs = options.perHostMinDelayMs ?? DEFAULT_NETWORK_POLICY.perHostMinDelayMs
    this.crawlDelayMsByHost = options.crawlDelayMsByHost ?? new Map()
  }

  seed(url: string = this.seedCanonicalUrl, depth = 0): FrontierEnqueueResult {
    return this.offer(url, depth, 'seeded')
  }

  enqueue(url: string, depth: number, base?: string): FrontierEnqueueResult {
    return this.offer(url, depth, 'enqueued', base)
  }

  dequeue(nowMs: number): FrontierDequeue {
    let nextReadyAtMs: number | null = null
    for (let i = 0; i < this.pending.length; i++) {
      const item = this.pending[i]!
      const inFlight = this.inFlight.get(item.host) ?? 0
      if (inFlight >= this.perHostConcurrency) continue
      const delay = this.hostDelayMs(item.host)
      const last = this.lastStartedAtMs.get(item.host)
      if (last !== undefined) {
        const readyAt = last + delay
        if (nowMs < readyAt) {
          nextReadyAtMs = nextReadyAtMs === null ? readyAt : Math.min(nextReadyAtMs, readyAt)
          continue
        }
      }
      this.pending.splice(i, 1)
      this.inFlight.set(item.host, inFlight + 1)
      this.lastStartedAtMs.set(item.host, nowMs)
      return { item, nextReadyAtMs: null }
    }
    return {
      item: null,
      nextReadyAtMs: this.pending.length === 0 ? null : nextReadyAtMs,
    }
  }

  /**
   * Caller finished the page (success, failure, or skip). Frees a host slot.
   * The canonical URL stays in `visited` so it is not crawled again.
   */
  release(canonicalUrl: string): void {
    const host = hostOf(canonicalUrl)
    const inFlight = this.inFlight.get(host) ?? 0
    if (inFlight <= 1) this.inFlight.delete(host)
    else this.inFlight.set(host, inFlight - 1)
  }

  has(canonicalUrl: string): boolean {
    return this.visited.has(canonicalUrl)
  }

  /**
   * Remember a URL without enqueueing it. Resume uses this so a completed
   * page is not crawled again, while unfinished URLs can still be seeded.
   */
  markVisited(canonicalUrl: string): void {
    this.visited.add(canonicalUrl)
  }

  pendingCount(): number {
    return this.pending.length
  }

  inFlightCount(host?: string): number {
    if (host !== undefined) return this.inFlight.get(host) ?? 0
    let total = 0
    for (const n of this.inFlight.values()) total += n
    return total
  }

  hostDelayMs(host: string): number {
    const robotsDelay = this.crawlDelayMsByHost.get(host) ?? 0
    return Math.max(this.perHostMinDelayMs, robotsDelay)
  }

  setCrawlDelay(host: string, delayMs: number | null): void {
    if (delayMs === null) return
    const next = Math.max(0, delayMs)
    const current = this.crawlDelayMsByHost.get(host) ?? 0
    if (next <= current) return
    this.crawlDelayMsByHost = new Map(this.crawlDelayMsByHost).set(host, next)
  }

  private offer(
    url: string,
    depth: number,
    acceptedReason: 'enqueued' | 'seeded',
    base?: string,
  ): FrontierEnqueueResult {
    const canonicalUrl = canonicalizeUrl(url, base)
    if (canonicalUrl === null) {
      return { accepted: false, canonicalUrl: null, reason: urlLooksLikeNonHttp(url, base) ? 'scheme_denied' : 'malformed' }
    }
    if (this.maxDepth !== null && depth > this.maxDepth) {
      return { accepted: false, canonicalUrl, reason: 'depth' }
    }
    const host = hostOf(canonicalUrl)
    if (!this.hostAllowed(host)) {
      return { accepted: false, canonicalUrl, reason: 'host_denied' }
    }
    if (this.visited.has(canonicalUrl)) {
      return { accepted: false, canonicalUrl, reason: 'duplicate' }
    }
    this.visited.add(canonicalUrl)
    this.pending.push({ url: resolvedHref(url, base) ?? canonicalUrl, canonicalUrl, depth, host })
    return { accepted: true, canonicalUrl, reason: acceptedReason }
  }

  private hostAllowed(host: string): boolean {
    if (this.allowlistedDomains.length > 0) {
      return this.allowlistedDomains.some((entry) => hostMatchesAllowlist(host, entry))
    }
    return host === this.seedHost
  }
}

function resolvedHref(url: string, base?: string): string | null {
  try {
    return (base === undefined ? new URL(url) : new URL(url, base)).href
  } catch {
    return null
  }
}

function urlLooksLikeNonHttp(url: string, base?: string): boolean {
  try {
    const parsed = base === undefined ? new URL(url) : new URL(url, base)
    return parsed.protocol !== 'http:' && parsed.protocol !== 'https:'
  } catch {
    return false
  }
}
