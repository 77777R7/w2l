/**
 * Native REST contract for scrape + crawl.
 *
 * Request fields match the product CLI. Responses are FetchResult /
 * CrawlReport — no second result enum. Types only.
 */

import type { CrawlMode } from './compliance.js'
import type { CrawlReport } from './crawl.js'
import type { FetchResult } from './result.js'

export const CRAWL_MODES = ['research', 'standard', 'authed'] as const
export type ApiCrawlMode = (typeof CRAWL_MODES)[number]

export interface ScrapeRequest {
  url: string
  mode?: ApiCrawlMode
  allowlistedDomains?: readonly string[]
}

export type ScrapeResponse = FetchResult

export interface CrawlStartRequest {
  url: string
  mode?: ApiCrawlMode
  maxPages?: number | null
  maxDepth?: number | null
  useCached?: boolean
  allowlistedDomains?: readonly string[]
}

export interface CrawlAccepted {
  taskId: string
}

export type CrawlStatusResponse = CrawlReport

export function isApiCrawlMode(value: string): value is ApiCrawlMode {
  return (CRAWL_MODES as readonly string[]).includes(value)
}

export function defaultApiMode(mode: CrawlMode | undefined): ApiCrawlMode {
  return mode === 'research' || mode === 'authed' ? mode : 'standard'
}

export class RequestError extends Error {
  readonly status = 400
  constructor(message: string) {
    super(message)
    this.name = 'RequestError'
  }
}

function asRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError('body must be a JSON object')
  }
  return body as Record<string, unknown>
}

function readUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new RequestError('url is required')
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new RequestError('url must be http(s)')
    }
  } catch (err) {
    if (err instanceof RequestError) throw err
    throw new RequestError('url must be http(s)')
  }
  return value
}

function readMode(value: unknown): ApiCrawlMode | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !isApiCrawlMode(value)) {
    throw new RequestError('mode must be standard, research, or authed')
  }
  return value
}

function readAllowlist(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new RequestError('allowlistedDomains must be an array of strings')
  }
  return value.filter((item) => item.length > 0)
}

function readBound(value: unknown, name: string, min: number): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new RequestError(`${name} must be a number >= ${min}`)
  }
  return value
}

export function parseScrapeRequest(body: unknown): ScrapeRequest {
  const rec = asRecord(body)
  return {
    url: readUrl(rec.url),
    mode: readMode(rec.mode),
    allowlistedDomains: readAllowlist(rec.allowlistedDomains),
  }
}

export function parseCrawlStartRequest(body: unknown): CrawlStartRequest {
  const rec = asRecord(body)
  const useCached = rec.useCached
  if (useCached !== undefined && typeof useCached !== 'boolean') {
    throw new RequestError('useCached must be a boolean')
  }
  return {
    url: readUrl(rec.url),
    mode: readMode(rec.mode),
    maxPages: readBound(rec.maxPages, 'maxPages', 1),
    maxDepth: readBound(rec.maxDepth, 'maxDepth', 0),
    useCached,
    allowlistedDomains: readAllowlist(rec.allowlistedDomains),
  }
}
