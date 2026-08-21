import { estimateTokens, type FetchResult, type TraceEvent } from '@w2l/contracts'
import { extractTf } from '@w2l/extract-tf'
import { toGfmTable } from '@w2l/fixtures'
import { resilientFetch, classifyGate, escalationForBlock, type ResilientFetcher } from '@w2l/http-core'
import { request } from 'undici'
import type { SubjectAdapter } from '../subject.js'
import { POLITE_UA } from '../ua.js'

/**
 * Resilient HTTP subject: the resilient transport engine (redirect following
 * + 503 retry, http-core) composed with the extract-tf cascade. This is the
 * production-shaped arm — BareHttpSubject stays the untouched floor.
 *
 * Transport semantics come from resilientFetch; extraction and the markdown
 * convention (mainHtml + fixtures-owned GFM table derivation) are identical
 * to ExtractTfSubject, so any score delta against that arm is attributable
 * to transport resilience alone.
 */
export class ResilientHttpSubject implements SubjectAdapter {
  readonly meta = {
    id: 'resilient-http',
    displayName: 'Resilient HTTP (redirect+retry × extract-tf)',
    version: '0.1.0',
    hosting: 'self_hosted' as const,
  }

  async fetch(url: string): Promise<FetchResult> {
    const start = Date.now()
    const out = await resilientFetch(url, undiciFetcher)
    const wallMs = Date.now() - start

    const trace: TraceEvent[] = out.trace.map((t) => ({
      at: t.at,
      lane: 'http',
      event: t.event,
      ...(t.detail !== undefined ? { detail: t.detail } : {}),
    }))

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
    trace.push({
      at: wallMs,
      lane: 'http',
      event: 'extract',
      detail: {
        pageType: extracted.pageType,
        strategy: extracted.strategy,
        confidence: extracted.confidence,
        escalate: extracted.escalate,
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
      lane: 'http',
      escalations: [],
      markdown,
      usage: { ...base.usage, contentTokens: estimateTokens(markdown) },
    }
  }

  async teardown(): Promise<void> {}
}

/**
 * undici adapter for the engine. Bodies are always buffered so redirect-hop
 * responses never hold their connection open waiting for a reader.
 */
const undiciFetcher: ResilientFetcher = async (url, init) => {
  // undici request() never follows redirects itself — the engine owns the
  // redirect policy, this adapter is one wire request.
  const response = await request(url, {
    method: 'GET',
    headersTimeout: init.headersTimeoutMs,
    bodyTimeout: init.bodyTimeoutMs,
    headers: { 'user-agent': POLITE_UA },
  })
  const buf = await response.body.arrayBuffer()
  const headers = response.headers
  return {
    status: response.statusCode,
    headers: {
      get: (name: string) => {
        const v = headers[name.toLowerCase()]
        return typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? null) : null
      },
    },
    bodyText: async () => new TextDecoder().decode(buf),
  }
}
