import { describe, expect, it } from 'vitest'
import {
  MODE_IDENTITIES,
  browserClientHints,
  browserUserAgent,
  modeIdentity,
  type CrawlMode,
} from '../src/index.js'

/**
 * Identity invariants. The mode switch is honest by construction, and the
 * load-bearing rule is alignment: the client hints must quote the same Chrome
 * major as the UA, and the declared-bot mode must carry no browser hints at
 * all. A violation of either is the self-contradiction the live probe showed
 * gets a request blocked — which means the bug and the lie are the same thing.
 */

describe('modeIdentity', () => {
  it('covers exactly the four modes with no surprises', () => {
    expect(Object.keys(MODE_IDENTITIES).sort()).toEqual(['authed', 'proxy', 'research', 'standard'])
  })

  it('research is the declared bot: no client hints', () => {
    const id = modeIdentity('research')
    expect(id.clientHints).toEqual({})
    expect(id.userAgent).toContain('w2l-research')
    expect(id.lane).toBe('browser_local')
  })

  it('research user agent never claims Chromium', () => {
    expect(modeIdentity('research').userAgent).not.toMatch(/Chrome\/|Chromium/)
  })

  it('standard, authed, proxy share one consistent-browser identity', () => {
    const std = modeIdentity('standard')
    const authed = modeIdentity('authed')
    const proxy = modeIdentity('proxy')
    expect(authed.userAgent).toBe(std.userAgent)
    expect(proxy.userAgent).toBe(std.userAgent)
    expect(authed.clientHints).toEqual(std.clientHints)
    expect(proxy.clientHints).toEqual(std.clientHints)
  })

  it('browser modes differ only in lane', () => {
    expect(modeIdentity('standard').lane).toBe('browser_local')
    expect(modeIdentity('authed').lane).toBe('browser_local_authed')
    expect(modeIdentity('proxy').lane).toBe('browser_proxy')
  })

  it('client hints quote the same Chrome major as the UA', () => {
    for (const major of [128, 130, 200]) {
      const ua = browserUserAgent(major)
      const hints = browserClientHints(major)
      expect(ua).toContain(`Chrome/${major}.0.0.0`)
      expect(hints['sec-ch-ua']).toContain(`"${major}"`)
      expect(hints['sec-ch-ua-platform']).toContain('macOS')
    }
  })

  it('no mode maps two different modes to the same identity+lane pair by accident', () => {
    const seen = new Set<string>()
    for (const mode of Object.keys(MODE_IDENTITIES) as CrawlMode[]) {
      const id = modeIdentity(mode)
      seen.add(`${id.userAgent}|${id.lane}`)
    }
    // research shares browser_local with standard but has a distinct UA; the
    // three browser modes share a UA but distinct lanes. Net: all four pairs
    // are unique.
    expect(seen.size).toBe(4)
  })
})
