/**
 * Key rotation, revocation, and the published keyset.
 *
 * signer.ts states the hard limit: the private key IS the identity, and a leak
 * makes every record signed under it forgeable. This module is the answer to
 * that — not a fix, because nothing un-leaks a key, but the machinery that
 * bounds the blast radius:
 *
 *   - A keyset publishes public keys with validity windows, so a verifier can
 *     ask "was this key valid when the record was minted?" rather than only
 *     "does the signature check out?".
 *   - Revocation carries a timestamp, and records signed BEFORE the revocation
 *     instant stay valid. This is the whole point: revoking on compromise must
 *     not invalidate a year of honest history, and treating revocation as
 *     retroactive would give an operator an incentive never to disclose.
 *   - Compromise is distinguished from ordinary retirement. A key retired on
 *     schedule keeps its prior signatures trustworthy; a key believed
 *     *compromised* cannot vouch for anything after the compromise instant,
 *     which may be earlier than the moment it was noticed.
 *
 * The keyset is designed to be published out-of-band (a well-known URL, a repo,
 * eventually a transparency log). A verifier who fetches the keyset from the
 * same party that signed the records gains little; that limitation is inherent
 * to self-held keys and is why the scheme field exists on every signature.
 */

import type { ComplianceSigner } from '@w2l/contracts'
import {
  ED25519_SCHEME,
  Ed25519ComplianceSigner,
  generateEd25519KeyPair,
  verifyEd25519Signature,
  type Ed25519KeyPair,
} from './signer.js'

/** Why a key stopped being usable for new signatures. */
export type RevocationReason =
  /** Planned rotation. Prior signatures remain fully trustworthy. */
  | 'retired'
  /** Private key believed exposed. Signatures after `at` cannot be trusted. */
  | 'compromised'
  /** Key superseded by a successor without any suspicion of exposure. */
  | 'superseded'

export interface KeyRevocation {
  reason: RevocationReason
  /**
   * ISO timestamp the revocation takes effect from. For 'compromised' this
   * should be the earliest moment exposure is *possible*, not the moment it was
   * discovered — guessing late is how a forged record slips through.
   */
  at: string
  note: string | null
}

/** One public key as published in the keyset. No private material, ever. */
export interface PublishedKey {
  keyId: string
  scheme: string
  publicKeyPem: string
  /** ISO timestamp from which this key may sign. */
  validFrom: string
  revocation: KeyRevocation | null
}

export interface KeySet {
  /** Who these keys belong to, e.g. a URL or org identifier. */
  issuer: string
  keys: readonly PublishedKey[]
}

/** Serializable form of the keyset; this is what gets published. */
export function serializeKeySet(keySet: KeySet): string {
  return JSON.stringify(keySet, null, 2)
}

export function parseKeySet(json: string): KeySet {
  const parsed: unknown = JSON.parse(json)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as KeySet).issuer !== 'string' ||
    !Array.isArray((parsed as KeySet).keys)
  ) {
    throw new Error('malformed keyset: expected { issuer: string, keys: [] }')
  }
  return parsed as KeySet
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

export interface RotationResult {
  /** The signer to use from now on. */
  signer: Ed25519ComplianceSigner
  /** The new key material — the caller is responsible for storing it safely. */
  keyPair: Ed25519KeyPair
  /** The keyset with the successor added and the predecessor revoked. */
  keySet: KeySet
}

/**
 * Rotate to a fresh key: mint a successor, publish it, and revoke the current
 * key with the given reason.
 *
 * `at` is supplied by the caller rather than read from the clock, so rotation
 * stays pure and testable, and so a compromise can be backdated to when it
 * actually began. Rotating a key that is already revoked throws — silently
 * re-revoking would overwrite the original (possibly earlier, possibly
 * 'compromised') revocation, which is exactly the record a verifier depends on.
 */
export function rotateKey(
  keySet: KeySet,
  currentKeyId: string,
  revocation: KeyRevocation,
  at: string,
): RotationResult {
  const current = keySet.keys.find((k) => k.keyId === currentKeyId)
  if (!current) {
    throw new Error(`cannot rotate unknown key ${currentKeyId}`)
  }
  if (current.revocation !== null) {
    throw new Error(
      `key ${currentKeyId} is already revoked (${current.revocation.reason} at ${current.revocation.at})`,
    )
  }

  const keyPair = generateEd25519KeyPair()
  const successor: PublishedKey = {
    keyId: keyPair.keyId,
    scheme: ED25519_SCHEME,
    publicKeyPem: keyPair.publicKeyPem,
    validFrom: at,
    revocation: null,
  }

  return {
    signer: new Ed25519ComplianceSigner(keyPair),
    keyPair,
    keySet: {
      issuer: keySet.issuer,
      keys: [...keySet.keys.map((k) => (k.keyId === currentKeyId ? { ...k, revocation } : k)), successor],
    },
  }
}

/** Revoke a key in place without minting a successor. */
export function revokeKey(keySet: KeySet, keyId: string, revocation: KeyRevocation): KeySet {
  const target = keySet.keys.find((k) => k.keyId === keyId)
  if (!target) throw new Error(`cannot revoke unknown key ${keyId}`)
  if (target.revocation !== null) {
    throw new Error(
      `key ${keyId} is already revoked (${target.revocation.reason} at ${target.revocation.at})`,
    )
  }
  return {
    issuer: keySet.issuer,
    keys: keySet.keys.map((k) => (k.keyId === keyId ? { ...k, revocation } : k)),
  }
}

/** Start a keyset from a freshly generated key. */
export function initKeySet(issuer: string, keyPair: Ed25519KeyPair, validFrom: string): KeySet {
  return {
    issuer,
    keys: [
      {
        keyId: keyPair.keyId,
        scheme: ED25519_SCHEME,
        publicKeyPem: keyPair.publicKeyPem,
        validFrom,
        revocation: null,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Verification against a keyset
// ---------------------------------------------------------------------------

export type KeyStatus =
  /** Key was valid for signing at the given instant. */
  | 'valid'
  /** Key exists but the instant precedes its validFrom. */
  | 'not_yet_valid'
  /** Key was retired/superseded before the instant; prior signatures still hold. */
  | 'revoked'
  /** Key was compromised at or before the instant — trust nothing from then on. */
  | 'compromised'
  /** No such key in the keyset. */
  | 'unknown_key'

/**
 * What a key's status was at a given instant.
 *
 * The distinction that matters: 'retired' and 'superseded' bound *future*
 * signing but leave earlier records valid, whereas 'compromised' invalidates
 * everything from the compromise instant forward. Both report 'revoked' vs
 * 'compromised' separately so the caller can apply that difference rather than
 * collapsing it into a single boolean.
 */
export function keyStatusAt(keySet: KeySet, keyId: string, instant: string): KeyStatus {
  const key = keySet.keys.find((k) => k.keyId === keyId)
  if (!key) return 'unknown_key'

  const t = Date.parse(instant)
  if (Number.isNaN(t)) throw new Error(`unparseable instant: ${instant}`)
  if (t < Date.parse(key.validFrom)) return 'not_yet_valid'

  const rev = key.revocation
  if (rev === null) return 'valid'
  if (t < Date.parse(rev.at)) return 'valid'
  return rev.reason === 'compromised' ? 'compromised' : 'revoked'
}

export interface AttestationVerdict {
  /** Signature checks out AND the key was legitimately usable at `signedAt`. */
  trusted: boolean
  /** Cryptographic result alone, independent of key status. */
  signatureValid: boolean
  keyStatus: KeyStatus
  reason: string
}

/**
 * Verify a record's signature against a published keyset, at the instant the
 * record claims to have been minted.
 *
 * Both halves must hold: a valid signature from a compromised key is not
 * trustworthy, and a valid key does not rescue a broken signature. The verdict
 * reports them separately so a verifier can tell "you forged this" from "your
 * key leaked and we can no longer tell".
 */
export function verifyAgainstKeySet(
  keySet: KeySet,
  keyId: string,
  contentHash: string,
  signatureBase64: string,
  signedAt: string,
): AttestationVerdict {
  const key = keySet.keys.find((k) => k.keyId === keyId)
  const keyStatus = keyStatusAt(keySet, keyId, signedAt)

  if (!key) {
    return { trusted: false, signatureValid: false, keyStatus, reason: `unknown key ${keyId}` }
  }
  if (key.scheme !== ED25519_SCHEME) {
    return {
      trusted: false,
      signatureValid: false,
      keyStatus,
      reason: `unsupported scheme ${key.scheme}`,
    }
  }

  let signatureValid = false
  try {
    signatureValid = verifyEd25519Signature(contentHash, signatureBase64, key.publicKeyPem)
  } catch {
    signatureValid = false
  }

  if (!signatureValid) {
    return { trusted: false, signatureValid, keyStatus, reason: 'signature does not verify' }
  }
  if (keyStatus !== 'valid') {
    return {
      trusted: false,
      signatureValid,
      keyStatus,
      reason:
        keyStatus === 'compromised'
          ? 'key was compromised at or before this record was signed'
          : `key status at signing time: ${keyStatus}`,
    }
  }

  return { trusted: true, signatureValid, keyStatus, reason: 'signature valid under an active key' }
}

/** Narrowing helper: the signer interface a rotation returns. */
export type RotatableSigner = ComplianceSigner & { readonly publicKeyPem: string }
