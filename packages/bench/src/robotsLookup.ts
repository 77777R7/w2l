/**
 * Origin-cached robots.txt lookup shared by the HTTP and browser arms.
 *
 * A 4xx or a non-text/plain body is "no robots.txt". A network failure is
 * also recorded as no rules, but `absent` stays false so the record never
 * pretends the publisher published an empty file.
 */

import { type NetworkPolicy } from '@w2l/contracts'
import {
  evaluateRobots,
  parseRobotsTxt,
  sha256Hex,
  type ComplianceRobotsDecision,
} from '@w2l/http-core'
import { assertSafeUrl, defaultNetworkPolicy } from './egress.js'

function isPlainText(contentType: string | null): boolean {
  if (contentType === null) return true
  return contentType.toLowerCase().trimStart().startsWith('text/plain')
}

export interface CachedRobots {
  robotsUrl: string
  robots: ReturnType<typeof parseRobotsTxt> | null
  sha256: string | null
  absent: boolean
}

export class RobotsOriginCache {
  private readonly byOrigin = new Map<string, CachedRobots>()
  constructor(private readonly networkPolicy: NetworkPolicy = defaultNetworkPolicy()) {}

  async lookup(url: string, userAgent: string): Promise<CachedRobots | null> {
    let origin: string
    let robotsUrl: string
    try {
      const parsed = new URL(url)
      origin = parsed.origin
      robotsUrl = `${parsed.origin}/robots.txt`
    } catch {
      return null
    }

    const cached = this.byOrigin.get(origin)
    if (cached) return cached

    let entry: CachedRobots
    try {
      await assertSafeUrl(robotsUrl, this.networkPolicy)
      const res = await fetch(robotsUrl, {
        headers: { 'user-agent': userAgent },
        signal: AbortSignal.timeout(5_000),
      })
      if (res.status >= 400) {
        entry = { robotsUrl, robots: null, sha256: null, absent: true }
      } else if (!isPlainText(res.headers.get('content-type'))) {
        entry = { robotsUrl, robots: null, sha256: null, absent: true }
      } else {
        const text = await res.text()
        entry = {
          robotsUrl,
          robots: parseRobotsTxt(text),
          sha256: sha256Hex(new TextEncoder().encode(text)),
          absent: false,
        }
      }
    } catch {
      entry = { robotsUrl, robots: null, sha256: null, absent: false }
    }

    this.byOrigin.set(origin, entry)
    return entry
  }

  decision(cached: CachedRobots | null, url: string, userAgent: string): ComplianceRobotsDecision {
    if (cached === null || cached.robots === null) {
      return {
        robotsUrl: cached?.robotsUrl ?? null,
        robotsSha256: null,
        matchedUserAgentGroup: null,
        appliedRules: [],
        decision: 'no_robots',
        skippedFetch: false,
      }
    }

    let path = '/'
    try {
      const parsed = new URL(url)
      path = parsed.pathname + parsed.search
    } catch {
      /* keep '/' */
    }

    const match = evaluateRobots(cached.robots, userAgent, path)
    return {
      robotsUrl: cached.robotsUrl,
      robotsSha256: cached.sha256,
      matchedUserAgentGroup: match.matchedAgent,
      appliedRules: match.appliedRules.map((r) => ({ pattern: r.pattern, allow: r.allow })),
      decision: match.allowed ? 'allowed' : 'disallowed',
      skippedFetch: false,
    }
  }

  crawlDelayMs(cached: CachedRobots | null, userAgent: string): number | null {
    if (cached?.robots === null || cached?.robots === undefined) return null
    const group = cached.robots.groups.find((candidate) => candidate.agents.some((agent) => agent === '*' || userAgent.toLowerCase().includes(agent)))
    return group?.crawlDelayMs ?? null
  }
}
