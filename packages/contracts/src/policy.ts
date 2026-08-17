/**
 * Network egress policy.
 *
 * Contract: there is no per-request "allow private network" flag. Private-range
 * access requires an explicit host/CIDR allowlist that only a server operator can
 * set (config file or env at process start). API callers cannot widen it.
 */

export type PolicyOrigin =
  /** Set by the operator at process start. The only origin allowed to permit private ranges. */
  | 'operator'
  /** Derived from an API request. May narrow the effective policy, never widen it. */
  | 'request'

export interface NetworkPolicy {
  origin: PolicyOrigin
  /**
   * Hosts and CIDRs exempt from private-range blocking.
   * Entries are literal hostnames, IPs, or CIDR blocks (e.g. '127.0.0.1/32').
   * Ignored — and a violation — when origin is 'request'.
   */
  privateAllowlist: readonly string[]
  maxRedirects: number
  maxBodyBytes: number
  /** Cap on post-decompression size, to bound zip bombs. */
  maxDecompressedBytes: number
  /** Per-host concurrent request ceiling. */
  perHostConcurrency: number
  /** Minimum delay between requests to the same host. */
  perHostMinDelayMs: number
  respectRobotsTxt: boolean
}

export const DEFAULT_NETWORK_POLICY: NetworkPolicy = {
  origin: 'request',
  privateAllowlist: [],
  maxRedirects: 5,
  maxBodyBytes: 10 * 1024 * 1024,
  maxDecompressedBytes: 50 * 1024 * 1024,
  perHostConcurrency: 2,
  perHostMinDelayMs: 250,
  respectRobotsTxt: true,
}

export const POLICY_VIOLATION = [
  'private_address',
  'loopback_address',
  'link_local_address',
  'cloud_metadata_address',
  'unspecified_address',
  'unsupported_scheme',
  'malformed_url',
  /** A request-origin policy tried to grant private-range access. */
  'privilege_escalation',
] as const

export type PolicyViolation = (typeof POLICY_VIOLATION)[number]

export interface PolicyDecision {
  allowed: boolean
  violation: PolicyViolation | null
  /** The IP the hostname resolved to, pinned for the actual connection. */
  pinnedAddress: string | null
  detail: string | null
}
