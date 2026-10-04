import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createNetServer, type AddressInfo } from 'node:net'
import { ChromeLoginError, connectCdp, type CdpConnection } from '../src/chromeLogin.js'
import { HandoffNotThrough, openUserChrome } from '../src/chromeHandoff.js'

const GATE = '<html><body><div class="g-recaptcha" data-sitekey="k"></div></body></html>'
const PAGE = `<html><body><article><h1>Page</h1>${'<p>Prose long enough to be the page. </p>'.repeat(4)}</article></body></html>`

/** What the tab shows on one read; `active`: the person has clicked or typed on this document (its user activation, which only Chrome sets). */
type State = { href: string; ready?: string; status?: number | null; html: string; secret?: boolean; field?: string | null; active?: boolean }

/**
 * A Chrome that shows the tab W2L opens as `states`, one per read, the last
 * one from then on ('closed': the tab is gone). It has no events, as a
 * connection without them: the document's status is the page's own report.
 */
function fakeChrome(states: Array<State | 'closed' | 'moving'>, navigate: () => unknown = () => ({})) {
  const calls: string[] = []
  let read = 0
  let shown = ''
  const connect = async (): Promise<CdpConnection> => ({
    async send(method, params, sessionId) {
      calls.push(sessionId === undefined ? method : `${method}@${sessionId}`)
      if (method === 'Browser.getVersion') return { product: 'Chrome/144.0.7000.0' }
      if (method === 'Target.createTarget') return { targetId: `tab:${String((params as { url: string }).url)}` }
      if (method === 'Target.attachToTarget') return { sessionId: 's1' }
      if (method === 'Target.closeTarget') return {}
      if (method === 'Page.navigate') return navigate()
      if (method === 'Target.getTargetInfo') {
        // Chromium's own words for a closed tab.
        const next = states[Math.min(read, states.length - 1)]!
        if (next === 'closed') throw new ChromeLoginError('Chrome refused the request: No target with given id found')
        return { targetInfo: { url: next === 'moving' ? shown : next.href } }
      }
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 7 }
      if (method === 'Runtime.evaluate' && (params as { contextId?: number }).contextId === 7) {
        const state = states[Math.min(read - 1, states.length - 1)]!
        return { result: { value: typeof state === 'object' && state.active === true } }
      }
      if (method === 'Runtime.evaluate') {
        const state = states[Math.min(read++, states.length - 1)]!
        if (state === 'closed') throw new ChromeLoginError('Chrome refused the request: Session with given id not found.')
        if (state === 'moving') throw new ChromeLoginError('Chrome refused the request: Inspected target navigated or closed')
        shown = state.href
        // The page's script says it is elsewhere: Chrome's address is the one read.
        return { result: { value: JSON.stringify({ ready: 'complete', status: 200, secret: false, field: null, ...state, href: 'https://forged.test/' }) } }
      }
      throw new Error(`unexpected ${method}`)
    },
    close() { calls.push('close') },
  })
  return { calls, connect }
}

const at = (href: string, html: string, extra: Partial<State> = {}): State => ({ href, html, ...extra })

describe('the person\'s Chrome', () => {
  let userDataDir: string
  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'w2l-handoff-chrome-'))
    await mkdir(userDataDir, { recursive: true })
    await writeFile(join(userDataDir, 'DevToolsActivePort'), '9222\n/devtools/browser/x\n')
  })
  afterEach(async () => { await rm(userDataDir, { recursive: true, force: true }) })

  it('opens a blank tab, goes to the page, says when it shows a check, reads it once through on three reads, and closes the tab', async () => {
    const chrome = fakeChrome([at('https://site.test/a', GATE), at('https://site.test/a', PAGE, { active: true })])
    const reader = await openUserChrome({ userDataDir, connect: chrome.connect })
    const waiting: string[] = []
    const read = await reader.read('https://site.test/a', { pollMs: 1, waitMs: 5_000, onWaiting: (url, check) => waiting.push(`${url} ${check}`) })
    reader.close()
    expect(waiting).toEqual(['https://site.test/a captcha'])
    expect(read).toMatchObject({ requestedUrl: 'https://site.test/a', finalUrl: 'https://site.test/a', status: 200, contentType: null, html: PAGE, sawGate: 'captcha', act: 'user_activation', browser: 'Chrome/144.0.7000.0' })
    // Each read: the tab from the browser, the page, and, until the person has acted, their activation in W2L's own world (made once for the document).
    expect(chrome.calls).toEqual(['Browser.getVersion', 'Target.createTarget', 'Target.attachToTarget', 'Target.activateTarget', 'Page.navigate@s1',
      'Target.getTargetInfo', 'Runtime.evaluate@s1', 'Page.createIsolatedWorld@s1', 'Runtime.evaluate@s1',
      'Target.getTargetInfo', 'Runtime.evaluate@s1', 'Runtime.evaluate@s1',
      ...Array(2).fill(['Target.getTargetInfo', 'Runtime.evaluate@s1']).flat(), 'Target.closeTarget', 'close'])
  })

  it('a page that still shows its check when the wait ends is not read, and its tab is closed', async () => {
    const chrome = fakeChrome([at('https://site.test/a', GATE)])
    const reader = await openUserChrome({ userDataDir, connect: chrome.connect })
    const failure = await reader.read('https://site.test/a', { pollMs: 1, waitMs: 50 }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(HandoffNotThrough)
    expect(failure).toMatchObject({ check: 'captcha', message: expect.stringContaining('still showed a check (captcha: widget_recaptcha') })
    expect(chrome.calls).toContain('Target.closeTarget')
  })

  it('the person at a sign-in step of their own (a code field showing, a field whose value they change) is waited for', async () => {
    const chrome = fakeChrome([
      at('https://site.test/a', '<form><input autocomplete="one-time-code"></form>', { secret: true }),
      at('https://site.test/a', PAGE, { field: 'INPUT:4' }),
      at('https://site.test/a', PAGE, { field: 'INPUT:42' }),
      at('https://site.test/a', PAGE, { field: 'INPUT:421', active: true }),
      at('https://site.test/a', PAGE, { field: 'INPUT:421', active: true }),
    ])
    const reader = await openUserChrome({ userDataDir, connect: chrome.connect })
    await reader.read('https://site.test/a', { pollMs: 1, waitMs: 5_000 })
    // A sign-in read, three of typing (the field's value changed since the read before), then three clear: a field focused and unchanged is no step.
    expect(chrome.calls.filter((call) => call === 'Target.getTargetInfo')).toHaveLength(7)
  })

  it('a page between two documents is waited for, not taken for a closed tab; a slow navigation is waited for in the reads', async () => {
    const chrome = fakeChrome([at('https://site.test/a', GATE), 'moving', 'moving', at('https://site.test/a', PAGE, { active: true })], () => { throw new ChromeLoginError('Chrome did not answer Page.navigate within 30 s') })
    const reader = await openUserChrome({ userDataDir, connect: chrome.connect })
    expect(await reader.read('https://site.test/a', { pollMs: 1, waitMs: 5_000 })).toMatchObject({ html: PAGE })
  })

  it('a page that does not answer 2xx, or sits on a login path, is not through', async () => {
    for (const state of [at('https://site.test/a', PAGE, { status: 403 }), at('https://site.test/login?next=/a', PAGE)]) {
      const reader = await openUserChrome({ userDataDir, connect: fakeChrome([state]).connect })
      await expect(reader.read('https://site.test/a', { pollMs: 1, waitMs: 50 })).rejects.toThrow('it was not yet the page')
    }
  })

  it('a page that ends off the site asked for is not read as that site\'s', async () => {
    const chrome = fakeChrome([at('http://192.168.1.1/admin', PAGE)])
    const reader = await openUserChrome({ userDataDir, connect: chrome.connect })
    await expect(reader.read('https://site.test/a', { pollMs: 1, waitMs: 50 })).rejects.toThrow('it was on 192.168.1.1, not site.test')
  })

  it('the person\'s sign-in on another host of the site is waited for, and the page read once back on it', async () => {
    const chrome = fakeChrome([at('https://login.example.org/sso', PAGE, { secret: true }), at('https://www.site.test/a', PAGE, { active: true })])
    const reader = await openUserChrome({ userDataDir, connect: chrome.connect })
    expect(await reader.read('https://site.test/a', { pollMs: 1, waitMs: 5_000 })).toMatchObject({ finalUrl: 'https://www.site.test/a', sawGate: null })
  })

  it('a sign-in that ends on the home page: the tab is taken back to the page asked for, and that page is read', async () => {
    const home = '<html><body><article><h1>Welcome home</h1>' + '<p>The site\'s home page, long enough to be read. </p>'.repeat(4) + '</article></body></html>'
    const chrome = fakeChrome([at('https://site.test/a', GATE), ...Array(3).fill(at('https://site.test/', home, { active: true })), at('https://site.test/a', PAGE)])
    const reader = await openUserChrome({ userDataDir, connect: chrome.connect })
    expect(await reader.read('https://site.test/a', { pollMs: 1, waitMs: 5_000 })).toMatchObject({ finalUrl: 'https://site.test/a', html: PAGE })
    expect(chrome.calls.filter((call) => call.startsWith('Page.navigate'))).toHaveLength(2)
  })

  it('a way through that stays elsewhere on the site after the returns is not read', async () => {
    const home = '<html><body><article><h1>Welcome home</h1>' + '<p>The site\'s home page, long enough to be read. </p>'.repeat(4) + '</article></body></html>'
    const chrome = fakeChrome([at('https://site.test/a', GATE), at('https://site.test/', home, { active: true })])
    const reader = await openUserChrome({ userDataDir, connect: chrome.connect })
    await expect(reader.read('https://site.test/a', { pollMs: 1, waitMs: 5_000 })).rejects.toThrow('the tab stayed on /, not the page asked for')
    expect(chrome.calls.filter((call) => call.startsWith('Page.navigate'))).toHaveLength(3)
  })

  it('a page the person has not clicked or typed on is not read, whatever it does by itself; it is asked for once, and read once they click on it', async () => {
    const confirms: string[] = []
    const untouched = await openUserChrome({ userDataDir, connect: fakeChrome([at('https://site.test/a', PAGE)]).connect })
    await expect(untouched.read('https://site.test/a', { pollMs: 1, waitMs: 50, onConfirm: (url) => confirms.push(url) })).rejects.toThrow('you did not click on it to have it read')
    expect(confirms).toEqual(['https://site.test/a'])
    const clicked = await openUserChrome({ userDataDir, connect: fakeChrome([...Array(4).fill(at('https://site.test/a', PAGE)), at('https://site.test/a', PAGE, { active: true })]).connect })
    expect(await clicked.read('https://site.test/a', { pollMs: 1, waitMs: 5_000 })).toMatchObject({ html: PAGE, act: 'user_activation', sawGate: null })
  })

  it('a tab the person closed is not read', async () => {
    const chrome = fakeChrome([at('https://site.test/a', GATE), 'closed'])
    const reader = await openUserChrome({ userDataDir, connect: chrome.connect })
    await expect(reader.read('https://site.test/a', { pollMs: 1, waitMs: 5_000 })).rejects.toThrow('was closed, or Chrome quit, before W2L read it')
  })

  it('a Chrome that stops answering (quit, its socket not yet closed) ends the wait within a read\'s timeout', async () => {
    const asked: Array<number | undefined> = []
    const frozen = async (): Promise<CdpConnection> => ({
      async send(method, _params, _sessionId, timeoutMs) {
        if (method === 'Browser.getVersion') return { product: 'Chrome/144' }
        if (method === 'Target.createTarget') return { targetId: 't' }
        if (method === 'Target.attachToTarget') return { sessionId: 's1' }
        if (method === 'Page.navigate' || method === 'Target.closeTarget') return {}
        if (method === 'Target.getTargetInfo') {
          asked.push(timeoutMs)
          // connectCdp's own words when the time runs out.
          throw new ChromeLoginError(`Chrome did not answer Target.getTargetInfo within ${Math.round((timeoutMs ?? 30_000) / 1000)} s`)
        }
        throw new Error(`unexpected ${method}`)
      },
      close() {},
    })
    const reader = await openUserChrome({ userDataDir, connect: frozen })
    await expect(reader.read('https://site.test/a', { pollMs: 1, waitMs: 60_000 })).rejects.toThrow('was closed, or Chrome quit, before W2L read it')
    expect(asked).toEqual([10_000])
  })

  it('a caller that went away ends the wait', async () => {
    const reader = await openUserChrome({ userDataDir, connect: fakeChrome([at('https://site.test/a', GATE)]).connect })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 20)
    await expect(reader.read('https://site.test/a', { pollMs: 5, waitMs: 60_000, signal: controller.signal })).rejects.toThrow('was cancelled before W2L read it')
  })

  it('a cancel while Chrome waits for Allow drops the connection, and one Chrome opens after is not used', async () => {
    // A Chrome that holds the handshake: the socket opens, the upgrade never comes.
    const silent = createNetServer((socket) => { socket.on('error', () => undefined) })
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
    try {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 100)
      const started = Date.now()
      await expect(connectCdp(`ws://127.0.0.1:${(silent.address() as AddressInfo).port}/devtools/browser/x`, 60_000, controller.signal)).rejects.toThrow('cancelled')
      expect(Date.now() - started).toBeLessThan(5_000)
    } finally {
      silent.close()
    }
    const late = fakeChrome([])
    const controller = new AbortController()
    const opening = openUserChrome({ userDataDir, connect: async (...args) => { controller.abort(); return late.connect(...(args as [])) } }, controller.signal)
    await expect(opening).rejects.toThrow('cancelled')
    expect(late.calls).toEqual(['close'])
  })

  it('without remote debugging on, says how to turn it on', async () => {
    await rm(join(userDataDir, 'DevToolsActivePort'))
    await expect(openUserChrome({ userDataDir, connect: fakeChrome([]).connect })).rejects.toThrow(/chrome:\/\/inspect\/#remote-debugging/)
  })
})
