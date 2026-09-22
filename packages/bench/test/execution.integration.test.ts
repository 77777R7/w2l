import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResilientHttpSubject } from '../src/subjects/resilientHttp.js'
import { BrowserLocalSubject } from '../src/subjects/browserLocal.js'
import { buildChannels } from '../src/ladderCli.js'
import { LadderRunner } from '../src/routing/ladder.js'
import { LadderScrapeAtom } from '../src/scrapeAtom.js'
import { fetchVendorApi } from '../src/vendors/api.js'
import { measureUserAgent, navigateOnce, type CdpBrowser, type CdpPage } from '../src/vendors/cdp.js'

const servers: Server[] = []
const subjects: BrowserLocalSubject[] = []
const article = '<html><body><article><h1>Execution contract evidence</h1><p>' + 'A complete public document with factual content, stable formatting, and enough prose to extract reliably. '.repeat(12) + '</p></article></body></html>'
async function server(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const instance = createServer(handler)
  servers.push(instance)
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve))
  const addr = instance.address()
  if (!addr || typeof addr === 'string') throw new Error('missing port')
  return `http://127.0.0.1:${addr.port}`
}
function robots(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.url !== '/robots.txt') return false
  res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nAllow: /\n')
  return true
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(subjects.splice(0).map(subject => subject.teardown()))
  await Promise.all(servers.splice(0).map(instance => new Promise<void>(resolve => { instance.closeAllConnections(); instance.close(() => resolve()) })))
})

describe('execution budget over real HTTP', () => {
  it('cancels robots on the wire and never starts the target request', async () => {
    let robotStarted!: () => void
    const started = new Promise<void>(resolve => { robotStarted = resolve })
    let closed = false
    let pageHits = 0
    const origin = await server((req, res) => {
      if (req.url === '/robots.txt') { res.on('close', () => { closed = true }); robotStarted(); return }
      pageHits++
      res.end(article)
    })
    const controller = new AbortController()
    const task = new ResilientHttpSubject().fetch(`${origin}/page`, Date.now() + 5_000, controller.signal)
    await started
    controller.abort()
    const out = await task
    expect(out.failureReason).toBe('timeout')
    await expect.poll(() => closed).toBe(true)
    expect(pageHits).toBe(0)
  })

  it('deadline stops a streaming body and closes the origin connection', async () => {
    let closed = false
    const origin = await server((req, res) => {
      if (robots(req, res)) return
      res.writeHead(200, { 'content-type': 'text/html' })
      res.write('<article>unfinished')
      res.on('close', () => { closed = true })
    })
    const start = Date.now()
    const out = await new ResilientHttpSubject().fetch(`${origin}/stream`, start + 150)
    expect(out.failureReason).toBe('timeout')
    expect(Date.now() - start).toBeLessThan(1_000)
    await expect.poll(() => closed).toBe(true)
  })

  it('preserves a long Retry-After as retryAt without making an early retry', async () => {
    let hits = 0
    const origin = await server((req, res) => {
      if (robots(req, res)) return
      hits++
      res.writeHead(503, { 'retry-after': '120' }).end('busy')
    })
    const start = Date.now()
    const out = await new ResilientHttpSubject().fetch(`${origin}/busy`, start + 500)
    expect(out.retryAt).toBeGreaterThanOrEqual(start + 120_000)
    expect(out.trace.some(event => event.event === 'retry_deferred')).toBe(true)
    expect(hits).toBe(1)
    expect(Date.now() - start).toBeLessThan(500)
  })

  it('serializes same-origin retry/cooldown while another origin proceeds and a waiter can cancel', async () => {
    const hits: number[] = []
    let firstHit!: () => void
    const started = new Promise<void>(resolve => { firstHit = resolve })
    const origin = await server((req, res) => {
      if (robots(req, res)) return
      hits.push(Date.now())
      if (hits.length === 1) { res.writeHead(503, { 'retry-after': '1' }).end('busy'); firstHit(); return }
      res.writeHead(200, { 'content-type': 'text/html' }).end(article)
    })
    const other = await server((req, res) => { if (!robots(req, res)) res.end(article) })
    const subject = new ResilientHttpSubject()
    const first = subject.fetch(`${origin}/first`, Date.now() + 5_000)
    await started
    const cancellation = new AbortController()
    const cancelled = subject.fetch(`${origin}/cancelled`, Date.now() + 5_000, cancellation.signal)
    const second = subject.fetch(`${origin}/second`, Date.now() + 5_000)
    cancellation.abort()
    const independentStart = Date.now()
    await subject.fetch(`${other}/other`, Date.now() + 500)
    expect(Date.now() - independentStart).toBeLessThan(500)
    expect((await cancelled).failureReason).toBe('timeout')
    await first
    await second
    expect(hits).toHaveLength(3)
    expect(hits[1]! - hits[0]!).toBeGreaterThanOrEqual(990)
    expect(hits[2]!).toBeGreaterThanOrEqual(hits[1]!)
  })

  it('cancels a host cooldown timer without hitting the origin', async () => {
    let hits = 0
    const origin = await server((req, res) => {
      if (robots(req, res)) return
      hits++
      res.writeHead(429, { 'retry-after': '120' }).end('limited')
    })
    const subject = new ResilientHttpSubject()
    const first = await subject.fetch(`${origin}/one`)
    expect(first.retryAt).toBeGreaterThan(Date.now() + 119_000)
    const controller = new AbortController()
    const task = subject.fetch(`${origin}/two`, undefined, controller.signal)
    setTimeout(() => controller.abort(), 40)
    expect((await task).failureReason).toBe('timeout')
    expect(hits).toBe(1)
  })

  it('retains in-memory origin cooldown when an inline retry wait is cancelled', async () => {
    let hits = 0
    const origin = await server((req, res) => { if (!robots(req, res)) { hits++; res.writeHead(503, { 'retry-after': '60' }).end('busy') } })
    const subject = new ResilientHttpSubject()
    const controller = new AbortController()
    let retryAt = 0
    const first = await subject.fetch(`${origin}/busy`, undefined, controller.signal, {}, (_url, next) => { retryAt = next; controller.abort() })
    expect(first.failureReason).toBe('timeout')
    const second = await subject.fetch(`${origin}/busy`, Date.now() + 100)
    expect(second.retryAt).toBe(retryAt)
    expect(hits).toBe(1)
  })

  it('durably records Retry-After before cancellation interrupts the inline wait', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { default: Database } = await import('better-sqlite3')
    const { MonitorStore, runConfiguredMonitor } = await import('@w2l/runtime')
    const dir = await mkdtemp(join(tmpdir(), 'w2l-retry-notice-'))
    const dbPath = join(dir, 'control.sqlite')
    const store = MonitorStore.open(dbPath)
    const inspect = new Database(dbPath, { readonly: true })
    let hits = 0
    const origin = await server((req, res) => {
      if (robots(req, res)) return
      hits++
      res.writeHead(503, { 'retry-after': '60' }).end('busy')
    })
    const revision = {
      monitorId: 'retry-notice', revision: 1, url: `${origin}/busy`, ruleVersion: 'price/v1',
      intervalMs: 60_000, staleAfterMs: 120_000, createdAt: Date.now(),
      config: { adapter: 'markdown-sections/v1' as const, workspaceId: 'test', entityKey: 'product', viewKey: 'public', expectedTitle: 'Product', schemaVersion: 'price/v1', captureMode: 'http' as const, conditionalRequests: false, fields: [{ name: 'price', heading: 'Price', type: 'decimal' as const, required: true }] },
    }
    const shutdown = new AbortController()
    let noticedAt = 0
    let capture: Promise<import('@w2l/contracts').FetchResult> | undefined
    try {
      const view = await runConfiguredMonitor(store, revision, async options => {
        capture = new ResilientHttpSubject().fetch(revision.url, options.deadlineAt, options.signal, options, options.onRetryAfter)
        return { result: await capture, links: [] }
      }, 'one', { signal: shutdown.signal, onRetryAfter: (url, retryAt) => {
        expect(url).toBe(revision.url)
        const row = inspect.prepare('SELECT not_before FROM monitor_origin_cooldowns WHERE origin=?').get(origin) as { not_before: number }
        expect(row.not_before).toBeGreaterThanOrEqual(retryAt)
        noticedAt = retryAt
        shutdown.abort(new DOMException('service shutdown', 'ShutdownError'))
      } })
      await capture
      expect(noticedAt).toBeGreaterThan(Date.now() + 59_000)
      expect(view.runs[0]?.state).toBe('waiting_retry')
      expect(view.runs[0]?.nextAttemptAt).toBeGreaterThanOrEqual(noticedAt)
      expect(hits).toBe(1)
      expect(view.events).toEqual([])
    } finally { inspect.close(); store.close(); await rm(dir, { recursive: true, force: true }) }
  })

  it('passes the same deadline through ScrapeAtom, ladder, and channel with no escalation', async () => {
    let nextLane = 0
    let deadlineSeen: number | undefined
    const origin = await server((req, res) => { if (!robots(req, res)) res.writeHead(503, { 'retry-after': '120' }).end('busy') })
    const channels = buildChannels('standard', { keys: { browserbase: '', steel: '' }, localSubjects: {
      http: { fetch: (url, deadline, signal) => { deadlineSeen = deadline; return new ResilientHttpSubject().fetch(url, deadline, signal) } },
      browser_local: { fetch: async () => { nextLane++; throw new Error('must not escalate during Retry-After') } },
    } })
    const deadlineAt = Date.now() + 1_000
    const out = await new LadderScrapeAtom(new LadderRunner(channels, { mode: 'standard' })).scrape(`${origin}/busy`, { deadlineAt })
    expect(deadlineSeen).toBe(deadlineAt)
    expect(out.result.retryAt).toBeGreaterThan(deadlineAt)
    expect(nextLane).toBe(0)
    await Promise.all(channels.map(channel => channel.close?.()))
  })
})

describe('browser and vendor execution cancellation', () => {
  it('closes the local browser page during an active navigation', async () => {
    let started!: () => void
    const navigation = new Promise<void>(resolve => { started = resolve })
    let closed = false
    const origin = await server((req, res) => {
      if (robots(req, res)) return
      if (req.url === '/slow') { res.on('close', () => { closed = true }); started(); return }
      res.end(article)
    })
    const subject = new BrowserLocalSubject()
    subjects.push(subject)
    await subject.fetch(`${origin}/warm`, Date.now() + 10_000)
    const controller = new AbortController()
    const pending = subject.fetch(`${origin}/slow`, Date.now() + 5_000, controller.signal)
    await navigation
    controller.abort()
    expect((await pending).failureReason).toBe('timeout')
    await expect.poll(() => closed).toBe(true)
    // Cancelling one page must leave the shared browser usable.
    expect((await subject.fetch(`${origin}/again`, Date.now() + 5_000)).status).toBe('success')
  })

  it('browser defers Retry-After beyond its budget without an early second navigation', async () => {
    let busyHits = 0
    const origin = await server((req, res) => {
      if (robots(req, res)) return
      if (req.url === '/busy') { busyHits++; res.writeHead(503, { 'retry-after': '120' }).end('busy'); return }
      res.end(article)
    })
    const subject = new BrowserLocalSubject()
    subjects.push(subject)
    await subject.fetch(`${origin}/warm`, Date.now() + 10_000)
    const started = Date.now()
    const result = await subject.fetch(`${origin}/busy`, started + 500)
    expect(result.retryAt).toBeGreaterThanOrEqual(started + 120_000)
    expect(result.trace.some(event => event.event === 'retry_deferred')).toBe(true)
    expect(busyHits).toBe(1)
    // A second call with insufficient budget respects the shared origin cooldown.
    const second = await subject.fetch(`${origin}/busy`, Date.now() + 100)
    expect(second.retryAt).toBe(result.retryAt)
    expect(busyHits).toBe(1)
  })

  it('vendor HTTP respects deadline through its response body', async () => {
    let closed = false
    const origin = await server((_req, res) => { res.write('{'); res.on('close', () => { closed = true }) })
    await expect(fetchVendorApi({ method: 'GET', url: origin, headers: {}, deadlineMs: Date.now() + 100 })).rejects.toBeDefined()
    await expect.poll(() => closed).toBe(true)
  })

  it.each(['measure', 'navigate'] as const)('cancels stalled provider %s setup and closes the late-created page', async mode => {
    let resolvePage!: (page: CdpPage) => void
    let pageCloses = 0
    let browserCloses = 0
    let navigations = 0
    const browser: CdpBrowser = { close: async () => { browserCloses++ }, contexts: () => [{ pages: () => [], newPage: () => new Promise(resolve => { resolvePage = resolve }) }] }
    const operation = mode === 'measure'
      ? measureUserAgent(browser, Date.now() + 30)
      : navigateOnce(browser, 'https://example.com', Date.now() + 30)
    await expect(operation).rejects.toMatchObject({ name: 'TimeoutError' })
    resolvePage({
      goto: async () => { navigations++; return null }, evaluate: async () => 'unused', waitForTimeout: async () => {},
      content: async () => '', url: () => 'about:blank', close: async () => { pageCloses++ },
    })
    await expect.poll(() => pageCloses).toBe(1)
    expect(browserCloses).toBe(0)
    expect(navigations).toBe(0)
  })

  it.each(['browser', 'managed'] as const)('closes a late-owned local %s startup after its only caller cancels', async mode => {
    const { chromium } = await import('playwright')
    let resolveCreated!: (resource: unknown) => void
    let started!: () => void
    const startup = new Promise<void>(resolve => { started = resolve })
    let closes = 0
    const creation = () => { started(); return new Promise(resolve => { resolveCreated = resolve }) }
    if (mode === 'browser') vi.spyOn(chromium, 'launch').mockImplementation(creation as never)
    else vi.spyOn(chromium, 'launchPersistentContext').mockImplementation(creation as never)
    const subject = new BrowserLocalSubject('standard', null, false, undefined, mode === 'managed' ? '/unused-test-profile' : null)
    subjects.push(subject)
    const controller = new AbortController()
    const pending = subject.fetch('http://127.0.0.1:1/not-fetched', Date.now() + 5_000, controller.signal)
    await startup
    controller.abort()
    expect((await pending).failureReason).toBe('timeout')
    resolveCreated({ close: async () => { closes++ } })
    await expect.poll(() => closes).toBe(1)
  })

  it('closes the active provider CDP page when the caller cancels', async () => {
    let started!: () => void
    const navigation = new Promise<void>(resolve => { started = resolve })
    let closes = 0
    const browser: CdpBrowser = { close: async () => {}, contexts: () => [{ pages: () => [], newPage: async () => ({
      goto: async () => { started(); return await new Promise(() => {}) }, evaluate: async () => '', waitForTimeout: async () => {},
      content: async () => '', url: () => 'https://example.com', close: async () => { closes++ },
    }) }] }
    const controller = new AbortController()
    const pending = navigateOnce(browser, 'https://example.com', Date.now() + 5_000, controller.signal)
    await navigation
    controller.abort()
    await expect(pending).rejects.toBeDefined()
    expect(closes).toBeGreaterThan(0)
  })
})
