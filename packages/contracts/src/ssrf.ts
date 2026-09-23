import {
  DEFAULT_NETWORK_POLICY,
  type NetworkPolicy,
  type PolicyDecision,
  type PolicyViolation,
} from './policy.js'

const V4 = {
  loopback: [ip4('127.0.0.0'), 8] as const,
  rfc1918a: [ip4('10.0.0.0'), 8] as const,
  rfc1918b: [ip4('172.16.0.0'), 12] as const,
  rfc1918c: [ip4('192.168.0.0'), 16] as const,
  linkLocal: [ip4('169.254.0.0'), 16] as const,
  cgnat: [ip4('100.64.0.0'), 10] as const,
  multicast: [ip4('224.0.0.0'), 4] as const,
  unspecified: ip4('0.0.0.0'),
  metadata: ip4('169.254.169.254'),
  ecsMetadata: ip4('169.254.170.2'),
}

const V6 = {
  unspecified: 0n,
  loopback: 1n,
  linkLocal: [0xfe80n << 112n, 10] as const,
  ula: [0xfcn << 120n, 7] as const,
  multicast: [0xffn << 120n, 8] as const,
  metadata: 0xfd00ec20000000000000000000000254n,
}

const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.goog'])

export const LOCAL_PRIVATE_ALLOWLIST = [
  '127.0.0.0/8',
  '::1/128',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  'fc00::/7',
] as const

export function localNetworkPolicy(): NetworkPolicy {
  return {
    ...DEFAULT_NETWORK_POLICY,
    origin: 'operator',
    privateAllowlist: [...LOCAL_PRIVATE_ALLOWLIST],
  }
}

export function hostedNetworkPolicy(): NetworkPolicy {
  return {
    ...DEFAULT_NETWORK_POLICY,
    origin: 'operator',
    privateAllowlist: [],
  }
}

export function classifyIp(address: string): PolicyViolation | null {
  const v4 = parseV4(address)
  if (v4 !== null) return classifyV4(v4)
  const v6 = parseV6(address)
  if (v6 !== null) {
    const mapped = v4Mapped(v6)
    if (mapped !== null) return classifyV4(mapped)
    return classifyV6(v6)
  }
  return 'malformed_url'
}

export function evaluateHostname(hostname: string, policy: NetworkPolicy): PolicyDecision | null {
  const host = stripBrackets(hostname).toLowerCase()
  if (host.length === 0) {
    return deny('malformed_url', null, 'empty hostname')
  }
  if (METADATA_HOSTS.has(host)) {
    return deny('cloud_metadata_address', null, host)
  }
  if (parseV4(host) !== null || parseV6(host) !== null) {
    return evaluateAddress(host, host, policy)
  }
  return null
}

export function evaluateAddress(hostname: string, address: string, policy: NetworkPolicy): PolicyDecision {
  const violation = classifyIp(address)
  if (violation === null) {
    return { allowed: true, violation: null, pinnedAddress: address, detail: null }
  }
  if (violation === 'cloud_metadata_address' || violation === 'malformed_url' || violation === 'unspecified_address') {
    return deny(violation, address, hostname)
  }
  if (policy.origin === 'operator' && allowlisted(hostname, address, policy.privateAllowlist)) {
    return { allowed: true, violation: null, pinnedAddress: address, detail: null }
  }
  return deny(violation, address, hostname)
}

export function evaluateResolved(hostname: string, addresses: readonly string[], policy: NetworkPolicy): PolicyDecision {
  if (addresses.length === 0) {
    return deny('malformed_url', null, `no addresses for ${hostname}`)
  }
  for (const address of addresses) {
    const decision = evaluateAddress(hostname, address, policy)
    if (!decision.allowed) return decision
  }
  return { allowed: true, violation: null, pinnedAddress: addresses[0] ?? null, detail: null }
}

export function evaluateUrl(url: string, policy: NetworkPolicy): PolicyDecision | { hostname: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return deny('malformed_url', null, url)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return deny('unsupported_scheme', null, parsed.protocol)
  }
  if (parsed.username || parsed.password) {
    return deny('malformed_url', null, 'credentials in URL are not allowed')
  }
  const literal = evaluateHostname(parsed.hostname, policy)
  if (literal !== null) return literal
  return { hostname: stripBrackets(parsed.hostname).toLowerCase() }
}

function deny(violation: PolicyViolation, pinned: string | null, detail: string): PolicyDecision {
  return { allowed: false, violation, pinnedAddress: pinned, detail }
}

function allowlisted(hostname: string, address: string, list: readonly string[]): boolean {
  const host = stripBrackets(hostname).toLowerCase()
  for (const entry of list) {
    const item = entry.toLowerCase()
    if (item === host || item === address.toLowerCase()) return true
    if (item.includes('/')) {
      if (cidrContains(item, address)) return true
    }
  }
  return false
}

function classifyV4(ip: number): PolicyViolation | null {
  if (ip === V4.unspecified) return 'unspecified_address'
  if (ip === V4.metadata || ip === V4.ecsMetadata) return 'cloud_metadata_address'
  if (inCidrV4(ip, V4.loopback[0], V4.loopback[1])) return 'loopback_address'
  if (inCidrV4(ip, V4.linkLocal[0], V4.linkLocal[1])) return 'link_local_address'
  if (
    inCidrV4(ip, V4.rfc1918a[0], V4.rfc1918a[1]) ||
    inCidrV4(ip, V4.rfc1918b[0], V4.rfc1918b[1]) ||
    inCidrV4(ip, V4.rfc1918c[0], V4.rfc1918c[1]) ||
    inCidrV4(ip, V4.cgnat[0], V4.cgnat[1]) ||
    inCidrV4(ip, V4.multicast[0], V4.multicast[1])
  ) {
    return 'private_address'
  }
  return null
}

function classifyV6(ip: bigint): PolicyViolation | null {
  if (ip === V6.unspecified) return 'unspecified_address'
  if (ip === V6.loopback) return 'loopback_address'
  if (ip === V6.metadata) return 'cloud_metadata_address'
  if (inCidrV6(ip, V6.linkLocal[0], V6.linkLocal[1])) return 'link_local_address'
  if (inCidrV6(ip, V6.ula[0], V6.ula[1]) || inCidrV6(ip, V6.multicast[0], V6.multicast[1])) {
    return 'private_address'
  }
  return null
}

function ip4(text: string): number {
  const parsed = parseV4(text)
  if (parsed === null) throw new Error(`bad fixture ip ${text}`)
  return parsed
}

function parseV4(text: string): number | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    n = (n << 8) + octet
  }
  return n >>> 0
}

function parseV6(text: string): bigint | null {
  let raw = stripBrackets(text)
  const zone = raw.indexOf('%')
  if (zone !== -1) raw = raw.slice(0, zone)
  if (raw.includes('.')) {
    const last = raw.lastIndexOf(':')
    if (last === -1) return null
    const tail = parseV4(raw.slice(last + 1))
    if (tail === null) return null
    const hiHex = ((tail >>> 16) & 0xffff).toString(16)
    const loHex = (tail & 0xffff).toString(16)
    raw = `${raw.slice(0, last + 1)}${hiHex}:${loHex}`
  }
  const sides = raw.split('::')
  if (sides.length > 2) return null
  const left = sides[0] === '' || sides[0] === undefined ? [] : sides[0].split(':')
  const right = sides.length === 1 || sides[1] === '' || sides[1] === undefined ? [] : sides[1]!.split(':')
  if (sides.length === 1 && left.length !== 8) return null
  const missing = 8 - left.length - right.length
  if (sides.length === 2 && missing < 1) return null
  const groups = [...left, ...Array.from({ length: Math.max(0, missing) }, () => '0'), ...right]
  if (groups.length !== 8) return null
  let n = 0n
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
    n = (n << 16n) + BigInt(parseInt(group, 16))
  }
  return n
}

function v4Mapped(ip: bigint): number | null {
  if ((ip >> 32n) === 0xffffn) return Number(ip & 0xffffffffn) >>> 0
  return null
}

function inCidrV4(ip: number, network: number, bits: number): boolean {
  if (bits === 0) return true
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0
  return ((ip >>> 0) & mask) === (network & mask)
}

function inCidrV6(ip: bigint, network: bigint, bits: number): boolean {
  if (bits === 0) return true
  const mask = bits === 128 ? (1n << 128n) - 1n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - bits)) - 1n)
  return (ip & mask) === (network & mask)
}

function cidrContains(cidr: string, address: string): boolean {
  const slash = cidr.lastIndexOf('/')
  if (slash === -1) return false
  const base = cidr.slice(0, slash)
  const bits = Number(cidr.slice(slash + 1))
  if (!Number.isInteger(bits) || bits < 0) return false
  const v4 = parseV4(address)
  const net4 = parseV4(base)
  if (v4 !== null && net4 !== null) return bits <= 32 && inCidrV4(v4, net4, bits)
  const v6 = parseV6(address)
  const net6 = parseV6(base)
  if (v6 !== null && net6 !== null) return bits <= 128 && inCidrV6(v6, net6, bits)
  return false
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}
