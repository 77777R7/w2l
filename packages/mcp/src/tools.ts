/**
 * MCP tool dispatch over the native REST contract.
 * No resources, no OAuth, no second result type.
 */

import { parseCrawlStartRequest, parseScrapeRequest } from '@w2l/contracts'
import type { W2L } from '@w2l/sdk'

export const TOOL_NAMES = ['scrape', 'crawl', 'get_crawl'] as const
export type ToolName = (typeof TOOL_NAMES)[number]

export const TOOLS = [
  {
    name: 'scrape',
    description: 'Fetch one URL through the W2L coverage ladder. Returns a FetchResult.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s) URL' },
        mode: { type: 'string', enum: ['standard', 'research', 'authed'] },
        allowlistedDomains: { type: 'array', items: { type: 'string' } },
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
] as const

export async function callTool(client: W2L, name: string, args: unknown): Promise<unknown> {
  if (name === 'scrape') {
    const req = parseScrapeRequest(args)
    return client.scrape(req.url, { mode: req.mode, allowlistedDomains: req.allowlistedDomains })
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
  throw new Error(`unknown tool: ${name}`)
}
