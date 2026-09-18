import { describe, expect, it } from 'vitest'
import { parseCrawlStartRequest, parseScrapeRequest, RequestError } from '@w2l/contracts'

describe('REST request parsing', () => {
  it('accepts a scrape URL and optional CLI-aligned fields', () => {
    expect(parseScrapeRequest({ url: 'https://example.com/', mode: 'research' })).toEqual({
      url: 'https://example.com/',
      mode: 'research',
      allowlistedDomains: undefined,
    })
  })

  it('rejects missing or non-http URLs', () => {
    expect(() => parseScrapeRequest({})).toThrow(RequestError)
    expect(() => parseScrapeRequest({ url: 'ftp://x' })).toThrow(/http/)
  })

  it('parses crawl start flags without inventing extra fields', () => {
    expect(
      parseCrawlStartRequest({
        url: 'https://example.com/',
        maxPages: 20,
        maxDepth: 2,
        useCached: false,
        allowlistedDomains: ['example.com'],
      }),
    ).toMatchObject({ maxPages: 20, maxDepth: 2, useCached: false })
  })
})
