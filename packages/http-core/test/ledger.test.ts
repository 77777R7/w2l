import { describe, expect, it } from 'vitest'
import { ComplianceChain, verifyLedger, type ComplianceLedgerShape } from '../src/ledger.js'
import { buildComplianceRecord, type ComplianceRecordInput } from '../src/compliance.js'

/** A minimal record input; only the fields a test varies are worth naming. */
function input(n: number, overrides: Partial<ComplianceRecordInput> = {}): Omit<ComplianceRecordInput, 'prevRecordHash'> {
  return {
    recordId: `rec-${n}`,
    mode: 'research',
    requestedUrl: `https://example.com/page/${n}`,
    finalUrl: `https://example.com/page/${n}`,
    requestedAt: `2026-08-21T00:00:0${n}.000Z`,
    robots: {
      robotsUrl: 'https://example.com/robots.txt',
      robotsSha256: 'a'.repeat(64),
      matchedUserAgentGroup: '*',
      appliedRules: [],
      decision: 'allowed',
      skippedFetch: false,
    },
    sentHeaders: { headers: [{ name: 'user-agent', value: 'w2l/0.1' }] },
    rateLimit: {
      previousRequestAtMs: null,
      observedDelayMs: null,
      requiredDelayMs: 250,
      compliant: true,
      recentSameHostCount: 1,
    },
    ...overrides,
  }
}

function chainOf(count: number): ComplianceChain {
  const chain = new ComplianceChain('run-1', 'research')
  for (let i = 0; i < count; i++) chain.append(input(i))
  return chain
}

// ---------------------------------------------------------------------------
// Chaining
// ---------------------------------------------------------------------------

describe('ComplianceChain', () => {
  it('genesis record chains to null', () => {
    const chain = chainOf(1)
    expect(chain.toLedger().records[0]!.prevRecordHash).toBeNull()
  })

  it('each record chains to its predecessor contentHash', () => {
    const { records } = chainOf(4).toLedger()
    for (let i = 1; i < records.length; i++) {
      expect(records[i]!.prevRecordHash).toBe(records[i - 1]!.contentHash)
    }
  })

  it('headHash tracks the last appended record', () => {
    const chain = new ComplianceChain('run-1', 'research')
    expect(chain.headHash).toBeNull()
    const first = chain.append(input(0))
    expect(chain.headHash).toBe(first.contentHash)
    const second = chain.append(input(1))
    expect(chain.headHash).toBe(second.contentHash)
  })

  it('the chain owns prevRecordHash — a caller cannot set it', () => {
    const chain = new ComplianceChain('run-1', 'research')
    chain.append(input(0))
    // Even if a caller smuggles the field in, the chain overwrites it with the
    // real head; a record whose link disagrees with its position is the exact
    // forgery the chain exists to prevent.
    const second = chain.append({
      ...input(1),
      ...({ prevRecordHash: 'f'.repeat(64) } as Record<string, unknown>),
    })
    expect(second.prevRecordHash).toBe(chain.toLedger().records[0]!.contentHash)
  })

  it('toLedger snapshots — later appends do not mutate an earlier snapshot', () => {
    const chain = chainOf(2)
    const snapshot = chain.toLedger()
    chain.append(input(2))
    expect(snapshot.records).toHaveLength(2)
    expect(chain.toLedger().records).toHaveLength(3)
  })

  it('two identical fetches produce different records because the chain differs', () => {
    // Same input twice: without chaining these would hash identically, which
    // would let a ledger silently drop one of them as a "duplicate".
    const chain = new ComplianceChain('run-1', 'research')
    const a = chain.append(input(0))
    const b = chain.append({ ...input(0), recordId: 'rec-0' })
    expect(b.contentHash).not.toBe(a.contentHash)
  })
})

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

describe('verifyLedger', () => {
  it('accepts an untampered chain', () => {
    const verdict = verifyLedger(chainOf(5).toLedger())
    expect(verdict.valid).toBe(true)
    expect(verdict.violations).toHaveLength(0)
  })

  it('accepts an empty ledger with a null head', () => {
    const verdict = verifyLedger({ runId: 'run-1', mode: 'research', records: [] })
    expect(verdict.valid).toBe(true)
    expect(verdict.headHash).toBeNull()
  })

  it('reports the head hash for external anchoring', () => {
    const ledger = chainOf(3).toLedger()
    expect(verifyLedger(ledger).headHash).toBe(ledger.records[2]!.contentHash)
  })

  it('catches an edited field — the stored contentHash no longer re-derives', () => {
    const ledger = chainOf(3).toLedger()
    const tampered: ComplianceLedgerShape = {
      ...ledger,
      records: ledger.records.map((r, i) =>
        i === 1 ? { ...r, requestedUrl: 'https://evil.example/' } : r,
      ),
    }
    const verdict = verifyLedger(tampered)
    expect(verdict.valid).toBe(false)
    expect(verdict.violations.some((v) => v.kind === 'content_hash_mismatch' && v.index === 1)).toBe(true)
  })

  it('catches a robots decision flipped from disallowed to allowed', () => {
    // The single most likely lie: claiming robots permitted a page it forbade.
    const chain = new ComplianceChain('run-1', 'research')
    chain.append(input(0, { robots: { ...input(0).robots, decision: 'disallowed', skippedFetch: true } }))
    const ledger = chain.toLedger()
    const tampered: ComplianceLedgerShape = {
      ...ledger,
      records: [{ ...ledger.records[0]!, robots: { ...ledger.records[0]!.robots, decision: 'allowed' } }],
    }
    expect(verifyLedger(tampered).valid).toBe(false)
  })

  it('catches a removed record — the following link no longer resolves', () => {
    const ledger = chainOf(4).toLedger()
    const dropped: ComplianceLedgerShape = {
      ...ledger,
      records: [ledger.records[0]!, ledger.records[2]!, ledger.records[3]!],
    }
    const verdict = verifyLedger(dropped)
    expect(verdict.valid).toBe(false)
    expect(verdict.violations.some((v) => v.kind === 'broken_link')).toBe(true)
  })

  it('catches reordered records', () => {
    const ledger = chainOf(3).toLedger()
    const swapped: ComplianceLedgerShape = {
      ...ledger,
      records: [ledger.records[0]!, ledger.records[2]!, ledger.records[1]!],
    }
    expect(verifyLedger(swapped).valid).toBe(false)
  })

  it('catches a genesis record that chains to something', () => {
    const ledger = chainOf(3).toLedger()
    // Dropping the true genesis makes record 1 the head — its non-null link is
    // the evidence that something was removed ahead of it.
    const beheaded: ComplianceLedgerShape = { ...ledger, records: ledger.records.slice(1) }
    const verdict = verifyLedger(beheaded)
    expect(verdict.valid).toBe(false)
    expect(verdict.violations.some((v) => v.kind === 'non_null_genesis')).toBe(true)
  })

  it('catches a chain that restarts mid-ledger', () => {
    const ledger = chainOf(3).toLedger()
    const restarted: ComplianceLedgerShape = {
      ...ledger,
      records: ledger.records.map((r, i) => (i === 2 ? { ...r, prevRecordHash: null } : r)),
    }
    const verdict = verifyLedger(restarted)
    expect(verdict.valid).toBe(false)
    expect(verdict.violations.some((v) => v.kind === 'null_link')).toBe(true)
  })

  it('catches duplicate record ids', () => {
    const chain = new ComplianceChain('run-1', 'research')
    chain.append(input(0))
    chain.append({ ...input(1), recordId: 'rec-0' })
    const verdict = verifyLedger(chain.toLedger())
    expect(verdict.valid).toBe(false)
    expect(verdict.violations.some((v) => v.kind === 'duplicate_record_id')).toBe(true)
  })

  it('catches a record whose mode disagrees with the ledger', () => {
    const chain = new ComplianceChain('run-1', 'research')
    chain.append(input(0))
    const ledger = chain.toLedger()
    const relabelled: ComplianceLedgerShape = {
      ...ledger,
      records: [buildComplianceRecord({ ...input(0), mode: 'proxy', prevRecordHash: null })],
    }
    const verdict = verifyLedger(relabelled)
    expect(verdict.valid).toBe(false)
    expect(verdict.violations.some((v) => v.kind === 'mode_mismatch')).toBe(true)
  })

  it('reports every violation, not just the first', () => {
    const ledger = chainOf(4).toLedger()
    const wrecked: ComplianceLedgerShape = {
      ...ledger,
      records: ledger.records.map((r, i) =>
        i === 1 || i === 3 ? { ...r, requestedUrl: `https://evil.example/${i}` } : r,
      ),
    }
    const verdict = verifyLedger(wrecked)
    expect(verdict.violations.filter((v) => v.kind === 'content_hash_mismatch')).toHaveLength(2)
  })

  it('a violation names the record it belongs to', () => {
    const ledger = chainOf(2).toLedger()
    const tampered: ComplianceLedgerShape = {
      ...ledger,
      records: ledger.records.map((r, i) => (i === 1 ? { ...r, finalUrl: null } : r)),
    }
    const v = verifyLedger(tampered).violations[0]!
    expect(v.recordId).toBe('rec-1')
    expect(v.index).toBe(1)
    expect(v.detail).toContain('recomputed')
  })
})
