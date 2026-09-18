import { estimateTokens, type FetchResult, type NetworkPolicy, type TraceEvent } from '@w2l/contracts'
import { collectLinks, extractTf, htmlToMarkdown } from '@w2l/extract-tf'
import {
  classifyGate,
  escalationForBlock,
  isRetryableStatus,
  parseRetryAfterMs,
  ComplianceChain,
  normalizeAccessConfig,
  sha256Utf8,
  type AccessConfigInput,
  type AccessFactShape,
  type ComplianceRecord,
  type ComplianceSentHeader,
} from '@w2l/http-core'
import { chromium, type Browser, type Response } from 'playwright'
import { assertSafeUrl, BodyTooLargeError, defaultNetworkPolicy } from '../egress.js'
import type { SubjectAdapter } from '../subject.js'
import { RobotsOriginCache } from '../robotsLookup.js'
import {
  BROWSER_FINGERPRINT,
  CHROME_MAJOR_FLOOR,
  DEFAULT_NETWORK_POLICY,
  assertIdentityBundle,
  checkIdentityHonesty,
  identityBundleFrom,
  identityForRoute,
  modeIdentity,
  type CrawlMode,
  type HonestyVerdict,
} from '@w2l/contracts'

/**
 * Browser-local subject: the escalation target the http lane flags into.
 * Direct Playwright (ADR 0001) — one Chromium per run (headless unless
 * `--headed`), one fresh
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
 * A caller may supply their own proxy or session (`AccessConfigInput`). Doing
 * so changes the route and the credentials, never the identity: the UA,
 * locale, timezone and viewport stay exactly what they were. Who owns that
 * access is normalized into a credential-free fact and signed inside every
 * record, so the responsibility transfer is provable rather than asserted.
 * robots is still evaluated, and a disallow still stops the fetch — bringing
 * your own network does not buy an exemption from the publisher's rules.
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
  private readonly robotsCache: RobotsOriginCache
  private readonly networkPolicy: NetworkPolicy
  /** The run's hash chain. Every record this subject mints links into it. */
  private readonly chain: ComplianceChain
  /**
   * Who owns the network and session for this run, resolved once at
   * construction. Normalizing here means a config that cannot be honestly
   * recorded — a proxy with no attestation, a password in the URL — fails
   * before a single fetch, rather than half a run in.
   */
  private readonly access: AccessFactShape
  /**
   * The raw config, kept in memory only, because actually routing through the
   * user's proxy needs the password the fact deliberately reduced to a hash.
   * It is never written to a record, a trace, or a log line.
   */
  private readonly accessConfig: AccessConfigInput | null

  constructor(
    private readonly mode: CrawlMode = 'standard',
    access?: AccessConfigInput | null,
    private readonly headed = false,
    networkPolicy?: NetworkPolicy,
  ) {
    this.chain = new ComplianceChain(crypto.randomUUID(), mode)
    this.access = normalizeAccessConfig(access)
    this.accessConfig = access ?? null
    this.networkPolicy = networkPolicy ?? defaultNetworkPolicy()
    this.robotsCache = new RobotsOriginCache(this.networkPolicy)
  }

  /** Snapshot of the run's ledger, for callers that persist or verify it. */
  ledger(): ReturnType<ComplianceChain['toLedger']> {
    return this.chain.toLedger()
  }

  async fetch(url: string): Promise<FetchResult> {
    const start = Date.now()
    const trace: TraceEvent[] = [{ at: 0, lane: 'browser_local', event: 'browser_start' }]
    try {
      await assertSafeUrl(url, this.networkPolicy)
    } catch (err) {
      return this.denied(url, start, trace, err)
    }
    const browser = await this.getBrowser()

    let context
    let page
    try {
      // Real Chromium major, not the floor constant: declaring a Chrome
      // version we are not running is an inconsistency, not a feature.
      const version = browser.version()
      const major = Number(version.split('.')[0] ?? CHROME_MAJOR_FLOOR)
      const identity = modeIdentity(this.mode, Number.isFinite(major) ? major : CHROME_MAJOR_FLOOR)
      assertIdentityBundle(
        identityForRoute(this.mode, this.accessConfig, Number.isFinite(major) ? major : CHROME_MAJOR_FLOOR),
      )

      // Robots is consulted BEFORE the browser context is opened. Every mode
      // declares respectsRobots: true, and the only way that claim means
      // anything is if a disallow actually stops the fetch — a record that
      // says "disallowed" next to a page we fetched anyway would be a
      // self-documenting violation.
      const cachedRobots = await this.robotsCache.lookup(url, identity.userAgent)
      const robotsDecision = this.robotsCache.decision(cachedRobots, url, identity.userAgent)
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
          access: this.access,
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
        // Restore the user's full session state (cookies, localStorage,
        // sessionStorage) when they inherited a storageState blob — the
        // serialized JSON IS the Playwright shape, passed through verbatim.
        ...(this.accessConfig?.session?.storageState
          ? { storageState: JSON.parse(this.accessConfig.session.storageState) }
          : {}),
        // The user's egress, if they supplied one. Note what does NOT change
        // alongside it: the UA, the locale, the timezone, the viewport. A
        // different address is a different route, not a different identity —
        // spoofing the rest is the line this product does not cross.
        ...(this.accessConfig?.proxy
          ? {
              proxy: {
                server: this.access.proxyEndpoint!,
                ...(this.accessConfig.proxy.username === undefined
                  ? {}
                  : { username: this.accessConfig.proxy.username }),
                ...(this.accessConfig.proxy.password === undefined
                  ? {}
                  : { password: this.accessConfig.proxy.password }),
              },
            }
          : {}),
      })
      // The user's session, if they inherited one to us. Cookies go in through
      // the context API rather than a header so the browser scopes them the
      // way the origin expects.
      const userCookies = this.accessConfig?.session?.cookies ?? []
      if (userCookies.length > 0) {
        await context.addCookies(
          userCookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path })),
        )
        trace.push({
          at: Date.now() - start,
          lane: 'browser_local',
          event: 'session_attached',
          // Count and scope only. A trace that printed cookie values would
          // leak the user's account into every bench artifact.
          detail: { cookieCount: userCookies.length, sessionSha256: this.access.sessionSha256 },
        })
      }
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
      if (finalUrl !== url) {
        try {
          await assertSafeUrl(finalUrl, this.networkPolicy)
        } catch (err) {
          return this.denied(url, start, trace, err)
        }
      }
      const body = await page.content()
      if (Buffer.byteLength(body) > this.networkPolicy.maxDecompressedBytes) {
        return this.denied(url, start, trace, new BodyTooLargeError(this.networkPolicy.maxDecompressedBytes))
      }
      const rawBodySha256 = sha256Utf8(body)
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
        access: this.access,
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
          rawBodySha256,
          artifacts: [],
        },
        usage: {
          wallMs,
          // This is rendered DOM content, not measured network traffic.
          bytesWire: null,
          bytesDecompressed: Buffer.byteLength(body),
          requestCount: attemptCount,
          attemptCount,
          contentTokens: null as number | null,
          browserMs,
          externalCostUsd: null,
        },
        trace,
      }

      // Gate classification on the rendered DOM. Non-contentful paths use the
      // full classifier; a contentful 200 still consults decisive challenge
      // evidence so a 200 interstitial with extractable prose is not success.
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
      const links = collectLinks(body, finalUrl)
      trace.push({
        at: wallMs,
        lane: 'browser_local',
        event: 'extract',
        detail: {
          pageType: extracted.pageType,
          strategy: extracted.strategy,
          confidence: extracted.confidence,
          escalate: extracted.escalate,
          linkCount: links.length,
        },
      })

      if (extracted.escalate) {
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

      const decisive = classifyGate({
        status,
        header: (name) => response?.headers()[name.toLowerCase()] ?? null,
        body,
        contentful: true,
      })
      if (decisive !== null) return blocked(decisive)

      const markdown = htmlToMarkdown(extracted.mainHtml)
      return {
        ...base,
        status: 'success',
        failureReason: null,
        blockReason: null,
        budgetExceeded: null,
        lane: 'browser_local',
        escalations: [],
        markdown,
        links,
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

  private denied(
    url: string,
    start: number,
    trace: TraceEvent[],
    err: unknown,
    failureReason: FetchResult['failureReason'] = 'policy_denied',
  ): FetchResult {
    const wallMs = Date.now() - start
    const reason = err instanceof Error && err.name === 'BodyTooLargeError' ? 'body_too_large' : failureReason
    trace.push({
      at: wallMs,
      lane: 'browser_local',
      event: reason === 'body_too_large' ? 'body_too_large' : 'ssrf_denied',
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
        requestCount: 0,
        attemptCount: 0,
        contentTokens: null,
        browserMs: wallMs,
        externalCostUsd: null,
      },
      trace,
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
      this.browser = await chromium.launch({ headless: !this.headed })
    }
    return this.browser
  }

  async teardown(): Promise<void> {
    await this.browser?.close().catch(() => {})
    this.browser = null
  }
}
