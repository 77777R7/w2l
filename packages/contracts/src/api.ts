/**
 * Native REST contract for scrape + crawl.
 *
 * Request fields match the product CLI. Responses are FetchResult /
 * CrawlReport — no second result enum. Types only.
 */

import type { CrawlMode } from './compliance.js'
import type { CrawlError, CrawlPage, CrawlPageList, CrawlReport } from './crawl.js'
import type { FetchResult, LadderRunAudit } from './result.js'
import type { DocumentExtraction } from './extractor.js'
import type { ScrapeFormat, StructuredExtractionResult } from './structured.js'

export const CRAWL_MODES = ['research', 'standard', 'authed'] as const
export type ApiCrawlMode = (typeof CRAWL_MODES)[number]

export interface ScrapeRequest {
  url: string
  mode?: ApiCrawlMode
  allowlistedDomains?: readonly string[]
  formats?: readonly ScrapeFormat[]
  /** Include outbound links. Kept separate from content formats. */
  includeLinks?: boolean
  /** Omitted preserves the legacy full REST/SDK response. MCP sends false by default. */
  debug?: boolean
}

export type ScrapeResponse = FetchResult & LadderRunAudit

export interface CompactScrapeResponse {
  requestedUrl: string
  finalUrl: string
  /** Small capture identity for field audits; the HTML body remains local. */
  snapshot: { rawBodySha256: string | null; artifacts: readonly string[]; httpStatus: number | null }
  status: FetchResult['status']
  failureReason: FetchResult['failureReason']
  blockReason: FetchResult['blockReason']
  budgetExceeded: FetchResult['budgetExceeded']
  retryAt?: number
  lane: FetchResult['lane']
  formats: readonly ('markdown' | 'links' | 'json')[]
  markdown?: string | null
  links?: readonly string[]
  document?: Pick<DocumentExtraction, 'title' | 'pageType' | 'strategy' | 'confidence' | 'adapter' | 'adapterValidation'> | null
  json?: StructuredExtractionResult | null
  truncated: boolean
  truncatedAt: number | null
  usage: FetchResult['usage'] & { totalMs: number }
  channelsTried: readonly string[]
}

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

export interface BatchStartRequest {
  urls: readonly string[]
  mode?: ApiCrawlMode
  formats?: readonly ScrapeFormat[]
  includeLinks?: boolean
}

export interface BatchStatusResponse extends CrawlReport {
  requested: number
  completed: number
  remaining: number
}

export type CrawlStatusResponse = CrawlReport
export interface CrawlPageQuery {
  attemptId?: string
  cursor?: string
  limit?: number
  debug?: boolean
}
export type CrawlPagesResponse = CrawlPageList<CrawlPage>
export type CrawlErrorsResponse = CrawlPageList<CrawlError>

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

const SCHEMA_KEYS = new Set(['$ref', 'type', 'properties', 'required', 'items', 'enum', 'description', 'additionalProperties', '$defs'])
const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

function readSchema(value: unknown): import('./structured.js').JsonSchema {
  const bytes = new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength
  if (bytes > 64 * 1024) throw new RequestError('json schema must be at most 64 KiB')
  let properties = 0
  const visit = (node: unknown, depth: number): void => {
    if (depth > 8) throw new RequestError('json schema must be at most 8 levels deep')
    if (node === null || typeof node !== 'object' || Array.isArray(node)) throw new RequestError('json schema nodes must be objects')
    const rec = node as Record<string, unknown>
    for (const key of Object.keys(rec)) if (!SCHEMA_KEYS.has(key)) throw new RequestError(`unsupported json schema keyword: ${key}`)
    if (rec.$ref !== undefined && (typeof rec.$ref !== 'string' || !rec.$ref.startsWith('#/'))) throw new RequestError('json schema only supports local $ref')
    if (rec.type !== undefined) {
      const types = Array.isArray(rec.type) ? rec.type : [rec.type]
      if (types.some(type => typeof type !== 'string' || !SCHEMA_TYPES.has(type))) throw new RequestError('json schema contains an unsupported type')
    }
    if (rec.required !== undefined && (!Array.isArray(rec.required) || rec.required.some(item => typeof item !== 'string'))) throw new RequestError('json schema required must be an array of strings')
    if (rec.enum !== undefined && !Array.isArray(rec.enum)) throw new RequestError('json schema enum must be an array')
    if (rec.description !== undefined && typeof rec.description !== 'string') throw new RequestError('json schema description must be a string')
    if (rec.properties !== undefined) {
      if (rec.properties === null || typeof rec.properties !== 'object' || Array.isArray(rec.properties)) throw new RequestError('json schema properties must be an object')
      for (const child of Object.values(rec.properties as Record<string, unknown>)) { properties++; visit(child, depth + 1) }
    }
    if (properties > 100) throw new RequestError('json schema must contain at most 100 properties')
    if (rec.items !== undefined) visit(rec.items, depth + 1)
    if (typeof rec.additionalProperties === 'object' && rec.additionalProperties !== null) visit(rec.additionalProperties, depth + 1)
    if (rec.$defs !== undefined) {
      if (rec.$defs === null || typeof rec.$defs !== 'object' || Array.isArray(rec.$defs)) throw new RequestError('json schema $defs must be an object')
      for (const child of Object.values(rec.$defs as Record<string, unknown>)) visit(child, depth + 1)
    }
  }
  visit(value, 0)
  return value as import('./structured.js').JsonSchema
}

function readFormats(value: unknown): readonly ScrapeFormat[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) throw new RequestError('formats must contain 1 to 3 entries')
  const formats: ScrapeFormat[] = []
  const logical = new Set<string>()
  for (const item of value) {
    if (item === 'markdown' || item === 'links' || item === 'json') {
      if (logical.has(item)) throw new RequestError('formats must not contain duplicates')
      logical.add(item)
      formats.push(item)
      continue
    }
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new RequestError('formats entries must be markdown, links, json, or a json schema request')
    const rec = item as Record<string, unknown>
    for (const key of Object.keys(rec)) if (!['type', 'schema', 'prompt', 'modelFallback'].includes(key)) throw new RequestError(`unsupported json format option: ${key}`)
    if (rec.type !== 'json' || rec.schema === undefined) throw new RequestError('json format requires type=json and schema')
    if (logical.has('json')) throw new RequestError('formats must contain at most one json entry')
    if (rec.prompt !== undefined && (typeof rec.prompt !== 'string' || rec.prompt.length > 4000)) throw new RequestError('json prompt must be a string of at most 4000 characters')
    if (rec.modelFallback !== undefined && typeof rec.modelFallback !== 'boolean') throw new RequestError('json modelFallback must be a boolean')
    logical.add('json')
    formats.push({
      type: 'json' as const,
      schema: readSchema(rec.schema),
      ...(rec.prompt === undefined ? {} : { prompt: rec.prompt }),
      ...(rec.modelFallback === undefined ? {} : { modelFallback: rec.modelFallback }),
    })
  }
  return formats
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
  if (rec.debug !== undefined && typeof rec.debug !== 'boolean') throw new RequestError('debug must be a boolean')
  if (rec.includeLinks !== undefined && typeof rec.includeLinks !== 'boolean') throw new RequestError('includeLinks must be a boolean')
  return {
    url: readUrl(rec.url),
    mode: readMode(rec.mode),
    allowlistedDomains: readAllowlist(rec.allowlistedDomains),
    formats: readFormats(rec.formats),
    includeLinks: rec.includeLinks as boolean | undefined,
    debug: rec.debug as boolean | undefined,
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

export function parseBatchStartRequest(body: unknown): BatchStartRequest {
  const rec = asRecord(body)
  if (!Array.isArray(rec.urls) || rec.urls.length < 1 || rec.urls.length > 1000) {
    throw new RequestError('urls must contain 1 to 1000 URLs')
  }
  const urls = rec.urls.map(readUrl)
  if (new Set(urls.map(url => new URL(url).href)).size !== urls.length) throw new RequestError('urls must be unique')
  if (rec.includeLinks !== undefined && typeof rec.includeLinks !== 'boolean') throw new RequestError('includeLinks must be a boolean')
  return { urls, mode: readMode(rec.mode), formats: readFormats(rec.formats), includeLinks: rec.includeLinks as boolean | undefined }
}

export function parseCrawlPageQuery(query: Record<string, string | undefined>): CrawlPageQuery {
  const limitValue = query.limit
  const limit = limitValue === undefined ? undefined : Number(limitValue)
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) {
    throw new RequestError('limit must be an integer between 1 and 1000')
  }
  if (query.cursor !== undefined && query.cursor.length === 0) throw new RequestError('cursor must not be empty')
  if (query.attemptId !== undefined && query.attemptId.length === 0) throw new RequestError('attemptId must not be empty')
  if (query.debug !== undefined && query.debug !== 'true' && query.debug !== 'false') throw new RequestError('debug must be true or false')
  return { cursor: query.cursor, limit, attemptId: query.attemptId, debug: query.debug === undefined ? undefined : query.debug === 'true' }
}
