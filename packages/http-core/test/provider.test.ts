import { describe, expect, it } from 'vitest'
import { parseRobotsTxt } from '../src/robots.js'
import {
  evaluateProviderGate,
  REFUSED_CAPABILITIES,
  type ProviderDeclaration,
} from '../src/provider.js'

/**
 * The gate's job is to stop us paying someone else to commit a violation we
 * would not commit ourselves. The tests are organized around the three ways
 * that could happen: the provider won't say who it is, the provider's product
 * is evasion, or the target has already banned the UA it sends.
 */

/**
 * Shaped after the real amazon.com/robots.txt: a wildcard group with path
 * disallows, plus named groups that ban specific crawlers site-wide. The live
 * file bans 99 named agents this way, which is exactly why a provider's UA
 * cannot be assumed benign.
 */
const AMAZON_SHAPED = parseRobotsTxt(
  [
    'User-agent: *',
    'Disallow: /gp/cart',
    'Disallow: /gp/customer-reviews/write-a-review.html',
    'Allow: /gp/aw/help/id=tos',
    '',
    'User-agent: Scrapy',
    'Disallow: /',
    '',
    'User-agent: Crawl4AI',
    'Disallow: /',
    '',
    'User-agent: EtaoSpider',
    'Disallow: /',
  ].join('\n'),
)

function provider(over: Partial<ProviderDeclaration> = {}): ProviderDeclaration {
  return {
    id: 'test-provider',
    declaredUserAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
    capabilities: ['headless_browser', 'datacenter_proxy'],
    honoursCallerUserAgent: false,
    ...over,
  }
}

describe('capability refusal', () => {
  it.each(REFUSED_CAPABILITIES)('refuses a provider offering %s', (cap) => {
    const verdict = evaluateProviderGate(
      provider({ capabilities: ['headless_browser', cap] }),
      AMAZON_SHAPED,
      '/dp/B0TEST',
    )
    expect(verdict.allowed).toBe(false)
    expect(verdict.refusal).toBe('refused_capability')
    expect(verdict.refusedCapabilities).toContain(cap)
  })

  it('allows the route-changing capabilities', () => {
    const verdict = evaluateProviderGate(
      provider({
        capabilities: [
          'headless_browser',
          'datacenter_proxy',
          'residential_proxy',
          'retry_orchestration',
        ],
      }),
      AMAZON_SHAPED,
      '/dp/B0TEST',
    )
    expect(verdict.allowed).toBe(true)
  })

  it('refuses on capability even where robots would have allowed the path', () => {
    // Order matters: a captcha-solving provider is refused everywhere, so a
    // permissive robots.txt must not be able to launder it.
    const verdict = evaluateProviderGate(
      provider({ capabilities: ['captcha_solving'] }),
      null,
      '/anything',
    )
    expect(verdict.allowed).toBe(false)
    expect(verdict.refusal).toBe('refused_capability')
  })

  it('reports every refused capability, not just the first', () => {
    const verdict = evaluateProviderGate(
      provider({ capabilities: ['captcha_solving', 'cdp_patching', 'headless_browser'] }),
      AMAZON_SHAPED,
      '/dp/B0TEST',
    )
    expect(verdict.refusedCapabilities).toEqual(['captcha_solving', 'cdp_patching'])
  })
})

describe('undeclared user agent', () => {
  it('refuses a provider that will not say what it sends', () => {
    const verdict = evaluateProviderGate(
      provider({ declaredUserAgent: null }),
      AMAZON_SHAPED,
      '/dp/B0TEST',
    )
    expect(verdict.allowed).toBe(false)
    expect(verdict.refusal).toBe('undeclared_user_agent')
  })

  it('refuses it even when the site publishes no robots.txt', () => {
    // Tempting to allow — nothing to violate. But the reason to demand the UA
    // is that it goes in the record; a record naming an unknown agent proves
    // nothing about a fetch we outsourced.
    const verdict = evaluateProviderGate(provider({ declaredUserAgent: null }), null, '/anything')
    expect(verdict.allowed).toBe(false)
    expect(verdict.refusal).toBe('undeclared_user_agent')
  })
})

describe('robots gate on the provider UA', () => {
  it('refuses a provider whose UA the target bans site-wide', () => {
    const verdict = evaluateProviderGate(
      provider({ id: 'scrapling', declaredUserAgent: 'Scrapy/2.11 (+https://scrapy.org)' }),
      AMAZON_SHAPED,
      '/dp/B0TEST',
    )
    expect(verdict.allowed).toBe(false)
    expect(verdict.refusal).toBe('robots_disallowed')
    expect(verdict.matchedUserAgentGroup).toBe('scrapy')
    expect(verdict.appliedRules).toEqual([{ pattern: '/', allow: false }])
  })

  it('names the banned agent in the reason so the operator can act on it', () => {
    const verdict = evaluateProviderGate(
      provider({ id: 'crawl4ai-host', declaredUserAgent: 'Crawl4AI/0.4' }),
      AMAZON_SHAPED,
      '/dp/B0TEST',
    )
    expect(verdict.reason).toContain('Crawl4AI/0.4')
    expect(verdict.reason).toContain('would not avoid that violation, it would arrange it')
  })

  it('points at UA pass-through when the provider supports it', () => {
    const verdict = evaluateProviderGate(
      provider({ declaredUserAgent: 'Scrapy/2.11', honoursCallerUserAgent: true }),
      AMAZON_SHAPED,
      '/dp/B0TEST',
    )
    expect(verdict.reason).toContain('pass through our UA')
  })

  it('stays silent about pass-through when the provider cannot do it', () => {
    const verdict = evaluateProviderGate(
      provider({ declaredUserAgent: 'Scrapy/2.11', honoursCallerUserAgent: false }),
      AMAZON_SHAPED,
      '/dp/B0TEST',
    )
    expect(verdict.reason).not.toContain('pass through our UA')
  })

  it('allows a benign UA on an allowed path under the wildcard group', () => {
    const verdict = evaluateProviderGate(provider(), AMAZON_SHAPED, '/dp/B0TEST')
    expect(verdict.allowed).toBe(true)
    expect(verdict.refusal).toBeNull()
    expect(verdict.matchedUserAgentGroup).toBe('*')
  })

  it('applies the wildcard path disallows to a benign UA', () => {
    const verdict = evaluateProviderGate(provider(), AMAZON_SHAPED, '/gp/cart/view.html')
    expect(verdict.allowed).toBe(false)
    expect(verdict.refusal).toBe('robots_disallowed')
    expect(verdict.matchedUserAgentGroup).toBe('*')
  })

  it('honours a more-specific Allow beneath a Disallow', () => {
    const permissive = parseRobotsTxt(
      ['User-agent: *', 'Disallow: /gp', 'Allow: /gp/aw/help/id=tos'].join('\n'),
    )
    expect(evaluateProviderGate(provider(), permissive, '/gp/aw/help/id=tos').allowed).toBe(true)
    expect(evaluateProviderGate(provider(), permissive, '/gp/cart').allowed).toBe(false)
  })

  it('treats an absent robots.txt as unrestricted', () => {
    const verdict = evaluateProviderGate(provider(), null, '/dp/B0TEST')
    expect(verdict.allowed).toBe(true)
    expect(verdict.reason).toContain('No robots.txt published')
  })

  it('records the UA the decision was actually made about', () => {
    // The record has to be self-describing: "allowed" is meaningless without
    // "allowed for whom", since the provider's UA is not ours.
    const verdict = evaluateProviderGate(
      provider({ declaredUserAgent: 'ProviderBot/2.0' }),
      AMAZON_SHAPED,
      '/dp/B0TEST',
    )
    expect(verdict.evaluatedUserAgent).toBe('ProviderBot/2.0')
  })

  it('matches the ban case-insensitively', () => {
    // robots.txt agent tokens are case-insensitive (RFC 9309 §2.2.1); a
    // provider sending lowercase `scrapy` is the same banned agent.
    const verdict = evaluateProviderGate(
      provider({ declaredUserAgent: 'scrapy/2.11' }),
      AMAZON_SHAPED,
      '/dp/B0TEST',
    )
    expect(verdict.allowed).toBe(false)
  })

  it('picks the most specific named group over the wildcard', () => {
    // Our clean UA is governed by `*`; a Scrapy UA must be governed by the
    // Scrapy group, or the site-wide ban would be invisible to the gate.
    expect(evaluateProviderGate(provider(), AMAZON_SHAPED, '/dp/X').matchedUserAgentGroup).toBe('*')
    expect(
      evaluateProviderGate(
        provider({ declaredUserAgent: 'Scrapy/2.11' }),
        AMAZON_SHAPED,
        '/dp/X',
      ).matchedUserAgentGroup,
    ).toBe('scrapy')
  })
})

describe('the gate has no override', () => {
  it('exposes no way to allow a refused capability', () => {
    // Deliberate absence, asserted so that adding a `force` option has to
    // break a test that says why it must not exist.
    const keys = Object.keys(provider())
    expect(keys).not.toContain('force')
    expect(keys).not.toContain('skipRobots')
    expect(keys).not.toContain('allowRefusedCapabilities')
  })
})
