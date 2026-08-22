import { describe, expect, it } from 'vitest'
import { buildChannels, parseArgs } from '../src/ladderCli.js'

describe('ladder CLI arguments', () => {
  it('defaults to standard mode (http + browser only)', () => {
    expect(parseArgs(['https://example.com/p'])).toEqual({
      url: 'https://example.com/p',
      mode: 'standard',
      allowlistedDomains: [],
    })
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

  it('rejects unknown flags instead of ignoring them', () => {
    expect(() => parseArgs(['--stealth', 'https://example.com/p'])).toThrow(/unknown flag --stealth/)
  })

  it('requires a URL', () => {
    expect(() => parseArgs([])).toThrow(/usage: w2l-fetch/)
    expect(() => parseArgs(['nope'])).toThrow(/not a URL/)
  })
})

describe('buildChannels', () => {
  it('standard mode builds exactly the two local rungs, no vendors', async () => {
    const channels = await buildChannels('standard')
    expect(channels.map((c) => c.id)).toEqual(['http', 'browser_local'])
    expect(channels.every((c) => c.vendorId === undefined)).toBe(true)
  })

  it('research mode without a vendor key still builds only local rungs — the vendor rung does not exist', async () => {
    const channels = await buildChannels('research')
    expect(channels.map((c) => c.id)).toEqual(['http', 'browser_local'])
  })

  it('every channel exposes close() so the owner can release resources', async () => {
    const channels = await buildChannels('standard')
    for (const c of channels) expect(typeof c.close).toBe('function')
  })
})
