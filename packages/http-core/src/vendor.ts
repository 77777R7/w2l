/**
 * Vendor capability manifest + product policy.
 *
 * THREE LAYERS, THREE FILES:
 *   1. Transport   — packages/bench/src/vendors/*: talks to the vendor API.
 *   2. Capability  — this module: what each vendor CAN do, declared by the
 *                    vendor adapter, uncoloured by product opinion.
 *   3. Policy      — also this module: which capabilities the PRODUCT will
 *                    ever enable, as a pure function of (offers, policy).
 *
 * Why the split exists. A capability is a fact about the vendor ("can solve
 * captchas", "can persist a profile", "offers a live view"). A policy is a
 * decision about us ("never solve captchas", "persist only when the user
 * authorized this domain", "live view only for handoff"). Hard-coding policy
 * into a vendor adapter is how it dies: add a third vendor, and the product's
 * refusal posture gets re-implemented (or forgotten) a third time. With the
 * split, the refusal set lives once, the authorization surface lives once,
 * and a vendor adapter can only ever declare what it offers — never change
 * what we accept.
 *
 * The refused capabilities have NO switch. Not "off by default" — absent from
 * the policy input entirely. A knob for `captcha_solving` would be the
 * override flag the provider gate deliberately lacks.
 */

// ---------------------------------------------------------------------------
// Capability layer: facts about vendors
// ---------------------------------------------------------------------------

/**
 * A capability a vendor may offer. The split is not "nice" vs "naughty" —
 * it is whether the capability changes the ROUTE (acceptable) or forges the
 * IDENTITY (refused).
 */
export type ProviderCapability =
  /** Runs a real browser engine remotely. Route change. Fine. */
  | 'headless_browser'
  /** Egress from the provider's addresses. Route change. Fine. */
  | 'datacenter_proxy'
  /** Egress from consumer ISP addresses. Route change; sourcing is the
   *  caller's diligence, not something this gate can verify. */
  | 'residential_proxy'
  /** Retries, backoff, queueing. Fine. */
  | 'retry_orchestration'
  /** Reuses a persisted browser profile across sessions (cookies, storage).
   *  Route persistence. Fine — but see policy: only with user authorization. */
  | 'session_persistence'
  /** A human can drive the session live (debug URL, remote view). Fine —
   *  it is the mechanism by which handoff happens. */
  | 'live_view_handoff'
  /** Forges navigator/TLS/canvas signals to defeat detection. REFUSED. */
  | 'fingerprint_spoofing'
  /** Hides the automation channel from the page. REFUSED. */
  | 'cdp_patching'
  /** Solves or bypasses a human-verification challenge. REFUSED. */
  | 'captcha_solving'
  /** Cycles identities to outlast a ban. REFUSED. */
  | 'identity_rotation'

/**
 * Capabilities that are a stealth layer by another name. Buying one is the
 * same act as building one; the only difference is the invoice. There is no
 * policy input that enables these — they are structurally absent.
 */
export const REFUSED_CAPABILITIES: readonly ProviderCapability[] = [
  'fingerprint_spoofing',
  'cdp_patching',
  'captcha_solving',
  'identity_rotation',
]

/**
 * One capability a vendor declares. `enableKey` says how the policy turns it
 * on (or null when the vendor exposes no off switch and we accept it by
 * choosing the vendor at all, e.g. headless_browser).
 */
export interface CapabilityOffer {
  capability: ProviderCapability
  /**
   * Whether the vendor ships with this capability ON by default, so the
   * adapter must send an explicit opt-out (Browserbase solveCaptchas, Steel
   * fingerprint injection) rather than trusting a default. The adapter is
   * responsible for the wire-side switch; this field is the declaration that
   * makes the refusal auditable.
   */
  vendorDefaultOn: boolean
  /** Policy key that may enable it. Null = always accepted when offered. */
  enableKey: string | null
}

// ---------------------------------------------------------------------------
// Policy layer: decisions about us
// ---------------------------------------------------------------------------

/**
 * What the operator (or user) has authorized, per run. The refused
 * capabilities are NOT here — there is no field that could name them.
 * `authorized` may be omitted: an empty authorization is the default.
 */
export interface VendorPolicy {
  authorized?: readonly string[]
}

/** The default: no persistence, no live view. Safe for any public URL. */
export const DEFAULT_VENDOR_POLICY: VendorPolicy = { authorized: [] }

export interface EnabledCapability {
  capability: ProviderCapability
  enableKey: string | null
  /** True when the vendor defaults it ON and the adapter must opt out. */
  optOutRequired: boolean
}

export interface PolicyDecision {
  /** What this run is allowed to use, after policy. Refused ones are absent. */
  enabled: readonly EnabledCapability[]
  /** Authorized policy keys this vendor did not offer, for the audit trail. */
  unauthorized: readonly string[]
  /** The permanent refusals, for the declaration and the audit trail. */
  refused: readonly ProviderCapability[]
}

/**
 * Policy keys that may enable a capability. `session_persistence` and
 * `live_view_handoff` require user authorization per target domain (see
 * governance); `residential_proxy` and `retry_orchestration` are operator
 * choices, also never on by default. The refused capabilities have no key.
 */
export const AUTHORIZABLE_POLICY_KEYS = [
  'session_persistence',
  'live_view_handoff',
  'residential_proxy',
  'retry_orchestration',
] as const

/**
 * Evaluate product policy against a vendor's capability offers.
 * Pure function: same offers + policy => same decision. The vendor adapter
 * passes this decision down to its session body builder; nothing else in the
 * vendor layer reads policy directly.
 */
export function evaluateVendorPolicy(
  offers: readonly CapabilityOffer[],
  policy: VendorPolicy = DEFAULT_VENDOR_POLICY,
): PolicyDecision {
  const authorized = new Set(policy.authorized ?? [])

  const enabled: EnabledCapability[] = []

  for (const offer of offers) {
    if (REFUSED_CAPABILITIES.includes(offer.capability)) {
      // Structural refusal — not added to `enabled` even though the vendor
      // offers it, and there is no policy key that could have named it.
      continue
    }
    if (offer.enableKey === null) {
      enabled.push({ capability: offer.capability, enableKey: null, optOutRequired: offer.vendorDefaultOn })
      continue
    }
    if (authorized.has(offer.enableKey)) {
      enabled.push({
        capability: offer.capability,
        enableKey: offer.enableKey,
        optOutRequired: offer.vendorDefaultOn,
      })
    }
  }

  // Requested-but-unavailable is itself worth reporting: it is the audit
  // trail's way of saying "you asked for handoff, this vendor cannot give it".
  const unauthorized = [...authorized].filter((key) => !offers.some((o) => o.enableKey === key))

  return { enabled, unauthorized, refused: [...REFUSED_CAPABILITIES] }
}
