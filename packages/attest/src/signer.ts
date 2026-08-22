/**
 * Ed25519 compliance signer over Node's built-in crypto.
 *
 * First implementation of the `ComplianceSigner` seam from @w2l/contracts.
 * Deliberately offline and self-keyed: the signature proves the record was
 * minted by whoever holds the private key, and `keyId` is the fingerprint of
 * the public key so a verifier can pick the right key out of a published set.
 *
 * The hard limit, stated plainly: the private key IS the identity. If it leaks,
 * every record ever signed under it becomes forgeable and the whole ledger's
 * trust collapses — the hash chain only proves tamper-evidence, not
 * authorship. Key rotation, revocation, and out-of-band key publication are a
 * later requirement, not an afterthought. The scheme name is stamped into each
 * signature so a Sigstore/Rekor-backed implementation can slot in beside this
 * one without touching the record format.
 *
 * This package imports node:crypto, which is why it is NOT in http-core —
 * http-core stays a dependency-free pure module; this is the leaf where the
 * runtime primitive is allowed to live.
 */

import {
  createHash,
  generateKeyPairSync,
  sign as _sign,
  verify as _verify,
  type KeyObject,
} from 'node:crypto'
import type { ComplianceSigner } from '@w2l/contracts'

export const ED25519_SCHEME = 'ed25519'

/**
 * The public key fingerprint used as `keyId`: sha256 of the DER SPKI, hex.
 * Stable for a given key, independent of the PEM wrapper.
 */
export function publicKeyFingerprint(publicKeyPem: string): string {
  const der = Buffer.from(publicKeyPem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64')
  return createHash('sha256').update(der).digest('hex')
}

/** Export a KeyObject public key as SPKI PEM. */
export function exportPublicKey(publicKey: KeyObject): string {
  return publicKey.export({ type: 'spki', format: 'pem' }).toString()
}

export interface Ed25519KeyPair {
  publicKeyPem: string
  privateKeyPem: string
  keyId: string
}

/** Generate a fresh Ed25519 keypair. Returns PEMs plus the derived keyId. */
export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = exportPublicKey(publicKey)
  return {
    publicKeyPem,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    keyId: publicKeyFingerprint(publicKeyPem),
  }
}

/**
 * Verify a signature independently, given the signer's public key. This is the
 * path a third party runs: it takes only the record's contentHash, signature
 * value, and the published public key — no private material.
 */
export function verifyEd25519Signature(
  contentHash: string,
  signatureBase64: string,
  publicKeyPem: string,
): boolean {
  return _verify(
    null,
    Buffer.from(contentHash, 'hex'),
    publicKeyPem,
    Buffer.from(signatureBase64, 'base64'),
  )
}

/**
 * An Ed25519 `ComplianceSigner` bound to one keypair. `sign` produces a
 * base64 signature over the record's contentHash; `verify` checks against the
 * same key (self-check, used in tests and key rotation). Third parties use
 * `verifyEd25519Signature` with the published public key instead.
 */
export class Ed25519ComplianceSigner implements ComplianceSigner {
  readonly scheme = ED25519_SCHEME
  readonly keyId: string
  readonly publicKeyPem: string

  private readonly privateKeyPem: string

  constructor(keyPair: Ed25519KeyPair) {
    this.keyId = keyPair.keyId
    this.publicKeyPem = keyPair.publicKeyPem
    this.privateKeyPem = keyPair.privateKeyPem
  }

  async sign(contentHash: string): Promise<{ value: string }> {
    const sig = _sign(null, Buffer.from(contentHash, 'hex'), this.privateKeyPem)
    return { value: sig.toString('base64') }
  }

  async verify(contentHash: string, signature: string): Promise<boolean> {
    return verifyEd25519Signature(contentHash, signature, this.publicKeyPem)
  }
}
