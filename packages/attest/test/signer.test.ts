import { describe, expect, it } from 'vitest'
import {
  Ed25519ComplianceSigner,
  generateEd25519KeyPair,
  publicKeyFingerprint,
  verifyEd25519Signature,
} from '../src/signer.js'

/**
 * Two obligations: (1) sign-then-verify round-trips — a signature produced by
 * the signer verifies under the signer's public key; (2) forgery resistance —
 * the wrong key or a single flipped bit in the content hash must fail. A
 * signer whose verify accepts a tampered hash defeats the entire point of the
 * attestation record.
 */

describe('Ed25519ComplianceSigner', () => {
  it('signs and self-verifies a contentHash', async () => {
    const signer = new Ed25519ComplianceSigner(generateEd25519KeyPair())
    const hash = 'a'.repeat(64)
    const { value } = await signer.sign(hash)
    expect(value).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(await signer.verify(hash, value)).toBe(true)
  })

  it('rejects a tampered hash', async () => {
    const signer = new Ed25519ComplianceSigner(generateEd25519KeyPair())
    const hash = 'a'.repeat(64)
    const { value } = await signer.sign(hash)
    const tampered = 'b'.repeat(64)
    expect(await signer.verify(tampered, value)).toBe(false)
  })

  it('third-party verification works with only the public key', async () => {
    const kp = generateEd25519KeyPair()
    const signer = new Ed25519ComplianceSigner(kp)
    const hash = 'c'.repeat(64)
    const { value } = await signer.sign(hash)
    expect(verifyEd25519Signature(hash, value, kp.publicKeyPem)).toBe(true)
    expect(verifyEd25519Signature('d'.repeat(64), value, kp.publicKeyPem)).toBe(false)
  })

  it('rejects a signature under the wrong key', async () => {
    const a = new Ed25519ComplianceSigner(generateEd25519KeyPair())
    const b = new Ed25519ComplianceSigner(generateEd25519KeyPair())
    const hash = 'e'.repeat(64)
    const { value } = await a.sign(hash)
    expect(verifyEd25519Signature(hash, value, b.publicKeyPem)).toBe(false)
  })

  it('keyId is a stable fingerprint of the public key', () => {
    const kp = generateEd25519KeyPair()
    expect(kp.keyId).toBe(publicKeyFingerprint(kp.publicKeyPem))
    expect(kp.keyId).toMatch(/^[0-9a-f]{64}$/)
  })

  it('two keypairs never collide on keyId', () => {
    expect(generateEd25519KeyPair().keyId).not.toBe(generateEd25519KeyPair().keyId)
  })

  it('rejects an empty or malformed signature', async () => {
    const signer = new Ed25519ComplianceSigner(generateEd25519KeyPair())
    expect(await signer.verify('f'.repeat(64), '')).toBe(false)
    expect(await signer.verify('f'.repeat(64), '!!!not-base64!!!')).toBe(false)
  })
})
