/**
 * BYO Proxy and Inherited Session: the user's own access, and the record that
 * proves whose it was.
 *
 * WHY THIS EXISTS. When a site gates us, three answers are honest and one is
 * not. Honest: run a real browser (more capability we legitimately have), use
 * the user's own logged-in session, leave from the user's own network. Not
 * honest: defeat the gate. `escalationForBlock` already encodes that ladder;
 * this module is the configuration surface for its last two rungs.
 *
 * WHY IT IS NOT JUST CONFIG. Routing a fetch through a user's proxy or session
 * moves real responsibility onto them — their IP is what the publisher sees,
 * their account is what the ToS binds, their contract governs the egress. A
 * product that quietly accepts a proxy URL and says nothing has taken their
 * risk without their acknowledgement. So the transfer is recorded: every
 * compliance record carries an `AccessFact` stating who owned the egress, who
 * owned the session, and who attested to the right to use them. Signed, that
 * is a artifact both sides can point at afterwards — which is the difference
 * between transferring responsibility and merely assuming it transferred.
 *
 * WHAT MUST NEVER BE IN THE RECORD. Proxy passwords and cookie values are
 * credentials. They are hashed, never stored: `proxyCredentialSha256` lets two
 * records be recognized as using the same credential without disclosing it,
 * which is what an auditor actually needs. A compliance record is meant to be
 * handed to a publisher or a court; a record that leaks the user's session
 * cookie would be a breach dressed as an attestation.
 *
 * WHAT THIS IS NOT. There is no fingerprint spoofing here, no CDP patching, no
 * captcha solving, and no rotating pool. A proxy is an egress path the user
 * already has the right to use; the honest-mode UA is sent through it
 * unchanged, and the identity honesty check still applies. Changing egress is
 * not changing identity.
 */

/** Who owned the network path a fetch actually left through. */
export type EgressOwner =
  /** Our own network. We hold the responsibility. */
  | 'operator'
  /** The user's proxy. Their IP, their contract, their responsibility. */
  | 'user'

/** Whose authenticated state, if any, a fetch carried. */
export type SessionOwner =
  /** No session; the fetch was anonymous. */
  | 'none'
  /** The user's own logged-in state, supplied by them. */
  | 'user'

/**
 * A proxy the user brings. `url` carries scheme://host:port ONLY — credentials
 * go in the separate fields so they are never accidentally logged, serialized
 * into a trace, or embedded in an error message alongside the endpoint.
 * `normalizeProxyConfig` enforces this rather than trusting the caller.
 */
export interface ProxyConfig {
  /** e.g. `http://proxy.example:8080`. Userinfo here is stripped, not honoured. */
  url: string
  username?: string
  password?: string
}

/** One cookie of an inherited session, in the shape Playwright accepts. */
export interface SessionCookie {
  name: string
  value: string
  domain: string
  path: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

/**
 * The user's own logged-in state. Either explicit cookies or an opaque
 * Playwright storageState blob; both are credentials and both are hashed
 * rather than recorded.
 */
export interface SessionConfig {
  cookies?: readonly SessionCookie[]
  /** Serialized Playwright storageState JSON. */
  storageState?: string
}

/**
 * The user's explicit acknowledgement that they hold the right to use the
 * proxy and session they supplied, and that fetches made through them are
 * theirs. Required — `normalizeAccessConfig` rejects a proxy or session
 * without one, because an unattested transfer is not a transfer.
 */
export interface AccessAttestation {
  /** Identifier for the accepting principal: account id, email, org handle. */
  principal: string
  /** ISO timestamp of acceptance. */
  at: string
  /**
   * What they accepted, verbatim. Stored in the record so the claim can be
   * read later without trusting our summary of it.
   */
  statement: string
}

export interface AccessConfig {
  proxy?: ProxyConfig | null
  session?: SessionConfig | null
  attestation?: AccessAttestation | null
}

/**
 * The recorded, credential-free facts about whose access a fetch used. This is
 * the field that makes the responsibility transfer provable; it is part of the
 * canonical serialization, so it is covered by the record's contentHash and by
 * any signature over it.
 */
export interface AccessFact {
  egressOwner: EgressOwner
  /**
   * `scheme://host:port` of the proxy, with any userinfo removed. Null under
   * operator egress. The endpoint is not a secret and an auditor needs it;
   * the credential is a secret and appears only as a hash.
   */
  proxyEndpoint: string | null
  /**
   * sha256 of the proxy credential. Recognizes reuse across records without
   * disclosing the credential. Null when the proxy needs no credential.
   */
  proxyCredentialSha256: string | null
  sessionOwner: SessionOwner
  /** sha256 of the session material. Null when no session was supplied. */
  sessionSha256: string | null
  /** Principal who accepted responsibility. Null under operator egress. */
  attestedBy: string | null
  /** ISO timestamp of that acceptance. Null under operator egress. */
  attestedAt: string | null
  /** The statement they accepted, verbatim. Null under operator egress. */
  attestationStatement: string | null
}

/**
 * The default: we supplied the egress, no session, nobody else's
 * responsibility. Stated explicitly rather than left absent — "we did not
 * track this" and "this was ours" are different claims, and a record that
 * cannot tell them apart is not much of a record.
 */
export const OPERATOR_ACCESS_FACT: AccessFact = {
  egressOwner: 'operator',
  proxyEndpoint: null,
  proxyCredentialSha256: null,
  sessionOwner: 'none',
  sessionSha256: null,
  attestedBy: null,
  attestedAt: null,
  attestationStatement: null,
}

// ---------------------------------------------------------------------------
// What a blocked result should ask the user for
// ---------------------------------------------------------------------------

/**
 * What the caller must supply for a given escalation target. Returned to a
 * blocked caller so the guidance is a machine-readable requirement, not a
 * sentence in a log line.
 */
export type AccessRequirement =
  /** Nothing more is needed; we can run this lane ourselves. */
  | 'none'
  /** The user's own logged-in session (cookies or storageState). */
  | 'session'
  /** The user's own proxy. */
  | 'proxy'

export interface AccessGuidance {
  requirement: AccessRequirement
  /** Why this is being asked for, in one sentence the caller can surface. */
  rationale: string
}

/**
 * The access a lane needs from the user. Lanes we can run on our own return
 * `none`; the two user-access lanes name what they need and why.
 *
 * Note what is NOT here: no lane's requirement is "solve the challenge" or
 * "rotate to a fresh IP". `provider` returns `none` because the provider lane
 * is our own contracted capacity, not the user's — its own gating lives in the
 * provider adapter's robots check, not here.
 */
export function accessGuidanceForLane(lane: string): AccessGuidance {
  switch (lane) {
    case 'browser_local_authed':
      return {
        requirement: 'session',
        rationale:
          'The site requires an account. We do not create or share accounts; ' +
          'supply your own logged-in session and the fetch runs as you.',
      }
    case 'browser_proxy':
      return {
        requirement: 'proxy',
        rationale:
          'The site refused our network path. We do not rotate addresses to ' +
          'get around that; supply a proxy you hold the right to use and the ' +
          'fetch leaves from your network, under your responsibility.',
      }
    default:
      return { requirement: 'none', rationale: 'This lane needs no access from you.' }
  }
}
