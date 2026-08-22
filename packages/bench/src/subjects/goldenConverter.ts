import { estimateTokens, type FetchResult } from '@w2l/contracts'
import { toGfmTable } from '@w2l/fixtures'
import { request } from 'undici'
import type { SubjectAdapter } from '../subject.js'
import { POLITE_UA } from '../ua.js'

/**
 * Golden converter: fetches the raw HTML, strips the page chrome down to the
 * <article> (or <main>) element, converts any top-level <table> it contains to
 * GFM via the fixture-owned derivation, and estimates the token count.
 *
 * This is the reference implementation the table fixtures are scored against:
 * it must achieve a perfect false-success score, which in turn validates that
 * the expectedTable annotations are actually reachable by a conforming
 * converter. Everything outside <article>/<main> (nav, sidebar, cookie banner,
 * footer) is dropped, which is what the mustNotContain boilerplate checks.
 */
export class GoldenConverterSubject implements SubjectAdapter {
  readonly meta = {
    id: 'golden-converter',
    displayName: 'Golden converter (article + toGfmTable)',
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
        headers: { 'user-agent': POLITE_UA },
      })

      const wallMs = Date.now() - start
      const bodyBuffer = await response.body.arrayBuffer()
      const body = new TextDecoder().decode(bodyBuffer)
      const status = response.statusCode

      const markdown = status === 200 ? extract(body) : null

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
    }
  }

  async teardown(): Promise<void> {}
}

function extract(body: string): string {
  // Prefer the outermost <main> container when one exists, so nested content
  // (forum posts inside main, spec tables + paragraphs inside main) survives
  // whole. Pages without <main> fall back to the first <article>.
  const main =
    /<main\b[\s\S]*?<\/main>/i.exec(body)?.[0] ??
    /<article\b[\s\S]*?<\/article>/i.exec(body)?.[0] ??
    // Fallback for pages without a main-content element: the whole body minus
    // the known boilerplate (the CMP-pruning shape the real pipeline applies
    // before extraction).
    body
      .replace(/<div[^>]*id="cookie-consent"[\s\S]*?<\/div>/gi, '')
      .replace(/<(?:nav|aside|footer)\b[\s\S]*?<\/(?:nav|aside|footer)>/gi, '')
  if (!main) return ''
  const clamped = clampSpans(main)
  const withTables = clamped.replace(
    /<table\b[\s\S]*?<\/table>/gi,
    (table) => `\n${toGfmTable(table)}\n`,
  )
  return stripTags(withTables)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Normalization clamp: a span must never be able to amplify one cell into
 * tens of thousands of output cells. Each row's colspans are clamped so the
 * row's logical width stays within 2x its raw cell count. The real extractor
 * clamps against the table's actual column count (pipeline step 6); this
 * bounds the reference converter itself.
 */
function clampSpans(html: string): string {
  return html.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const cells = row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []
    const cap = Math.max(1, cells.length * 2)
    return row.replace(/colspan\s*=\s*["']?(\d+)/gi, (attr, n) => {
      const v = Math.min(Math.max(1, Number(n)), cap)
      return attr.replace(/\d+/, String(v))
    })
  })
}

function stripTags(html: string): string {
  return html
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => {
      const hashes = '#'.repeat(Number(level))
      return `\n${hashes} ${stripTags(text)}\n`
    })
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `\n- ${stripTags(text)}`)
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `\n${stripTags(text)}\n`)
    .replace(/<[^>]+>/g, '')
}
