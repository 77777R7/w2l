import { describe, expect, it } from 'vitest'
import { W2L } from '@w2l/sdk'
import { callTool, TOOL_NAMES, TOOLS } from '../src/tools.js'
import { parseBaseUrl, parseToken } from '../src/stdio.js'

describe('MCP tools', () => {
  it('exposes scrape, crawl, and persistent batch operations', () => {
    const expected = ['scrape_product', 'batch_products', 'scrape', 'crawl', 'get_crawl', 'get_crawl_pages', 'get_crawl_errors', 'cancel_crawl', 'batch_scrape', 'get_batch', 'get_batch_items', 'wait_batch', 'cancel_batch',
      'preview_monitor','create_monitor','list_monitors','get_monitor','run_monitor','get_monitor_run','pause_monitor','resume_monitor','cancel_monitor_run',
      'create_delivery_destination','list_delivery_destinations','pause_delivery_destination','resume_delivery_destination','list_deliveries','get_delivery','retry_dead_letter']
    expect([...TOOL_NAMES]).toEqual(expected)
    expect(TOOLS.map((t) => t.name)).toEqual(expected)
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
    expect(calls[0]?.body).toEqual({ url: 'https://example.com/', mode: 'standard', debug: false })
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

  it('offers one-argument Amazon product tools with a fixed schema and no model', async () => {
    const bodies:Record<string,unknown>[]=[]
    const client=new W2L({baseUrl:'http://127.0.0.1:8787',fetch:(async (input,init)=>{
      bodies.push(JSON.parse(String(init?.body)))
      return json(String(input).endsWith('/v1/batches')?{taskId:'batch-1'}:{status:'success'},String(input).endsWith('/v1/batches')?202:200)
    }) as typeof fetch})
    await callTool(client,'scrape_product',{url:'https://www.amazon.sg/dp/B000VW9PIK?tag=ref'})
    await callTool(client,'batch_products',{urls:['https://www.amazon.sg/dp/B000VW9PIK']})
    expect(bodies.map(body=>body.formats)).toEqual([
      [{type:'json',schema:expect.any(Object),modelFallback:false}],
      [{type:'json',schema:expect.any(Object),modelFallback:false}],
    ])
    expect(bodies[0]?.url).toBe('https://www.amazon.sg/dp/B000VW9PIK')
    expect(bodies[1]?.urls).toEqual(['https://www.amazon.sg/dp/B000VW9PIK'])
    await expect(callTool(client,'scrape_product',{url:'https://127.0.0.1/dp/B000VW9PIK'})).rejects.toThrow('Amazon.sg')
  })

  it('keeps the legacy links format and caller schema on the public tool schema', () => {
    const scrape = TOOLS.find(tool => tool.name === 'scrape')
    const batch = TOOLS.find(tool => tool.name === 'batch_scrape')
    expect(JSON.stringify(scrape?.inputSchema)).toContain('"links"')
    expect(JSON.stringify(scrape?.inputSchema)).toContain('"schema"')
    expect(JSON.stringify(batch?.inputSchema)).toContain('"schema"')
  })

  it('dispatches URL arrays and paginated batch results through the SDK', async () => {
    const calls: string[] = []
    const client = new W2L({ baseUrl: 'http://127.0.0.1:8787', fetch: (async (input, init) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/v1/batches')) return json({ taskId: 'batch-1' }, 202)
      if (url.includes('/items')) return json({ items: [{ id: 'item-1' }], nextCursor: null, hasMore: false })
      return json({ taskId: 'batch-1', status: 'completed', completed: 1, requested: 1, remaining: 0 })
    }) as typeof fetch })
    expect(await callTool(client, 'batch_scrape', { urls: ['https://example.com/a'] })).toEqual({ taskId: 'batch-1' })
    expect((await callTool(client, 'get_batch_items', { id: 'batch-1', limit: 1 }) as { items: unknown[] }).items).toHaveLength(1)
    expect((await callTool(client, 'wait_batch', { id: 'batch-1' }) as { status: string }).status).toBe('completed')
    expect(calls).toEqual([
      'POST http://127.0.0.1:8787/v1/batches',
      'GET http://127.0.0.1:8787/v1/batches/batch-1/items?limit=1',
      'GET http://127.0.0.1:8787/v1/batches/batch-1',
    ])
  })

  it('bounds wait_batch and returns current state when its wait expires', async () => {
    const client = new W2L({ baseUrl: 'http://127.0.0.1:8787', fetch: (async () => json({ taskId: 'batch-1', status: 'running', completed: 0, requested: 2, remaining: 2 })) as typeof fetch })
    const state = await callTool(client, 'wait_batch', { id: 'batch-1', timeoutMs: 10 }) as { status: string }
    expect(state.status).toBe('running')
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

  it('creates paused first-use Monitors and queues durable runs through REST', async () => {
    const calls: Array<{url:string;body:Record<string,unknown>}> = []
    const client = new W2L({baseUrl:'http://w2l.local',fetch:(async(input,init)=>{
      calls.push({url:String(input),body:init?.body ? JSON.parse(String(init.body)) : {}})
      return json(String(input).endsWith('/runs') ? {id:'run-1',monitorId:'firecrawl-introduction',state:'queued',triggerKey:'manual'} : {monitorId:'firecrawl-introduction',revision:1},String(input).endsWith('/runs') ? 202 : 201)
    }) as typeof fetch})
    await callTool(client,'create_monitor',{preset:'firecrawl-introduction'})
    expect(calls[0]?.body).toEqual({preset:'firecrawl-introduction',enabled:false})
    expect(await callTool(client,'run_monitor',{id:'firecrawl-introduction'})).toMatchObject({runId:'run-1',state:'queued'})
    expect(calls[1]?.url).toMatch(/\/v1\/monitors\/firecrawl-introduction\/runs$/)
  })

  it('explains a dead-letter and retries the same event without exposing its payload by default', async () => {
    const calls: string[] = []
    const delivery = {id:'delivery-1',eventId:'event-1',state:'dead_letter',lastError:'HTTP 503',attemptCount:2,payload:{privateBody:'fixture'}}
    const client = new W2L({baseUrl:'http://w2l.local',fetch:(async(input,init)=>{
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
      return json(String(input).endsWith('/retry') ? {...delivery,state:'pending'} : {delivery,attempts:[{status:503,error:'HTTP 503'}]})
    }) as typeof fetch})
    const compact = await callTool(client,'get_delivery',{id:'delivery-1'}) as {delivery:Record<string,unknown>;attempts:unknown[]}
    expect(compact.delivery).toMatchObject({eventId:'event-1',state:'dead_letter',lastError:'HTTP 503'})
    expect(compact.delivery).not.toHaveProperty('payload')
    expect(compact.attempts).toHaveLength(1)
    const debug = await callTool(client,'get_delivery',{id:'delivery-1',debug:true}) as {delivery:Record<string,unknown>}
    expect(debug.delivery).toHaveProperty('payload')
    const retried = await callTool(client,'retry_dead_letter',{id:'delivery-1'}) as Record<string,unknown>
    expect(retried).toMatchObject({eventId:'event-1',state:'pending'})
    expect(retried).not.toHaveProperty('payload')
    expect(calls).toEqual([
      'GET http://w2l.local/v1/deliveries/delivery-1',
      'GET http://w2l.local/v1/deliveries/delivery-1',
      'POST http://w2l.local/v1/deliveries/delivery-1/retry',
    ])
  })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
