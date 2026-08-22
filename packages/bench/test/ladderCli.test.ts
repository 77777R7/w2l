import { describe, expect, it } from 'vitest'
import { buildChannels, parseArgs } from '../src/ladderCli.js'
import { LadderRunner } from '../src/routing/ladder.js'
import { evaluateVendorPolicy, REFUSED_CAPABILITIES } from '@w2l/http-core'
import type { CdpBrowser } from '../src/vendors/cdp.js'
import type { VendorOps, VendorSession } from '../src/vendors/transport.js'

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

function fakeVendorOps(vendorId: string, onCreate: () => void): VendorOps {
  return {
    vendorId,
    secrets: [],
    decision: evaluateVendorPolicy([
      { capability: 'headless_browser', vendorDefaultOn: true, enableKey: null },
      { capability: 'datacenter_proxy', vendorDefaultOn: true, enableKey: null },
      { capability: 'captcha_solving', vendorDefaultOn: true, enableKey: 'captcha_solving' },
    ]),
    async createSession(): Promise<VendorSession> {
      onCreate()
      return {
        sessionId: 'fake-1',
        connectUrl: 'wss://fake.example/session',
        handoffUrl: null,
        resumeContext: null,
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

  it('the refusal posture stays intact in the test ops — REFUSED_CAPABILITIES unchanged', () => {
    expect(REFUSED_CAPABILITIES).toContain('captcha_solving')
  })
})
