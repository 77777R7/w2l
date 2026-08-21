import { estimateTokens, type FetchResult, type TraceEvent } from '@w2l/contracts'
import { extractTf } from '@w2l/extract-tf'
import { toGfmTable } from '@w2l/fixtures'
import {
  classifyGate,
  escalationForBlock,
  isRetryableStatus,
  parseRetryAfterMs,
  ComplianceChain,
  evaluateRobots,
  parseRobotsTxt,
  sha256Hex,
  type ComplianceRecord,
  type ComplianceRobotsDecision,
  type ComplianceSentHeader,
} from '@w2l/http-core'
import { chromium, type Browser, type Response } from 'playwright'
import type { SubjectAdapter } from '../subject.js'
import {
  BROWSER_FINGERPRINT,
  CHROME_MAJOR_FLOOR,
  DEFAULT_NETWORK_POLICY,
  checkIdentityHonesty,
  modeIdentity,
  type CrawlMode,
  type HonestyVerdict,
} from '@w2l/contracts'

/**
 * Whether a content-type is a plain-text document. robots.txt must be
 * `text/plain` per RFC 9309 §2.3; anything else is a route that happened to
 * answer, not a rules file.
 */
function isPlainText(contentType: string | null): boolean {
  if (contentType === null) return true // no type declared — take it at face value
  return contentType.toLowerCase().trimStart().startsWith('text/plain')
}

/** One origin's robots.txt as fetched for this run. */interface CachedRobots {
  robotsUrl: string
  /** Null when robots.txt was absent, unreachable, or not a text document. */
  robots: ReturnType<typeof parseRobotsTxt> | null
  sha256: string | null
  /** True when the server explicitly said there is none (4xx), vs a failure. */
  absent: boolean
}

/**
 * Browser-local subject: the escalation target the http lane flags into.
 * Direct Playwright (ADR 0001) — one headless Chromium per run, one fresh
 * page per case, real script execution, real fingerprint.
 *
 * Identity is honest by construction: the mode's declared identity is derived
 * from the *actual* Chromium version (`browser.version()`), and the client
 * hints are aligned to it. The declared-vs-sent check (checkIdentityHonesty)
 * runs on every fetch and is recorded into the trace — a UA that Playwright
 * mutates on the wire is surfaced as a mismatch, never papered over.
 *
 * robots.txt is fetched per origin and evaluated against the mode's declared
 * UA before navigation; a disallow ends the fetch as `policy_denied` and still
 * mints a record. Every record joins one per-run hash chain, so the ledger a
 * publisher receives is missing-record-evident, not just tamper-evident.
 *
 * The rendered DOM goes through the SAME extract-tf cascade as the http
 * arms, so any score delta against resilient-http is attributable to
 * render-and-execute alone.
 */
export class BrowserLocalSubject implements SubjectAdapter {
  readonly meta = {
    id: 'browser-local',
    displayName: 'browser-local (playwright chromium × extract-tf)',
    version: '0.1.0',
    hosting: 'self_hosted' as const,
  }

  private browser: Browser | null = null
  /** Per-host last-request timestamp, for honest rate-limit facts. */
  private readonly lastRequestAtMsByHost = new Map<string, number>()
  /**
   * Per-host robots.txt, fetched once and reused. Caching is itself a
   * politeness property — re-fetching robots.txt before every page would be
   * the opposite of what the file is for.
   */
  private readonly robotsByOrigin = new Map<string, CachedRobots>()
  /** The run's hash chain. Every record this subject mints links into it. */
  private readonly chain: ComplianceChain

  constructor(private readonly mode: CrawlMode = 'standard') {
    this.chain = new ComplianceChain(crypto.randomUUID(), mode)
  }

  /** Snapshot of the run's ledger, for callers that persist or verify it. */
  ledger(): ReturnType<ComplianceChain['toLedger']> {
    return this.chain.toLedger()
  }

  async fetch(url: string): Promise<FetchResult> {
    const start = Date.now()
    const trace: TraceEvent[] = [{ at: 0, lane: 'browser_local', event: 'browser_start' }]
    const browser = await this.getBrowser()

    let context
    let page
    try {
      // Real Chromium major, not the floor constant: declaring a Chrome
      // version we are not running is an inconsistency, not a feature.
      const version = browser.version()
      const major = Number(version.split('.')[0] ?? CHROME_MAJOR_FLOOR)
      const identity = modeIdentity(this.mode, Number.isFinite(major) ? major : CHROME_MAJOR_FLOOR)

      // Robots is consulted BEFORE the browser context is opened. Every mode
      // declares respectsRobots: true, and the only way that claim means
      // anything is if a disallow actually stops the fetch — a record that
      // says "disallowed" next to a page we fetched anyway would be a
      // self-documenting violation.
      const cachedRobots = await this.robotsFor(url, identity.userAgent)
      const robotsDecision = this.robotsDecisionFor(cachedRobots, url, identity.userAgent)
      trace.push({
        at: Date.now() - start,
        lane: 'browser_local',
        event: 'robots_checked',
        detail: {
          decision: robotsDecision.decision,
          robotsUrl: robotsDecision.robotsUrl,
          matchedGroup: robotsDecision.matchedUserAgentGroup,
          ruleCount: robotsDecision.appliedRules.length,
        },
      })

      const host = this.hostOf(url)

      if (identity.respectsRobots && robotsDecision.decision === 'disallowed') {
        const wallMs = Date.now() - start
        const record = this.chain.append({
          recordId: crypto.randomUUID(),
          mode: this.mode,
          requestedUrl: url,
          finalUrl: null,
          requestedAt: new Date(start).toISOString(),
          robots: { ...robotsDecision, skippedFetch: true },
          sentHeaders: { headers: [] },
          rateLimit: {
            previousRequestAtMs: this.lastRequestAtMsByHost.get(host) ?? null,
            observedDelayMs: null,
            requiredDelayMs: DEFAULT_NETWORK_POLICY.perHostMinDelayMs,
            compliant: true,
            recentSameHostCount: 0,
          },
        })
        trace.push({
          at: wallMs,
          lane: 'browser_local',
          event: 'robots_disallowed',
          detail: { url, appliedRules: robotsDecision.appliedRules },
        })
        return {
          requestedUrl: url,
          status: 'failed',
          failureReason: 'policy_denied',
          blockReason: null,
          budgetExceeded: null,
          lane: 'browser_local',
          escalations: [],
          markdown: null,
          truncated: false,
          truncatedAt: null,
          compliance: record,
          evidence: {
            finalUrl: url,
            httpStatus: null,
            redirectChain: [],
            contentType: null,
            rawBodySha256: null,
            artifacts: [],
          },
          usage: {
            wallMs,
            bytesWire: 0,
            bytesDecompressed: 0,
            requestCount: 0,
            attemptCount: 0,
            contentTokens: null,
            browserMs: 0,
            externalCostUsd: null,
          },
          trace,
        }
      }

      context = await browser.newContext({
        userAgent: identity.userAgent,
        locale: BROWSER_FINGERPRINT.locale,
        timezoneId: BROWSER_FINGERPRINT.timezoneId,
        viewport: BROWSER_FINGERPRINT.viewport,
        screen: BROWSER_FINGERPRINT.screen,
        deviceScaleFactor: BROWSER_FINGERPRINT.deviceScaleFactor,
        extraHTTPHeaders: identity.clientHints,
      })
      page = await context.newPage()

      // Rate-limit facts for this host, captured before the request.
      const previousRequestAtMs = this.lastRequestAtMsByHost.get(host) ?? null
      const observedDelayMs = previousRequestAtMs === null ? null : Date.now() - previousRequestAtMs
      const requiredDelayMs = DEFAULT_NETWORK_POLICY.perHostMinDelayMs
      const compliant = observedDelayMs === null || observedDelayMs >= requiredDelayMs
      this.lastRequestAtMsByHost.set(host, Date.now())

      // Browser-tier retry: the same transport-independent policy the
      // http engine shares (503 only, once, Retry-After bounded). The
      // runner resets fixture state per subject, so the browser arm
      // genuinely sees flaky attempt 1 and must retry to survive it.
      const MAX_ATTEMPTS = 2
      let attemptCount = 1
      let response: Response | null = null
      for (;;) {
        trace.push({ at: Date.now() - start, lane: 'browser_local', event: 'navigate', detail: { url, attempt: attemptCount } })
        response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
        const status = response?.status() ?? 0
        if (isRetryableStatus(status) && attemptCount < MAX_ATTEMPTS) {
          const retryAfter = response?.headers()['retry-after'] ?? null
          const delayMs = Math.min(parseRetryAfterMs(retryAfter) ?? 0, 2000)
          trace.push({ at: Date.now() - start, lane: 'browser_local', event: 'retry', detail: { attempt: attemptCount, status, delayMs } })
          attemptCount++
          if (delayMs > 0) await page.waitForTimeout(delayMs)
          continue
        }
        break
      }
      // Give JS shells a beat to render after first paint; networkidle never
      // fires on long-polling pages, so use a bounded settle instead.
      await page.waitForTimeout(1500)
      const status = response?.status() ?? 0
      const finalUrl = page.url()
      const body = await page.content()
      const wallMs = Date.now() - start
      const browserMs = wallMs
      trace.push({ at: wallMs, lane: 'browser_local', event: 'rendered', detail: { status, attemptCount } })

      // What actually went on the wire, as Playwright saw it — the fact the
      // honesty check compares against, and the record signs.
      const sentHeaders: ComplianceSentHeader[] = Object.entries(response?.request().headers() ?? {})
        .map(([name, value]) => ({ name: name.toLowerCase(), value }))
        .sort((a, b) => a.name.localeCompare(b.name))
      const honesty: HonestyVerdict = checkIdentityHonesty(identity, { headers: sentHeaders })
      if (!honesty.honest) {
        trace.push({
          at: wallMs,
          lane: 'browser_local',
          event: 'identity_mismatch',
          detail: { mismatches: honesty.mismatches },
        })
      }

      // The per-fetch compliance record, appended to the run's hash chain so
      // this fetch commits to every fetch before it. The robots facts are the
      // ones actually evaluated above, not a placeholder.
      const record: ComplianceRecord = this.chain.append({
        recordId: crypto.randomUUID(),
        mode: this.mode,
        requestedUrl: url,
        finalUrl,
        requestedAt: new Date(start).toISOString(),
        robots: robotsDecision,
        sentHeaders: { headers: sentHeaders },
        rateLimit: {
          previousRequestAtMs,
          observedDelayMs,
          requiredDelayMs,
          compliant,
          recentSameHostCount: 1,
        },
      })

      const base = {
        requestedUrl: url,
        truncated: false,
        truncatedAt: null,
        compliance: record,
        evidence: {
          finalUrl,
          httpStatus: status,
          redirectChain: finalUrl !== url ? [url, finalUrl] : [],
          contentType: 'text/html; rendered',
          rawBodySha256: null,
          artifacts: [],
        },
        usage: {
          wallMs,
          bytesWire: Buffer.byteLength(body),
          bytesDecompressed: Buffer.byteLength(body),
          requestCount: attemptCount,
          attemptCount,
          contentTokens: null as number | null,
          browserMs,
          externalCostUsd: null,
        },
        trace,
      }

      // Gate classification, identical policy to the http lane — computed once
      // from the rendered DOM, consulted only on non-contentful paths.
      const gate = classifyGate({
        status,
        header: (name) => response?.headers()[name.toLowerCase()] ?? null,
        body,
      })
      const blocked = (verdict: NonNullable<typeof gate>): FetchResult => {
        const next = escalationForBlock(verdict.reason, 'browser_local')
        trace.push({
          at: wallMs,
          lane: 'browser_local',
          event: 'gate_detected',
          detail: { blockReason: verdict.reason, signals: verdict.signals, status },
        })
        return {
          ...base,
          status: 'blocked',
          failureReason: null,
          blockReason: verdict.reason,
          budgetExceeded: null,
          lane: 'browser_local',
          escalations: next === null ? [] : [{ ...next, improved: null }],
          markdown: null,
        }
      }

      const nonOk = status !== 200 && status !== 0
      if (nonOk && gate !== null) {
        return blocked(gate)
      }
      if (nonOk) {
        return {
          ...base,
          status: 'failed',
          failureReason: 'http_error',
          blockReason: null,
          budgetExceeded: null,
          lane: 'browser_local',
          escalations: [],
          markdown: null,
        }
      }

      const extracted = extractTf.extract(body)
      trace.push({
        at: wallMs,
        lane: 'browser_local',
        event: 'extract',
        detail: {
          pageType: extracted.pageType,
          strategy: extracted.strategy,
          confidence: extracted.confidence,
          escalate: extracted.escalate,
        },
      })

      if (extracted.escalate) {
        // A rendered page that still yields no main content may be the gate's
        // own answer rather than the page; classify now that it is known
        // non-contentful. A browser-lane gate escalates to the user's own
        // network or session, never to defeating the gate.
        if (gate !== null) return blocked(gate)
        return {
          ...base,
          status: 'failed',
          failureReason: 'empty_unverified',
          blockReason: null,
          budgetExceeded: null,
          lane: 'browser_local',
          escalations: [],
          markdown: null,
        }
      }

      const markdown = extracted.mainHtml.replace(
        /<table\b[\s\S]*?<\/table>/gi,
        (table) => `\n${toGfmTable(table)}\n`,
      )
      return {
        ...base,
        status: 'success',
        failureReason: null,
        blockReason: null,
        budgetExceeded: null,
        lane: 'browser_local',
        escalations: [],
        markdown,
        usage: { ...base.usage, contentTokens: estimateTokens(markdown) },
      }
    } catch (err) {
      const wallMs = Date.now() - start
      // Playwright surfaces deadline misses as TimeoutError; map them to the
      // contract's timeout reason so the timeout fixtures match, and leave
      // every other navigation failure as connection_error.
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'connection_error'
      trace.push({
        at: wallMs,
        lane: 'browser_local',
        event: 'navigate_failed',
        detail: { error: err instanceof Error ? err.message.slice(0, 200) : String(err) },
      })
      return {
        requestedUrl: url,
        status: 'failed',
        failureReason: reason,
        blockReason: null,
        budgetExceeded: null,
        lane: 'browser_local',
        escalations: [],
        markdown: null,
        truncated: false,
        truncatedAt: null,
        compliance: null,
        evidence: {
          finalUrl: url,
          httpStatus: null,
          redirectChain: [],
          contentType: null,
          rawBodySha256: null,
          artifacts: [],
        },
        usage: {
          wallMs,
          bytesWire: 0,
          bytesDecompressed: 0,
          requestCount: 1,
          attemptCount: 1,
          contentTokens: null,
          browserMs: wallMs,
          externalCostUsd: null,
        },
        trace,
      }
    } finally {
      await page?.close().catch(() => {})
      await context?.close().catch(() => {})
    }
  }

  private hostOf(url: string): string {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  }

  /**
   * Fetch and parse robots.txt for a URL's origin, once per origin per run.
   *
   * Plain `fetch` rather than the browser: robots.txt is a text file, and
   * spending a browser context on it would inflate the per-page cost of being
   * polite. A network failure is recorded as `null` robots — treated as
   * "no robots.txt" for the decision, but the record still says which URL was
   * attempted, so "we couldn't reach it" never silently reads as "it allowed
   * us".
   */
  private async robotsFor(url: string, userAgent: string): Promise<CachedRobots | null> {
    let origin: string
    let robotsUrl: string
    try {
      const parsed = new URL(url)
      origin = parsed.origin
      robotsUrl = `${parsed.origin}/robots.txt`
    } catch {
      return null
    }

    const cached = this.robotsByOrigin.get(origin)
    if (cached) return cached

    let entry: CachedRobots
    try {
      const res = await fetch(robotsUrl, {
        headers: { 'user-agent': userAgent },
        signal: AbortSignal.timeout(5_000),
      })
      if (res.status >= 400) {
        // 404/410 means the site published no rules — RFC 9309 §2.3.1.3 says
        // that is a full allow, and it is a different fact from a fetch error.
        entry = { robotsUrl, robots: null, sha256: null, absent: true }
      } else if (!isPlainText(res.headers.get('content-type'))) {
        // A "robots.txt" served as text/html is a soft-404 or a catch-all
        // route, not a rules document. Parsing it would invent groups out of
        // markup and let a record claim rules the publisher never wrote.
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

    this.robotsByOrigin.set(origin, entry)
    return entry
  }

  /** Turn a robots lookup into the record's robots facts for one path. */
  private robotsDecisionFor(cached: CachedRobots | null, url: string, userAgent: string): ComplianceRobotsDecision {
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

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true })
    }
    return this.browser
  }

  async teardown(): Promise<void> {
    await this.browser?.close().catch(() => {})
    this.browser = null
  }
}
