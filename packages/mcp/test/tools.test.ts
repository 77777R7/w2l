import { describe, expect, it } from 'vitest'
import { W2L } from '@w2l/sdk'
import { callTool, TOOL_NAMES, TOOLS } from '../src/tools.js'
import { parseBaseUrl, parseToken } from '../src/stdio.js'

describe('MCP tools', () => {
  it('exposes exactly scrape, crawl, and get_crawl', () => {
    expect([...TOOL_NAMES]).toEqual(['scrape', 'crawl', 'get_crawl', 'get_crawl_pages', 'get_crawl_errors', 'cancel_crawl'])
    expect(TOOLS.map((t) => t.name)).toEqual(['scrape', 'crawl', 'get_crawl', 'get_crawl_pages', 'get_crawl_errors', 'cancel_crawl'])
  })

  it('dispatches to the REST SDK with A1 fields', async () => {
    const calls: Array<{ line: string; body: unknown }> = []
    const client = new W2L({
      baseUrl: 'http://127.0.0.1:8787',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push({ line: `${init?.method ?? 'GET'} ${url}`, body: init?.body ? JSON.parse(String(init.body)) : null })
        if (url.endsWith('/v1/scrape')) {
          return json({ status: 'success', markdown: 'ok', requestedUrl: 'https://example.com/' })
        }
        if (url.endsWith('/v1/crawl')) {
          return json({ taskId: 'task-1' }, 202)
        }
        if (url.includes('/pages')) return json({ items: [{ id: 'step-1' }], nextCursor: null, hasMore: false })
        if (url.includes('/errors')) return json({ items: [], nextCursor: null, hasMore: false })
        if (url.includes('/cancel')) return json({ taskId: 'task-1', status: 'cancelled' })
        return json({ taskId: 'task-1', status: 'completed', pagesFetched: 1, cachedPages: 0, attemptId: 'a', budgetExceeded: null, loopDetected: false })
      }) as typeof fetch,
    })

    const scraped = (await callTool(client, 'scrape', { url: 'https://example.com/', mode: 'standard' })) as { status: string }
    expect(scraped.status).toBe('success')
    const accepted = (await callTool(client, 'crawl', { url: 'https://example.com/', maxPages: 20 })) as { taskId: string }
    expect(accepted.taskId).toBe('task-1')
    const report = (await callTool(client, 'get_crawl', { id: 'task-1' })) as { pagesFetched: number }
    expect(report.pagesFetched).toBe(1)
    expect((await callTool(client, 'get_crawl_pages', { id: 'task-1', limit: 1 }) as { items: unknown[] }).items).toHaveLength(1)
    expect((await callTool(client, 'get_crawl_errors', { id: 'task-1' }) as { items: unknown[] }).items).toEqual([])
    expect((await callTool(client, 'cancel_crawl', { id: 'task-1' }) as { status: string }).status).toBe('cancelled')
    expect(calls.map(call => call.line)).toEqual([
      'POST http://127.0.0.1:8787/v1/scrape',
      'POST http://127.0.0.1:8787/v1/crawl',
      'GET http://127.0.0.1:8787/v1/crawl/task-1',
      'GET http://127.0.0.1:8787/v1/crawl/task-1/pages?limit=1',
      'GET http://127.0.0.1:8787/v1/crawl/task-1/errors',
      'POST http://127.0.0.1:8787/v1/crawl/task-1/cancel',
    ])
    expect(calls[0]?.body).toEqual({ url: 'https://example.com/', mode: 'standard', formats: ['markdown'], debug: false })
  })

  it('forwards custom formats and debug to REST', async () => {
    let body: Record<string, unknown> | null = null
    const client = new W2L({ baseUrl: 'http://127.0.0.1:8787', fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body))
      return json({ status: 'success' })
    }) as typeof fetch })
    await callTool(client, 'scrape', { url: 'https://example.com/', formats: [{ type: 'json', schema: { type: 'object' } }], debug: true })
    expect(body).toMatchObject({ formats: [{ type: 'json', schema: { type: 'object' } }], debug: true })
  })

  it('has no resource or oauth surface', async () => {
    const runtime = await import('../src/index.js')
    expect(Object.keys(runtime).sort()).toEqual([
      'TOOLS',
      'TOOL_NAMES',
      'callTool',
      'createMcpServer',
      'parseBaseUrl',
      'parseToken',
    ])
    expect(JSON.stringify(runtime)).not.toMatch(/oauth|subscribe|resource/i)
  })

  it('reads W2L_API_URL / --base-url for the REST origin', () => {
    expect(parseBaseUrl([], {})).toBe('http://127.0.0.1:8787')
    expect(parseBaseUrl([], { W2L_API_URL: 'http://127.0.0.1:9000' })).toBe('http://127.0.0.1:9000')
    expect(parseBaseUrl(['--base-url', 'http://127.0.0.1:9'], {})).toBe('http://127.0.0.1:9')
  })

  it('reads W2L_API_TOKEN / --token for hosted API auth', () => {
    expect(parseToken([], {})).toBeUndefined()
    expect(parseToken([], { W2L_API_TOKEN: 'secret' })).toBe('secret')
    expect(parseToken(['--token', 'cli'], {})).toBe('cli')
  })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
