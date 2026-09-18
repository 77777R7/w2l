import { describe, expect, it } from 'vitest'
import {
  AccessConfigError,
  isUserAccess,
  normalizeAccessConfig,
  normalizeProxyEndpoint,
  OPERATOR_ACCESS,
  verifyAccessFact,
  type AccessConfigInput,
  type AccessFactShape,
} from '../src/access.js'
import { buildComplianceRecord, type ComplianceRecordInput } from '../src/compliance.js'
import { ComplianceChain, verifyLedger } from '../src/ledger.js'

/**
 * What this module has to get right, in order of how badly it fails if wrong:
 *
 *  1. Credentials must not survive normalization. This is the one that turns a
 *     compliance artifact into a breach if it regresses, so it is tested from
 *     both ends: the fact, and the serialized record the fact ends up inside.
 *  2. A claimed responsibility transfer must be attested. An unattested
 *     user-access record is worse than none — it looks like proof and isn't.
 *  3. The fact must be inside the hashed bytes, so it cannot be stripped or
 *     forged after the fact without breaking the chain.
 */

const ATTESTATION = {
  principal: 'acct_9f21 (jane@example.com)',
  at: '2026-08-21T09:00:00.000Z',
  statement: 'I own this proxy and accept responsibility for fetches made through it.',
}

function inputWithAccess(access?: AccessFactShape): ComplianceRecordInput {
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
      appliedRules: [{ pattern: '/', allow: true }],
      decision: 'allowed',
      skippedFetch: false,
    },
    sentHeaders: { headers: [{ name: 'user-agent', value: 'w2l-research/0.1' }] },
    rateLimit: {
      previousRequestAtMs: 1_000,
      observedDelayMs: 400,
      requiredDelayMs: 250,
      compliant: true,
      recentSameHostCount: 2,
    },
    prevRecordHash: null,
    ...(access === undefined ? {} : { access }),
  }
}

describe('normalizeProxyEndpoint', () => {
  it('keeps scheme, host and port and drops path, query and fragment', () => {
    expect(normalizeProxyEndpoint('http://gate.proxy.example:8080/path?x=1#f')).toBe(
      'http://gate.proxy.example:8080',
    )
  })

  it('accepts a portless endpoint', () => {
    expect(normalizeProxyEndpoint('socks5://gate.proxy.example')).toBe(
      'socks5://gate.proxy.example',
    )
  })

  it('rejects userinfo instead of silently accepting it', () => {
    // The failure mode being prevented: quietly promoting `p` into
    // proxyCredentialSha256 would "work", and the caller would keep putting
    // passwords in URLs that get logged everywhere else in their stack.
    expect(() => normalizeProxyEndpoint('http://u:p@gate.proxy.example:8080')).toThrow(
      AccessConfigError,
    )
    try {
      normalizeProxyEndpoint('http://u:p@gate.proxy.example:8080')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as AccessConfigError).rejection).toBe('credentials_in_proxy_url')
    }
  })

  it('rejects a username with no password', () => {
    try {
      normalizeProxyEndpoint('http://u@gate.proxy.example:8080')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as AccessConfigError).rejection).toBe('credentials_in_proxy_url')
    }
  })

  it('rejects an unsupported scheme', () => {
    try {
      normalizeProxyEndpoint('ftp://gate.proxy.example:21')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as AccessConfigError).rejection).toBe('unsupported_proxy_scheme')
    }
  })

  it('rejects a malformed URL', () => {
    try {
      normalizeProxyEndpoint('not a url')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as AccessConfigError).rejection).toBe('malformed_proxy_url')
    }
  })
})

describe('normalizeAccessConfig', () => {
  it('returns the operator fact for no config', () => {
    expect(normalizeAccessConfig(null)).toEqual(OPERATOR_ACCESS)
    expect(normalizeAccessConfig(undefined)).toEqual(OPERATOR_ACCESS)
    expect(normalizeAccessConfig({})).toEqual(OPERATOR_ACCESS)
  })

  it('does not hand back the shared operator constant', () => {
    // A caller mutating the returned fact must not corrupt every later record.
    const fact = normalizeAccessConfig(null)
    expect(fact).not.toBe(OPERATOR_ACCESS)
  })

  it('records a user proxy as user-owned egress', () => {
    const fact = normalizeAccessConfig({
      proxy: { url: 'http://gate.proxy.example:8080', username: 'u', password: 'hunter2' },
      attestation: ATTESTATION,
    })
    expect(fact.egressOwner).toBe('user')
    expect(fact.proxyEndpoint).toBe('http://gate.proxy.example:8080')
    expect(fact.sessionOwner).toBe('none')
    expect(fact.attestedBy).toBe(ATTESTATION.principal)
  })

  it('never carries the proxy password, only its hash', () => {
    const fact = normalizeAccessConfig({
      proxy: { url: 'http://gate.proxy.example:8080', username: 'u', password: 'hunter2' },
      attestation: ATTESTATION,
    })
    expect(JSON.stringify(fact)).not.toContain('hunter2')
    expect(fact.proxyCredentialSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('leaves the credential hash null for an unauthenticated proxy', () => {
    const fact = normalizeAccessConfig({
      proxy: { url: 'http://gate.proxy.example:8080' },
      attestation: ATTESTATION,
    })
    expect(fact.proxyCredentialSha256).toBeNull()
    expect(fact.egressOwner).toBe('user')
  })

  it('never carries a cookie value, only the session hash', () => {
    const fact = normalizeAccessConfig({
      session: {
        cookies: [
          { name: 'session-id', value: 'SECRET-COOKIE-VALUE', domain: '.amazon.com', path: '/' },
        ],
      },
      attestation: ATTESTATION,
    })
    expect(JSON.stringify(fact)).not.toContain('SECRET-COOKIE-VALUE')
    expect(fact.sessionSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(fact.sessionOwner).toBe('user')
    // A session alone does not move egress: the fetch still leaves our address.
    expect(fact.egressOwner).toBe('operator')
    expect(fact.proxyEndpoint).toBeNull()
  })

  it('hashes a session identically regardless of cookie order', () => {
    const cookies = [
      { name: 'session-id', value: 'a', domain: '.amazon.com', path: '/' },
      { name: 'ubid-main', value: 'b', domain: '.amazon.com', path: '/' },
      { name: 'x-acb', value: 'c', domain: 'www.amazon.com', path: '/gp' },
    ]
    const forward = normalizeAccessConfig({ session: { cookies }, attestation: ATTESTATION })
    const reversed = normalizeAccessConfig({
      session: { cookies: [...cookies].reverse() },
      attestation: ATTESTATION,
    })
    expect(forward.sessionSha256).toBe(reversed.sessionSha256)
  })

  it('distinguishes sessions that differ only in field boundaries', () => {
    // Without a separator byte, {name:'ab',value:'c'} and {name:'a',value:'bc'}
    // would concatenate to the same material and hash alike.
    const a = normalizeAccessConfig({
      session: { cookies: [{ name: 'ab', value: 'c', domain: 'd', path: '/' }] },
      attestation: ATTESTATION,
    })
    const b = normalizeAccessConfig({
      session: { cookies: [{ name: 'a', value: 'bc', domain: 'd', path: '/' }] },
      attestation: ATTESTATION,
    })
    expect(a.sessionSha256).not.toBe(b.sessionSha256)
  })

  it('distinguishes a changed cookie value', () => {
    const mk = (value: string) =>
      normalizeAccessConfig({
        session: { cookies: [{ name: 'session-id', value, domain: '.a.com', path: '/' }] },
        attestation: ATTESTATION,
      }).sessionSha256
    expect(mk('one')).not.toBe(mk('two'))
  })

  it('counts storageState as session material', () => {
    const fact = normalizeAccessConfig({
      session: { storageState: '{"cookies":[],"origins":[]}' },
      attestation: ATTESTATION,
    })
    expect(fact.sessionOwner).toBe('user')
    expect(fact.sessionSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects a session that carries nothing', () => {
    try {
      normalizeAccessConfig({ session: { cookies: [] }, attestation: ATTESTATION })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as AccessConfigError).rejection).toBe('empty_session')
    }
  })

  it('refuses user access with no attestation', () => {
    try {
      normalizeAccessConfig({ proxy: { url: 'http://gate.proxy.example:8080' } })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as AccessConfigError).rejection).toBe('missing_attestation')
    }
  })

  it('refuses an attestation with a blank field', () => {
    for (const blank of ['', '   ']) {
      try {
        normalizeAccessConfig({
          proxy: { url: 'http://gate.proxy.example:8080' },
          attestation: { ...ATTESTATION, principal: blank },
        })
        expect.unreachable(`should have thrown for ${JSON.stringify(blank)}`)
      } catch (err) {
        expect((err as AccessConfigError).rejection).toBe('incomplete_attestation')
      }
    }
  })

  it('ignores an attestation when no user access was actually supplied', () => {
    // Attesting to nothing must not mark the record as a transfer, or an
    // operator could paper every record with the customer's name.
    const fact = normalizeAccessConfig({ attestation: ATTESTATION })
    expect(fact).toEqual(OPERATOR_ACCESS)
    expect(isUserAccess(fact)).toBe(false)
  })
})

describe('verifyAccessFact', () => {
  it('passes the operator fact', () => {
    expect(verifyAccessFact(OPERATOR_ACCESS)).toEqual([])
  })

  it('passes a well-formed user fact', () => {
    const fact = normalizeAccessConfig({
      proxy: { url: 'http://gate.proxy.example:8080' },
      session: { cookies: [{ name: 'a', value: 'b', domain: 'c', path: '/' }] },
      attestation: ATTESTATION,
    })
    expect(verifyAccessFact(fact)).toEqual([])
  })

  it('catches user access stripped of its attestation', () => {
    const fact = normalizeAccessConfig({
      proxy: { url: 'http://gate.proxy.example:8080' },
      attestation: ATTESTATION,
    })
    const stripped: AccessFactShape = {
      ...fact,
      attestedBy: null,
      attestedAt: null,
      attestationStatement: null,
    }
    expect(verifyAccessFact(stripped)).toHaveLength(1)
    expect(verifyAccessFact(stripped)[0]).toContain('unproven')
  })

  it('catches an attestation pinned to operator-owned access', () => {
    const forged: AccessFactShape = {
      ...OPERATOR_ACCESS,
      attestedBy: ATTESTATION.principal,
      attestedAt: ATTESTATION.at,
      attestationStatement: ATTESTATION.statement,
    }
    expect(verifyAccessFact(forged)).toHaveLength(1)
  })

  it('catches claimed user egress with no endpoint', () => {
    const fact: AccessFactShape = {
      ...OPERATOR_ACCESS,
      egressOwner: 'user',
      attestedBy: ATTESTATION.principal,
      attestedAt: ATTESTATION.at,
      attestationStatement: ATTESTATION.statement,
    }
    expect(verifyAccessFact(fact)).toContain(
      'egress claimed user-owned but no proxy endpoint recorded',
    )
  })

  it('reports every violation, not just the first', () => {
    const fact: AccessFactShape = {
      egressOwner: 'user',
      proxyEndpoint: null,
      proxyCredentialSha256: null,
      sessionOwner: 'user',
      sessionSha256: null,
      attestedBy: null,
      attestedAt: null,
      attestationStatement: null,
    }
    expect(verifyAccessFact(fact).length).toBeGreaterThanOrEqual(3)
  })
})

describe('access inside the compliance record', () => {
  it('defaults to operator access when the caller says nothing', () => {
    const record = buildComplianceRecord(inputWithAccess())
    expect(record.access).toEqual(OPERATOR_ACCESS)
    expect(record.schemaVersion).toBe(2)
  })

  it('changes the contentHash when access changes', () => {
    // This is the whole point of the schemaVersion bump: the transfer is
    // *inside* the signed bytes, so it cannot be added or removed later.
    const operator = buildComplianceRecord(inputWithAccess())
    const user = buildComplianceRecord(
      inputWithAccess(
        normalizeAccessConfig({
          proxy: { url: 'http://gate.proxy.example:8080' },
          attestation: ATTESTATION,
        }),
      ),
    )
    expect(user.contentHash).not.toBe(operator.contentHash)
  })

  it('cannot be stripped of its access claim without breaking the hash', () => {
    const fact = normalizeAccessConfig({
      proxy: { url: 'http://gate.proxy.example:8080' },
      attestation: ATTESTATION,
    })
    const record = buildComplianceRecord(inputWithAccess(fact))
    const rehashedWithoutAccess = buildComplianceRecord(inputWithAccess())
    expect(rehashedWithoutAccess.contentHash).not.toBe(record.contentHash)
  })

  it('keeps credentials out of the record entirely', () => {
    const fact = normalizeAccessConfig({
      proxy: { url: 'http://gate.proxy.example:8080', username: 'u', password: 'hunter2' },
      session: {
        cookies: [{ name: 'session-id', value: 'SECRET-COOKIE', domain: '.a.com', path: '/' }],
      },
      attestation: ATTESTATION,
    })
    const serialized = JSON.stringify(buildComplianceRecord(inputWithAccess(fact)))
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('SECRET-COOKIE')
  })

  it('is re-derived by the ledger verifier, so a user-access chain verifies', () => {
    // Regression guard: the verifier rebuilds each record to re-check its hash.
    // When `access` was added to the serialization but not to that rebuild,
    // every user-access record failed verification against itself.
    const fact = normalizeAccessConfig({
      proxy: { url: 'http://gate.proxy.example:8080' },
      attestation: ATTESTATION,
    })
    const chain = new ComplianceChain('run-1', 'research')
    const { recordId: _id, prevRecordHash: _p, ...rest } = inputWithAccess(fact)
    chain.append({ recordId: 'rec-001', ...rest })
    chain.append({ recordId: 'rec-002', ...rest })

    const verdict = verifyLedger(chain.toLedger())
    expect(verdict.violations).toEqual([])
    expect(verdict.valid).toBe(true)
  })

  it('flags a record claiming user access with nobody attesting', () => {
    const chain = new ComplianceChain('run-1', 'research')
    const { recordId: _id, prevRecordHash: _p, ...rest } = inputWithAccess({
      ...OPERATOR_ACCESS,
      egressOwner: 'user',
      proxyEndpoint: 'http://gate.proxy.example:8080',
    })
    chain.append({ recordId: 'rec-001', ...rest })

    const verdict = verifyLedger(chain.toLedger())
    expect(verdict.valid).toBe(false)
    expect(verdict.violations.map((v) => v.kind)).toContain('unattested_access')
  })
})
