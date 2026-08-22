import { describe, expect, it } from 'vitest'
import {
  AUTHORIZABLE_POLICY_KEYS,
  DEFAULT_VENDOR_POLICY,
  evaluateVendorPolicy,
  REFUSED_CAPABILITIES,
  type CapabilityOffer,
} from '../src/vendor.js'

const OFFERS: readonly CapabilityOffer[] = [
  { capability: 'headless_browser', vendorDefaultOn: true, enableKey: null },
  { capability: 'datacenter_proxy', vendorDefaultOn: true, enableKey: null },
  { capability: 'session_persistence', vendorDefaultOn: false, enableKey: 'session_persistence' },
  { capability: 'live_view_handoff', vendorDefaultOn: true, enableKey: 'live_view_handoff' },
  { capability: 'captcha_solving', vendorDefaultOn: true, enableKey: 'captcha_solving' },
  { capability: 'fingerprint_spoofing', vendorDefaultOn: true, enableKey: 'fingerprint_spoofing' },
]

describe('evaluateVendorPolicy — capability vs policy split', () => {
  it('default policy enables route capabilities only, refuses the rest', () => {
    const d = evaluateVendorPolicy(OFFERS, DEFAULT_VENDOR_POLICY)
    expect(d.enabled.map((c) => c.capability)).toEqual(['headless_browser', 'datacenter_proxy'])
    // The refused set is reported even though nothing asked for them: the
    // audit trail must be able to say what the product declines.
    expect(d.refused).toEqual([...REFUSED_CAPABILITIES])
  })

  it('carries the vendor-default flag through so adapters can opt out explicitly', () => {
    const d = evaluateVendorPolicy(OFFERS, DEFAULT_VENDOR_POLICY)
    const headless = d.enabled.find((c) => c.capability === 'headless_browser')!
    // Browserbase/Steel run a real browser by default; nothing to opt out of,
    // so no wire-side switch is needed. The optOutRequired flag only matters
    // for capabilities where the vendor default is ON and we decline (see the
    // refused list — those never reach `enabled` at all).
    expect(headless.capability).toBe('headless_browser')
    expect(headless.enableKey).toBeNull()
  })

  it('enables authorizable capabilities only when authorized', () => {
    const d = evaluateVendorPolicy(OFFERS, {
      authorized: ['session_persistence', 'live_view_handoff'],
    })
    expect(d.enabled.map((c) => c.capability)).toEqual([
      'headless_browser',
      'datacenter_proxy',
      'session_persistence',
      'live_view_handoff',
    ])
    const live = d.enabled.find((c) => c.capability === 'live_view_handoff')!
    // Steel/Browserbase both default live-view doors on; enabling it means
    // the adapter may leave the door open, but the manifest still says so.
    expect(live.optOutRequired).toBe(true)
  })

  it('refused capabilities stay refused even when a key names them', () => {
    const d = evaluateVendorPolicy(OFFERS, { authorized: ['captcha_solving'] })
    expect(d.enabled.map((c) => c.capability)).not.toContain('captcha_solving')
    expect(d.enabled.map((c) => c.capability)).not.toContain('fingerprint_spoofing')
  })

  it('reports authorized keys the vendor does not offer', () => {
    const d = evaluateVendorPolicy(
      OFFERS.filter((o) => o.capability !== 'live_view_handoff'),
      { authorized: ['live_view_handoff'] },
    )
    expect(d.unauthorized).toEqual(['live_view_handoff'])
  })

  it('the authorizable surface is exactly four keys — no stealth key exists', () => {
    expect([...AUTHORIZABLE_POLICY_KEYS]).toEqual([
      'session_persistence',
      'live_view_handoff',
      'residential_proxy',
      'retry_orchestration',
    ])
  })

  it('is a pure function of its inputs', () => {
    const a = evaluateVendorPolicy(OFFERS, { authorized: ['session_persistence'] })
    const b = evaluateVendorPolicy(OFFERS, { authorized: ['session_persistence'] })
    expect(a).toEqual(b)
  })
})
