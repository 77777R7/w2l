import { estimateTokens, type ExecutionContext, type FetchResult, type NetworkPolicy, type TraceEvent } from '@w2l/contracts'
import { collectLinks, extractTf, htmlToMarkdown } from '@w2l/extract-tf'
import {
  abortableSleep,
  createExecutionScope,
  raceWithSignal,
  remainingTimeout,
  throwIfExecutionStopped,
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
import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright'
import { assertSafeUrl, BodyTooLargeError, defaultNetworkPolicy } from '../egress.js'
import type { SubjectAdapter } from '../subject.js'
import { RobotsOriginCache } from '../robotsLookup.js'
import { waitForRenderedStability } from '../browserSettle.js'
import { OriginScheduler, type OriginPermit } from './originScheduler.js'
import { captureRawHtml } from '../rawArtifact.js'
import { amazonVariantFollowupUrl } from './amazonVariantFollowup.js'
import {
  BROWSER_FINGERPRINT,
  CHROME_MAJOR_FLOOR,
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

  private activeExecutions = 0
  private readonly scheduler: OriginScheduler
  private browser: Browser | null = null
  private browserPromise: Promise<Browser> | null = null
  private managedContext: BrowserContext | null = null
  private managedContextPromise: Promise<BrowserContext> | null = null
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
    private readonly managedProfileDir: string | null = null,
    scheduler?: OriginScheduler,
    private readonly publicPreferenceState: string | null = null,
  ) {
    if (publicPreferenceState !== null && (mode !== 'standard' || access != null || managedProfileDir !== null)) {
      throw new Error('anonymous public preference state is only available to the standard public browser')
    }
    this.chain = new ComplianceChain(crypto.randomUUID(), mode)
    this.access = normalizeAccessConfig(access)
    this.accessConfig = access ?? null
    this.networkPolicy = networkPolicy ?? defaultNetworkPolicy()
    this.scheduler = scheduler ?? new OriginScheduler(this.networkPolicy)
    this.robotsCache = new RobotsOriginCache(this.networkPolicy)
  }

  /** Managed profile is a distinct lifecycle path; it is never implied by an anonymous subject. */
  profileDir(): string | null { return this.managedProfileDir }

  /** Snapshot of the run's ledger, for callers that persist or verify it. */
  ledger(): ReturnType<ComplianceChain['toLedger']> {
    return this.chain.toLedger()
  }

  async fetch(url: string, deadlineMs?: number, signal?: AbortSignal, onRetryAfter?: ExecutionContext['onRetryAfter']): Promise<FetchResult> {
    const scope = createExecutionScope({ signal, deadlineAt: deadlineMs, onRetryAfter })
    const start = Date.now()
    const monotonicStart = performance.now()
    let queueMs = 0
    let cooldownWaitMs = 0
    const finish = (result: FetchResult): FetchResult => {
      const totalMs = Math.max(0, performance.now() - monotonicStart)
      return {
        ...result,
        usage: {
          ...result.usage,
          wallMs: totalMs,
          timings: {
            ...(result.usage.timings ?? {}),
            queueMs,
            cooldownWaitMs,
            totalMs,
          },
        },
      }
    }
    const origin = new URL(url).origin
    this.activeExecutions++
    let permit: OriginPermit | undefined
    try {
      permit = await this.scheduler.acquire(origin, scope.signal)
      queueMs = permit.queueMs
      cooldownWaitMs = permit.cooldownWaitMs
      throwIfExecutionStopped(scope)
      const result = await this.fetchWithinBudget(url, scope, (intervalMs, cooldownMs) => { queueMs += intervalMs; cooldownWaitMs += cooldownMs })
      if (result.retryAt !== undefined) this.scheduler.cooldown(origin, result.retryAt)
      return finish(result)
    } catch (error) {
      if (!scope.signal.aborted && (deadlineMs === undefined || Date.now() < deadlineMs)) throw error
      const retryAt = this.scheduler.retryAt(origin)
      if (!permit) {
        const waited = Math.max(0, performance.now() - monotonicStart)
        queueMs = retryAt === undefined ? waited : 0
        cooldownWaitMs = retryAt === undefined ? 0 : waited
      }
      return finish({ ...this.denied(url, start, [], new Error('aborted')), ...(retryAt === undefined ? {} : { retryAt }) })
    } finally {
      this.activeExecutions--
      scope.dispose()
      permit?.release()
    }
  }

  private async fetchWithinBudget(url: string, execution: ExecutionContext, onRequestWait?: (intervalMs: number, cooldownMs: number) => void): Promise<FetchResult> {
    const signal = execution.signal
    const start = Date.now()
    const trace: TraceEvent[] = [{ at: 0, lane: 'browser_local', event: 'browser_start' }]
    let context: BrowserContext | undefined
    let page: Page | undefined
    const onAbort = () => {
      void page?.close().catch(() => {})
      if (context !== this.managedContext) void context?.close().catch(() => {})
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      throwIfExecutionStopped(execution)
      await raceWithSignal(assertSafeUrl(url, this.networkPolicy), signal)
      const managedContext = this.managedProfileDir === null ? null : await raceWithSignal(this.getManagedContext(execution), signal)
      const browser = managedContext?.browser() ?? await raceWithSignal(this.getBrowser(execution), signal)
      throwIfExecutionStopped(execution)
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
      const cachedRobots = await this.robotsCache.lookup(url, identity.userAgent, execution)
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
          crawlDelayMs: robotsDecision.crawlDelayMs,
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
            requiredDelayMs: this.networkPolicy.perHostMinDelayMs,
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

      const amazonPublicState = this.publicPreferenceState !== null && /(^|\.)amazon\.(com|sg)$/i.test(host)
        ? this.publicPreferenceState : null
      const pendingContext = managedContext ? Promise.resolve(managedContext) : browser.newContext({
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
        ...(this.accessConfig?.session?.storageState ?? amazonPublicState
          ? { storageState: JSON.parse((this.accessConfig?.session?.storageState ?? amazonPublicState)!) }
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
      void pendingContext.then(created => { if (signal?.aborted && created !== this.managedContext) void created.close().catch(() => {}) }, () => {})
      context = await raceWithSignal(pendingContext, signal)
      if (amazonPublicState !== null) trace.push({
        at: Date.now() - start, lane: 'browser_local', event: 'anonymous_public_preference_attached',
        detail: { host, stateSha256: sha256Utf8(amazonPublicState) },
      })
      throwIfExecutionStopped(execution)
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
      throwIfExecutionStopped(execution)
      const pendingPage = context.newPage()
      void pendingPage.then(created => { if (signal?.aborted) void created.close().catch(() => {}) }, () => {})
      page = await raceWithSignal(pendingPage, signal)
      throwIfExecutionStopped(execution)

      // Rate-limit facts are captured at actual navigation, after setup.
      let previousRequestAtMs: number | null = null
      let observedDelayMs: number | null = null
      const requiredDelayMs = this.networkPolicy.perHostMinDelayMs
      let compliant = true

      // Browser-tier retry: the same transport-independent policy the
      // http engine shares (503 only, once, authoritative Retry-After). The
      // runner resets fixture state per subject, so the browser arm
      // genuinely sees flaky attempt 1 and must retry to survive it.
      const MAX_STATUS_RETRIES = 1
      let statusRetries = 0
      let variantFollowups = 0
      let attemptCount = 0
      let navigationUrl = url
      const requestedAmazonAsin = /^\/dp\/([A-Z0-9]{10})\/?$/i.exec(new URL(url).pathname)?.[1]?.toUpperCase() ?? null
      let response: Response | null = null
      for (;;) {
        await this.scheduler.beforeRequest(new URL(navigationUrl).origin, signal, onRequestWait)
        previousRequestAtMs = this.lastRequestAtMsByHost.get(host) ?? null
        const navigationAt = Date.now()
        observedDelayMs = previousRequestAtMs === null ? null : navigationAt - previousRequestAtMs
        compliant &&= observedDelayMs === null || observedDelayMs >= requiredDelayMs
        this.lastRequestAtMsByHost.set(host, navigationAt)
        attemptCount++
        trace.push({ at: Date.now() - start, lane: 'browser_local', event: 'navigate', detail: { url: navigationUrl, attempt: attemptCount } })
        response = await page.goto(navigationUrl, { waitUntil: 'domcontentloaded', timeout: remainingTimeout(execution, 20_000) })
        const status = response?.status() ?? 0
        if (status === 429 || status === 503) {
          const delay = parseRetryAfterMs(response?.headers()['retry-after'] ?? null)
          if (delay !== null) {
            const target = response?.url() ?? url
            const retryAt = Date.now() + delay
            for (const origin of new Set([new URL(navigationUrl).origin, new URL(target).origin])) this.scheduler.cooldown(origin, retryAt)
            execution.onRetryAfter?.(target, retryAt)
          }
        }
        if (isRetryableStatus(status) && statusRetries < MAX_STATUS_RETRIES) {
          const retryAfter = response?.headers()['retry-after'] ?? null
          const delayMs = parseRetryAfterMs(retryAfter) ?? 250
          const retryAt = Date.now() + delayMs
          if (execution.deadlineAt !== undefined && retryAt >= execution.deadlineAt) {
            trace.push({ at: Date.now() - start, lane: 'browser_local', event: 'retry_deferred', detail: { retryAt, delayMs, status } })
            const deferred = this.denied(url, start, trace, new Error('aborted'))
            return { ...deferred, retryAt, evidence: { ...deferred.evidence, httpStatus: status, finalUrl: page.url() } }
          }
          trace.push({ at: Date.now() - start, lane: 'browser_local', event: 'retry', detail: { attempt: attemptCount, status, delayMs } })
          statusRetries++
          if (delayMs > 0) await abortableSleep(delayMs, signal)
          continue
        }
        await raceWithSignal(waitForRenderedStability(page, { maxMs: remainingTimeout(execution, 1_500) }), signal)
        throwIfExecutionStopped(execution)
        if (status === 200 && variantFollowups === 0 && requestedAmazonAsin !== null) {
          const variant = await raceWithSignal(page.evaluate((asin) => ({
            selectedAsin: document.querySelector('input[name="ASIN"]')?.getAttribute('value') ?? null,
            requestedVariantAvailable: Array.from(document.querySelectorAll('li[data-asin]')).some(element =>
              element.getAttribute('data-asin')?.toUpperCase() === asin
              && /swatchAvailable/i.test(element.getAttribute('data-csa-c-content-id') ?? '')),
          }), requestedAmazonAsin), signal)
          const followupUrl = amazonVariantFollowupUrl(url, page.url(), variant.selectedAsin, variant.requestedVariantAvailable)
          if (followupUrl !== null) {
            const followupRobots = this.robotsCache.decision(cachedRobots, followupUrl, identity.userAgent)
            if (followupRobots.decision === 'disallowed') {
              trace.push({ at: Date.now() - start, lane: 'browser_local', event: 'amazon_variant_followup_denied', detail: { url: followupUrl } })
            } else {
              await raceWithSignal(assertSafeUrl(followupUrl, this.networkPolicy), signal)
              variantFollowups++
              navigationUrl = followupUrl
              trace.push({ at: Date.now() - start, lane: 'browser_local', event: 'amazon_variant_followup', detail: { selectedAsin: variant.selectedAsin, requestedAsin: requestedAmazonAsin, url: followupUrl } })
              continue
            }
          }
        }
        break
      }
      throwIfExecutionStopped(execution)
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
      const rawArtifacts = await captureRawHtml(body, rawBodySha256)
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
          recentSameHostCount: attemptCount,
        },
        access: this.access,
      })

      const base = {
        requestedUrl: url,
        ...([429, 503].includes(status) ? { retryAt: Date.now() + (parseRetryAfterMs(response?.headers()['retry-after'] ?? null) ?? 250) } : {}),
        truncated: false,
        truncatedAt: null,
        compliance: record,
        evidence: {
          finalUrl,
          httpStatus: status,
          redirectChain: finalUrl !== url ? [url, finalUrl] : [],
          contentType: 'text/html; rendered',
          rawBodySha256,
          artifacts: rawArtifacts,
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

      const extracted = extractTf.extract(body, { url: finalUrl })
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
        document: {
          title: extracted.title,
          pageType: extracted.pageType,
          strategy: extracted.strategy,
          confidence: extracted.confidence,
          product: extracted.product ?? null,
          adapter: extracted.adapter,
          entities: extracted.entities,
          adapterValidation: extracted.adapterValidation,
        },
        usage: { ...base.usage, contentTokens: estimateTokens(markdown) },
      }
    } catch (err) {
      const wallMs = Date.now() - start
      // Playwright surfaces deadline misses as TimeoutError; map them to the
      // contract's timeout reason so the timeout fixtures match, and leave
      // every other navigation failure as connection_error.
      const reason = signal?.aborted || err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'timeout' : err instanceof Error && err.name === 'SsrfDeniedError' ? 'policy_denied' : 'connection_error'
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
      signal?.removeEventListener('abort', onAbort)
      await page?.close().catch(() => {})
      if (context !== this.managedContext) await context?.close().catch(() => {})
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
    const reason = err instanceof Error && err.message === 'aborted'
      ? 'timeout'
      : err instanceof Error && err.name === 'BodyTooLargeError'
        ? 'body_too_large'
        : failureReason
    trace.push({
      at: wallMs,
      lane: 'browser_local',
      event: reason === 'body_too_large' ? 'body_too_large' : reason === 'timeout' ? 'cancelled' : 'ssrf_denied',
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

  private async getBrowser(execution: ExecutionContext): Promise<Browser> {
    throwIfExecutionStopped(execution)
    if (this.browser !== null) return this.browser
    if (this.browserPromise === null) {
      // Startup belongs to the shared subject. Each caller has its own budget;
      // one short caller must not set the launch deadline for another monitor.
      const pending = chromium.launch({ headless: !this.headed, timeout: 30_000 }).then(async browser => {
        if (this.activeExecutions === 0) {
          if (this.browserPromise === pending) this.browserPromise = null
          await browser.close().catch(() => {})
          throw new DOMException('Browser startup abandoned', 'AbortError')
        }
        this.browser = browser
        return browser
      }).catch(error => {
        if (this.browserPromise === pending) this.browserPromise = null
        throw error
      })
      this.browserPromise = pending
    }
    return this.browserPromise
  }

  private async getManagedContext(execution: ExecutionContext): Promise<BrowserContext> {
    throwIfExecutionStopped(execution)
    if (this.managedContext !== null) return this.managedContext
    if (this.managedContextPromise === null) {
      const pending = chromium.launchPersistentContext(this.managedProfileDir!, { headless: !this.headed, timeout: 30_000 })
        .then(async context => {
          if (this.activeExecutions === 0) {
            if (this.managedContextPromise === pending) this.managedContextPromise = null
            await context.close().catch(() => {})
            throw new DOMException('Managed browser startup abandoned', 'AbortError')
          }
          this.managedContext = context
          return context
        })
        .catch(error => { if (this.managedContextPromise === pending) this.managedContextPromise = null; throw error })
      this.managedContextPromise = pending
    }
    return this.managedContextPromise
  }

  async teardown(): Promise<void> {
    if (this.managedContextPromise !== null && this.managedContext === null) await this.managedContextPromise.catch(() => {})
    await this.managedContext?.close().catch(() => {})
    this.managedContext = null
    this.managedContextPromise = null
    const pending = this.browserPromise
    if (pending !== null && this.browser === null) await pending.catch(() => {})
    await this.browser?.close().catch(() => {})
    this.browser = null
    this.browserPromise = null
  }
}
