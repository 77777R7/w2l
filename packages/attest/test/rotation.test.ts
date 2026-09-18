import { describe, expect, it } from 'vitest'
import {
  Ed25519ComplianceSigner,
  generateEd25519KeyPair,
  initKeySet,
  keyStatusAt,
  parseKeySet,
  revokeKey,
  rotateKey,
  serializeKeySet,
  verifyAgainstKeySet,
  type KeySet,
} from '../src/index.js'

const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-06-01T00:00:00.000Z'
const T2 = '2026-08-21T00:00:00.000Z'
const HASH = 'a'.repeat(64)

function fresh(): { keySet: KeySet; signer: Ed25519ComplianceSigner; keyId: string } {
  const keyPair = generateEd25519KeyPair()
  return {
    keySet: initKeySet('https://w2l.example/keys', keyPair, T0),
    signer: new Ed25519ComplianceSigner(keyPair),
    keyId: keyPair.keyId,
  }
}

// ---------------------------------------------------------------------------
// Keyset shape and publication
// ---------------------------------------------------------------------------

describe('keyset', () => {
  it('initKeySet publishes exactly one active key', () => {
    const { keySet, keyId } = fresh()
    expect(keySet.keys).toHaveLength(1)
    expect(keySet.keys[0]!.keyId).toBe(keyId)
    expect(keySet.keys[0]!.revocation).toBeNull()
  })

  it('the published keyset contains no private material', () => {
    const { keySet } = fresh()
    expect(serializeKeySet(keySet)).not.toContain('PRIVATE KEY')
  })

  it('round-trips through serialize/parse', () => {
    const { keySet } = fresh()
    expect(parseKeySet(serializeKeySet(keySet))).toEqual(keySet)
  })

  it('rejects a malformed keyset rather than returning a broken object', () => {
    expect(() => parseKeySet('{"issuer":"x"}')).toThrow(/malformed keyset/)
  })
})

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

describe('rotateKey', () => {
  it('mints a successor and revokes the predecessor', () => {
    const { keySet, keyId } = fresh()
    const out = rotateKey(keySet, keyId, { reason: 'retired', at: T1, note: null }, T1)
    expect(out.keySet.keys).toHaveLength(2)
    expect(out.keySet.keys[0]!.revocation?.reason).toBe('retired')
    expect(out.keySet.keys[1]!.revocation).toBeNull()
    expect(out.keySet.keys[1]!.keyId).toBe(out.keyPair.keyId)
  })

  it('the successor key is genuinely different', () => {
    const { keySet, keyId } = fresh()
    const out = rotateKey(keySet, keyId, { reason: 'retired', at: T1, note: null }, T1)
    expect(out.keyPair.keyId).not.toBe(keyId)
    expect(out.keyPair.publicKeyPem).not.toBe(keySet.keys[0]!.publicKeyPem)
  })

  it('the returned signer signs under the new key', async () => {
    const { keySet, keyId } = fresh()
    const out = rotateKey(keySet, keyId, { reason: 'retired', at: T1, note: null }, T1)
    const sig = await out.signer.sign(HASH)
    const verdict = verifyAgainstKeySet(out.keySet, out.keyPair.keyId, HASH, sig.value, T2)
    expect(verdict.trusted).toBe(true)
  })

  it('refuses to rotate an unknown key', () => {
    const { keySet } = fresh()
    expect(() => rotateKey(keySet, 'nope', { reason: 'retired', at: T1, note: null }, T1)).toThrow(
      /unknown key/,
    )
  })

  it('refuses to re-revoke — the original revocation must not be overwritten', () => {
    // Overwriting would let a later 'retired' hide an earlier 'compromised',
    // which is precisely the fact a verifier depends on.
    const { keySet, keyId } = fresh()
    const once = rotateKey(keySet, keyId, { reason: 'compromised', at: T1, note: null }, T1)
    expect(() =>
      rotateKey(once.keySet, keyId, { reason: 'retired', at: T2, note: null }, T2),
    ).toThrow(/already revoked/)
  })

  it('revokeKey retires a key without minting a successor', () => {
    const { keySet, keyId } = fresh()
    const out = revokeKey(keySet, keyId, { reason: 'superseded', at: T1, note: 'manual' })
    expect(out.keys).toHaveLength(1)
    expect(out.keys[0]!.revocation?.note).toBe('manual')
  })
})

// ---------------------------------------------------------------------------
// Key status over time — the property that makes revocation usable
// ---------------------------------------------------------------------------

describe('keyStatusAt', () => {
  it('an unrevoked key is valid after validFrom', () => {
    const { keySet, keyId } = fresh()
    expect(keyStatusAt(keySet, keyId, T2)).toBe('valid')
  })

  it('a key is not yet valid before its validFrom', () => {
    const { keySet, keyId } = fresh()
    expect(keyStatusAt(keySet, keyId, '2025-01-01T00:00:00.000Z')).toBe('not_yet_valid')
  })

  it('a retired key was still valid before the revocation instant', () => {
    const { keySet, keyId } = fresh()
    const out = revokeKey(keySet, keyId, { reason: 'retired', at: T1, note: null })
    expect(keyStatusAt(out, keyId, T0)).toBe('valid')
    expect(keyStatusAt(out, keyId, T2)).toBe('revoked')
  })

  it('a compromised key reports compromised, not merely revoked', () => {
    const { keySet, keyId } = fresh()
    const out = revokeKey(keySet, keyId, { reason: 'compromised', at: T1, note: null })
    expect(keyStatusAt(out, keyId, T2)).toBe('compromised')
  })

  it('a compromise does not retroactively invalidate earlier signing', () => {
    const { keySet, keyId } = fresh()
    const out = revokeKey(keySet, keyId, { reason: 'compromised', at: T1, note: null })
    expect(keyStatusAt(out, keyId, T0)).toBe('valid')
  })

  it('an unknown key is reported as such rather than as invalid', () => {
    const { keySet } = fresh()
    expect(keyStatusAt(keySet, 'nope', T2)).toBe('unknown_key')
  })

  it('throws on an unparseable instant instead of silently defaulting', () => {
    const { keySet, keyId } = fresh()
    expect(() => keyStatusAt(keySet, keyId, 'not-a-date')).toThrow(/unparseable/)
  })
})

// ---------------------------------------------------------------------------
// Verification against the keyset — signature AND key status
// ---------------------------------------------------------------------------

describe('verifyAgainstKeySet', () => {
  it('trusts a valid signature from an active key', async () => {
    const { keySet, signer, keyId } = fresh()
    const sig = await signer.sign(HASH)
    const v = verifyAgainstKeySet(keySet, keyId, HASH, sig.value, T2)
    expect(v.trusted).toBe(true)
    expect(v.signatureValid).toBe(true)
    expect(v.keyStatus).toBe('valid')
  })

  it('records signed before a retirement stay trusted after it', async () => {
    // The whole point of dated revocation: rotating on schedule must not
    // invalidate a year of honest history.
    const { keySet, signer, keyId } = fresh()
    const sig = await signer.sign(HASH)
    const rotated = rotateKey(keySet, keyId, { reason: 'retired', at: T1, note: null }, T1)
    const v = verifyAgainstKeySet(rotated.keySet, keyId, HASH, sig.value, T0)
    expect(v.trusted).toBe(true)
  })

  it('a record claiming to be signed after retirement is not trusted', async () => {
    const { keySet, signer, keyId } = fresh()
    const sig = await signer.sign(HASH)
    const rotated = rotateKey(keySet, keyId, { reason: 'retired', at: T1, note: null }, T1)
    const v = verifyAgainstKeySet(rotated.keySet, keyId, HASH, sig.value, T2)
    expect(v.trusted).toBe(false)
    expect(v.signatureValid).toBe(true)
    expect(v.keyStatus).toBe('revoked')
  })

  it('a compromised key cannot vouch for anything after the compromise instant', async () => {
    const { keySet, signer, keyId } = fresh()
    const sig = await signer.sign(HASH)
    const revoked = revokeKey(keySet, keyId, { reason: 'compromised', at: T1, note: 'laptop stolen' })
    const v = verifyAgainstKeySet(revoked, keyId, HASH, sig.value, T2)
    expect(v.trusted).toBe(false)
    expect(v.keyStatus).toBe('compromised')
    expect(v.reason).toMatch(/compromised/)
  })

  it('distinguishes a forgery from a leaked key', async () => {
    // Two different failures the caller must be able to tell apart: a bad
    // signature means someone lied; a compromised key means we can no longer
    // tell whether they did.
    const { keySet, signer, keyId } = fresh()
    const sig = await signer.sign(HASH)

    const forged = verifyAgainstKeySet(keySet, keyId, 'b'.repeat(64), sig.value, T2)
    expect(forged.signatureValid).toBe(false)
    expect(forged.reason).toMatch(/does not verify/)

    const leaked = verifyAgainstKeySet(
      revokeKey(keySet, keyId, { reason: 'compromised', at: T0, note: null }),
      keyId,
      HASH,
      sig.value,
      T2,
    )
    expect(leaked.signatureValid).toBe(true)
    expect(leaked.trusted).toBe(false)
  })

  it('rejects a signature attributed to a key not in the keyset', async () => {
    const { signer } = fresh()
    const other = fresh()
    const sig = await signer.sign(HASH)
    const v = verifyAgainstKeySet(other.keySet, 'unlisted-key', HASH, sig.value, T2)
    expect(v.trusted).toBe(false)
    expect(v.reason).toMatch(/unknown key/)
  })

  it('rejects a signature made by a different key than the one claimed', async () => {
    const a = fresh()
    const b = fresh()
    const sig = await b.signer.sign(HASH)
    const v = verifyAgainstKeySet(a.keySet, a.keyId, HASH, sig.value, T2)
    expect(v.trusted).toBe(false)
    expect(v.signatureValid).toBe(false)
  })

  it('a malformed signature is rejected rather than throwing', () => {
    const { keySet, keyId } = fresh()
    const v = verifyAgainstKeySet(keySet, keyId, HASH, 'not-base64!!', T2)
    expect(v.trusted).toBe(false)
    expect(v.signatureValid).toBe(false)
  })

  it('rejects a key published under an unsupported scheme', async () => {
    const { keySet, signer, keyId } = fresh()
    const sig = await signer.sign(HASH)
    const alien: KeySet = {
      ...keySet,
      keys: keySet.keys.map((k) => ({ ...k, scheme: 'rsa-pss' })),
    }
    const v = verifyAgainstKeySet(alien, keyId, HASH, sig.value, T2)
    expect(v.trusted).toBe(false)
    expect(v.reason).toMatch(/unsupported scheme/)
  })

  it('survives a full rotation: old records verify under the old key, new under the new', async () => {
    const { keySet, signer, keyId } = fresh()
    const oldSig = await signer.sign(HASH)
    const rotated = rotateKey(keySet, keyId, { reason: 'retired', at: T1, note: null }, T1)
    const newHash = 'c'.repeat(64)
    const newSig = await rotated.signer.sign(newHash)

    expect(verifyAgainstKeySet(rotated.keySet, keyId, HASH, oldSig.value, T0).trusted).toBe(true)
    expect(
      verifyAgainstKeySet(rotated.keySet, rotated.keyPair.keyId, newHash, newSig.value, T2).trusted,
    ).toBe(true)
    // And the keys are not interchangeable.
    expect(
      verifyAgainstKeySet(rotated.keySet, rotated.keyPair.keyId, HASH, oldSig.value, T2).trusted,
    ).toBe(false)
  })
})
