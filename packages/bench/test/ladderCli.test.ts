import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buildChannels, parseArgs } from '../src/ladderCli.js'
import { LadderRunner } from '../src/routing/ladder.js'
import { evaluateVendorPolicy, REFUSED_CAPABILITIES } from '@w2l/http-core'
import type { SessionSnapshot } from '../src/routing/sessionStore.js'
import type { CdpBrowser } from '../src/vendors/cdp.js'
import type { VendorOps, VendorSession } from '../src/vendors/transport.js'

// A real server for the authed-session rung test: proves the REAL
// BrowserLocalSubject sends the session's cookies, not that a fake channel
// was handed a snapshot.
let authServer: Server
let authBase: string

beforeAll(async () => {
  authServer = createServer((req, res) => {
    if (req.url === '/echo-cookie') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      const cookie = req.headers.cookie ?? '(none)'
      res.end(
        '<html><body><article><h1>Cookie echo</h1>' +
        `<p>${cookie}</p>` +
        '<p>The session cookies sent by the real browser are echoed back above. This paragraph exists so the extractor has real content to work with, and the sentence continues at some length.</p>' +
        '</article></body></html>',
      )
    } else {
      res.writeHead(404)
      res.end('not found')
    }
  })
  await new Promise<void>((resolve) => authServer.listen(0, '127.0.0.1', resolve))
  authBase = `http://127.0.0.1:${(authServer.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => authServer.close(() => resolve()))
})

describe('ladder CLI arguments', () => {
  it('defaults to standard mode (http + browser only)', () => {
    expect(parseArgs(['https://example.com/p'])).toEqual({
      url: 'https://example.com/p',
      mode: 'standard',
      allowlistedDomains: [],
      sessionStoreFile: null,
      historyFile: null,
      handoff: false,
      persistSession: false,
      liveView: false,
    })
  })

  it('reads the persist-session / live-view flags, defaulting both off', () => {
    expect(parseArgs(['--persist-session', '--live-view', 'https://example.com/p'])).toMatchObject({
      persistSession: true,
      liveView: true,
    })
    expect(parseArgs(['https://example.com/p'])).toMatchObject({ persistSession: false, liveView: false })
  })

  it('reads research/authed mode flags', () => {
    expect(parseArgs(['--research', 'https://example.com/p']).mode).toBe('research')
    expect(parseArgs(['--authed', 'https://example.com/p']).mode).toBe('authed')
  })

  it('parses the domain allowlist', () => {
    expect(parseArgs(['--allowlist-hosts', 'example.com,*.example.net', 'https://example.com/p']).allowlistedDomains)
      .toEqual(['example.com', '*.example.net'])
    expect(parseArgs(['--allowlist-hosts=only.example', 'https://x.test/p']).allowlistedDomains)
      .toEqual(['only.example'])
  })

  it('parses session store / history file / handoff flags', () => {
    const args = parseArgs([
      '--session-store',
      '/tmp/sessions.json',
      '--history-file',
      '/tmp/history.json',
      '--handoff',
      'https://example.com/p',
    ])
    expect(args.sessionStoreFile).toBe('/tmp/sessions.json')
    expect(args.historyFile).toBe('/tmp/history.json')
    expect(args.handoff).toBe(true)
  })

  it('rejects unknown flags instead of ignoring them', () => {
    expect(() => parseArgs(['--stealth', 'https://example.com/p'])).toThrow(/unknown flag --stealth/)
  })

  it('requires a URL', () => {
    expect(() => parseArgs([])).toThrow(/usage: w2l-fetch/)
    expect(() => parseArgs(['nope'])).toThrow(/not a URL/)
  })
})

describe('buildChannels', () => {
  it('standard mode builds exactly the two local rungs, no vendors', () => {
    const channels = buildChannels('standard')
    expect(channels.map((c) => c.id)).toEqual(['http', 'browser_local'])
    expect(channels.every((c) => c.vendorId === undefined)).toBe(true)
  })

  it('research mode without a vendor key still builds only local rungs — the vendor rung does not exist', () => {
    const channels = buildChannels('research')
    expect(channels.map((c) => c.id)).toEqual(['http', 'browser_local'])
  })

  it('every channel exposes close() so the owner can release resources', () => {
    const channels = buildChannels('standard')
    for (const c of channels) expect(typeof c.close).toBe('function')
  })

  it('vendor connection is lazy: nothing connects while channels are built', () => {
    const connected: string[] = []
    const channels = buildChannels('research', { onVendorConnect: (id) => connected.push(id) })
    // Building the channels (which would create paid sessions in the eager
    // design) must not touch the vendor.
    expect(connected).toEqual([])
    expect(channels.map((c) => c.id)).toEqual(['http', 'browser_local'])
  })
})

// --- lazy vendor connection -------------------------------------------------

function fakeBrowser(): CdpBrowser {
  const page = {
    async goto() {
      return {
        status: () => 200,
        headers: () => ({ 'Content-Type': 'text/html' }),
        request: () => ({ headers: () => ({ 'User-Agent': 'TestUA/1.0' }) }),
      }
    },
    async evaluate(expression: string) {
      return expression === 'navigator.userAgent' ? 'TestUA/1.0' : null
    },
    async waitForTimeout() {},
    async content() {
      return (
        '<html><body><article><h1>Rendered by vendor</h1>' +
        '<p>The vendor browser executed the page script and this paragraph is the ' +
        'proof that a rendered document, not a shell, came back from the fetch.</p>' +
        '</article></body></html>'
      )
    },
    url: () => 'about:blank',
    async close() {},
  }
  const context = {
    pages: () => [],
    newPage: async () => page,
  }
  return {
    contexts: () => [context],
    async close() {},
  }
}

function fakeVendorOps(vendorId: string, onCreate: (resume: unknown) => void, opts: { persist?: boolean } = {}): VendorOps {
  return {
    vendorId,
    secrets: [],
    decision: evaluateVendorPolicy([
      { capability: 'headless_browser', vendorDefaultOn: true, enableKey: null },
      { capability: 'datacenter_proxy', vendorDefaultOn: true, enableKey: null },
      { capability: 'captcha_solving', vendorDefaultOn: true, enableKey: 'captcha_solving' },
    ]),
    async ensurePersistence() {
      return opts.persist === true ? { browserbaseContextId: 'ctx-from-ensure' } : null
    },
    async createSession(resume?: unknown): Promise<VendorSession> {
      onCreate(resume ?? null)
      const contextId = (resume as { browserbaseContextId?: string } | null)?.browserbaseContextId
      return {
        sessionId: 'fake-1',
        connectUrl: 'wss://fake.example/session',
        handoffUrl: null,
        resumeContext:
          contextId !== undefined && contextId !== null
            ? { browserbaseContextId: contextId }
            : null,
      }
    },
    async releaseSession() {},
  }
}

describe('lazy vendor connection', () => {
  it('does not create a vendor session while channels are built, only when the provider rung runs', async () => {
    const created: string[] = []
    const connected: string[] = []
    const channels = buildChannels('research', {
      vendorOps: { steel: fakeVendorOps('steel', () => created.push('steel')) },
      onVendorConnect: (id) => connected.push(id),
      vendorConnector: async () => fakeBrowser(),
      robotsFetcher: async () => ({
        text: 'User-agent: *\nDisallow:\n',
        status: 200,
        contentType: 'text/plain',
      }),
    })

    // Build time: zero vendor activity. The paid session must not exist yet.
    expect(created).toEqual([])
    expect(connected).toEqual([])

    const provider = channels.find((c) => c.vendorId === 'steel')!
    const result = await provider.fetch('https://example.com/p')

    // Fetch time: exactly one connection, and only now.
    expect(created).toEqual(['steel'])
    expect(connected).toEqual(['steel'])
    expect(result.status).toBe('success')

    // The session is reused on the second fetch — still exactly one session.
    await provider.fetch('https://example.com/p')
    expect(created).toEqual(['steel'])

    await Promise.all(channels.map((c) => c.close?.().catch(() => {})))
  })

  it('a URL governance refuses never reaches the vendor — zero vendor API calls', async () => {
    const created: string[] = []
    const channels = buildChannels('research', {
      vendorOps: { steel: fakeVendorOps('steel', () => created.push('steel')) },
      vendorConnector: async () => fakeBrowser(),
      robotsFetcher: async () => ({ text: 'User-agent: *\nDisallow:\n', status: 200, contentType: 'text/plain' }),
    })
    const runner = new LadderRunner(channels, {
      mode: 'research',
      allowlistedDomains: ['allowed.example'],
    })
    const run = await runner.run('https://blocked.example/p')
    expect(run.result.failureReason).toBe('policy_denied')
    expect(run.channelsTried).toEqual([])
    expect(created).toEqual([])
    await Promise.all(channels.map((c) => c.close?.().catch(() => {})))
  })

  it('first-use persistence: ensurePersistence runs BEFORE the first session, which receives the contextId', async () => {
    const createdResumes: unknown[] = []
    const channels = buildChannels('research', {
      vendorOps: {
        steel: fakeVendorOps('steel', (resume) => createdResumes.push(resume), { persist: true }),
      },
      vendorConnector: async () => fakeBrowser(),
      robotsFetcher: async () => ({ text: 'User-agent: *\nDisallow:\n', status: 200, contentType: 'text/plain' }),
    })
    const provider = channels.find((c) => c.vendorId === 'steel')!
    const result = await provider.fetch('https://example.com/p')

    // The FIRST createSession already carries the context the gate was
    // evaluated for — never a second session created after the fact.
    expect(createdResumes[0]).toEqual({ browserbaseContextId: 'ctx-from-ensure' })
    expect(result.status).toBe('success')
    expect(result.resumeContext).toEqual({ browserbaseContextId: 'ctx-from-ensure' })
    await Promise.all(channels.map((c) => c.close?.().catch(() => {})))
  })

  it('the refusal posture stays intact in the test ops — REFUSED_CAPABILITIES unchanged', () => {
    expect(REFUSED_CAPABILITIES).toContain('captcha_solving')
  })
})

describe('authed_session rung (real BrowserLocalSubject)', () => {
  it('the real browser sends the session cookies restored from the snapshot', async () => {
    const channels = buildChannels('authed')
    const authed = channels.find((c) => c.id === 'authed_session')!
    expect(authed).toBeDefined()

    const host = new URL(authBase).hostname
    const snapshot: SessionSnapshot = {
      domain: host,
      attestedBy: 'operator@example.com',
      attestedAt: '2026-08-22T00:00:00.000Z',
      vendor: 'browser_local_authed',
      principal: 'operator@example.com',
      statement: 'I authorize fetches under this session for this domain.',
      cookies: [{ name: 'sid', value: 'secret-value', domain: host, path: '/' }],
      // A Playwright storageState blob carrying a second cookie: the real
      // context creation must restore it alongside the explicit cookies.
      storageState: JSON.stringify({
        cookies: [{ name: 'ss-cookie', value: 'from-storage-state', domain: host, path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }],
        origins: [],
      }),
    }

    try {
      const result = await authed.fetch(`${authBase}/echo-cookie`, snapshot)
      expect(result.status).toBe('success')
      expect(result.markdown).toContain('sid=secret-value')
      expect(result.markdown).toContain('ss-cookie=from-storage-state')
    } finally {
      await Promise.all(channels.map((c) => c.close?.().catch(() => {})))
    }
  })

  it('a snapshot scoped to another domain is refused, not misapplied', async () => {
    const channels = buildChannels('authed')
    const authed = channels.find((c) => c.id === 'authed_session')!
    const snapshot: SessionSnapshot = {
      domain: 'other.example',
      attestedBy: 'operator@example.com',
      attestedAt: '2026-08-22T00:00:00.000Z',
      vendor: 'browser_local_authed',
      cookies: [{ name: 'sid', value: 'secret-value', domain: 'other.example', path: '/' }],
    }
    try {
      await expect(authed.fetch(`${authBase}/echo-cookie`, snapshot)).rejects.toThrow(
        /does not match/,
      )
    } finally {
      await Promise.all(channels.map((c) => c.close?.().catch(() => {})))
    }
  })

  it('a vendor resume handed to the authed rung is refused as a mismatch', async () => {
    const channels = buildChannels('authed')
    const authed = channels.find((c) => c.id === 'authed_session')!
    const snapshot: SessionSnapshot = {
      domain: new URL(authBase).hostname,
      attestedBy: 'operator@example.com',
      attestedAt: '2026-08-22T00:00:00.000Z',
      vendor: 'steel',
      resume: { steelProfileId: 'prof-1' },
    }
    try {
      await expect(authed.fetch(`${authBase}/echo-cookie`, snapshot)).rejects.toThrow(
        /does not match/,
      )
    } finally {
      await Promise.all(channels.map((c) => c.close?.().catch(() => {})))
    }
  })
})
