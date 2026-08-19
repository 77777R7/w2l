import type { FetchResult } from '@w2l/contracts'
import { request } from 'undici'
import type { SubjectAdapter } from '../subject.js'

/**
 * Bare HTTP baseline: undici fetch with zero resilience, no browser,
 * no retry, no content extraction. Returns raw HTML as markdown.
 * This is the floor — every real implementation should beat it.
 */
export class BareHttpSubject implements SubjectAdapter {
  readonly meta = {
    id: 'bare-http',
    displayName: 'Bare HTTP (undici)',
    version: '1.0.0',
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

      // Bare HTTP treats everything as success if it got bytes back.
      // No extraction, no false-success filtering — that's the point.
      const markdown = status === 200 ? body : null

      return {
        requestedUrl: url,
        status: status === 200 ? 'success' : 'failed',
        failureReason: status !== 200 ? 'http_error' : null,
        blockReason: null,
        budgetExceeded: null,
        lane: 'http',
        escalations: [],
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
          contentTokens: null,
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

  async teardown(): Promise<void> {
    // undici connection pool cleanup is automatic
  }
}
