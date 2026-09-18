import { describe, expect, it } from 'vitest'
import { CRAWL_MODES, defaultApiMode, isApiCrawlMode } from '../src/index.js'
import type { CrawlAccepted, CrawlStartRequest, ScrapeRequest, ScrapeResponse } from '../src/index.js'

describe('REST contract: scrape + crawl reuse existing result types', () => {
  it('accepts the CLI modes and not proxy', () => {
    expect([...CRAWL_MODES]).toEqual(['research', 'standard', 'authed'])
    expect(isApiCrawlMode('standard')).toBe(true)
    expect(isApiCrawlMode('proxy')).toBe(false)
    expect(defaultApiMode('proxy')).toBe('standard')
  })

  it('scrape request is url + optional mode/allowlist', () => {
    const req: ScrapeRequest = { url: 'https://example.com/' }
    expect(req.url).toBe('https://example.com/')
  })

  it('crawl start request matches CLI flags without inventing a second status enum', () => {
    const req: CrawlStartRequest = {
      url: 'https://example.com/',
      maxPages: 20,
      maxDepth: 2,
      useCached: false,
      allowlistedDomains: ['example.com'],
    }
    const accepted: CrawlAccepted = { taskId: 'task-1' }
    expect(accepted.taskId).toBe('task-1')
    expect(req.maxPages).toBe(20)
  })

  it('scrape response is a FetchResult, not a wrapper status', () => {
    const sample: Pick<ScrapeResponse, 'status' | 'markdown'> = { status: 'success', markdown: 'x' }
    expect(sample.status).toBe('success')
  })
})
