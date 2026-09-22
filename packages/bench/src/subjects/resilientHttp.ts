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
import { resilientFetch, abortableSleep, createExecutionScope, raceWithSignal, throwIfExecutionStopped, classifyGate, escalationForBlock, parseRetryAfterMs, sha256Utf8, type ResilientFetcher } from '@w2l/http-core'
import { request } from 'undici'
import { assertSafeUrl, defaultNetworkPolicy, readCappedBody } from '../egress.js'
import { prepareHttpIdentity, recordHttpIdentity } from '../httpIdentity.js'
import { RobotsOriginCache } from '../robotsLookup.js'
import type { SubjectAdapter } from '../subject.js'

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
  private readonly fetcherFor: (initialUrl: string, validators: { etag?: string; lastModified?: string }, signal?: AbortSignal) => ResilientFetcher
  private readonly robotsCache: RobotsOriginCache
  private readonly networkPolicy: NetworkPolicy
  private readonly pendingByOrigin = new Map<string, Promise<void>>()
  private readonly cooldownUntilByHost = new Map<string, number>()

  constructor(mode: CrawlMode = 'standard', networkPolicy?: NetworkPolicy) {
    this.prepared = prepareHttpIdentity(mode)
    this.networkPolicy = networkPolicy ?? defaultNetworkPolicy()
    this.robotsCache = new RobotsOriginCache(this.networkPolicy)
    const headers = this.prepared.headers
    const maxBodyBytes = this.networkPolicy.maxBodyBytes
    this.fetcherFor = (initialUrl, validators, signal) => async (url, init) => {
      const response = await request(url, {
        method: 'GET',
        headersTimeout: init.headersTimeoutMs,
        bodyTimeout: init.bodyTimeoutMs,
        // Validators are bound to one representation; never forward on redirects.
        headers: { ...headers, ...(url === initialUrl ? validators.etag ? { 'if-none-match': validators.etag } : validators.lastModified ? { 'if-modified-since': validators.lastModified } : {} : {}) },
        signal: init.signal ?? signal,
      })
      const buf = await readCappedBody(response.body, maxBodyBytes)
      const responseHeaders = response.headers
      return {
        status: response.statusCode,
        headers: {
          get: (name: string) => {
            const v = responseHeaders[name.toLowerCase()]
            return typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? null) : null
          },
        },
        bodyText: async () => new TextDecoder().decode(buf),
      }
    }
  }

  async fetch(url: string, deadlineMs?: number, signal?: AbortSignal, validators: { etag?: string; lastModified?: string } = {}, onRetryAfter?: ExecutionContext['onRetryAfter']): Promise<FetchResult> {
    const scope = createExecutionScope({ signal, deadlineAt: deadlineMs, onRetryAfter })
    const start = Date.now()
    const origin = new URL(url).origin
    const previous = this.pendingByOrigin.get(origin) ?? Promise.resolve()
    let release!: () => void
    const ticket = new Promise<void>(resolve => { release = resolve })
    const pending = previous.then(() => ticket)
    this.pendingByOrigin.set(origin, pending)
    try {
      await raceWithSignal(previous, scope.signal)
      throwIfExecutionStopped(scope)
      const result = await this.fetchWithinBudget(url, scope, validators)
      return scope.signal.reason?.name === 'TimeoutError' || deadlineMs !== undefined && Date.now() >= deadlineMs
        ? { ...result, budgetExceeded: 'time' }
        : result
    } catch (error) {
      if (!scope.signal.aborted) throw error
      const result = this.denied(url, start, [], 'timeout')
      return scope.signal.reason?.name === 'TimeoutError' || deadlineMs !== undefined && Date.now() >= deadlineMs ? { ...result, budgetExceeded: 'time' } : result
    } finally {
      scope.dispose()
      release()
      if (this.pendingByOrigin.get(origin) === pending) {
        void pending.then(() => { if (this.pendingByOrigin.get(origin) === pending) this.pendingByOrigin.delete(origin) })
      }
    }
  }

  private async fetchWithinBudget(url: string, execution: ExecutionContext, validators: { etag?: string; lastModified?: string }): Promise<FetchResult> {
    const { signal, deadlineAt, onRetryAfter } = execution
    const start = Date.now()
    const trace: TraceEvent[] = []
    const honest = recordHttpIdentity(this.prepared, trace, 0)
    if (!honest) {
      return this.denied(url, start, trace, 'identity_compromised')
    }

    if (this.prepared.identity.respectsRobots) {
      const cached = await this.robotsCache.lookup(url, this.prepared.identity.userAgent, execution)
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
      if (robotsDecision.decision === 'disallowed') {
        trace.push({
          at: Date.now() - start,
          lane: 'http',
          event: 'robots_disallowed',
          detail: { url, appliedRules: robotsDecision.appliedRules },
        })
        return this.denied(url, start, trace, 'policy_denied')
      }
    }

    if (signal?.aborted) return this.denied(url, start, trace, 'timeout')
    const host = new URL(url).origin
    const cooldownUntil = this.cooldownUntilByHost.get(host) ?? 0
    if (cooldownUntil > Date.now()) {
      const waitMs = cooldownUntil - Date.now()
      trace.push({ at: Date.now() - start, lane: 'http', event: 'host_cooldown_wait', detail: { host, waitMs } })
      if (deadlineAt !== undefined && cooldownUntil >= deadlineAt) {
        trace.push({ at: Date.now() - start, lane: 'http', event: 'retry_deferred', detail: { retryAt: cooldownUntil } })
        return { ...this.denied(url, start, trace, 'timeout'), retryAt: cooldownUntil }
      }
      await abortableSleep(waitMs, signal)
    }
    const out = await resilientFetch(url, this.fetcherFor(url, validators, signal), {
      signal,
      deadlineAt,
      onRetryAfter: (target, retryAt) => {
        for (const origin of new Set([host, new URL(target).origin])) {
          this.cooldownUntilByHost.set(origin, Math.max(this.cooldownUntilByHost.get(origin) ?? 0, retryAt))
        }
        onRetryAfter?.(target, retryAt)
      },
      maxRedirects: this.networkPolicy.maxRedirects,
      assertUrl: (target) => assertSafeUrl(target, this.networkPolicy),
    })
    const wallMs = Date.now() - start
    let retryAt = out.retryAt
    if (out.status === 429 || out.status === 503) {
      const retryAfter = parseRetryAfterMs(out.headers?.get('retry-after') ?? null) ?? 250
      const next = out.retryAt ?? Date.now() + Math.max(retryAfter, 250)
      retryAt = next
      this.cooldownUntilByHost.set(host, Math.max(this.cooldownUntilByHost.get(host) ?? 0, next))
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
    const body = await out.bodyText()
    const rawBodySha256 = sha256Utf8(body)

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
        artifacts: [],
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

    // Transport-level failure (timeout, connection error, redirect loop/limit,
    // non-http(s) redirect target).
    if (out.kind === 'failure') {
      return {
        ...base,
        status: 'failed',
        failureReason: out.failureReason,
        blockReason: null,
        budgetExceeded: null,
        lane: 'http',
        escalations: [],
        markdown: null,
      }
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
      return {
        ...base,
        status: 'blocked',
        failureReason: null,
        blockReason: verdict.reason,
        budgetExceeded: null,
        lane: 'http',
        escalations: next === null ? [] : [{ ...next, improved: null }],
        markdown: null,
      }
    }

    // A gate that answers with a non-200 is a block, not a transient failure.
    // Note the retry policy never retries 429 — the job here is to not hammer.
    if (out.status !== 200 && gate !== null) {
      return blocked(gate)
    }

    if (out.status !== 200) {
      return {
        ...base,
        status: 'failed',
        failureReason: 'http_error',
        blockReason: null,
        budgetExceeded: null,
        lane: 'http',
        escalations: [],
        markdown: null,
      }
    }

    // Same extraction convention as ExtractTfSubject: escalate means the
    // extractor found no main content — report failed/empty_unverified and
    // flag the browser lane, never a contentful success.
    const extracted = extractTf.extract(body)
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
      return {
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
      }
    }

    const decisive = classifyGate({
      status: out.status,
      header: (name) => out.headers?.get(name) ?? null,
      body,
      contentful: true,
    })
    if (decisive !== null) return blocked(decisive)

    const markdown = htmlToMarkdown(extracted.mainHtml)
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

    return {
      ...base,
      status: 'success',
      failureReason: null,
      blockReason: null,
      budgetExceeded: null,
      lane: 'http',
      escalations: [],
      markdown,
      links,
      usage: { ...base.usage, contentTokens },
    }
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
