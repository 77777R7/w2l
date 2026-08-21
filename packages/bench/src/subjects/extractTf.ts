import { estimateTokens, type FetchResult } from '@w2l/contracts'
import { extractTf } from '@w2l/extract-tf'
import { toGfmTable } from '@w2l/fixtures'
import { classifyGate, escalationForBlock } from '@w2l/http-core'
import { request } from 'undici'
import type { SubjectAdapter } from '../subject.js'
import { POLITE_UA } from '../ua.js'

/**
 * extract-tf subject: undici fetch + the extract-tf cascade. The first
 * production-shaped arm of the benchmark — real parsing and main-content
 * extraction on top of the same transport as bare-http.
 *
 * Output convention: extract-tf emits main-content HTML (markdown conversion
 * is pipeline step 7, not the extractor's job). For bench scoring, top-level
 * tables are converted to GFM via the fixtures-owned derivation — the same
 * convention the golden-converter arm uses — so the table fixtures can assert
 * structural geometry. Everything else stays HTML.
 */
export class ExtractTfSubject implements SubjectAdapter {
  readonly meta = {
    id: 'extract-tf',
    displayName: 'extract-tf (linkedom cascade)',
    version: '0.1.0',
    hosting: 'self_hosted' as const,
  }

  async fetch(url: string): Promise<FetchResult> {
    const start = Date.now()
    try {
      const response = await request(url, {
        method: 'GET',
        headersTimeout: 10_000,
        bodyTimeout: 30_000,
        headers: { 'user-agent': POLITE_UA },
      })

      const wallMs = Date.now() - start
      const bodyBuffer = await response.body.arrayBuffer()
      const body = new TextDecoder().decode(bodyBuffer)
      const status = response.statusCode

      // Extraction failure is not a fetch failure: an escalate flag means the
      // extractor could not find main content and the page should go to a
      // higher lane. Report it as an unverified empty failure (per contract:
      // suspected-bad emptiness is `failed`, not a contentful success).
      let markdown: string | null = null
      let escalated = false
      let routeEvidence: {
        pageType: string
        strategy: string
        confidence: number
        escalate: boolean
      } | null = null
      if (status === 200) {
        const out = extractTf.extract(body)
        routeEvidence = {
          pageType: out.pageType,
          strategy: out.strategy,
          confidence: out.confidence,
          escalate: out.escalate,
        }
        if (out.escalate) {
          escalated = true
        } else {
          markdown = out.mainHtml.replace(
            /<table\b[\s\S]*?<\/table>/gi,
            (table) => `\n${toGfmTable(table)}\n`,
          )
        }
      }

      // Gate classification. Consulted only once the response is known to be
      // non-contentful (non-200, or a 200 the extractor declined) — that
      // precondition is what makes the marker matching safe.
      const gate = classifyGate({
        status,
        header: (name) => {
          const v = response.headers[name.toLowerCase()]
          return typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? null) : null
        },
        body,
      })
      const verdict = status !== 200 || escalated ? gate : null
      const blockEscalation =
        verdict === null ? null : escalationForBlock(verdict.reason, 'http')

      let terminalStatus: 'success' | 'failed' | 'blocked' = 'success'
      let failureReason: 'http_error' | 'empty_unverified' | null = null
      if (verdict !== null) {
        terminalStatus = 'blocked'
      } else if (status !== 200) {
        terminalStatus = 'failed'
        failureReason = 'http_error'
      } else if (escalated) {
        terminalStatus = 'failed'
        failureReason = 'empty_unverified'
      }

      const escalations =
        verdict !== null
          ? blockEscalation === null
            ? []
            : [{ ...blockEscalation, improved: null }]
          : escalated
            ? [
                {
                  from: 'http' as const,
                  to: 'browser_local' as const,
                  trigger: 'extract_low_confidence',
                  improved: null,
                },
              ]
            : []

      return {
        requestedUrl: url,
        status: terminalStatus,
        failureReason,
        blockReason: verdict?.reason ?? null,
        budgetExceeded: null,
        lane: 'http',
        escalations,
        markdown,
        truncated: false,
        truncatedAt: null,
        evidence: {
          finalUrl: url,
          httpStatus: status,
          redirectChain: [],
          contentType: response.headers['content-type'] as string | null,
          rawBodySha256: null,
          artifacts: [],
        },
        usage: {
          wallMs,
          bytesWire: bodyBuffer.byteLength,
          bytesDecompressed: bodyBuffer.byteLength,
          requestCount: 1,
          attemptCount: 1,
          contentTokens: markdown !== null ? estimateTokens(markdown) : null,
          browserMs: 0,
          externalCostUsd: null,
        },
        trace: [
          { at: 0, lane: 'http', event: 'request_start' },
          { at: wallMs, lane: 'http', event: 'request_complete', detail: { status } },
          ...(routeEvidence !== null
            ? [{ at: wallMs, lane: 'http' as const, event: 'extract', detail: routeEvidence }]
            : []),
          ...(verdict !== null
            ? [
                {
                  at: wallMs,
                  lane: 'http' as const,
                  event: 'gate_detected',
                  detail: { blockReason: verdict.reason, signals: verdict.signals, status },
                },
              ]
            : []),
        ],
      }
    } catch (err) {
      const wallMs = Date.now() - start
      return {
        requestedUrl: url,
        status: 'failed',
        failureReason: 'connection_error',
        blockReason: null,
        budgetExceeded: null,
        lane: 'http',
        escalations: [],
        markdown: null,
        truncated: false,
        truncatedAt: null,
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
          browserMs: 0,
          externalCostUsd: null,
        },
        trace: [
          { at: 0, lane: 'http', event: 'request_start' },
          { at: wallMs, lane: 'http', event: 'request_failed', detail: { error: String(err) } },
        ],
      }
    }
  }

  async teardown(): Promise<void> {}
}
