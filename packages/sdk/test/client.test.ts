import { describe, expect, it } from 'vitest'
import { W2L } from '../src/index.js'

describe('W2L SDK', () => {
  it('posts scrape and crawl to the native paths', async () => {
    const calls: { method: string; url: string; body: unknown }[] = []
    const client = new W2L({
      baseUrl: 'http://127.0.0.1:8787/',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const body = init?.body === undefined ? null : JSON.parse(String(init.body))
        calls.push({ method: init?.method ?? 'GET', url, body })
        if (url.endsWith('/v1/scrape')) {
          return new Response(JSON.stringify({ status: 'success', markdown: 'ok', requestedUrl: body.url }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url.endsWith('/v1/crawl')) {
          return new Response(JSON.stringify({ taskId: 'task-1' }), {
            status: 202,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ taskId: 'task-1', status: 'completed', pagesFetched: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch,
    })

    const scraped = await client.scrape('https://example.com/')
    expect(scraped.status).toBe('success')
    const accepted = await client.crawl('https://example.com/', { maxPages: 20 })
    expect(accepted.taskId).toBe('task-1')
    const report = await client.getCrawl('task-1')
    expect(report.pagesFetched).toBe(1)
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST http://127.0.0.1:8787/v1/scrape',
      'POST http://127.0.0.1:8787/v1/crawl',
      'GET http://127.0.0.1:8787/v1/crawl/task-1',
    ])
  })

  it('sends Authorization when a token is configured', async () => {
    const headers: string[] = []
    const client = new W2L({
      baseUrl: 'http://127.0.0.1:8787',
      token: 'secret',
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const h = new Headers(init?.headers)
        headers.push(h.get('authorization') ?? '')
        return new Response(JSON.stringify({ status: 'success', markdown: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch,
    })
    await client.scrape('https://example.com/')
    expect(headers).toEqual(['Bearer secret'])
  })
})
