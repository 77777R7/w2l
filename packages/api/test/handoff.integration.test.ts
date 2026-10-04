import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { buildChannels } from '@w2l/bench'
import type { CrawlPage } from '@w2l/contracts'
import { createApiEngine, type ApiEngine } from '../src/engine.js'

/**
 * The handoff end to end: a batch stopped at a check, handed to "the person"
 * in a real Chromium that remote debugging is on in (as the person's Chrome
 * would be), who gets through it there; W2L reads the page and the item's
 * stopped result is replaced, and only then. The test plays the person, in
 * the tabs W2L opens.
 */

let server: Server
let base: string
let root: string
let chrome: BrowserContext

const ARTICLE = `<article><h1>The member page</h1>${'<p>What is behind the check: a page of prose, long enough to be read as an article and not as a stub. </p>'.repeat(4)}</article>`
/** A captcha its button passes, by setting `name` (one per page: the tests share one browser, and its cookies). */
const captcha = (name: string) => `<div class="g-recaptcha" data-sitekey="test-key"></div><button id="pass" onclick="document.cookie='${name}=1; path=/'; location.reload()">I am human</button>`

beforeAll(async () => {
  server = createServer((req, res) => {
    const cookie = req.headers.cookie ?? ''
    const html = (body: string, status = 200, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers }); res.end(`<!doctype html><html><head><title>Members</title></head><body>${body}</body></html>`) }
    if (req.url === '/robots.txt') { res.writeHead(404); res.end(); return }
    if (req.url === '/open') return html(ARTICLE.replace('member page', 'open page'))
    // A captcha until the person passes it: their browser then holds the cookie the page checks.
    if (req.url === '/gate') return cookie.includes('passed=1') ? html(ARTICLE) : html(captcha('passed'))
    // Through the captcha, a page with nothing on it: not the page asked for.
    if (req.url === '/thin') return cookie.includes('thin=1') ? html('<p>ok</p>') : html(captcha('thin'))
    // Behind the captcha, a page with a search box that takes the focus and a sign-in box it hides.
    if (req.url === '/search') return cookie.includes('search=1') ? html(`<input name="q" autofocus><div style="display:none"><input type="password"></div>${ARTICLE}`) : html(captcha('search'))
    // A challenge that runs its script for a moment, then reloads into the page by itself.
    if (req.url === '/jsc') return cookie.includes('js=1') ? html(ARTICLE) : html('<div class="g-recaptcha" data-sitekey="k"></div><script>setTimeout(() => { document.cookie = "js=1; path=/"; location.reload() }, 1500)</script>')
    // A login-walled page: signed out, it sends you to sign in, and signing in ends on the home page.
    if (req.url === '/orders') {
      if (cookie.includes('member=1')) return html(ARTICLE.replace('The member page', 'Your orders'))
      res.writeHead(302, { location: '/signin' }); res.end(); return
    }
    if (req.url === '/signin') return html('<h1>Sign in</h1><form><input name="user"><input type="password" name="pw"><button id="in" type="button" onclick="document.cookie=\'member=1; path=/\'; location.href=\'/\'">Sign in</button></form>')
    if (req.url === '/') return html(ARTICLE.replace('The member page', 'Welcome home'))
    // A page that keeps the widget's script once the person is through it (as a Turnstile page does).
    if (req.url === '/turnstile') return cookie.includes('turnstile=1') ? html(`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async></script>${ARTICLE}`) : html(`<div class="cf-turnstile" data-sitekey="k"></div>${captcha('turnstile')}`)
    // Checks that pass by themselves in a browser, with nobody there: a script that reloads into the page, a meta refresh.
    if (req.url === '/auto') return cookie.includes('auto=1') ? html(ARTICLE) : html('<div class="g-recaptcha" data-sitekey="k"></div><script>document.cookie = "auto=1; path=/"; setTimeout(() => location.reload(), 300)</script>')
    if (req.url === '/meta') return cookie.includes('meta=1') ? html(ARTICLE) : html('<meta http-equiv="refresh" content="0; url=/meta2"><div class="g-recaptcha" data-sitekey="k"></div>')
    if (req.url === '/meta2') { res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'meta=1; path=/' }); res.end(`<!doctype html><html><body>${ARTICLE}</body></html>`); return }
    // A bot check that only its header says (a vendor's), never passed here.
    if (req.url === '/dd') return html('<p>Access denied.</p>', 403, { 'x-datadome': 'protected' })
    // A sign-in, then a one-time code, then the page.
    if (req.url === '/account') {
      if (cookie.includes('code=1')) return html(ARTICLE)
      if (cookie.includes('signed=1')) return html('<p>Check your phone</p><form><input id="code" autocomplete="one-time-code"><button id="go" type="button" onclick="document.cookie=\'code=1; path=/\'; location.reload()">Go</button></form>')
      return html('<h1>Sign in</h1><form><input name="user"><input type="password" name="pw"><button id="in" type="button" onclick="document.cookie=\'signed=1; path=/\'; location.reload()">Sign in</button></form>')
    }
    res.writeHead(404); res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  root = await mkdtemp(join(tmpdir(), 'w2l-handoff-'))
  // "The person's Chrome": remote debugging on, so Chrome writes DevToolsActivePort in its user data directory.
  chrome = await chromium.launchPersistentContext(join(root, 'chrome'), { args: ['--remote-debugging-port=0'] })
}, 60_000)

afterAll(async () => {
  await chrome?.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
})

function engineFor(taskRoot: string, userDataDir = join(root, 'chrome')): ApiEngine {
  const http = buildChannels('standard', { localSubjects: { browser_local: { fetch: async () => { throw new Error('unused') } } } })[0]!
  return createApiEngine({ taskRoot, channelsFor: () => [http], userChrome: { userDataDir } })
}

async function batchOf(engine: ApiEngine, paths: string[]): Promise<string> {
  const { taskId } = await engine.startBatch({ urls: paths.map((path) => `${base}${path}`), formats: ['markdown'] } as never)
  for (let i = 0; i < 300; i++) {
    const report = await engine.getBatch(taskId)
    if (report !== null && ['completed', 'failed', 'cancelled'].includes(report.status)) return taskId
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('batch did not finish')
}

async function itemsOf(engine: ApiEngine, taskId: string): Promise<CrawlPage[]> {
  return (await engine.getBatchItems(taskId, { limit: 50, debug: true }))!.items
}

/** The person: what they do in each tab W2L opens, by its path. */
function person(context: BrowserContext, acts: Record<string, (page: Page) => Promise<void>>): () => void {
  const listener = (page: Page) => {
    void (async () => {
      await page.waitForURL((url) => url.href.startsWith(base), { timeout: 20_000 })
      await acts[new URL(page.url()).pathname]?.(page)
    })().catch(() => undefined)
  }
  context.on('page', listener)
  return () => context.off('page', listener)
}

describe('handing a page a check stopped to the person, in their own Chrome', () => {
  it('the stopped item waits for the person; once they are through, W2L reads the page there and the item is the page', async () => {
    const engine = engineFor(join(root, 'tasks-1'))
    const opened: string[] = []
    const seen = (page: Page) => { opened.push(page.url()) }
    chrome.on('page', seen)
    const stop = person(chrome, { '/gate': async (page) => { await page.click('#pass') } })
    try {
      const taskId = await batchOf(engine, ['/gate', '/open'])
      expect(await engine.getBatch(taskId)).toMatchObject({ status: 'completed', waitingForPerson: 1 })
      const stopped = (await itemsOf(engine, taskId)).find((item) => item.url.endsWith('/gate'))!
      expect(stopped).toMatchObject({ status: 'blocked', blockReason: 'captcha', handoff: { reason: 'captcha_required', liveViewUrl: null } })
      expect((await itemsOf(engine, taskId)).find((item) => item.url.endsWith('/open'))!.handoff).toBeUndefined()

      const done = await engine.handOffBatch(taskId, {})
      expect(done).toMatchObject({ id: taskId, handedOff: 1, through: 1, notThrough: 0, items: [{ id: stopped.id, url: `${base}/gate`, through: true, status: 'success' }] })
      // W2L opened one tab, blank first, for the stopped page alone, and closed it when it had read it.
      expect(opened).toEqual(['about:blank'])
      for (let i = 0; i < 40 && chrome.pages().some((page) => page.url().startsWith(base)); i++) await new Promise((resolve) => setTimeout(resolve, 50))
      expect(chrome.pages().some((page) => page.url().startsWith(base))).toBe(false)

      const item = (await itemsOf(engine, taskId)).find((entry) => entry.url.endsWith('/gate'))!
      expect(item).toMatchObject({ id: stopped.id, status: 'success', lane: 'browser_local_authed', blockReason: null, evidence: { contentType: 'text/html; charset=utf-8', httpStatus: 200 } })
      expect(item.handoff).toBeUndefined()
      expect(item.markdown).toContain('What is behind the check')
      // W2L sent nothing for it: the person's browser did, as them; no hint speaks of W2L's own lanes, whose run it replaced.
      expect(item.evidenceRecord).toMatchObject({ lane: 'browser_local_authed', status: 'success', identity: { mode: 'authed', userAgent: null }, robotsDecision: { decision: 'no_robots' } })
      expect(item.trace.map((event) => event.event)).toContain('user_browser_read')
      expect(item.audit).toBeUndefined()
      expect(JSON.stringify(item.agentHints ?? [])).not.toContain('lane served')
      expect(await engine.getBatch(taskId)).toMatchObject({ waitingForPerson: 0, succeeded: 2, failed: 0 })
      expect(await engine.handOffBatch(taskId, {})).toMatchObject({ handedOff: 0, items: [] })
    } finally {
      stop()
      chrome.off('page', seen)
      await engine.close()
    }
  }, 120_000)

  it('a sign-in with a code is waited for while the person is at it, and the page read after', async () => {
    const engine = engineFor(join(root, 'tasks-2'))
    const stop = person(chrome, {
      '/account': async (page) => {
        await page.click('#in')
        await page.waitForSelector('#code')
        // The person takes their time with the code: W2L does not read the code page.
        await page.click('#code')
        await page.waitForTimeout(4_000)
        await page.click('#go')
      },
    })
    try {
      const taskId = await batchOf(engine, ['/account'])
      expect((await itemsOf(engine, taskId))[0]).toMatchObject({ status: 'blocked', blockReason: 'login_wall', handoff: { reason: 'login_required' } })
      expect(await engine.handOffBatch(taskId, {})).toMatchObject({ through: 1 })
      expect((await itemsOf(engine, taskId))[0]!.markdown).toContain('What is behind the check')
    } finally {
      stop()
      await engine.close()
    }
  }, 120_000)

  it('a page not got through (a check its header alone says, or nothing on the page after) keeps its stopped result, and still waits', async () => {
    const engine = engineFor(join(root, 'tasks-3'))
    const stop = person(chrome, { '/thin': async (page) => { await page.click('#pass') } })
    try {
      const taskId = await batchOf(engine, ['/dd', '/thin'])
      const before = await itemsOf(engine, taskId)
      expect(before.map((item) => [new URL(item.url).pathname, item.status, item.blockReason])).toEqual([['/dd', 'blocked', 'bot_detected_generic'], ['/thin', 'blocked', 'captcha']])
      const done = await engine.handOffBatch(taskId, { waitMs: 6_000 })
      expect(done).toMatchObject({ handedOff: 2, through: 0, notThrough: 2 })
      expect(done!.items.map((item) => item.reason)).toEqual([expect.stringContaining('still showed a check (bot_detected_generic: header_x_datadome'), expect.stringContaining('was failed (empty_unverified), not the page')])
      const after = await itemsOf(engine, taskId)
      expect(after.map((item) => [item.id, item.status, item.blockReason, item.lane])).toEqual(before.map((item) => [item.id, item.status, item.blockReason, item.lane]))
      expect(await engine.getBatch(taskId)).toMatchObject({ waitingForPerson: 2 })
    } finally {
      stop()
      await engine.close()
    }
  }, 120_000)

  it('a search box with the focus, a hidden sign-in box, a challenge reloading by itself, or a widget script left on the page does not stop a page from being through', async () => {
    const engine = engineFor(join(root, 'tasks-5'))
    // The challenge reloads into the page by itself; the person then clicks on the page to have it read.
    const stop = person(chrome, { '/search': async (page) => { await page.click('#pass') }, '/turnstile': async (page) => { await page.click('#pass') }, '/jsc': async (page) => { await page.waitForSelector('article', { timeout: 20_000 }); await page.mouse.click(10, 10) } })
    try {
      const taskId = await batchOf(engine, ['/search', '/jsc', '/turnstile'])
      const done = await engine.handOffBatch(taskId, { waitMs: 20_000 })
      expect(done).toMatchObject({ handedOff: 3, through: 3 })
    } finally {
      stop()
      await engine.close()
    }
  }, 120_000)

  it('a sign-in that ends on the home page is followed back to the page asked for; once signed in, a page with nothing to do is not read', async () => {
    const engine = engineFor(join(root, 'tasks-8'))
    const stop = person(chrome, { '/signin': async (page) => { await page.click('#in') } })
    try {
      const first = await batchOf(engine, ['/orders'])
      expect((await itemsOf(engine, first))[0]).toMatchObject({ status: 'blocked', blockReason: 'login_wall' })
      expect(await engine.handOffBatch(first, {})).toMatchObject({ through: 1 })
      const item = (await itemsOf(engine, first))[0]!
      expect(item.markdown).toContain('Your orders')
      expect(item.evidence?.finalUrl).toBe(`${base}/orders`)
      // The person is signed in now: a page their Chrome shows them clear, that they do not click on, is their session's, and not read.
      const second = await batchOf(engine, ['/orders'])
      const done = await engine.handOffBatch(second, { waitMs: 6_000 })
      expect(done).toMatchObject({ through: 0, items: [{ reason: expect.stringContaining('you did not click on it to have it read') }] })
      expect((await itemsOf(engine, second))[0]).toMatchObject({ status: 'blocked' })
    } finally {
      stop()
      await engine.close()
    }
  }, 120_000)

  it('a check that passes by itself in the browser, with nobody at it, is not read', async () => {
    const engine = engineFor(join(root, 'tasks-9'))
    try {
      const taskId = await batchOf(engine, ['/auto', '/meta'])
      expect((await itemsOf(engine, taskId)).map((item) => item.status)).toEqual(['blocked', 'blocked'])
      const done = await engine.handOffBatch(taskId, { waitMs: 6_000 })
      expect(done).toMatchObject({ through: 0, notThrough: 2 })
      expect(done!.items.every((item) => item.reason?.includes('you did not click on it to have it read'))).toBe(true)
    } finally {
      await engine.close()
    }
  }, 120_000)

  it('the person closing the tab ends the wait for that page at once', async () => {
    const engine = engineFor(join(root, 'tasks-7'))
    const stop = person(chrome, { '/dd': async (page) => { await page.waitForTimeout(1_500); await page.close() } })
    try {
      const taskId = await batchOf(engine, ['/dd'])
      const started = Date.now()
      const done = await engine.handOffBatch(taskId, { waitMs: 60_000 })
      expect(Date.now() - started).toBeLessThan(10_000)
      expect(done).toMatchObject({ through: 0, items: [{ reason: expect.stringContaining('was closed, or Chrome quit') }] })
    } finally {
      stop()
      await engine.close()
    }
  }, 120_000)

  it('W2L shutting down ends a handoff waiting for the person, closes its tab and stores nothing', async () => {
    const engine = engineFor(join(root, 'tasks-6'))
    const taskId = await batchOf(engine, ['/dd'])
    const started = Date.now()
    const handing = engine.handOffBatch(taskId, { waitMs: 60_000 })
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    await engine.close()
    const done = await handing
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(done).toMatchObject({ through: 0, notThrough: 1, items: [{ reason: expect.stringContaining('cancelled') }] })
    for (let i = 0; i < 40 && chrome.pages().some((page) => page.url().startsWith(base)); i++) await new Promise((resolve) => setTimeout(resolve, 50))
    expect(chrome.pages().some((page) => page.url().startsWith(base))).toBe(false)
  }, 120_000)

  it('a Chrome that quits during the wait ends the handoff, and the batch can be handed over again', async () => {
    const quitting = await chromium.launchPersistentContext(join(root, 'chrome-quits'), { args: ['--remote-debugging-port=0'] })
    const engine = engineFor(join(root, 'tasks-4'), join(root, 'chrome-quits'))
    try {
      const taskId = await batchOf(engine, ['/gate', '/dd'])
      setTimeout(() => { void quitting.close() }, 2_000)
      const started = Date.now()
      const done = await engine.handOffBatch(taskId, {})
      expect(Date.now() - started).toBeLessThan(20_000)
      expect(done).toMatchObject({ handedOff: 2, through: 0, notThrough: 2 })
      expect(done!.items[0]!.reason).toContain('Chrome quit')
      // Not left "being handed over": a second handoff runs, and finds Chrome gone.
      await expect(engine.handOffBatch(taskId, {})).rejects.toThrow(/DevToolsActivePort|did not accept|closed the connection|connect/i)
    } finally {
      await engine.close()
    }
  }, 120_000)
})
