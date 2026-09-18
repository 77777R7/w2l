/**
 * Firecrawl v1 scrape/crawl snapshot, frozen 2026-09-18.
 *
 * A one-shot migration shim: map the two main paths onto the native
 * contract. Not a compatibility layer. Unknown fields are ignored.
 */

import type { CrawlAccepted, CrawlStartRequest, ScrapeRequest } from './api.js'
import { parseCrawlStartRequest, parseScrapeRequest, RequestError } from './api.js'
import type { CrawlReport } from './crawl.js'
import type { FetchResult } from './result.js'
import type { StepRecord, TaskStatus } from './checkpoint.js'

export const FIRECRAWL_SHIM_SNAPSHOT = {
  capturedAt: '2026-09-18',
  apiVersion: 'v1' as const,
  docs: {
    scrape: 'https://docs.firecrawl.dev/api-reference/v1-endpoint/scrape',
    crawl: 'https://docs.firecrawl.dev/api-reference/v1-endpoint/crawl-post',
    crawlStatus: 'https://docs.firecrawl.dev/api-reference/v1-endpoint/crawl-get',
  },
  paths: ['/scrape', '/crawl', '/crawl/:id'] as const,
  notCovered: ['search', 'interact', 'agent', 'monitor', 'map', 'extract'] as const,
}

export const FIRECRAWL_SHIM_DIFFS = [
  'Challenge / block pages are success: false (Firecrawl often returns them as success markdown).',
  'No fire-engine, proxy pools, actions, JSON extract, or screenshots.',
  'Resume / cache defaults to refetch (useCached is never set from a Firecrawl body).',
  'Omitted limit / maxDepth stay unbounded; Firecrawl defaults are 10000 / 10.',
  'Crawl start is mapped onto native POST /v1/crawl; the shim itself returns 200 {success,id,url}.',
  'creditsUsed is always 0. Formats other than markdown/links are dropped.',
] as const

export interface FirecrawlPage {
  markdown: string | null
  links?: string[]
  metadata: {
    sourceURL: string
    statusCode: number | null
    error?: string
  }
}

export interface FirecrawlScrapeResponse {
  success: boolean
  data: FirecrawlPage
  error?: string
}

export interface FirecrawlCrawlStarted {
  success: true
  id: string
  url: string
}

export type FirecrawlCrawlJobStatus = 'scraping' | 'completed' | 'failed'

export interface FirecrawlCrawlStatus {
  status: FirecrawlCrawlJobStatus
  total: number
  completed: number
  creditsUsed: number
  expiresAt: string
  next: string | null
  data: FirecrawlPage[]
}

export function parseFirecrawlScrapeRequest(body: unknown): ScrapeRequest {
  const rec = asRecord(body)
  return parseScrapeRequest({ url: rec.url })
}

export function parseFirecrawlCrawlRequest(body: unknown): CrawlStartRequest {
  const rec = asRecord(body)
  const native: Record<string, unknown> = { url: rec.url }
  if (rec.limit !== undefined) native.maxPages = rec.limit
  if (rec.maxDepth !== undefined) native.maxDepth = rec.maxDepth
  return parseCrawlStartRequest(native)
}

export function wrapScrape(result: FetchResult): FirecrawlScrapeResponse {
  const data = firecrawlPage(result)
  if (result.status === 'success' || result.status === 'partial') {
    return { success: true, data }
  }
  return { success: false, error: scrapeError(result), data }
}

export function wrapCrawlAccepted(native: CrawlAccepted, seedUrl: string): FirecrawlCrawlStarted {
  return { success: true, id: native.taskId, url: seedUrl }
}

export function wrapCrawlStatus(report: CrawlReport, steps: readonly StepRecord[]): FirecrawlCrawlStatus {
  const data: FirecrawlPage[] = []
  for (const step of steps) {
    if (step.result !== null) data.push(firecrawlPage(step.result))
  }
  return {
    status: firecrawlCrawlStatus(report.status),
    total: steps.length,
    completed: report.pagesFetched,
    creditsUsed: 0,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    next: null,
    data,
  }
}

function asRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError('body must be a JSON object')
  }
  return body as Record<string, unknown>
}

function firecrawlPage(result: FetchResult): FirecrawlPage {
  const error =
    result.status === 'blocked'
      ? (result.blockReason ?? 'blocked')
      : result.status === 'failed'
        ? (result.failureReason ?? 'failed')
        : result.status === 'budget_exceeded'
          ? (result.budgetExceeded ?? 'budget_exceeded')
          : result.status === 'success' || result.status === 'partial'
            ? undefined
            : result.status
  return {
    markdown: result.markdown,
    ...(result.links !== undefined ? { links: [...result.links] } : {}),
    metadata: {
      sourceURL: result.requestedUrl,
      statusCode: result.evidence.httpStatus,
      ...(error !== undefined ? { error } : {}),
    },
  }
}

function scrapeError(result: FetchResult): string {
  if (result.status === 'blocked') return `blocked: ${result.blockReason ?? 'unknown'}`
  if (result.status === 'failed') return `failed: ${result.failureReason ?? 'unknown'}`
  if (result.status === 'budget_exceeded') return `budget_exceeded: ${result.budgetExceeded ?? 'unknown'}`
  return result.status
}

function firecrawlCrawlStatus(status: TaskStatus): FirecrawlCrawlJobStatus {
  if (status === 'completed') return 'completed'
  if (status === 'failed' || status === 'cancelled') return 'failed'
  return 'scraping'
}
