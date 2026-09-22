/**
 * MCP tool dispatch over the native REST contract.
 * No resources, no OAuth, no second result type.
 */

import { parseBatchStartRequest, parseCrawlStartRequest, parseScrapeRequest } from '@w2l/contracts'
import type { W2L } from '@w2l/sdk'

export const TOOL_NAMES = ['scrape', 'crawl', 'get_crawl', 'get_crawl_pages', 'get_crawl_errors', 'cancel_crawl', 'batch_scrape', 'get_batch', 'get_batch_items', 'wait_batch', 'cancel_batch'] as const
export type ToolName = (typeof TOOL_NAMES)[number]

export const TOOLS = [
  {
    name: 'scrape',
    description: 'Fetch one URL through the W2L coverage ladder. Compact by default; set debug=true for the full audit.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s) URL' },
        mode: { type: 'string', enum: ['standard', 'research', 'authed'] },
        allowlistedDomains: { type: 'array', items: { type: 'string' } },
        formats: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            anyOf: [
              { type: 'string', enum: ['markdown', 'links', 'json'] },
              {
                type: 'object',
                properties: {
                  type: { const: 'json' },
                  schema: { type: 'object' },
                  prompt: { type: 'string', maxLength: 4000 },
                  modelFallback: { type: 'boolean' },
                },
                required: ['type', 'schema'],
                additionalProperties: false,
              },
            ],
          },
        },
        includeLinks: { type: 'boolean', description: 'Include outbound links. Defaults to false.' },
        debug: { type: 'boolean', description: 'Include trace, ladderTrace, and full attempt audit.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'crawl',
    description: 'Start a multi-page crawl. Returns { taskId } (HTTP 202 equivalent).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        mode: { type: 'string', enum: ['standard', 'research', 'authed'] },
        maxPages: { type: ['number', 'null'] },
        maxDepth: { type: ['number', 'null'] },
        useCached: { type: 'boolean' },
        allowlistedDomains: { type: 'array', items: { type: 'string' } },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_crawl',
    description: 'Read a crawl by task id. Returns a CrawlReport.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'taskId from crawl' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_crawl_pages',
    description: 'Read a paginated list of crawl page results by task id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        cursor: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 1000 },
        attemptId: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_crawl_errors',
    description: 'Read a paginated list of crawl errors by task id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        cursor: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 1000 },
        attemptId: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_crawl',
    description: 'Cancel a crawl task. Completed pages remain queryable.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'batch_scrape',
    description: 'Persist and run 1-1000 explicit URLs. Returns a taskId; use get_batch_items for paginated results.',
    inputSchema: {
      type: 'object',
      properties: {
        urls: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'string' } },
        mode: { type: 'string', enum: ['standard', 'research', 'authed'] },
        formats: { type: 'array', minItems: 1, maxItems: 3, items: { anyOf: [
          { type: 'string', enum: ['markdown', 'links', 'json'] },
          { type: 'object', properties: { type: { const: 'json' }, schema: { type: 'object' }, prompt: { type: 'string' }, modelFallback: { type: 'boolean' } }, required: ['type', 'schema'], additionalProperties: false },
        ] } },
        includeLinks: { type: 'boolean' },
      },
      required: ['urls'], additionalProperties: false,
    },
  },
  ...(['get_batch', 'get_batch_items', 'wait_batch', 'cancel_batch'] as const).map(name => ({
    name,
    description: `${name} for a persistent URL-array batch`,
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, ...(name === 'get_batch_items' ? { cursor: { type: 'string' }, limit: { type: 'number', minimum: 1, maximum: 50 }, debug: { type: 'boolean' } } : {}), ...(name === 'wait_batch' ? { timeoutMs: { type: 'number', minimum: 1, maximum: 300000 } } : {}) }, required: ['id'], additionalProperties: false },
  })),
] as const

export async function callTool(client: W2L, name: string, args: unknown): Promise<unknown> {
  if (name === 'scrape') {
    const req = parseScrapeRequest(args)
    return client.scrape(req.url, {
      mode: req.mode,
      allowlistedDomains: req.allowlistedDomains,
      formats: req.formats ?? ['markdown'],
      includeLinks: req.includeLinks,
      debug: req.debug ?? false,
    })
  }
  if (name === 'crawl') {
    const req = parseCrawlStartRequest(args)
    return client.crawl(req.url, {
      mode: req.mode,
      maxPages: req.maxPages,
      maxDepth: req.maxDepth,
      useCached: req.useCached,
      allowlistedDomains: req.allowlistedDomains,
    })
  }
  if (name === 'get_crawl') {
    const rec = args !== null && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : null
    const id = rec?.id
    if (typeof id !== 'string' || id.length === 0) throw new Error('id is required')
    return client.getCrawl(id)
  }
  if (name === 'get_crawl_pages' || name === 'get_crawl_errors') {
    const input = readCrawlQuery(args)
    return name === 'get_crawl_pages' ? client.getCrawlPages(input.id, input.options) : client.getCrawlErrors(input.id, input.options)
  }
  if (name === 'cancel_crawl') {
    const rec = args !== null && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : null
    const id = rec?.id
    if (typeof id !== 'string' || id.length === 0) throw new Error('id is required')
    return client.cancelCrawl(id)
  }
  if (name === 'batch_scrape') {
    const req = parseBatchStartRequest(args)
    return client.batchScrape(req.urls, { mode: req.mode, formats: req.formats, includeLinks: req.includeLinks })
  }
  if (name === 'get_batch_items') {
    const input = readCrawlQuery(args)
    return client.getBatchItems(input.id, input.options)
  }
  if (name === 'get_batch' || name === 'wait_batch' || name === 'cancel_batch') {
    const rec = args !== null && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : null
    if (typeof rec?.id !== 'string' || !rec.id) throw new Error('id is required')
    if (name === 'get_batch') return client.getBatch(rec.id)
    if (name === 'cancel_batch') return client.cancelBatch(rec.id)
    const timeoutMs = rec.timeoutMs ?? 30_000
    if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error('timeoutMs must be an integer between 1 and 300000')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('wait_batch timeout', 'TimeoutError')), timeoutMs)
    try { return await client.waitBatch(rec.id, { signal: controller.signal }) }
    catch (error) {
      if (!controller.signal.aborted) throw error
      return client.getBatch(rec.id)
    } finally { clearTimeout(timer) }
  }
  throw new Error(`unknown tool: ${name}`)
}

function readCrawlQuery(args: unknown): { id: string; options: { cursor?: string; limit?: number; attemptId?: string; debug?: boolean } } {
  const rec = args !== null && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : null
  if (typeof rec?.id !== 'string' || rec.id.length === 0) throw new Error('id is required')
  if (rec.limit !== undefined && (typeof rec.limit !== 'number' || !Number.isInteger(rec.limit))) throw new Error('limit must be an integer')
  if (rec.debug !== undefined && typeof rec.debug !== 'boolean') throw new Error('debug must be a boolean')
  return {
    id: rec.id,
    options: {
      cursor: typeof rec.cursor === 'string' ? rec.cursor : undefined,
      limit: rec.limit as number | undefined,
      attemptId: typeof rec.attemptId === 'string' ? rec.attemptId : undefined,
      debug: rec.debug as boolean | undefined,
    },
  }
}
