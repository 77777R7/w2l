/**
 * Compliance record builder: canonical serialization + SHA-256 as pure logic.
 *
 * No dependency on `@w2l/contracts` (same convention as `gate.ts`: the types
 * below are structural subsets, and @w2l/bench asserts assignability at
 * compile time so the two packages can't silently drift). No `node:crypto`
 * import either — SHA-256 is inlined so this stays a zero-dependency pure
 * module testable with a scripted input.
 *
 * Why canonical serialization matters: a signed record is only as trustworthy
 * as the bytes that were hashed. If the hash is computed over a JSON string
 * whose key order is insertion-dependent, the same logical record hashes to
 * many values and verification becomes a guessing game. The encoding below is
 * a fixed field order with length-prefixed UTF-8, so two structurally-equal
 * records always hash identically — a property the tests pin.
 */

import { OPERATOR_ACCESS, type AccessFactShape } from './access.js'
import { sha256Hex, utf8Bytes } from './hash.js'

// Re-exported: sha256Hex was part of this module's surface before the
// primitive moved to hash.ts, and callers (bench subjects) import it here.
export { sha256Hex } from './hash.js'

// ---------------------------------------------------------------------------
// Structural subsets of @w2l/contracts/compliance types. Assignability is
// asserted in @w2l/bench (http-core stays dependency-free; see gate.ts).
// ---------------------------------------------------------------------------

export type ComplianceMode = 'research' | 'standard' | 'authed' | 'proxy'

export interface ComplianceRobotsRule {
  pattern: string
  allow: boolean
}

export interface ComplianceRobotsDecision {
  robotsUrl: string | null
  robotsSha256: string | null
  matchedUserAgentGroup: string | null
  appliedRules: readonly ComplianceRobotsRule[]
  decision: 'allowed' | 'disallowed' | 'no_robots'
  skippedFetch: boolean
}

export interface ComplianceSentHeader {
  name: string
  value: string
}

export interface ComplianceSentHeadersFact {
  headers: readonly ComplianceSentHeader[]
}

export interface ComplianceRateLimitFact {
  previousRequestAtMs: number | null
  observedDelayMs: number | null
  requiredDelayMs: number
  compliant: boolean
  recentSameHostCount: number
}

/** Everything needed to mint a record except the contentHash itself. */
export interface ComplianceRecordInput {
  recordId: string
  mode: ComplianceMode
  requestedUrl: string
  finalUrl: string | null
  /** ISO timestamp of the request. Caller supplies it (builder stays pure). */
  requestedAt: string
  robots: ComplianceRobotsDecision
  sentHeaders: ComplianceSentHeadersFact
  rateLimit: ComplianceRateLimitFact
  /**
   * Whose network and whose session this fetch used. Credential-free by
   * construction (see access.ts). Optional at the input boundary so existing
   * callers keep compiling; absent means operator-owned, which is serialized
   * explicitly rather than skipped — "we did not track this" and "this was
   * ours" must not hash to the same bytes.
   */
  access?: AccessFactShape
  prevRecordHash: string | null
}

export interface ComplianceRecord extends ComplianceRecordInput {
  schemaVersion: 2
  /** The access fact is always resolved on a built record, never absent. */
  access: AccessFactShape
  /** sha256 hex of the canonical serialization of every field above. */
  contentHash: string
  /**
   * Always null at build time — the builder hashes but does not sign (it has
   * no key material, by design: signing lives in @w2l/attest). The caller
   * attaches a signature afterwards; the record is still verifiable-unsigned.
   */
  signature: null
}

// ---------------------------------------------------------------------------
// Length-prefixed canonical encoding
// ---------------------------------------------------------------------------

/** A canonical length-prefixed field: 4-byte big-endian length, then bytes. */
function field(chunks: number[][], s: string): void {
  const bytes = utf8Bytes(s)
  chunks.push([
    (bytes.length >>> 24) & 0xff,
    (bytes.length >>> 16) & 0xff,
    (bytes.length >>> 8) & 0xff,
    bytes.length & 0xff,
  ])
  chunks.push([...bytes])
}

/**
 * A nullable field. `null` and `''` are distinct states in the contract, so
 * they must hash differently — a record that collapses them is tamper-blind at
 * exactly the place a publisher would look (a missing vs empty robots URL).
 * Encoding: a 1-byte null flag, then the length-prefixed value when present.
 */
function nullableField(chunks: number[][], v: string | null): void {
  chunks.push([v === null ? 1 : 0])
  if (v !== null) field(chunks, v)
}

function serialize(input: ComplianceRecordInput): Uint8Array {
  const c: number[][] = []
  // Fixed field order — the canonical contract. Never reorder without bumping
  // schemaVersion; the hash of every existing record changes if you do.
  //
  // v2 appended the access fact (whose proxy, whose session, who attested).
  // It is appended, not interleaved, so a v1 reader's field walk stays valid
  // up to the point it stops — but the version field differs, so a v1 record
  // and a v2 record of the same fetch never collide.
  field(c, '2') // schemaVersion
  field(c, input.recordId)
  field(c, input.mode)
  field(c, input.requestedUrl)
  nullableField(c, input.finalUrl)
  field(c, input.requestedAt)
  nullableField(c, input.prevRecordHash)

  const r = input.robots
  nullableField(c, r.robotsUrl)
  nullableField(c, r.robotsSha256)
  nullableField(c, r.matchedUserAgentGroup)
  field(c, r.decision)
  field(c, r.skippedFetch ? '1' : '0')
  const rules = [...r.appliedRules].sort((a, b) =>
    a.pattern === b.pattern ? Number(a.allow) - Number(b.allow) : a.pattern < b.pattern ? -1 : 1,
  )
  field(c, String(rules.length))
  for (const rule of rules) {
    field(c, rule.pattern)
    field(c, rule.allow ? '1' : '0')
  }

  const headers = [...input.sentHeaders.headers].sort((a, b) =>
    a.name === b.name ? (a.value < b.value ? -1 : 1) : a.name < b.name ? -1 : 1,
  )
  field(c, String(headers.length))
  for (const h of headers) {
    field(c, h.name)
    field(c, h.value)
  }

  const rl = input.rateLimit
  nullableField(c, rl.previousRequestAtMs === null ? null : String(rl.previousRequestAtMs))
  nullableField(c, rl.observedDelayMs === null ? null : String(rl.observedDelayMs))
  field(c, String(rl.requiredDelayMs))
  field(c, rl.compliant ? '1' : '0')
  field(c, String(rl.recentSameHostCount))

  // Access fact (v2). Serialized even when operator-owned: an absent field and
  // an explicit "this was ours" must not produce the same bytes, or a record
  // could be stripped of its user-access claim without breaking its hash.
  const ax = input.access ?? OPERATOR_ACCESS
  field(c, ax.egressOwner)
  nullableField(c, ax.proxyEndpoint)
  nullableField(c, ax.proxyCredentialSha256)
  field(c, ax.sessionOwner)
  nullableField(c, ax.sessionSha256)
  nullableField(c, ax.attestedBy)
  nullableField(c, ax.attestedAt)
  nullableField(c, ax.attestationStatement)

  const total = c.reduce((n, arr) => n + arr.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const arr of c) {
    out.set(arr, o)
    o += arr.length
  }
  return out
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Mint a compliance record: canonicalize the input, hash it, and return the
 * record with its `contentHash` filled in. Pure — no I/O, no randomness, no
 * clock. Caller supplies `recordId` and `requestedAt`.
 *
 * The caller is expected to assert that `recordId` is unique per fetch and
 * that `prevRecordHash` chains to the prior record; those are ledger-level
 * invariants the builder cannot enforce without seeing the whole chain.
 */
export function buildComplianceRecord(input: ComplianceRecordInput): ComplianceRecord {
  const access = input.access ?? OPERATOR_ACCESS
  const contentHash = sha256Hex(serialize(input))
  return { schemaVersion: 2, ...input, access, contentHash, signature: null }
}
