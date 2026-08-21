import { estimateTokens, type FetchResult, type TraceEvent } from '@w2l/contracts'
import { extractTf } from '@w2l/extract-tf'
import { toGfmTable } from '@w2l/fixtures'
import {
  classifyGate,
  escalationForBlock,
  isRetryableStatus,
  parseRetryAfterMs,
  buildComplianceRecord,
  type ComplianceRecord,
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

  constructor(private readonly mode: CrawlMode = 'standard') {}

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
      const host = this.hostOf(url)
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

      // The per-fetch compliance record. robots decision is recorded as
      // `no_robots` — this subject does not consult robots.txt, and claiming
      // otherwise would be the exact lie the record exists to expose.
      const record: ComplianceRecord = buildComplianceRecord({
        recordId: crypto.randomUUID(),
        mode: this.mode,
        requestedUrl: url,
        finalUrl,
        requestedAt: new Date(start).toISOString(),
        robots: {
          robotsUrl: null,
          robotsSha256: null,
          matchedUserAgentGroup: null,
          appliedRules: [],
          decision: 'no_robots',
          skippedFetch: false,
        },
        sentHeaders: { headers: sentHeaders },
        rateLimit: {
          previousRequestAtMs,
          observedDelayMs,
          requiredDelayMs,
          compliant,
          recentSameHostCount: 1,
        },
        prevRecordHash: null,
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
