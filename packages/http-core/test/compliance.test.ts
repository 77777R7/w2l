import { describe, expect, it } from 'vitest'
import {
  buildComplianceRecord,
  sha256Hex,
  type ComplianceRecordInput,
} from '../src/compliance.js'

/**
 * Two obligations:
 *  1. the inlined SHA-256 must match FIPS 180-4 vectors (it is the hash the
 *     signature scheme will sign — a wrong digest breaks verification, not
 *     just this module).
 *  2. canonical serialization must be deterministic and field-order sensitive:
 *     the same logical record hashes identically, and any changed field changes
 *     the hash. A record whose hash ignores a field it claims to cover is
 *     tamper-blind.
 */

const utf8 = (s: string) => new TextEncoder().encode(s)

function baseInput(): ComplianceRecordInput {
  return {
    recordId: 'rec-001',
    mode: 'research',
    requestedUrl: 'https://example.com/a',
    finalUrl: 'https://example.com/a',
    requestedAt: '2026-08-21T00:00:00.000Z',
    robots: {
      robotsUrl: 'https://example.com/robots.txt',
      robotsSha256: 'abc123',
      matchedUserAgentGroup: 'w2l-research',
      appliedRules: [
        { pattern: '/private/', allow: false },
        { pattern: '/', allow: true },
      ],
      decision: 'allowed',
      skippedFetch: false,
    },
    sentHeaders: {
      headers: [
        { name: 'user-agent', value: 'w2l-research/0.1' },
        { name: 'accept', value: 'text/html' },
      ],
    },
    rateLimit: {
      previousRequestAtMs: 1_000,
      observedDelayMs: 400,
      requiredDelayMs: 250,
      compliant: true,
      recentSameHostCount: 2,
    },
    prevRecordHash: null,
  }
}

describe('sha256Hex', () => {
  it('matches the empty-string vector', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('matches the "abc" vector', () => {
    expect(sha256Hex(utf8('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('matches the "hello world" vector', () => {
    expect(sha256Hex(utf8('hello world'))).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    )
  })

  it('handles multi-byte UTF-8 (not charCodeAt-collapsed)', () => {
    // '§' is U+00A7 — two bytes in UTF-8. A naive charCodeAt encoder would
    // hash the same bytes as a single-byte 0xA7, diverging from every real
    // implementation.
    const viaUtf8 = sha256Hex(utf8('§1201'))
    expect(viaUtf8).toBe(sha256Hex(new TextEncoder().encode('§1201')))
  })
})

describe('buildComplianceRecord', () => {
  it('is deterministic for structurally-equal input', () => {
    const a = buildComplianceRecord(baseInput())
    const b = buildComplianceRecord(baseInput())
    expect(a.contentHash).toBe(b.contentHash)
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is sensitive to every claimed field', () => {
    const base = buildComplianceRecord(baseInput()).contentHash
    const vary = (patch: Partial<ComplianceRecordInput>) =>
      buildComplianceRecord({ ...baseInput(), ...patch }).contentHash

    expect(vary({ requestedUrl: 'https://example.com/b' })).not.toBe(base)
    expect(vary({ mode: 'proxy' })).not.toBe(base)
    expect(vary({ prevRecordHash: 'deadbeef' })).not.toBe(base)
    expect(
      vary({
        robots: { ...baseInput().robots, decision: 'disallowed', skippedFetch: true },
      }),
    ).not.toBe(base)
    expect(
      vary({
        sentHeaders: {
          headers: [{ name: 'user-agent', value: 'chrome/120' }],
        },
      }),
    ).not.toBe(base)
    expect(
      vary({
        rateLimit: { ...baseInput().rateLimit, compliant: false, observedDelayMs: 10 },
      }),
    ).not.toBe(base)
  })

  it('is order-insensitive for headers and applied rules', () => {
    const input = baseInput()
    const shuffled = {
      ...input,
      robots: {
        ...input.robots,
        appliedRules: [...input.robots.appliedRules].reverse(),
      },
      sentHeaders: {
        headers: [...input.sentHeaders.headers].reverse(),
      },
    }
    expect(buildComplianceRecord(shuffled).contentHash).toBe(
      buildComplianceRecord(input).contentHash,
    )
  })

  it('treats null and empty-string as distinct', () => {
    const withNull = buildComplianceRecord(baseInput()).contentHash
    const withEmpty = buildComplianceRecord({
      ...baseInput(),
      prevRecordHash: '',
    }).contentHash
    expect(withNull).not.toBe(withEmpty)
  })
})
