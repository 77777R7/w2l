import { describe, expect, it } from 'vitest'
import { verifyLedger, type ProviderDeclaration } from '@w2l/http-core'
import {
  ProviderSubject,
  type ProviderResponse,
  type ProviderTransport,
  type RobotsFetcher,
} from '../src/subjects/provider.js'

/**
 * The provider lane's whole risk is that outsourcing the fetch outsources the
 * violation. These tests are about the gate holding in the fetch path — not
 * just being computable — so the counting transport is the point: a refused
 * provider must record ZERO calls, not a call whose result we discarded.
 */

const AMAZON_SHAPED = [
  'User-agent: *',
  'Disallow: /gp/cart',
  '',
  'User-agent: Scrapy',
  'Disallow: /',
].join('\n')

const PAGE =
  '<!doctype html><html><body><article><h1>Cobalt ash kettle</h1>' +
  '<p>A stoneware pour-over kettle with four spouts for even infusion, fired to ' +
  'cone ten in a reduction atmosphere so the cobalt ash glaze breaks blue over the ' +
  'shoulder and pools green in the throat of each spout.</p>' +
  '<p>The handle is pulled rather than cast, which leaves the maker thumbprint at ' +
  'the root where it joins the body of the vessel itself.</p></article></body></html>'

class CountingTransport implements ProviderTransport {
  calls: string[] = []
  constructor(private readonly response: Partial<ProviderResponse> = {}) {}
  async fetch(url: string): Promise<ProviderResponse> {
    this.calls.push(url)
    return {
      status: 200,
      body: PAGE,
      finalUrl: url,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      ...this.response,
    }
  }
}

class ThrowingTransport implements ProviderTransport {
  calls: string[] = []
  async fetch(url: string): Promise<ProviderResponse> {
    this.calls.push(url)
    throw new Error('vendor 502: session pool exhausted')
  }
}

function robotsServing(text: string, over: Partial<{ status: number; contentType: string }> = {}) {
  const fetches: string[] = []
  const fetcher: RobotsFetcher = async (robotsUrl, ua) => {
    fetches.push(`${robotsUrl} ${ua}`)
    return { text, status: over.status ?? 200, contentType: over.contentType ?? 'text/plain' }
  }
  return { fetcher, fetches }
}

function decl(over: Partial<ProviderDeclaration> = {}): ProviderDeclaration {
  return {
    id: 'browserbase',
    declaredUserAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
    capabilities: ['headless_browser', 'datacenter_proxy'],
    honoursCallerUserAgent: false,
    ...over,
  }
}

describe('ProviderSubject robots gate', () => {
  it('fetches through the provider when robots allows its UA', async () => {
    const transport = new CountingTransport()
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(decl(), transport, 'standard', null, fetcher)

    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    expect(out.status).toBe('success')
    expect(out.lane).toBe('provider')
    expect(out.markdown).toContain('four spouts for even infusion')
    expect(transport.calls).toHaveLength(1)
  })

  it('evaluates robots under the PROVIDER UA, not ours', async () => {
    const transport = new CountingTransport()
    const { fetcher, fetches } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(
      decl({ declaredUserAgent: 'ProviderBot/2.0' }),
      transport,
      'standard',
      null,
      fetcher,
    )
    await subject.fetch('https://shop.example/dp/B0TEST')
    // Even the robots.txt request goes out under their identity: the question
    // being asked is what THEY are permitted, not what we are.
    expect(fetches[0]).toContain('ProviderBot/2.0')
  })

  it('refuses, without touching the origin, when robots bans the provider UA', async () => {
    const transport = new CountingTransport()
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(
      decl({ id: 'scrapling', declaredUserAgent: 'Scrapy/2.11 (+https://scrapy.org)' }),
      transport,
      'standard',
      null,
      fetcher,
    )

    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    expect(out.status).toBe('failed')
    expect(out.failureReason).toBe('policy_denied')
    // The load-bearing assertion. Routing to a banned UA would not avoid the
    // violation, it would arrange it — so the request must not happen at all.
    expect(transport.calls).toEqual([])
  })

  it('mints a record citing the rule that refused it', async () => {
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(
      decl({ declaredUserAgent: 'Scrapy/2.11' }),
      new CountingTransport(),
      'standard',
      null,
      fetcher,
    )
    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    const record = out.compliance!
    expect(record.robots.decision).toBe('disallowed')
    expect(record.robots.skippedFetch).toBe(true)
    expect(record.robots.matchedUserAgentGroup).toBe('scrapy')
    expect(record.robots.appliedRules).toEqual([{ pattern: '/', allow: false }])
    expect(record.robots.robotsSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('records the provider UA as what went on the wire', async () => {
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(
      decl({ declaredUserAgent: 'ProviderBot/2.0' }),
      new CountingTransport(),
      'standard',
      null,
      fetcher,
    )
    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    // Recording our own UA here would be a lie about a request we did not send.
    expect(out.compliance!.sentHeaders.headers).toEqual([
      { name: 'user-agent', value: 'ProviderBot/2.0' },
    ])
  })

  it('applies wildcard path rules to a benign provider UA', async () => {
    const transport = new CountingTransport()
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(decl(), transport, 'standard', null, fetcher)
    const out = await subject.fetch('https://shop.example/gp/cart/view.html')
    expect(out.failureReason).toBe('policy_denied')
    expect(transport.calls).toEqual([])
  })

  it('fetches robots once per origin, not once per page', async () => {
    const { fetcher, fetches } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(decl(), new CountingTransport(), 'standard', null, fetcher)
    await subject.fetch('https://shop.example/dp/A')
    await subject.fetch('https://shop.example/dp/B')
    await subject.fetch('https://shop.example/dp/C')
    expect(fetches).toHaveLength(1)
  })

  it('treats a 404 robots.txt as a real full allow', async () => {
    const transport = new CountingTransport()
    const { fetcher } = robotsServing('', { status: 404 })
    const subject = new ProviderSubject(decl(), transport, 'standard', null, fetcher)
    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    expect(out.status).toBe('success')
    expect(out.compliance!.robots.decision).toBe('no_robots')
  })

  it('does not parse an HTML soft-404 as a rules document', async () => {
    const { fetcher } = robotsServing('<!doctype html><html><body>Not found</body></html>', {
      contentType: 'text/html; charset=utf-8',
    })
    const subject = new ProviderSubject(decl(), new CountingTransport(), 'standard', null, fetcher)
    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    expect(out.status).toBe('success')
    expect(out.compliance!.robots.decision).toBe('no_robots')
    expect(out.compliance!.robots.robotsSha256).toBeNull()
  })
})

describe('ProviderSubject capability refusal', () => {
  it('refuses an evasion provider before any network call at all', async () => {
    const transport = new CountingTransport()
    const robotsFetches: string[] = []
    const fetcher: RobotsFetcher = async (u) => {
      robotsFetches.push(u)
      return { text: '', status: 404, contentType: 'text/plain' }
    }
    const subject = new ProviderSubject(
      decl({ id: 'evasion-vendor', capabilities: ['headless_browser', 'captcha_solving'] }),
      transport,
      'standard',
      null,
      fetcher,
    )

    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    expect(out.failureReason).toBe('policy_denied')
    expect(transport.calls).toEqual([])
    // Not even robots.txt: we are not going to use this provider under any
    // rules, so there is no reason to touch the origin to find that out.
    expect(robotsFetches).toEqual([])
  })

  it('refuses a provider that will not declare its UA', async () => {
    const transport = new CountingTransport()
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(
      decl({ declaredUserAgent: null }),
      transport,
      'standard',
      null,
      fetcher,
    )
    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    expect(out.failureReason).toBe('policy_denied')
    expect(transport.calls).toEqual([])
  })

  it('puts the refusal reason in the trace, verbatim', async () => {
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(
      decl({ id: 'evasion-vendor', capabilities: ['captcha_solving'] }),
      new CountingTransport(),
      'standard',
      null,
      fetcher,
    )
    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    const refused = out.trace.find((t) => t.event === 'provider_refused')
    expect(refused).toBeDefined()
    expect(JSON.stringify(refused!.detail)).toContain('captcha_solving')
  })
})

describe('ProviderSubject result mapping', () => {
  it('blames the vendor, not the publisher, when the transport throws', async () => {
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(decl(), new ThrowingTransport(), 'standard', null, fetcher)
    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    expect(out.status).toBe('failed')
    expect(out.failureReason).toBe('provider_error')
    expect(out.compliance).toBeNull()
  })

  it('classifies an origin challenge as blocked, not as a plain http_error', async () => {
    const transport = new CountingTransport({
      status: 403,
      headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
      body: '<!doctype html><html><head><title>Just a moment...</title></head><body><h1>Just a moment...</h1><p>Enable JavaScript and cookies to continue.</p></body></html>',
    })
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(decl(), transport, 'standard', null, fetcher)
    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    expect(out.status).toBe('blocked')
    expect(out.blockReason).toBe('cloudflare_challenge')
  })

  it('offers no further lane when a detection gate holds at the provider', async () => {
    // A challenge the provider could not clear has no honest next step: every
    // remaining lane is weaker at exactly this, and the only thing that would
    // "work" is the stealth layer we refuse to build.
    const transport = new CountingTransport({
      status: 403,
      headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
      body: '<!doctype html><html><head><title>Just a moment...</title></head><body><h1>Just a moment...</h1><p>Enable JavaScript and cookies to continue.</p></body></html>',
    })
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(decl(), transport, 'standard', null, fetcher)
    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    expect(out.blockReason).toBe('cloudflare_challenge')
    expect(out.escalations).toEqual([])
  })

  it('still hands a login wall back to the user, who has the account', async () => {
    // The counterpart: `provider` is not a dead end for everything. A login
    // wall is not a detection problem, it is a credentials problem, and the
    // user is the one who legitimately holds them.
    const transport = new CountingTransport({
      status: 401,
      headers: { 'content-type': 'text/html' },
      body: '<!doctype html><html><head><title>Sign in</title></head><body><h1>Sign in to continue</h1><form action="/login"><input type="password" name="password"></form></body></html>',
    })
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(decl(), transport, 'standard', null, fetcher)
    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    expect(out.status).toBe('blocked')
    expect(out.blockReason).toBe('login_wall')
    expect(out.escalations).toEqual([
      {
        from: 'provider',
        to: 'browser_local_authed',
        trigger: 'blocked:login_wall',
        improved: null,
      },
    ])
  })

  it('reports vendor cost only when the vendor stated it', async () => {
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const stated = new ProviderSubject(
      decl(),
      new CountingTransport({ costUsd: 0.0042 }),
      'standard',
      null,
      fetcher,
    )
    expect((await stated.fetch('https://shop.example/dp/A')).usage.externalCostUsd).toBe(0.0042)

    const silent = new ProviderSubject(decl(), new CountingTransport(), 'standard', null, fetcher)
    // Null, not an estimate: a guess in this field would read as a measurement.
    expect((await silent.fetch('https://shop.example/dp/B')).usage.externalCostUsd).toBeNull()
  })

  it('chains refusals and fetches into one verifiable ledger', async () => {
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(decl(), new CountingTransport(), 'standard', null, fetcher)
    await subject.fetch('https://shop.example/dp/A')
    await subject.fetch('https://shop.example/gp/cart/view.html') // refused
    await subject.fetch('https://shop.example/dp/B')

    const ledger = subject.ledger()
    expect(ledger.records).toHaveLength(3)
    const verdict = verifyLedger(ledger)
    expect(verdict.violations).toEqual([])
    expect(verdict.valid).toBe(true)
  })

  it('carries user access through the provider lane', async () => {
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(
      decl(),
      new CountingTransport(),
      'standard',
      {
        proxy: { url: 'http://gate.proxy.example:8080' },
        attestation: {
          principal: 'acct_test',
          at: '2026-08-21T09:00:00.000Z',
          statement: 'I own this proxy.',
        },
      },
      fetcher,
    )
    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    expect(out.compliance!.access.egressOwner).toBe('user')
    expect(out.compliance!.access.attestedBy).toBe('acct_test')
    expect(verifyLedger(subject.ledger()).valid).toBe(true)
  })
})
