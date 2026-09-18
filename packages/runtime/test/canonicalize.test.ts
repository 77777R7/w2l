import { describe, expect, it } from 'vitest'
import { canonicalizeUrl, hostOf } from '../src/canonicalize.js'

describe('canonicalizeUrl', () => {
  it('collapses tracking params so duplicate-c?utm_source=x matches /duplicate/c', () => {
    expect(canonicalizeUrl('https://fixture.test/duplicate/c?utm_source=x')).toBe(
      'https://fixture.test/duplicate/c',
    )
    expect(canonicalizeUrl('https://fixture.test/duplicate/c?utm_source=x')).toBe(
      canonicalizeUrl('https://fixture.test/duplicate/c'),
    )
  })

  it('does not treat /duplicate/a and /duplicate/c as the same page', () => {
    const a = canonicalizeUrl('https://fixture.test/duplicate/a')
    const c = canonicalizeUrl('https://fixture.test/duplicate/c?utm_source=x')
    expect(a).toBe('https://fixture.test/duplicate/a')
    expect(c).toBe('https://fixture.test/duplicate/c')
    expect(a).not.toBe(c)
  })

  it('lowercases host, drops default ports, fragments, and userinfo', () => {
    expect(canonicalizeUrl('HTTPS://Example.COM:443/Path#frag')).toBe('https://example.com/Path')
    expect(canonicalizeUrl('http://user:pass@example.com:80/x')).toBe('http://example.com/x')
  })

  it('sorts remaining query params and keeps non-tracking ones', () => {
    expect(canonicalizeUrl('https://example.com/x?b=2&a=1&utm_campaign=ad')).toBe(
      'https://example.com/x?a=1&b=2',
    )
  })

  it('resolves relative URLs against a base', () => {
    expect(canonicalizeUrl('/duplicate/a', 'https://fixture.test/listing')).toBe(
      'https://fixture.test/duplicate/a',
    )
  })

  it('refuses non-http schemes', () => {
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull()
    expect(canonicalizeUrl('mailto:a@b.test')).toBeNull()
    expect(canonicalizeUrl('file:///etc/passwd')).toBeNull()
  })

  it('returns null for malformed input', () => {
    expect(canonicalizeUrl('not a url')).toBeNull()
  })
})

describe('hostOf', () => {
  it('reads the host from a canonical URL', () => {
    expect(hostOf('https://shop.example.com/p')).toBe('shop.example.com')
  })
})
