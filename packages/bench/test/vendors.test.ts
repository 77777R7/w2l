import { describe, expect, it } from 'vitest'
import { verifyLedger } from '@w2l/http-core'
import { ProviderSubject, type RobotsFetcher } from '../src/subjects/provider.js'
import { scrubSecret, type VendorApi, type VendorApiRequest, type VendorApiResponse } from '../src/vendors/api.js'
import type { CdpBrowser, CdpConnector, CdpContext, CdpPage, CdpResponse } from '../src/vendors/cdp.js'
import { browserbaseOps } from '../src/vendors/browserbase.js'
import { steelOps } from '../src/vendors/steel.js'
import { CdpVendorTransport } from '../src/vendors/transport.js'
import { connectVendor } from '../src/vendors/connect.js'

/**
 * Both vendors ship with evasion ON by default (Browserbase solves captchas
 * unless told not to; Steel injects a synthetic fingerprint unless told not
 * to). The session-create body is therefore the compliance claim, and these
 * tests pin it: a refactor that drops the explicit opt-out silently re-buys
 * the capability the gate refuses.
 *
 * The other half is identity. Browserbase has no session-level UA field and
 * Playwright over CDP is lower fidelity than its own protocol, so the design
 * measures the vendor's UA instead of imposing one. The tests hold that line
 * from both ends: the declaration must come from the live session, and a
 * declaration that stops matching must stop the fetch.
 */

const PAGE =
  '<!doctype html><html><body><article><h1>Cobalt ash kettle</h1>' +
  '<p>A stoneware pour-over kettle with four spouts for even infusion, fired to ' +
  'cone ten in a reduction atmosphere so the cobalt ash glaze breaks blue over the ' +
  'shoulder and pools green in the throat of each spout.</p>' +
  '<p>The handle is pulled rather than cast, which leaves the maker thumbprint at ' +
  'the root where it joins the body of the vessel itself.</p></article></body></html>'

const VENDOR_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.7390.37 Safari/537.36'

// --- vendor REST fake -------------------------------------------------------

class FakeApi {
  requests: VendorApiRequest[] = []
  constructor(private readonly respond: (req: VendorApiRequest) => VendorApiResponse) {}
  handler: VendorApi = async (req) => {
    this.requests.push(req)
    return this.respond(req)
  }
}

function sessionServing(sessionId: string, connectUrl = `wss://cdp.example/${sessionId}`) {
  return new FakeApi((req) =>
    req.method === 'POST' && req.url.endsWith('/v1/sessions')
      ? { status: 201, json: { id: sessionId, connectUrl } }
      : { status: 200, json: {} },
  )
}

// --- CDP fake ----------------------------------------------------------------

interface FakeScript {
  userAgent?: string
  status?: number
  headers?: Record<string, string>
  requestHeaders?: Record<string, string>
  /** Throw instead of surfacing request headers, like a thin CDP attachment. */
  hideRequestHeaders?: boolean
  body?: string
  finalUrl?: string
  gotoError?: Error
  /** Simulate a vendor that provisioned no context at all. */
  noContext?: boolean
}

interface FakeState {
  navigations: string[]
  pagesOpened: number
  pagesClosed: number
  closed: boolean
}

function fakeBrowser(script: FakeScript = {}): { browser: CdpBrowser; state: FakeState } {
  const state: FakeState = { navigations: [], pagesOpened: 0, pagesClosed: 0, closed: false }
  const ua = script.userAgent ?? VENDOR_UA

  const context: CdpContext = {
    pages: () => [],
    async newPage(): Promise<CdpPage> {
      state.pagesOpened++
      let current = 'about:blank'
      return {
        async goto(url: string): Promise<CdpResponse | null> {
          if (script.gotoError) throw script.gotoError
          state.navigations.push(url)
          current = script.finalUrl ?? url
          return {
            status: () => script.status ?? 200,
            headers: () => script.headers ?? { 'Content-Type': 'text/html; charset=utf-8' },
            request: () => ({
              headers: () => {
                if (script.hideRequestHeaders) throw new Error('request headers unavailable over CDP')
                return script.requestHeaders ?? { 'User-Agent': ua, Accept: '*/*' }
              },
            }),
          }
        },
        async evaluate(expression: string) {
          return expression === 'navigator.userAgent' ? ua : undefined
        },
        async waitForTimeout() {},
        async content() {
          return script.body ?? PAGE
        },
        url: () => current,
        async close() {
          state.pagesClosed++
        },
      }
    },
  }

  const browser: CdpBrowser = {
    contexts: () => (script.noContext ? [] : [context]),
    async close() {
      state.closed = true
    },
  }
  return { browser, state }
}

/** A connector that hands out one scripted browser per connection, in order. */
function connectorFor(...browsers: { browser: CdpBrowser; state: FakeState }[]) {
  const wsUrls: string[] = []
  let i = 0
  const connector: CdpConnector = async (wsUrl) => {
    wsUrls.push(wsUrl)
    const next = browsers[Math.min(i, browsers.length - 1)]!
    i++
    return next.browser
  }
  return { connector, wsUrls, connections: () => i }
}

// --- session bodies are the compliance claim ---------------------------------

describe('browserbase session config', () => {
  it('turns captcha solving OFF explicitly — the vendor default is ON', async () => {
    const api = sessionServing('bb_1')
    await browserbaseOps({ apiKey: 'bb_key' }, api.handler).createSession()

    const body = api.requests[0]!.body as { browserSettings: Record<string, unknown> }
    // Explicit false, not merely absent: absent means true on their side.
    expect(body.browserSettings.solveCaptchas).toBe(false)
    expect(body.browserSettings.advancedStealth).toBe(false)
  })

  it('authenticates with X-BB-API-Key against the documented endpoint', async () => {
    const api = sessionServing('bb_1')
    await browserbaseOps({ apiKey: 'bb_key' }, api.handler).createSession()
    expect(api.requests[0]!.url).toBe('https://api.browserbase.com/v1/sessions')
    expect(api.requests[0]!.headers['x-bb-api-key']).toBe('bb_key')
  })

  it('releases by requesting REQUEST_RELEASE on the session resource', async () => {
    const api = sessionServing('bb_1')
    const ops = browserbaseOps({ apiKey: 'bb_key' }, api.handler)
    await ops.createSession()
    await ops.releaseSession('bb_1')
    expect(api.requests[1]!.url).toBe('https://api.browserbase.com/v1/sessions/bb_1')
    expect(api.requests[1]!.body).toEqual({ status: 'REQUEST_RELEASE' })
  })

  it('surfaces a create failure with the vendor status, not a fake session', async () => {
    const api = new FakeApi(() => ({ status: 402, json: { error: 'payment required' } }))
    await expect(browserbaseOps({ apiKey: 'k' }, api.handler).createSession()).rejects.toThrow(
      'browserbase: session create returned 402',
    )
  })

  it('rejects a create response that omits connectUrl', async () => {
    const api = new FakeApi(() => ({ status: 201, json: { id: 'bb_1' } }))
    await expect(browserbaseOps({ apiKey: 'k' }, api.handler).createSession()).rejects.toThrow(
      'missing id/connectUrl',
    )
  })
})

describe('steel session config', () => {
  it('opts out of the default fingerprint injection, and declines solving', async () => {
    const api = sessionServing('st_1')
    await steelOps({ apiKey: 'steel_key' }, api.handler).createSession()

    const body = api.requests[0]!.body as {
      solveCaptcha: boolean
      stealthConfig: Record<string, unknown>
    }
    expect(body.solveCaptcha).toBe(false)
    // Steel injects a synthetic fingerprint BY DEFAULT; true here is the opt-out.
    expect(body.stealthConfig.skipFingerprintInjection).toBe(true)
    expect(body.stealthConfig.autoCaptchaSolving).toBe(false)
    expect(body.stealthConfig.humanizeInteractions).toBe(false)
  })

  it('builds the CDP endpoint per their docs instead of trusting websocketUrl', async () => {
    const api = sessionServing('st_1')
    const session = await steelOps({ apiKey: 'steel_key' }, api.handler).createSession()
    expect(session.connectUrl).toBe('wss://connect.steel.dev?apiKey=steel_key&sessionId=st_1')
    expect(api.requests[0]!.headers['steel-api-key']).toBe('steel_key')
  })

  it('releases via the release endpoint', async () => {
    const api = sessionServing('st_1')
    const ops = steelOps({ apiKey: 'steel_key' }, api.handler)
    await ops.createSession()
    await ops.releaseSession('st_1')
    expect(api.requests[1]!.url).toBe('https://api.steel.dev/v1/sessions/st_1/release')
  })
})

// --- identity is measured, not asserted ---------------------------------------

describe('vendor identity', () => {
  it('declares the UA the vendor session actually reports', async () => {
    const api = sessionServing('bb_1')
    const bb = fakeBrowser()
    const { connector } = connectorFor(bb)
    const { declaration } = await connectVendor(browserbaseOps({ apiKey: 'k' }, api.handler), connector)

    // Not a flattering string of our choosing — HeadlessChrome is what this
    // session runs, so HeadlessChrome is what robots.txt gets evaluated
    // against and what the publisher's access log will show.
    expect(declaration.declaredUserAgent).toBe(VENDOR_UA)
    expect(declaration.id).toBe('browserbase')
    // We do not impose an identity on the vendor, so this is false — and the
    // gate's "you could pass through our UA" hint correctly stays silent.
    expect(declaration.honoursCallerUserAgent).toBe(false)
  })

  it('measures the UA without touching any origin', async () => {
    const api = sessionServing('bb_1')
    const bb = fakeBrowser()
    const { connector } = connectorFor(bb)
    await connectVendor(browserbaseOps({ apiKey: 'k' }, api.handler), connector)

    // The load-bearing assertion: the probe page never navigated anywhere.
    // A probe request before the gate runs would be the exact ordering
    // violation this lane exists to prevent.
    expect(bb.state.navigations).toEqual([])
    expect(bb.state.pagesOpened).toBe(1)
    expect(bb.state.pagesClosed).toBe(1)
  })

  it('uses the vendor default context, never a fresh one', async () => {
    // Both vendors provision a live context and document contexts()[0]; a
    // newContext() would bypass the session-level proxy the caller pays for.
    // The fake exposes no newContext at all, so this passing is the proof.
    const api = sessionServing('bb_1')
    const bb = fakeBrowser()
    const { connector } = connectorFor(bb)
    const transport = new CdpVendorTransport(browserbaseOps({ apiKey: 'k' }, api.handler), connector)
    const res = await transport.fetch('https://shop.example/dp/A')
    expect(res.status).toBe(200)
  })

  it('fails clearly when the vendor provisioned no context', async () => {
    const api = sessionServing('bb_1')
    const bb = fakeBrowser({ noContext: true })
    const { connector } = connectorFor(bb)
    const transport = new CdpVendorTransport(browserbaseOps({ apiKey: 'k' }, api.handler), connector)
    await expect(transport.resolveUserAgent()).rejects.toThrow('exposed no browser context')
  })

  it('refuses to fetch when the session UA changes across reconnects', async () => {
    const api = sessionServing('bb_1')
    const first = fakeBrowser({ gotoError: new Error('Target closed') })
    const upgraded = fakeBrowser({ userAgent: VENDOR_UA.replace('141', '142') })
    const { connector } = connectorFor(first, upgraded)
    const transport = new CdpVendorTransport(browserbaseOps({ apiKey: 'k' }, api.handler), connector)

    await transport.resolveUserAgent() // pins the 141 string
    await expect(transport.fetch('https://shop.example/dp/A')).rejects.toThrow('Target closed')

    // The reconnect runs a different engine. The permission the gate granted
    // was for the old identity, so the honest move is to stop, not to keep
    // sending a UA this session cannot back.
    await expect(transport.fetch('https://shop.example/dp/A')).rejects.toThrow(
      /user agent changed from .*141.* to .*142/,
    )
    expect(upgraded.state.navigations).toEqual([])
    expect(upgraded.state.closed).toBe(true)
  })

  it('reconnects silently when the UA is unchanged', async () => {
    // The counterpart to the drift test: a dropped session is a normal event,
    // and recovering from it must not require the UA to have changed.
    const api = sessionServing('bb_1')
    const first = fakeBrowser({ gotoError: new Error('Target closed') })
    const same = fakeBrowser()
    const { connector } = connectorFor(first, same)
    const transport = new CdpVendorTransport(browserbaseOps({ apiKey: 'k' }, api.handler), connector)

    await expect(transport.fetch('https://shop.example/dp/A')).rejects.toThrow('Target closed')
    const res = await transport.fetch('https://shop.example/dp/A')
    expect(res.status).toBe(200)
    expect(same.state.navigations).toEqual(['https://shop.example/dp/A'])
  })
})

// --- the shared transport ------------------------------------------------------

describe('CdpVendorTransport', () => {
  it("reports the origin's status, never the vendor API's", async () => {
    // The vendor answered 201 (session created). The origin answered 403
    // behind a challenge. The transport must say 403.
    const api = sessionServing('bb_1')
    const bb = fakeBrowser({
      status: 403,
      headers: { 'Content-Type': 'text/html', 'CF-Mitigated': 'challenge' },
    })
    const { connector } = connectorFor(bb)
    const transport = new CdpVendorTransport(browserbaseOps({ apiKey: 'k' }, api.handler), connector)

    const res = await transport.fetch('https://shop.example/dp/B0TEST')
    expect(res.status).toBe(403)
    expect(res.headers['cf-mitigated']).toBe('challenge')
    // Neither vendor states a per-request price; an estimate would read as a
    // measurement, so this is null, not a guess.
    expect(res.costUsd).toBeNull()
  })

  it('reuses one session across fetches, one fresh page per fetch', async () => {
    const api = sessionServing('bb_1')
    const bb = fakeBrowser()
    const { connector, connections } = connectorFor(bb)
    const transport = new CdpVendorTransport(browserbaseOps({ apiKey: 'k' }, api.handler), connector)

    await transport.fetch('https://shop.example/dp/A')
    await transport.fetch('https://shop.example/dp/B')

    expect(connections()).toBe(1)
    expect(api.requests.filter((r) => r.url.endsWith('/v1/sessions'))).toHaveLength(1)
    // 1 UA probe + 2 fetches, every one closed.
    expect(bb.state.pagesOpened).toBe(3)
    expect(bb.state.pagesClosed).toBe(3)
  })

  it('drops and releases the session after a navigation failure', async () => {
    const api = sessionServing('bb_1')
    const broken = fakeBrowser({ gotoError: new Error('Target closed') })
    const healthy = fakeBrowser()
    const { connector } = connectorFor(broken, healthy)
    const transport = new CdpVendorTransport(browserbaseOps({ apiKey: 'k' }, api.handler), connector)

    await expect(transport.fetch('https://shop.example/dp/A')).rejects.toThrow('Target closed')
    // The dead session was released, not left running on the vendor's meter.
    expect(api.requests.some((r) => r.url === 'https://api.browserbase.com/v1/sessions/bb_1')).toBe(true)
    expect(broken.state.closed).toBe(true)
  })

  it('reports the observed request UA, and null when it cannot see one', async () => {
    const api = sessionServing('bb_1')
    const seen = fakeBrowser()
    const blind = fakeBrowser({ hideRequestHeaders: true })
    const { connector } = connectorFor(seen)
    const t1 = new CdpVendorTransport(browserbaseOps({ apiKey: 'k' }, api.handler), connector)
    expect((await t1.fetch('https://shop.example/dp/A')).sentUserAgent).toBe(VENDOR_UA)

    const { connector: c2 } = connectorFor(blind)
    const t2 = new CdpVendorTransport(browserbaseOps({ apiKey: 'k' }, api.handler), c2)
    // Null means UNOBSERVED. The subject must not read that as agreement.
    expect((await t2.fetch('https://shop.example/dp/A')).sentUserAgent).toBeNull()
  })

  it('scrubs the API key out of every error it throws', async () => {
    // Steel's CDP endpoint carries the key as a query parameter, and connect
    // errors echo the URL they were given. That echo must not reach a trace
    // or a bench artifact with the credential still in it.
    const api = sessionServing('st_1')
    const connector: CdpConnector = async (wsUrl) => {
      throw new Error(`WebSocket error connecting to ${wsUrl}`)
    }
    const transport = new CdpVendorTransport(steelOps({ apiKey: 'steel_secret_key' }, api.handler), connector)

    const err = await transport.fetch('https://shop.example/dp/A').catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain('steel_secret_key')
    expect((err as Error).message).toContain('<redacted>')
    // And the orphaned session was still released.
    expect(api.requests.some((r) => r.url.endsWith('/v1/sessions/st_1/release'))).toBe(true)
  })

  it('releases the session on close', async () => {
    const api = sessionServing('bb_1')
    const bb = fakeBrowser()
    const { connector } = connectorFor(bb)
    const transport = new CdpVendorTransport(browserbaseOps({ apiKey: 'k' }, api.handler), connector)
    await transport.fetch('https://shop.example/dp/A')
    await transport.close()
    expect(bb.state.closed).toBe(true)
    expect(api.requests.some((r) => r.url === 'https://api.browserbase.com/v1/sessions/bb_1')).toBe(true)
  })
})

// --- end to end through the gate ---------------------------------------------

const AMAZON_SHAPED = ['User-agent: *', 'Disallow: /gp/cart', '', 'User-agent: Scrapy', 'Disallow: /'].join('\n')

function robotsServing(text: string) {
  const fetches: string[] = []
  const fetcher: RobotsFetcher = async (robotsUrl, ua) => {
    fetches.push(`${robotsUrl} ${ua}`)
    return { text, status: 200, contentType: 'text/plain' }
  }
  return { fetcher, fetches }
}

describe('vendor transport behind the provider gate', () => {
  it('records the measured vendor UA as what went on the wire', async () => {
    const api = sessionServing('bb_1')
    const bb = fakeBrowser()
    const { connector } = connectorFor(bb)
    const { declaration, transport } = await connectVendor(
      browserbaseOps({ apiKey: 'k' }, api.handler),
      connector,
    )
    const { fetcher, fetches } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(declaration, transport, 'standard', null, fetcher)

    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    expect(out.status).toBe('success')
    expect(out.markdown).toContain('four spouts for even infusion')
    expect(out.compliance!.sentHeaders.headers).toEqual([{ name: 'user-agent', value: VENDOR_UA }])
    // robots.txt was fetched under the vendor's identity too — the question
    // being asked is what THEY are permitted.
    expect(fetches[0]).toContain(VENDOR_UA)
    expect(verifyLedger(subject.ledger()).valid).toBe(true)
  })

  it('flags a mismatch when the wire UA is not the gated UA', async () => {
    // The integration bug this design exists to catch: the gate cleared one
    // identity and the request carried another. Record the truth (what was
    // sent) and say so, rather than record the flattering version.
    const api = sessionServing('bb_1')
    const bb = fakeBrowser({ requestHeaders: { 'User-Agent': 'SomethingElse/9' } })
    const { connector } = connectorFor(bb)
    const { declaration, transport } = await connectVendor(
      browserbaseOps({ apiKey: 'k' }, api.handler),
      connector,
    )
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(declaration, transport, 'standard', null, fetcher)

    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    expect(out.compliance!.sentHeaders.headers).toEqual([
      { name: 'user-agent', value: 'SomethingElse/9' },
    ])
    const mismatch = out.trace.find((t) => t.event === 'identity_mismatch')
    expect(mismatch).toBeDefined()
    expect(mismatch!.detail).toMatchObject({ declared: VENDOR_UA, sent: 'SomethingElse/9' })
  })

  it('says "unobserved" rather than assuming agreement', async () => {
    const api = sessionServing('bb_1')
    const bb = fakeBrowser({ hideRequestHeaders: true })
    const { connector } = connectorFor(bb)
    const { declaration, transport } = await connectVendor(
      browserbaseOps({ apiKey: 'k' }, api.handler),
      connector,
    )
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(declaration, transport, 'standard', null, fetcher)

    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    expect(out.trace.some((t) => t.event === 'identity_unobserved')).toBe(true)
    expect(out.trace.some((t) => t.event === 'identity_mismatch')).toBe(false)
    // Falls back to the declared UA, which is the gated one — but the trace
    // records that this was a fallback, not a confirmation.
    expect(out.compliance!.sentHeaders.headers).toEqual([{ name: 'user-agent', value: VENDOR_UA }])
  })

  it('a robots-banned path never reaches the vendor browser', async () => {
    const api = sessionServing('bb_1')
    const bb = fakeBrowser()
    const { connector } = connectorFor(bb)
    const { declaration, transport } = await connectVendor(
      browserbaseOps({ apiKey: 'k' }, api.handler),
      connector,
    )
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(declaration, transport, 'standard', null, fetcher)

    const out = await subject.fetch('https://shop.example/gp/cart/view.html')
    expect(out.failureReason).toBe('policy_denied')
    // The session exists (the UA had to be measured), but no navigation ever
    // happened: the wildcard disallow held at the gate.
    expect(bb.state.navigations).toEqual([])
  })

  it('refuses a vendor whose measured UA the target bans site-wide', async () => {
    // The scenario the whole gate is for. Nothing about the vendor changed —
    // the target simply bans the identity it runs, and routing to it would
    // arrange the violation rather than avoid it.
    const api = sessionServing('bb_1')
    const bb = fakeBrowser({ userAgent: 'Scrapy/2.11 (+https://scrapy.org)' })
    const { connector } = connectorFor(bb)
    const { declaration, transport } = await connectVendor(
      browserbaseOps({ apiKey: 'k' }, api.handler),
      connector,
    )
    const { fetcher } = robotsServing(AMAZON_SHAPED)
    const subject = new ProviderSubject(declaration, transport, 'standard', null, fetcher)

    const out = await subject.fetch('https://shop.example/dp/B0TEST')
    expect(out.failureReason).toBe('policy_denied')
    expect(out.compliance!.robots.matchedUserAgentGroup).toBe('scrapy')
    expect(bb.state.navigations).toEqual([])
  })
})

describe('scrubSecret', () => {
  it('removes every occurrence and tolerates empty secrets', () => {
    expect(scrubSecret('key=abc url=wss://x?apiKey=abc', 'abc')).toBe(
      'key=<redacted> url=wss://x?apiKey=<redacted>',
    )
    expect(scrubSecret('untouched', '')).toBe('untouched')
  })
})
