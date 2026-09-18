/**
 * Compliance ledger: chaining records, and verifying a chain someone hands you.
 *
 * A single signed record proves "this fetch happened as described". It does not
 * prove "and these were all the fetches" — an operator could mint records only
 * for the polite requests and drop the rest on the floor. The hash chain is
 * what closes that hole: each record commits to its predecessor's contentHash,
 * so removing or reordering any record breaks every link after it. What the
 * chain still cannot prove is that the chain *head* is the real head; that
 * needs an external anchor (a published head hash, or a transparency log),
 * which is a deliberate later step and not something this module pretends to.
 *
 * Pure logic, zero dependencies, no clock — same discipline as compliance.ts.
 * Verification here is chain-structural plus per-record access coherence;
 * signature verification lives in @w2l/attest because it needs key material.
 */

import { verifyAccessFact } from './access.js'
import { buildComplianceRecord, type ComplianceMode, type ComplianceRecord, type ComplianceRecordInput } from './compliance.js'

// ---------------------------------------------------------------------------
// Structural subset of @w2l/contracts ComplianceLedger (see compliance.ts).
// ---------------------------------------------------------------------------

export interface ComplianceLedgerShape {
  runId: string
  mode: ComplianceMode
  records: readonly ComplianceRecord[]
}

/**
 * Accumulates records for one run, threading each record's contentHash into
 * the next record's `prevRecordHash`.
 *
 * The chain is per-run, not global: a run is the unit an operator hands to a
 * publisher, and a global chain would leak the existence and count of every
 * other customer's fetches into it.
 */
export class ComplianceChain {
  private readonly recordList: ComplianceRecord[] = []

  constructor(
    readonly runId: string,
    readonly mode: ComplianceMode,
  ) {}

  /** The contentHash the next appended record will chain to. */
  get headHash(): string | null {
    return this.recordList.at(-1)?.contentHash ?? null
  }

  get length(): number {
    return this.recordList.length
  }

  /**
   * Build and append a record, overwriting `prevRecordHash` with the current
   * head. The caller passes everything else; the chain owns exactly the one
   * field it is responsible for, so a caller cannot accidentally supply a
   * prevRecordHash that disagrees with where the record actually lands.
   */
  append(input: Omit<ComplianceRecordInput, 'prevRecordHash'>): ComplianceRecord {
    const record = buildComplianceRecord({ ...input, prevRecordHash: this.headHash })
    this.recordList.push(record)
    return record
  }

  /** Snapshot the ledger. Records are copied so later appends don't mutate it. */
  toLedger(): ComplianceLedgerShape {
    return { runId: this.runId, mode: this.mode, records: [...this.recordList] }
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type LedgerViolationKind =
  /** A record's contentHash does not match a re-hash of its own fields. */
  | 'content_hash_mismatch'
  /** A record's prevRecordHash does not equal its predecessor's contentHash. */
  | 'broken_link'
  /** The first record chains to something, i.e. records were removed ahead of it. */
  | 'non_null_genesis'
  /** A non-first record chains to null, i.e. the chain restarts mid-ledger. */
  | 'null_link'
  /** Two records share a recordId. */
  | 'duplicate_record_id'
  /** A record's mode disagrees with the ledger's declared mode. */
  | 'mode_mismatch'
  /**
   * A record's access fact is internally incoherent — most importantly, it
   * claims the user's proxy or session without naming anyone who accepted
   * that transfer. Such a record reads as a responsibility transfer while
   * proving none, which is worse than claiming nothing at all.
   */
  | 'unattested_access'

export interface LedgerViolation {
  kind: LedgerViolationKind
  /** Index of the offending record within `ledger.records`. */
  index: number
  recordId: string
  detail: string
}

export interface LedgerVerdict {
  valid: boolean
  violations: readonly LedgerViolation[]
  /** The head contentHash, i.e. what an external anchor would need to pin. */
  headHash: string | null
}

/**
 * Verify a ledger's internal consistency: every contentHash re-derives from its
 * own fields, every link points at its predecessor, ids are unique, and the
 * declared mode holds throughout.
 *
 * All violations are reported, not just the first — an operator fixing one
 * broken link should not have to re-run to discover the next four. A valid
 * verdict means "nothing was altered or dropped *within* this ledger"; it says
 * nothing about whether records were withheld before the genesis record, which
 * is exactly why `headHash` is returned for external anchoring.
 */
export function verifyLedger(ledger: ComplianceLedgerShape): LedgerVerdict {
  const violations: LedgerViolation[] = []
  const seenIds = new Set<string>()

  ledger.records.forEach((record, index) => {
    const at = (kind: LedgerViolationKind, detail: string): void => {
      violations.push({ kind, index, recordId: record.recordId, detail })
    }

    // Re-derive the hash from the record's own fields. buildComplianceRecord is
    // pure, so an untampered record reproduces its stored contentHash exactly.
    const rebuilt = buildComplianceRecord({
      recordId: record.recordId,
      mode: record.mode,
      requestedUrl: record.requestedUrl,
      finalUrl: record.finalUrl,
      requestedAt: record.requestedAt,
      robots: record.robots,
      sentHeaders: record.sentHeaders,
      rateLimit: record.rateLimit,
      prevRecordHash: record.prevRecordHash,
      access: record.access,
    })
    if (rebuilt.contentHash !== record.contentHash) {
      at('content_hash_mismatch', `stored ${record.contentHash}, recomputed ${rebuilt.contentHash}`)
    }

    if (seenIds.has(record.recordId)) {
      at('duplicate_record_id', `recordId ${record.recordId} appears more than once`)
    }
    seenIds.add(record.recordId)

    if (record.mode !== ledger.mode) {
      at('mode_mismatch', `record mode ${record.mode}, ledger mode ${ledger.mode}`)
    }

    for (const problem of verifyAccessFact(record.access)) {
      at('unattested_access', problem)
    }

    if (index === 0) {
      if (record.prevRecordHash !== null) {
        at('non_null_genesis', `genesis record chains to ${record.prevRecordHash}`)
      }
      return
    }

    const prev = ledger.records[index - 1]!
    if (record.prevRecordHash === null) {
      at('null_link', `chain restarts at index ${index}`)
    } else if (record.prevRecordHash !== prev.contentHash) {
      at('broken_link', `chains to ${record.prevRecordHash}, predecessor is ${prev.contentHash}`)
    }
  })

  return {
    valid: violations.length === 0,
    violations,
    headHash: ledger.records.at(-1)?.contentHash ?? null,
  }
}
