import { estimateTokens, type FetchResult } from '@w2l/contracts'
import { extractTf } from '@w2l/extract-tf'
import { toGfmTable } from '@w2l/fixtures'
import { request } from 'undici'
import type { SubjectAdapter } from '../subject.js'

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
      if (status === 200) {
        const out = extractTf.extract(body)
        if (out.escalate) {
          escalated = true
        } else {
          markdown = out.mainHtml.replace(
            /<table\b[\s\S]*?<\/table>/gi,
            (table) => `\n${toGfmTable(table)}\n`,
          )
        }
      }

      return {
        requestedUrl: url,
        status: status !== 200 ? 'failed' : escalated ? 'failed' : 'success',
        failureReason:
          status !== 200 ? 'http_error' : escalated ? 'empty_unverified' : null,
        blockReason: null,
        budgetExceeded: null,
        lane: 'http',
        escalations: escalated
          ? [{ from: 'http', to: 'browser_local', trigger: 'extract_low_confidence', improved: null }]
          : [],
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
