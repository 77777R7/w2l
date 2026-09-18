import { describe, expect, it } from 'vitest'
import type { CrawlReport, FetchResult, StepRecord } from '../src/index.js'
import {
  FIRECRAWL_SHIM_DIFFS,
  FIRECRAWL_SHIM_SNAPSHOT,
  parseFirecrawlCrawlRequest,
  parseFirecrawlScrapeRequest,
  RequestError,
  wrapCrawlAccepted,
  wrapCrawlStatus,
  wrapScrape,
} from '../src/index.js'

function page(partial: Partial<FetchResult> & Pick<FetchResult, 'status' | 'requestedUrl'>): FetchResult {
  return {
    failureReason: null,
    blockReason: null,
    budgetExceeded: null,
    lane: 'http',
    escalations: [],
    handoff: null,
    markdown: null,
    truncated: false,
    truncatedAt: null,
    compliance: null,
    evidence: {
      finalUrl: partial.requestedUrl,
      httpStatus: 200,
      redirectChain: [],
      contentType: 'text/html',
      rawBodySha256: null,
      artifacts: [],
    },
    usage: {
      wallMs: 10,
      bytesWire: 1,
      bytesDecompressed: 1,
      requestCount: 1,
      attemptCount: 1,
      contentTokens: null,
      browserMs: 0,
      externalCostUsd: null,
    },
    trace: [],
    ...partial,
  }
}

describe('Firecrawl v1 shim snapshot 2026-09-18', () => {
  it('freezes scrape/crawl only and lists the known diffs', () => {
    expect(FIRECRAWL_SHIM_SNAPSHOT.capturedAt).toBe('2026-09-18')
    expect(FIRECRAWL_SHIM_SNAPSHOT.apiVersion).toBe('v1')
    expect([...FIRECRAWL_SHIM_SNAPSHOT.paths]).toEqual(['/scrape', '/crawl', '/crawl/:id'])
    expect([...FIRECRAWL_SHIM_SNAPSHOT.notCovered]).toEqual([
      'search',
      'interact',
      'agent',
      'monitor',
      'map',
      'extract',
    ])
    expect(FIRECRAWL_SHIM_DIFFS.some((d) => /challenge/i.test(d))).toBe(true)
    expect(FIRECRAWL_SHIM_DIFFS.some((d) => /fire-engine/i.test(d))).toBe(true)
    expect(FIRECRAWL_SHIM_DIFFS.some((d) => /refetch|useCached/i.test(d))).toBe(true)
  })

  it('maps url + limit + maxDepth and ignores Firecrawl extras', () => {
    expect(parseFirecrawlScrapeRequest({ url: 'https://example.com/', formats: ['markdown'], actions: [] })).toEqual({
      url: 'https://example.com/',
      mode: undefined,
      allowlistedDomains: undefined,
    })
    expect(
      parseFirecrawlCrawlRequest({
        url: 'https://example.com/listing',
        limit: 4,
        maxDepth: 2,
        useCached: true,
        proxy: 'stealth',
        scrapeOptions: { formats: ['html'] },
      }),
    ).toEqual({
      url: 'https://example.com/listing',
      mode: undefined,
      maxPages: 4,
      maxDepth: 2,
      useCached: undefined,
      allowlistedDomains: undefined,
    })
  })

  it('rejects a missing url the same way the native parser does', () => {
    expect(() => parseFirecrawlScrapeRequest({})).toThrow(RequestError)
    expect(() => parseFirecrawlCrawlRequest({ limit: 3 })).toThrow(/url/)
  })

  it('does not wrap a challenge page as success', () => {
    const wrapped = wrapScrape(
      page({
        requestedUrl: 'https://example.com/challenge',
        status: 'blocked',
        blockReason: 'cloudflare_challenge',
        evidence: {
          finalUrl: 'https://example.com/challenge',
          httpStatus: 403,
          redirectChain: [],
          contentType: 'text/html',
          rawBodySha256: null,
          artifacts: [],
        },
      }),
    )
    expect(wrapped.success).toBe(false)
    expect(wrapped.error).toMatch(/cloudflare_challenge/)
    expect(wrapped.data.metadata.error).toBe('cloudflare_challenge')
  })

  it('wraps a contentful scrape and a crawl start onto the Firecrawl envelope', () => {
    const scrape = wrapScrape(
      page({
        requestedUrl: 'https://example.com/listing',
        status: 'success',
        markdown: 'Harbour lantern catalog',
        links: ['https://example.com/item/1'],
      }),
    )
    expect(scrape).toEqual({
      success: true,
      data: {
        markdown: 'Harbour lantern catalog',
        links: ['https://example.com/item/1'],
        metadata: { sourceURL: 'https://example.com/listing', statusCode: 200 },
      },
    })
    expect(wrapCrawlAccepted({ taskId: 'task-1' }, 'https://example.com/listing')).toEqual({
      success: true,
      id: 'task-1',
      url: 'https://example.com/listing',
    })
  })

  it('projects crawl steps into Firecrawl status data without inventing credits', () => {
    const report: CrawlReport = {
      taskId: 'task-1',
      attemptId: 'attempt-1',
      status: 'completed',
      pagesFetched: 1,
      cachedPages: 0,
      budgetExceeded: null,
      loopDetected: false,
    }
    const steps: StepRecord[] = [
      {
        id: 'step-1',
        taskId: 'task-1',
        attemptId: 'attempt-1',
        url: 'https://example.com/listing',
        canonicalUrl: 'https://example.com/listing',
        depth: 0,
        status: 'success',
        lane: 'http',
        contentHash: 'abc',
        cached: false,
        result: page({
          requestedUrl: 'https://example.com/listing',
          status: 'success',
          markdown: 'MAIN',
        }),
        createdAt: '2026-09-18T00:00:00.000Z',
        updatedAt: '2026-09-18T00:00:00.000Z',
      },
    ]
    const status = wrapCrawlStatus(report, steps)
    expect(status.status).toBe('completed')
    expect(status.total).toBe(1)
    expect(status.completed).toBe(1)
    expect(status.creditsUsed).toBe(0)
    expect(status.next).toBeNull()
    expect(status.data[0]?.markdown).toBe('MAIN')
  })
})
