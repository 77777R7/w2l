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
  prevRecordHash: string | null
}

export interface ComplianceRecord extends ComplianceRecordInput {
  schemaVersion: 1
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
// UTF-8 + length-prefixed canonical encoding
// ---------------------------------------------------------------------------

/** Encode a string as UTF-8 bytes. Hand-rolled so we stay dependency-free. */
function utf8Bytes(s: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let cp = s.codePointAt(i)!
    if (cp > 0xffff) i++ // surrogate pair consumed
    if (cp < 0x80) {
      out.push(cp)
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      )
    }
  }
  return new Uint8Array(out)
}

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
  field(c, '1') // schemaVersion
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
// SHA-256 (FIPS 180-4), inlined to preserve zero-dependency.
// ---------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

/** Hash arbitrary bytes. Returns lowercase hex. */
export function sha256Hex(data: Uint8Array): string {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])

  // Padding: append 0x80, pad with zeros to 56 mod 64, append 64-bit bit-length.
  const bitLen = data.length * 8
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64)
  padded.set(data)
  padded[data.length] = 0x80
  // big-endian 64-bit length in the final 8 bytes (JS numbers are safe to 2^53,
  // and message lengths here are far below that).
  const hi = Math.floor(bitLen / 0x100000000)
  const lo = bitLen >>> 0
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, hi)
  dv.setUint32(padded.length - 4, lo)

  const w = new Uint32Array(64)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(off + i * 4)
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = [H[0]!, H[1]!, H[2]!, H[3]!, H[4]!, H[5]!, H[6]!, H[7]!]
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    H[0] = (H[0]! + a) >>> 0; H[1] = (H[1]! + b) >>> 0; H[2] = (H[2]! + c) >>> 0; H[3] = (H[3]! + d) >>> 0
    H[4] = (H[4]! + e) >>> 0; H[5] = (H[5]! + f) >>> 0; H[6] = (H[6]! + g) >>> 0; H[7] = (H[7]! + h) >>> 0
  }

  let hex = ''
  for (let i = 0; i < 8; i++) hex += H[i]!.toString(16).padStart(8, '0')
  return hex
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
  const contentHash = sha256Hex(serialize(input))
  return { schemaVersion: 1, ...input, contentHash, signature: null }
}
