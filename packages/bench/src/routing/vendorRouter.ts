/**
 * Multi-vendor routing: which provider serves which domain, decided from
 * the domain's own history — success rate, latency, cost, and failure type.
 *
 * Not a black box. The score is four explicit terms, and each is printed in
 * the trace:
 *
 *   success  : contentful share of attempts (0 when no data)
 *   latency  : TRUE MEDIAN wall time across stored samples, inverted and
 *              normalized (0 when no data). Samples are kept per attempt —
 *              an average of outliers is not a statistic a router may
 *              decide on.
 *   cost     : cumulative reported vendor cost, inverted (0 when no data)
 *   explore  : a small flat bonus when the vendor has no history here yet,
 *              so a new vendor gets ONE chance to prove itself per domain
 *              rather than riding an unearned reputation from elsewhere.
 *
 * Failure attribution, stated once and implemented the same way in both the
 * ranking and the rotation:
 *   - EVERY non-contentful attempt lowers the vendor's success rate,
 *     including site-level blocks (bot_gate etc.). The site refused the
 *     vendor's request; "the vendor did not break" does not make the fetch
 *     successful.
 *   - ROTATION (startingVendor) reacts only to vendor-level failures
 *     (provider_error / identity_mismatch): the vendor broke, so the next
 *     attempt starts elsewhere. A site-level bot_gate does not rotate —
 *     switching vendors does not answer the site's refusal.
 */

import type { RoutingFailureClass } from '@w2l/http-core'
import { VENDOR_LEVEL_FAILURE_CLASS } from '@w2l/http-core'
import { readFile, writeFile, mkdir, chmod, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface VendorHistoryEntry {
  attempts: number
  contentful: number
  latencyTotalMs: number
  /** One sample per attempt, so the ranker can take a true median. */
  latencySamplesMs: number[]
  costTotalUsd: number
  lastFailureClass: RoutingFailureClass | null
}

export interface DomainHistory {
  vendors: Record<string, VendorHistoryEntry>
  /** Vendor last used for this domain, so the next attempt can start there. */
  lastVendor: string | null
}

export interface RoutingHistory {
  read(domain: string): Promise<DomainHistory>
  record(domain: string, vendorId: string, outcome: VendorOutcome): Promise<void>
}

export interface VendorOutcome {
  contentful: boolean
  wallMs: number
  costUsd: number
  failureClass: RoutingFailureClass | null
}

/** Fresh history entry for a vendor a domain has never used. */
function freshEntry(): VendorHistoryEntry {
  return {
    attempts: 0,
    contentful: 0,
    latencyTotalMs: 0,
    latencySamplesMs: [],
    costTotalUsd: 0,
    lastFailureClass: null,
  }
}

/** Apply one outcome to an entry. Shared by both stores so their arithmetic
 *  cannot drift apart. */
function applyOutcome(entry: VendorHistoryEntry, outcome: VendorOutcome): void {
  entry.attempts += 1
  if (outcome.contentful) entry.contentful += 1
  entry.latencyTotalMs += outcome.wallMs
  entry.latencySamplesMs.push(outcome.wallMs)
  entry.costTotalUsd += outcome.costUsd
  entry.lastFailureClass = outcome.failureClass
}

export class MemoryRoutingHistory implements RoutingHistory {
  private readonly domains = new Map<string, DomainHistory>()

  async read(domain: string): Promise<DomainHistory> {
    return this.domains.get(domain) ?? { vendors: {}, lastVendor: null }
  }

  async record(domain: string, vendorId: string, outcome: VendorOutcome): Promise<void> {
    const history = this.domains.get(domain) ?? { vendors: {}, lastVendor: null }
    const entry = history.vendors[vendorId] ?? freshEntry()
    applyOutcome(entry, outcome)
    history.vendors[vendorId] = entry
    history.lastVendor = vendorId
    this.domains.set(domain, history)
  }
}

/** File-backed history. Statistics only — no credentials, no URLs beyond the
 *  domain key. 0600 because it is still operational data. */
export class FileRoutingHistory implements RoutingHistory {
  constructor(private readonly file: string) {}

  private async all(): Promise<Record<string, DomainHistory>> {
    try {
      const raw = await readFile(this.file, 'utf8')
      return JSON.parse(raw) as Record<string, DomainHistory>
    } catch {
      return {}
    }
  }

  private async persist(all: Record<string, DomainHistory>): Promise<void> {
    const tmp = `${this.file}.tmp`
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(tmp, JSON.stringify(all, null, 2), { mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, this.file)
  }

  async read(domain: string): Promise<DomainHistory> {
    const all = await this.all()
    return all[domain] ?? { vendors: {}, lastVendor: null }
  }

  async record(domain: string, vendorId: string, outcome: VendorOutcome): Promise<void> {
    const all = await this.all()
    const history = all[domain] ?? { vendors: {}, lastVendor: null }
    const entry = history.vendors[vendorId] ?? freshEntry()
    applyOutcome(entry, outcome)
    history.vendors[vendorId] = entry
    history.lastVendor = vendorId
    all[domain] = history
    await this.persist(all)
  }
}

export interface VendorScore {
  vendorId: string
  /** Higher is better. Deterministic; every term visible in the trace. */
  score: number
  successRate: number
  medianLatencyMs: number | null
  totalCostUsd: number
}

const EXPLORE_BONUS = 0.05

/** Rank vendors for a domain. Ties in success break on latency, then cost. */
export function rankVendors(
  domainHistory: DomainHistory,
  vendorIds: readonly string[],
): readonly VendorScore[] {
  const scores: VendorScore[] = []
  for (const id of vendorIds) {
    const entry = domainHistory.vendors[id]
    if (entry === undefined || entry.attempts === 0) {
      scores.push({
        vendorId: id,
        score: EXPLORE_BONUS,
        successRate: 0,
        medianLatencyMs: null,
        totalCostUsd: 0,
      })
      continue
    }
    const successRate = entry.contentful / entry.attempts
    // True median over stored samples. `latencyTotalMs` remains for display
    // and volume; the ranker must not be moved by one pathological outlier.
    const samples = [...entry.latencySamplesMs].sort((a, b) => a - b)
    const mid = samples.length > 0 ? samples[Math.floor(samples.length / 2)]! : 0
    const cost = entry.costTotalUsd
    const score = successRate + 0.3 / (1 + mid / 1_000) + 0.1 / (1 + cost / 0.1)
    scores.push({
      vendorId: id,
      score,
      successRate,
      medianLatencyMs: mid,
      totalCostUsd: cost,
    })
  }
  return scores.sort((a, b) => b.score - a.score)
}

/**
 * Pick the starting vendor for a domain. Normally the top-ranked; when the
 * last attempt on this domain failed at the vendor level, start from the next
 * one down so one broken vendor does not eat every attempt.
 */
export function startingVendor(ranked: readonly VendorScore[], history: DomainHistory): string | null {
  if (ranked.length === 0) return null
  const last = history.lastVendor
  if (last === null) return ranked[0]!.vendorId
  const lastEntry = history.vendors[last]
  if (lastEntry !== undefined && lastEntry.lastFailureClass !== null && VENDOR_LEVEL_FAILURE_CLASS.has(lastEntry.lastFailureClass)) {
    const idx = ranked.findIndex((r) => r.vendorId === last)
    return ranked[(idx + 1) % ranked.length]!.vendorId
  }
  return last
}
