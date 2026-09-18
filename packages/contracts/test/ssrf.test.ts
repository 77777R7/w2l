import { describe, expect, it } from 'vitest'
import {
  classifyIp,
  evaluateAddress,
  evaluateHostname,
  evaluateResolved,
  evaluateUrl,
  hostedNetworkPolicy,
  localNetworkPolicy,
} from '../src/index.js'

describe('classifyIp', () => {
  it('names loopback, RFC1918, link-local, and metadata', () => {
    expect(classifyIp('127.0.0.1')).toBe('loopback_address')
    expect(classifyIp('10.0.0.8')).toBe('private_address')
    expect(classifyIp('172.16.1.1')).toBe('private_address')
    expect(classifyIp('192.168.1.1')).toBe('private_address')
    expect(classifyIp('169.254.1.1')).toBe('link_local_address')
    expect(classifyIp('169.254.169.254')).toBe('cloud_metadata_address')
    expect(classifyIp('0.0.0.0')).toBe('unspecified_address')
    expect(classifyIp('8.8.8.8')).toBeNull()
  })

  it('classifies IPv6 loopback, ULA, and IPv4-mapped loopback', () => {
    expect(classifyIp('::1')).toBe('loopback_address')
    expect(classifyIp('fc00::1')).toBe('private_address')
    expect(classifyIp('::ffff:127.0.0.1')).toBe('loopback_address')
    expect(classifyIp('2001:4860:4860::8888')).toBeNull()
  })
})

describe('local vs hosted network policy', () => {
  it('lets the operator allowlist loopback for fixtures', () => {
    const local = evaluateHostname('127.0.0.1', localNetworkPolicy())
    expect(local?.allowed).toBe(true)
    const hosted = evaluateHostname('127.0.0.1', hostedNetworkPolicy())
    expect(hosted?.allowed).toBe(false)
    expect(hosted?.violation).toBe('loopback_address')
  })

  it('never allowlists cloud metadata, even in local mode', () => {
    expect(evaluateHostname('169.254.169.254', localNetworkPolicy())?.allowed).toBe(false)
    expect(evaluateHostname('metadata.google.internal', hostedNetworkPolicy())?.violation).toBe(
      'cloud_metadata_address',
    )
  })

  it('rejects a public hostname that resolves to a private address', () => {
    const decision = evaluateResolved('example.com', ['1.1.1.1', '10.0.0.1'], hostedNetworkPolicy())
    expect(decision.allowed).toBe(false)
    expect(decision.violation).toBe('private_address')
  })

  it('accepts a hostname whose every resolved address is public', () => {
    const decision = evaluateResolved('example.com', ['1.1.1.1', '8.8.8.8'], hostedNetworkPolicy())
    expect(decision.allowed).toBe(true)
    expect(decision.pinnedAddress).toBe('1.1.1.1')
  })

  it('denies non-http(s) URLs before DNS', () => {
    const decision = evaluateUrl('file:///etc/passwd', hostedNetworkPolicy())
    expect('allowed' in decision && decision.allowed).toBe(false)
  })

  it('returns a hostname for public DNS names so the caller can resolve', () => {
    const decision = evaluateUrl('https://example.com/x', hostedNetworkPolicy())
    expect(decision).toEqual({ hostname: 'example.com' })
  })
})

describe('evaluateAddress allowlist', () => {
  it('ignores a request-origin allowlist', () => {
    const decision = evaluateAddress('127.0.0.1', '127.0.0.1', {
      ...localNetworkPolicy(),
      origin: 'request',
      privateAllowlist: ['127.0.0.1/32'],
    })
    expect(decision.allowed).toBe(false)
    expect(decision.violation).toBe('loopback_address')
  })
})
