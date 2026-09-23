import {
  estimateTokens,
  QUALITY_ESCALATION_MAX_CONFIDENCE,
  QUALITY_ESCALATION_MAX_TOKENS,
  type CrawlMode,
  type ExecutionContext,
  type FetchResult,
  type NetworkPolicy,
  type TraceEvent,
} from '@w2l/contracts'
import { collectLinks, extractTf, htmlToMarkdown } from '@w2l/extract-tf'
import { resilientFetch, createExecutionScope, throwIfExecutionStopped, classifyGate, escalationForBlock, parseRetryAfterMs, sha256Utf8, type ResilientFetcher } from '@w2l/http-core'
import { request } from 'undici'
import { assertSafeUrl, BodyTooLargeError, defaultNetworkPolicy, readCappedBody } from '../egress.js'
import { prepareHttpIdentity, recordHttpIdentity } from '../httpIdentity.js'
import { RobotsOriginCache } from '../robotsLookup.js'
import type { SubjectAdapter } from '../subject.js'
import { OriginScheduler, type OriginPermit } from './originScheduler.js'
import { captureRawHtml } from '../rawArtifact.js'

/**
 * Resilient HTTP subject: the resilient transport engine (redirect following
 * + 503 retry, http-core) composed with the extract-tf cascade. This is the
 * production-shaped arm — BareHttpSubject stays the untouched floor.
 *
   * Transport semantics come from resilientFetch; extraction and markdown
   * (htmlToMarkdown after extract-tf) are identical to ExtractTfSubject, so
   * any score delta against that arm is attributable to transport alone.
 */
export class ResilientHttpSubject implements SubjectAdapter {
  readonly meta = {
    id: 'resilient-http',
    displayName: 'Resilient HTTP (redirect+retry × extract-tf)',
    version: '0.1.0',
    hosting: 'self_hosted' as const,
  }

  private readonly prepared: ReturnType<typeof prepareHttpIdentity>
  private readonly fetcherFor: (initialUrl: string, validators: { etag?: string; lastModified?: string }, signal?: AbortSignal, onBodyRead?: (ms: number) => void, onRequestWait?: (intervalMs: number, cooldownMs: number) => void) => ResilientFetcher
  private readonly robotsCache: RobotsOriginCache
  private readonly networkPolicy: NetworkPolicy
  private readonly scheduler: OriginScheduler

  constructor(mode: CrawlMode = 'standard', networkPolicy?: NetworkPolicy, scheduler?: OriginScheduler) {
    this.prepared = prepareHttpIdentity(mode)
    this.networkPolicy = networkPolicy ?? defaultNetworkPolicy()
    this.scheduler = scheduler ?? new OriginScheduler(this.networkPolicy)
    this.robotsCache = new RobotsOriginCache(this.networkPolicy)
    const headers = this.prepared.headers
    const maxBodyBytes = this.networkPolicy.maxBodyBytes
    this.fetcherFor = (initialUrl, validators, signal, onBodyRead, onRequestWait) => async (url, init) => {
      await this.scheduler.beforeRequest(new URL(url).origin, init.signal ?? signal, onRequestWait)
      const response = await request(url, {
        method: 'GET',
        headersTimeout: init.headersTimeoutMs,
        bodyTimeout: init.bodyTimeoutMs,
        // Validators are bound to one representation; never forward on redirects.
        headers: { ...headers, ...(url === initialUrl ? validators.etag ? { 'if-none-match': validators.etag } : validators.lastModified ? { 'if-modified-since': validators.lastModified } : {} : {}) },
        signal: init.signal ?? signal,
      })
      const responseHeaders = response.headers
      let body: string | undefined
      return {
        status: response.statusCode,
        headers: {
          get: (name: string) => {
            const v = responseHeaders[name.toLowerCase()]
            return typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? null) : null
          },
        },
        bodyText: async () => {
          if (body !== undefined) return body
          const bodyStart = performance.now()
          const buf = await readCappedBody(response.body, maxBodyBytes)
          body = new TextDecoder().decode(buf)
          onBodyRead?.(Math.max(0, performance.now() - bodyStart))
          return body
        },
      }
    }
  }

  async fetch(url: string, deadlineMs?: number, signal?: AbortSignal, validators: { etag?: string; lastModified?: string } = {}, onRetryAfter?: ExecutionContext['onRetryAfter']): Promise<FetchResult> {
    const scope = createExecutionScope({ signal, deadlineAt: deadlineMs, onRetryAfter })
    const start = Date.now()
    const monotonicStart = performance.now()
    const origin = new URL(url).origin
    let permit: OriginPermit | undefined
    try {
      permit = await this.scheduler.acquire(origin, scope.signal)
      throwIfExecutionStopped(scope)
      const result = await this.fetchWithinBudget(url, scope, validators, monotonicStart, permit.queueMs, permit.cooldownWaitMs)
      return scope.signal.reason?.name === 'TimeoutError' || deadlineMs !== undefined && Date.now() >= deadlineMs
        ? { ...result, budgetExceeded: 'time' }
        : result
    } catch (error) {
      if (!scope.signal.aborted && (deadlineMs === undefined || Date.now() < deadlineMs)) throw error
      const result = this.denied(url, start, [], 'timeout')
      const totalMs = Math.max(0, performance.now() - monotonicStart)
      const retryAt = this.scheduler.retryAt(origin)
      const timed = { ...result, ...(retryAt === undefined ? {} : { retryAt }), usage: { ...result.usage, wallMs: totalMs, timings: { queueMs: permit?.queueMs ?? (retryAt === undefined ? totalMs : 0), robotsMs: 0, cooldownWaitMs: permit?.cooldownWaitMs ?? (retryAt === undefined ? 0 : totalMs), retryWaitMs: 0, requestMs: 0, bodyReadMs: 0, transportMs: 0, parseMs: 0, extractMs: 0, formatMs: 0, serializeMs: 0, modelMs: 0, totalMs } } }
      return scope.signal.reason?.name === 'TimeoutError' || deadlineMs !== undefined && Date.now() >= deadlineMs ? { ...timed, budgetExceeded: 'time' } : timed
    } finally {
      scope.dispose()
      permit?.release()
    }
  }

  private async fetchWithinBudget(url: string, execution: ExecutionContext, validators: { etag?: string; lastModified?: string }, monotonicStart: number, initialQueueMs: number, initialCooldownWaitMs: number): Promise<FetchResult> {
    const { signal, deadlineAt, onRetryAfter } = execution
    const start = Date.now()
    let robotsMs = 0
    let queueMs = initialQueueMs
    let cooldownWaitMs = initialCooldownWaitMs
    let pacingWaitMs = 0
    let transportMs = 0
    let retryWaitMs = 0
    let bodyReadMs = 0
    let parseMs = 0
    let extractMs = 0
    let formatMs = 0
    const timings = (totalMs: number) => ({
      queueMs,
      robotsMs,
      cooldownWaitMs,
      retryWaitMs,
      requestMs: Math.max(0, transportMs - bodyReadMs),
      bodyReadMs,
      transportMs,
      parseMs,
      extractMs,
      formatMs,
      serializeMs: 0,
      modelMs: 0,
      totalMs,
    })
    const timedDenied = (failureReason: FetchResult['failureReason'], retryAt?: number): FetchResult => {
      const totalMs = Math.max(0, performance.now() - monotonicStart)
      const denied = this.denied(url, start, trace, failureReason)
      return {
        ...denied,
        ...(retryAt === undefined ? {} : { retryAt }),
        usage: {
          ...denied.usage,
          wallMs: totalMs,
          timings: timings(totalMs),
        },
      }
    }
    const trace: TraceEvent[] = []
    const honest = recordHttpIdentity(this.prepared, trace, 0)
    if (!honest) {
      return this.denied(url, start, trace, 'identity_compromised')
    }

    if (this.prepared.identity.respectsRobots) {
      const robotsStart = performance.now()
      let cached: Awaited<ReturnType<RobotsOriginCache['lookup']>>
      try { cached = await this.robotsCache.lookup(url, this.prepared.identity.userAgent, execution) }
      catch (error) {
        robotsMs = performance.now() - robotsStart
        if (signal?.aborted) return timedDenied('timeout')
        throw error
      }
      const robotsDecision = this.robotsCache.decision(cached, url, this.prepared.identity.userAgent)
      trace.push({
        at: Date.now() - start,
        lane: 'http',
        event: 'robots_checked',
        detail: {
          decision: robotsDecision.decision,
          robotsUrl: robotsDecision.robotsUrl,
          matchedGroup: robotsDecision.matchedUserAgentGroup,
          ruleCount: robotsDecision.appliedRules.length,
        },
      })
      robotsMs = performance.now() - robotsStart
      if (robotsDecision.decision === 'disallowed') {
        trace.push({
          at: Date.now() - start,
          lane: 'http',
          event: 'robots_disallowed',
          detail: { url, appliedRules: robotsDecision.appliedRules },
        })
        return timedDenied('policy_denied')
      }
    }

    if (signal?.aborted) return timedDenied('timeout')
    const host = new URL(url).origin
    if (cooldownWaitMs > 0) trace.push({ at: Date.now() - start, lane: 'http', event: 'host_cooldown_wait', detail: { host, waitMs: cooldownWaitMs } })
    const transportStart = performance.now()
    const out = await resilientFetch(url, this.fetcherFor(url, validators, signal, ms => { bodyReadMs += ms }, (intervalMs, cooldownMs) => {
      queueMs += intervalMs
      cooldownWaitMs += cooldownMs
      pacingWaitMs += intervalMs + cooldownMs
    }), {
      signal,
      deadlineAt,
      onRetryAfter: (target, retryAt) => {
        for (const origin of new Set([host, new URL(target).origin])) {
          this.scheduler.cooldown(origin, retryAt)
        }
        onRetryAfter?.(target, retryAt)
      },
      maxRedirects: this.networkPolicy.maxRedirects,
      assertUrl: (target) => assertSafeUrl(target, this.networkPolicy),
    }).catch(error => {
      if (!signal?.aborted && (deadlineAt === undefined || Date.now() < deadlineAt)) throw error
      transportMs = Math.max(0, performance.now() - transportStart - pacingWaitMs)
      return null
    })
    if (out === null) return timedDenied('timeout', this.scheduler.retryAt(host))
    const transportTotalMs = performance.now() - transportStart
    retryWaitMs = out.trace
      .filter(event => event.event === 'retry')
      .reduce((sum, event) => sum + (typeof event.detail?.waitedMs === 'number' ? event.detail.waitedMs : typeof event.detail?.delayMs === 'number' ? event.detail.delayMs : 0), 0)
    transportMs = Math.max(0, transportTotalMs - retryWaitMs - pacingWaitMs)
    const wallMs = Date.now() - start
    let retryAt = out.retryAt
    if (out.status === 429 || out.status === 503) {
      const retryAfter = parseRetryAfterMs(out.headers?.get('retry-after') ?? null) ?? 250
      const next = out.retryAt ?? Date.now() + Math.max(retryAfter, 250)
      retryAt = next
      this.scheduler.cooldown(host, next)
      trace.push({ at: wallMs, lane: 'http', event: 'host_cooldown_set', detail: { host, status: out.status, cooldownMs: next - Date.now() } })
    }
    for (const t of out.trace) {
      trace.push({
        at: t.at,
        lane: 'http',
        event: t.event,
        ...(t.detail !== undefined ? { detail: t.detail } : {}),
      })
    }

    // Redirect evidence only when a redirect actually happened; a chain of
    // just the requested URL is "no redirect" and matches the other arms.
    const redirectChain = out.redirectChain.length > 1 ? out.redirectChain : []
    const bodyReadBeforeFinal = bodyReadMs
    let body: string
    try { body = await out.bodyText() }
    catch (error) {
      if (signal?.aborted) return timedDenied('timeout', out.retryAt)
      if (error instanceof BodyTooLargeError) return timedDenied('body_too_large')
      throw error
    }
    transportMs += Math.max(0, bodyReadMs - bodyReadBeforeFinal)
    const rawBodySha256 = sha256Utf8(body)
    const rawArtifacts = await captureRawHtml(body, rawBodySha256)

    const base = {
      requestedUrl: url,
      ...(retryAt === undefined ? {} : { retryAt }),
      truncated: false,
      truncatedAt: null,
      compliance: null,
      evidence: {
        finalUrl: out.finalUrl,
        httpStatus: out.status,
        redirectChain,
        contentType: out.headers?.get('content-type') ?? null,
        rawBodySha256,
        artifacts: rawArtifacts,
        etag: out.headers?.get('etag') ?? null,
        lastModified: out.headers?.get('last-modified') ?? null,
        cacheControl: out.headers?.get('cache-control') ?? null,
        vary: out.headers?.get('vary') ?? null,
        setsCookie: out.headers?.get('set-cookie') != null,
      },
      usage: {
        wallMs,
        bytesWire: Buffer.byteLength(body),
        bytesDecompressed: Buffer.byteLength(body),
        requestCount: out.requestCount,
        attemptCount: out.attemptCount,
        contentTokens: null as number | null,
        browserMs: 0,
        externalCostUsd: null,
      },
      trace,
    }
    const finish = <T extends FetchResult>(result: T): T => {
      const totalMs = Math.max(0, performance.now() - monotonicStart)
      return {
        ...result,
        usage: {
          ...result.usage,
          wallMs: totalMs,
          timings: timings(totalMs),
        },
      }
    }

    // Transport-level failure (timeout, connection error, redirect loop/limit,
    // non-http(s) redirect target).
    if (out.kind === 'failure') {
      return finish({
        ...base,
        status: 'failed',
        failureReason: out.failureReason,
        blockReason: null,
        budgetExceeded: null,
        lane: 'http',
        escalations: [],
        markdown: null,
      })
    }

    // Gate classification on the raw body. Non-contentful paths use the full
    // classifier. A 200 that extracted a main body still consults decisive
    // challenge evidence (vendor header / CF plumbing / interstitial pair).
    const gate = classifyGate({
      status: out.status,
      header: (name) => out.headers?.get(name) ?? null,
      body,
    })
    const blocked = (verdict: NonNullable<typeof gate>): FetchResult => {
      const next = escalationForBlock(verdict.reason, 'http')
      trace.push({
        at: wallMs,
        lane: 'http',
        event: 'gate_detected',
        detail: { blockReason: verdict.reason, signals: verdict.signals, status: out.status },
      })
      return finish({
        ...base,
        status: 'blocked',
        failureReason: null,
        blockReason: verdict.reason,
        budgetExceeded: null,
        lane: 'http',
        escalations: next === null ? [] : [{ ...next, improved: null }],
        markdown: null,
      })
    }

    // A gate that answers with a non-200 is a block, not a transient failure.
    // Note the retry policy never retries 429 — the job here is to not hammer.
    if (out.status !== 200 && gate !== null) {
      return blocked(gate)
    }

    if (out.status !== 200) {
      return finish({
        ...base,
        status: 'failed',
        failureReason: 'http_error',
        blockReason: null,
        budgetExceeded: null,
        lane: 'http',
        escalations: [],
        markdown: null,
      })
    }

    // Same extraction convention as ExtractTfSubject: escalate means the
    // extractor found no main content — report failed/empty_unverified and
    // flag the browser lane, never a contentful success.
    const extractStart = performance.now()
    const extracted = extractTf.extract(body, { url: out.finalUrl })
    const extractionTotalMs = performance.now() - extractStart
    parseMs = extracted.timings.parseMs
    extractMs = Math.max(extracted.timings.extractMs, extractionTotalMs - parseMs)
    const links = collectLinks(body, out.finalUrl)
    trace.push({
      at: wallMs,
      lane: 'http',
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
      return finish({
        ...base,
        status: 'failed',
        failureReason: 'empty_unverified',
        blockReason: null,
        budgetExceeded: null,
        lane: 'http',
        escalations: [
          { from: 'http', to: 'browser_local', trigger: 'extract_low_confidence', improved: null },
        ],
        markdown: null,
      })
    }

    const decisive = classifyGate({
      status: out.status,
      header: (name) => out.headers?.get(name) ?? null,
      body,
      contentful: true,
    })
    if (decisive !== null) return blocked(decisive)

    const formatStart = performance.now()
    const markdown = htmlToMarkdown(extracted.mainHtml)
    formatMs = performance.now() - formatStart
    const contentTokens = estimateTokens(markdown)

    // Quality signal: a success whose content is thin AND low-confidence is
    // a success worth offering to a higher lane. The status stays success —
    // this is not a rewritten verdict — but the ladder reads this event as
    // "the HTTP answer is below the quality bar, try the browser".
    if (
      contentTokens <= QUALITY_ESCALATION_MAX_TOKENS &&
      extracted.confidence <= QUALITY_ESCALATION_MAX_CONFIDENCE
    ) {
      trace.push({
        at: wallMs,
        lane: 'http',
        event: 'quality_low_yield',
        detail: {
          contentTokens,
          confidence: extracted.confidence,
          pageType: extracted.pageType,
          strategy: extracted.strategy,
        },
      })
    }

    return finish({
      ...base,
      status: 'success',
      failureReason: null,
      blockReason: null,
      budgetExceeded: null,
      lane: 'http',
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
      usage: { ...base.usage, contentTokens },
    })
  }

  private denied(url: string, start: number, trace: TraceEvent[], failureReason: FetchResult['failureReason']): FetchResult {
    const wallMs = Date.now() - start
    return {
      requestedUrl: url,
      status: 'failed',
      failureReason,
      blockReason: null,
      budgetExceeded: null,
      lane: 'http',
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
        browserMs: 0,
        externalCostUsd: null,
      },
      trace,
    }
  }

  async teardown(): Promise<void> {}
}
