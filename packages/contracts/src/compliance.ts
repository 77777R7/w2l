/**
 * Honest-mode identity + provable-compliance record contracts.
 *
 * Two things live here, and they are deliberately separated:
 *
 *  1. `CrawlMode` — the product's mode switch, inverted. Every mode is *true*:
 *     it declares who the crawler is and what compliance it promises. There is
 *     no stealth mode and no "lie a little" tier; the empirical probe showed
 *     the honest arm (aligned client hints) already outperforms the stealth arm
 *     (see packages/bench research notes), so a covert mode would carry §1201
 *     exposure with no performance upside.
 *
 *  2. `ComplianceRecord` — the premium tier: a tamper-evident, signable record
 *     of *what the crawler actually did* (robots.txt decision, the exact
 *     headers it sent, the rate-limit facts), so a third party — publisher,
 *     enterprise buyer, court — can verify the claim rather than take it on
 *     faith. This is the buyer-side attestation cell the market research found
 *     empty: TollBit/x402/RSL/Cloudflare all sell to *publishers*; nobody sells
 *     the crawler a machine-verifiable record of its own compliance.
 *
 * This package stays types-only (no crypto, no I/O). The signing primitive is
 * an abstract `ComplianceSigner` implemented in http-core or a leaf package;
 * contracts only carries the opaque signature triple.
 *
 * Honesty invariant baked into the type: a record's `mode` is the single source
 * of truth for the *declared* identity, and the `sentHeaders` fact records the
 * bytes actually on the wire. A mismatch between the two is detectable from the
 * signed record alone — which is the point.
 */

import type { Lane } from './status.js'

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/**
 * The honest-mode switch. `mode` names an identity + compliance policy; the
 * runtime derives a `Lane` (execution tier) and a concrete user-agent from it.
 */
export type CrawlMode = 'research' | 'standard' | 'authed' | 'proxy'

/** Canonical UA shape per mode. Values live in http-core/bench (ua.ts), not here. */
export interface ModeIdentity {
  mode: CrawlMode
  /**
   * The exact User-Agent string the mode declares. The runtime must send this
   * verbatim — a differing UA is a lie the signed record exposes.
   */
  userAgent: string
  /**
   * Client-hint headers aligned to the UA, e.g. sec-ch-ua / sec-ch-ua-platform
   * / sec-ch-ua-mobile. Alignment — not stealth — is what avoids the
   * HeadlessChrome block signal; an inconsistent set is a bug, not a disguise.
   */
  clientHints: Readonly<Record<string, string>>
  /**
   * Whether the mode claims to respect robots.txt. All four modes are true:
   * login (`authed`) and egress (`proxy`) do not waive robots. The record
   * captures the actual per-decision facts regardless, so a claim here that
   * the record's `robots` contradicts is a verifiable lie.
   */
  respectsRobots: boolean
  /**
   * The lane this mode resolves to. Modes are policy, lanes are execution:
   *   research → browser_local (declared bot identity)
   *   standard → browser_local (plain browser consistency)
   *   authed   → browser_local_authed (owned login state)
   *   proxy    → browser_proxy (BYO egress; compliance responsibility is the
   *              operator's, and the record still captures the facts)
   */
  lane: Lane
}

// ---------------------------------------------------------------------------
// Concrete identities — one per mode, every mode true
// ---------------------------------------------------------------------------

/**
 * The declared-bot identity (`research`). No client hints: a UA that says
 * "compatible; w2l-research" must not simultaneously claim to be Chromium via
 * sec-ch-ua — that contradiction is the inconsistency the probe showed gets a
 * request blocked, and it is exactly the lie the signed record exposes.
 */
export const RESEARCH_USER_AGENT =
  'Mozilla/5.0 (compatible; w2l-research/0.1; +https://github.com/77777R7/w2l; research benchmark, one request per page)'

/**
 * Floor used when no real browser version is known. Subjects driving real
 * Chromium MUST pass the actual `browser.version()` major instead — declaring
 * a Chrome version you are not running is an inconsistency, not a feature.
 */
export const CHROME_MAJOR_FLOOR = 128

/** Full Chrome UA for a given major, in the shape the probe's D arm used. */
export function browserUserAgent(chromeMajor: number): string {
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`
}

/**
 * Client-hint headers aligned to the UA. The sec-ch-ua / sec-ch-ua-mobile /
 * sec-ch-ua-platform triple must quote the same major as the UA, and the
 * platform token must match what navigator.platform reports — an unaligned set
 * is the bug, not a disguise.
 *
 * `accept-language` is deliberately NOT here: it is not a client hint, it is
 * a normal header the browser derives from the context `locale`, and Chromium
 * normalizes it (dropping the `;q=` weight). Declaring it as a hint would
 * guarantee a declared-vs-sent mismatch on every fetch — so it stays under
 * `locale`/`BROWSER_FINGERPRINT`, where it is a setting, not a claim.
 */
export function browserClientHints(chromeMajor: number): Readonly<Record<string, string>> {
  return {
    'sec-ch-ua': `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not;A=Brand";v="24"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
  }
}

/**
 * Fingerprint context fields that must match the UA for a consistent browser
 * identity. Applied to the Playwright context by the subject; kept here so the
 * values are single-sourced with the UA rather than drifted per-subject.
 */
export const BROWSER_FINGERPRINT = {
  locale: 'en-US',
  timezoneId: 'America/Los_Angeles',
  viewport: { width: 1280, height: 800 },
  screen: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
} as const

/**
 * The identity for a mode. `standard`, `authed`, and `proxy` share one
 * consistent-browser identity (they differ only in execution lane — session,
 * egress); `research` is the declared bot with no client hints.
 */
export function modeIdentity(mode: CrawlMode, chromeMajor: number = CHROME_MAJOR_FLOOR): ModeIdentity {
  switch (mode) {
    case 'research':
      return { mode, userAgent: RESEARCH_USER_AGENT, clientHints: {}, respectsRobots: true, lane: 'browser_local' }
    case 'standard':
      return { mode, userAgent: browserUserAgent(chromeMajor), clientHints: browserClientHints(chromeMajor), respectsRobots: true, lane: 'browser_local' }
    case 'authed':
      return { mode, userAgent: browserUserAgent(chromeMajor), clientHints: browserClientHints(chromeMajor), respectsRobots: true, lane: 'browser_local_authed' }
    case 'proxy':
      return { mode, userAgent: browserUserAgent(chromeMajor), clientHints: browserClientHints(chromeMajor), respectsRobots: true, lane: 'browser_proxy' }
  }
}

/** All four identities, for the subject layer to enumerate without a switch. */
export const MODE_IDENTITIES: Readonly<Record<CrawlMode, ModeIdentity>> = {
  research: modeIdentity('research'),
  standard: modeIdentity('standard'),
  authed: modeIdentity('authed'),
  proxy: modeIdentity('proxy'),
}

// ---------------------------------------------------------------------------
// Compliance facts
// ---------------------------------------------------------------------------

/**
 * The outcome of consulting robots.txt for a single target URL. One record per
 * fetch. `consulted` distinguishes "we checked and it said X" from "there was
 * nothing to check" — a record that skips the check must say so, never pretend.
 */
export interface RobotsDecision {
  /** The robots.txt URL consulted, e.g. `https://site.example/robots.txt`. */
  robotsUrl: string | null
  /** sha256 of the robots.txt bytes actually parsed, for drift verification. */
  robotsSha256: string | null
  /**
   * Which user-agent group matched. Null when robots.txt was absent or had no
   * group for this UA — recorded as a fact, not an assumption.
   */
  matchedUserAgentGroup: string | null
  /** The compiled rules that fired for this path, most-specific first. */
  appliedRules: readonly { pattern: string; allow: boolean }[]
  /** Final decision: allowed, disallowed, or no-robots (nothing consulted). */
  decision: 'allowed' | 'disallowed' | 'no_robots'
  /** When disallowed, whether the fetch was skipped because of it. */
  skippedFetch: boolean
}

/**
 * What actually went on the wire. Sorted by header name, lowercased names.
 * Captured as-sent — including any header that would contradict the mode.
 */
export interface SentHeadersFact {
  /** Exact request headers, lowercased names, sorted. Empty when not captured. */
  headers: readonly { name: string; value: string }[]
}

/**
 * The rate-limit facts for this fetch relative to the preceding fetch to the
 * same host. The record asserts the *measured* facts; non-compliance is
 * recorded honestly as `compliant: false`, never omitted.
 */
export interface RateLimitFact {
  /** Same-host previous request timestamp, epoch ms. Null on first request. */
  previousRequestAtMs: number | null
  /** Delay actually observed before this request, ms. Null on first request. */
  observedDelayMs: number | null
  /** The policy minimum delay for this host at the time. */
  requiredDelayMs: number
  /** True iff observedDelayMs >= requiredDelayMs (or first request). */
  compliant: boolean
  /** Requests to this host within the last second, for burst verification. */
  recentSameHostCount: number
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** A single fetch's compliance record. Tamper-evident via the content hash. */
export interface ComplianceRecord {
  /** Schema version, bumped on breaking shape change. */
  schemaVersion: 1
  /** Opaque id, unique per fetch. */
  recordId: string
  /** The mode under which the fetch ran. Bind's the declared identity. */
  mode: CrawlMode
  /** The URL that was requested (pre-redirect). */
  requestedUrl: string
  /** Final URL after redirects; null if the fetch never completed. */
  finalUrl: string | null
  /** ISO timestamp of the request. */
  requestedAt: string
  robots: RobotsDecision
  sentHeaders: SentHeadersFact
  rateLimit: RateLimitFact
  /**
   * Hash of the previous record in the run's chain, hex. Null for the first
   * record. Chaining makes deletion or reordering of a run's history evident.
   */
  prevRecordHash: string | null
  /** sha256 of the canonical serialization of everything above. */
  contentHash: string
  /**
   * Opaque signature triple, produced by a `ComplianceSigner`. Absent until a
   * signer is configured — an unsigned record is still a record, just not a
   * verifiable one. contracts does not import crypto; the signer lives in a
   * leaf package.
   */
  signature: {
    scheme: string
    keyId: string
    value: string
  } | null
}

/**
 * A whole run's compliance ledger: the ordered chain of per-fetch records.
 * `records[i].prevRecordHash` must equal `records[i-1].contentHash`.
 */
export interface ComplianceLedger {
  runId: string
  /** The mode policy in effect for this run, for record-set verification. */
  mode: CrawlMode
  records: readonly ComplianceRecord[]
}

/**
 * Abstract signer. Implemented where keys live (leaf package); `contracts`
 * stays crypto-free so this interface is the seam, not a dependency.
 */
export interface ComplianceSigner {
  readonly scheme: string
  readonly keyId: string
  /** Produce a signature over `contentHash` (hex). */
  sign(contentHash: string): Promise<{ value: string }>
  /** Verify a signature produced by a possibly-different signer. */
  verify(contentHash: string, signature: string): Promise<boolean>
}

// ---------------------------------------------------------------------------
// Honesty check
// ---------------------------------------------------------------------------

/**
 * Whether the identity a mode *declared* matches the headers that were
 * actually sent. This is the load-bearing check: a record that declares
 * `userAgent: chromeUA` while the wire carried the default `HeadlessChrome`
 * UA is a lie, and the whole point of the record is that such a lie is
 * detectable from the signed bytes alone.
 */
export interface HonestyVerdict {
  honest: boolean
  /** Human-readable mismatches, empty when honest. Never silent on a miss. */
  mismatches: readonly string[]
}

/**
 * Compare a declared identity against the actual sent headers. `sentHeaders`
 * is the as-sent fact the record already carries; the declared `userAgent` and
 * `clientHints` come from the mode. A mismatch is reported, not papered over —
 * the fix is to align the context, not to widen the check.
 */
export function checkIdentityHonesty(
  identity: ModeIdentity,
  sent: SentHeadersFact,
): HonestyVerdict {
  const byName = new Map(sent.headers.map((h) => [h.name.toLowerCase(), h.value]))
  const mismatches: string[] = []

  const sentUa = byName.get('user-agent')
  if (sentUa === undefined) {
    mismatches.push('user-agent: not sent')
  } else if (sentUa !== identity.userAgent) {
    mismatches.push(`user-agent: declared "${identity.userAgent}" but sent "${sentUa}"`)
  }

  for (const [name, declared] of Object.entries(identity.clientHints)) {
    const sentValue = byName.get(name.toLowerCase())
    if (sentValue === undefined) {
      mismatches.push(`${name}: declared but not sent`)
    } else if (sentValue !== declared) {
      mismatches.push(`${name}: declared "${declared}" but sent "${sentValue}"`)
    }
  }

  return { honest: mismatches.length === 0, mismatches }
}
