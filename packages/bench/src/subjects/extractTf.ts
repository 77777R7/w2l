import { createExecutionScope, remainingTimeout, throwIfExecutionStopped } from '@w2l/http-core'
import { estimateTokens, type CrawlMode, type DocumentExtraction, type FetchResult, type TraceEvent } from '@w2l/contracts'
import { extractTf, htmlToMarkdown } from '@w2l/extract-tf'
import { classifyGate, escalationForBlock } from '@w2l/http-core'
import { request } from 'undici'
import { prepareHttpIdentity, recordHttpIdentity } from '../httpIdentity.js'
import type { SubjectAdapter } from '../subject.js'

/**
 * extract-tf subject: undici fetch + the extract-tf cascade. The first
 * production-shaped arm of the benchmark — real parsing and main-content
 * extraction on top of the same transport as bare-http.
 *
   * Output convention: extract-tf emits main-content HTML; htmlToMarkdown is
   * pipeline step 7. Tables stay GFM so the fixture suite can score geometry.
 */
export class ExtractTfSubject implements SubjectAdapter {
  readonly meta = {
    id: 'extract-tf',
    displayName: 'extract-tf (linkedom cascade)',
    version: '0.1.0',
    hosting: 'self_hosted' as const,
  }

  private readonly prepared: ReturnType<typeof prepareHttpIdentity>

  constructor(mode: CrawlMode = 'standard') {
    this.prepared = prepareHttpIdentity(mode)
  }

  async fetch(url: string, deadlineMs?: number, signal?: AbortSignal): Promise<FetchResult> {
    const scope = createExecutionScope({ signal, deadlineAt: deadlineMs })
    const start = Date.now()
    try {
      throwIfExecutionStopped(scope)
      const response = await request(url, {
        method: 'GET',
        signal: scope.signal,
        headersTimeout: remainingTimeout(scope, 10_000),
        bodyTimeout: remainingTimeout(scope, 30_000),
        headers: this.prepared.headers,
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
      let document: DocumentExtraction | null = null
      let escalated = false
      let routeEvidence: {
        pageType: string
        strategy: string
        confidence: number
        escalate: boolean
      } | null = null
      if (status === 200) {
        const out = extractTf.extract(body, { url })
        document = {
          title: out.title,
          pageType: out.pageType,
          strategy: out.strategy,
          confidence: out.confidence,
          product: out.product ?? null,
          adapter: out.adapter,
          entities: out.entities,
        }
        routeEvidence = {
          pageType: out.pageType,
          strategy: out.strategy,
          confidence: out.confidence,
          escalate: out.escalate,
        }
        if (out.escalate) {
          escalated = true
        } else {
          markdown = htmlToMarkdown(out.mainHtml)
        }
      }

      const header = (name: string) => {
        const v = response.headers[name.toLowerCase()]
        return typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? null) : null
      }
      const gate = classifyGate({ status, header, body })
      const decisive =
        status === 200 && !escalated ? classifyGate({ status, header, body, contentful: true }) : null
      const verdict = status !== 200 || escalated ? gate : decisive
      const blockEscalation =
        verdict === null ? null : escalationForBlock(verdict.reason, 'http')

      let terminalStatus: 'success' | 'failed' | 'blocked' = 'success'
      let failureReason: 'http_error' | 'empty_unverified' | null = null
      if (verdict !== null) {
        terminalStatus = 'blocked'
        markdown = null
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

      const trace: TraceEvent[] = [
        { at: 0, lane: 'http', event: 'request_start' },
        { at: wallMs, lane: 'http', event: 'request_complete', detail: { status } },
      ]
      const honest = recordHttpIdentity(this.prepared, trace, wallMs)
      if (routeEvidence !== null) {
        trace.push({ at: wallMs, lane: 'http', event: 'extract', detail: routeEvidence })
      }
      if (verdict !== null) {
        trace.push({
          at: wallMs,
          lane: 'http',
          event: 'gate_detected',
          detail: { blockReason: verdict.reason, signals: verdict.signals, status },
        })
      }

      if (!honest) {
        return {
          requestedUrl: url,
          status: 'failed',
          failureReason: 'identity_compromised',
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
            contentTokens: null,
            browserMs: 0,
            externalCostUsd: null,
          },
          trace,
        }
      }

      return {
        requestedUrl: url,
        status: terminalStatus,
        failureReason,
        blockReason: verdict?.reason ?? null,
        budgetExceeded: null,
        lane: 'http',
        escalations,
        markdown,
        document,
        truncated: false,
        truncatedAt: null,
        compliance: null,
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
        trace,
      }
    } catch (err) {
      const wallMs = Date.now() - start
      return {
        requestedUrl: url,
        status: 'failed',
        failureReason: scope.signal.aborted ? 'timeout' : 'connection_error',
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
    } finally { scope.dispose() }
  }

  async teardown(): Promise<void> {}
}
