import {
  estimateTokens,
  QUALITY_ESCALATION_MAX_CONFIDENCE,
  QUALITY_ESCALATION_MAX_TOKENS,
  type CrawlMode,
  type FetchResult,
  type TraceEvent,
} from '@w2l/contracts'
import { collectLinks, extractTf, htmlToMarkdown } from '@w2l/extract-tf'
import { resilientFetch, classifyGate, escalationForBlock, type ResilientFetcher } from '@w2l/http-core'
import { request } from 'undici'
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
  private readonly fetcher: ResilientFetcher
  private readonly robotsCache = new RobotsOriginCache()

  constructor(mode: CrawlMode = 'standard') {
    this.prepared = prepareHttpIdentity(mode)
    const headers = this.prepared.headers
    this.fetcher = async (url, init) => {
      const response = await request(url, {
        method: 'GET',
        headersTimeout: init.headersTimeoutMs,
        bodyTimeout: init.bodyTimeoutMs,
        headers,
      })
      const buf = await response.body.arrayBuffer()
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

  async fetch(url: string): Promise<FetchResult> {
    const start = Date.now()
    const trace: TraceEvent[] = []
    const honest = recordHttpIdentity(this.prepared, trace, 0)
    if (!honest) {
      return this.denied(url, start, trace, 'identity_compromised')
    }

    if (this.prepared.identity.respectsRobots) {
      const cached = await this.robotsCache.lookup(url, this.prepared.identity.userAgent)
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

    const out = await resilientFetch(url, this.fetcher)
    const wallMs = Date.now() - start
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

    const base = {
      requestedUrl: url,
      truncated: false,
      truncatedAt: null,
      compliance: null,
      evidence: {
        finalUrl: out.finalUrl,
        httpStatus: out.status,
        redirectChain,
        contentType: out.headers?.get('content-type') ?? null,
        rawBodySha256: null,
        artifacts: [],
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

    // Gate classification. Computed once from the raw body, but only ever
    // *consulted* on non-contentful paths — that precondition is what makes
    // the marker matching safe (see classifyGate).
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
      // A 200 that yields no main content may be a gate that answered with
      // the challenge instead of the page. Extraction has now declined it, so
      // the response is non-contentful and the classifier's precondition holds.
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

  private denied(url: string, start: number, trace: TraceEvent[], failureReason: 'identity_compromised' | 'policy_denied'): FetchResult {
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
