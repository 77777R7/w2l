import { estimateTokens, type FetchResult, type TraceEvent } from '@w2l/contracts'
import { extractTf } from '@w2l/extract-tf'
import { toGfmTable } from '@w2l/fixtures'
import {
  classifyGate,
  escalationForBlock,
  evaluateProviderGate,
  normalizeAccessConfig,
  parseRobotsTxt,
  sha256Hex,
  ComplianceChain,
  type AccessConfigInput,
  type AccessFactShape,
  type ComplianceRecord,
  type ComplianceRobotsDecision,
  type ProviderDeclaration,
  type ProviderGateVerdict,
  type RobotsTxt,
} from '@w2l/http-core'
import { DEFAULT_NETWORK_POLICY, type CrawlMode } from '@w2l/contracts'
import type { SubjectAdapter } from '../subject.js'
import { identityCompromised } from '../routing/identity.js'
import type { VendorResumeContext } from '../vendors/transport.js'

/**
 * Provider lane: hand the fetch to a third-party that fights anti-bot systems
 * for a living (Browserbase, Steel, Scrapling), and do scheduling and
 * acceptance ourselves.
 *
 * The strategic bet — never self-develop a C++-level anti-detection layer —
 * is what makes this lane exist. The compliance discipline is what makes it
 * safe: routing does not launder robots. Every fetch is gated by
 * `evaluateProviderGate` against the UA the provider ACTUALLY SENDS, using our
 * own robots implementation on the target's own robots.txt. A ban means
 * `policy_denied` and a minted record, exactly as in the local lanes.
 *
 * The gate is not optional and there is no override. That is deliberate: the
 * whole value of outsourcing the fight is lost if what we outsource is the
 * violation. A provider whose product is evasion (captcha solving, CDP
 * patching, fingerprint spoofing, identity rotation) is refused on capability
 * before robots is consulted — buying that layer is the same act as building
 * it.
 *
 * The transport itself is injected (`ProviderTransport`), because every vendor
 * has a different API and none of them belong in this file. What belongs here
 * is the policy they all have to pass.
 */

/** What a vendor integration must provide. One call, no vendor types leaked. */
export interface ProviderTransport {
  /**
   * Fetch `url` and return the rendered HTML plus what actually happened.
   * Implementations must report the status the ORIGIN returned, not the
   * status of the vendor's own API — a 200 from the vendor wrapping a 403
   * from the target is a 403.
   */
  fetch(url: string, deadlineMs?: number): Promise<ProviderResponse>
  close?(): Promise<void>
}

export interface ProviderResponse {
  /** The origin's HTTP status, or 0 if the vendor could not reach it. */
  status: number
  body: string
  finalUrl: string
  /** Origin response headers, lowercased, for gate classification. */
  headers: Readonly<Record<string, string>>
  /**
   * The User-Agent observed on the outgoing request, when the transport could
   * see it. Null means UNOBSERVED, which is not the same as "matched the
   * declaration" — the record says which of the two it is.
   */
  sentUserAgent?: string | null
  /**
   * The UA this fetch was gated under, when the transport tracks it per call.
   * Lets a mismatch against `sentUserAgent` be caught at the fetch that
   * carried it rather than inferred later.
   */
  declaredUserAgent?: string | null
  /** What the vendor billed us, when it says. Reported, never estimated. */
  costUsd?: number | null
  /**
   * A live-view door for human handoff, when the policy enabled
   * live_view_handoff and the session could produce one. Null means no door
   * was opened — not that a door does not exist.
   */
  handoffUrl?: string | null
  /**
   * Vendor resume material for this session (context/profile/storage), when
   * session_persistence is enabled. Null when not authorized or unsupported.
   */
  resumeContext?: VendorResumeContext | null
}

/**
 * How to obtain the target's robots.txt. Defaults to a plain fetch under the
 * PROVIDER's UA — the identity whose permissions we are actually asking about.
 */
export type RobotsFetcher = (
  robotsUrl: string,
  userAgent: string,
) => Promise<{ text: string; status: number; contentType: string | null } | null>

const defaultRobotsFetcher: RobotsFetcher = async (robotsUrl, userAgent) => {
  try {
    const res = await fetch(robotsUrl, {
      headers: { 'user-agent': userAgent },
      signal: AbortSignal.timeout(5_000),
    })
    return {
      text: res.status >= 400 ? '' : await res.text(),
      status: res.status,
      contentType: res.headers.get('content-type'),
    }
  } catch {
    return null
  }
}

interface CachedRobots {
  robotsUrl: string
  robots: RobotsTxt | null
  sha256: string | null
  /** True when the server said there are no rules (4xx) — a real full allow. */
  absent: boolean
}

function isPlainText(contentType: string | null): boolean {
  if (contentType === null) return true
  return contentType.toLowerCase().trimStart().startsWith('text/plain')
}

export class ProviderSubject implements SubjectAdapter {
  readonly meta: SubjectAdapter['meta']

  private readonly chain: ComplianceChain
  private readonly access: AccessFactShape
  private readonly robotsByOrigin = new Map<string, CachedRobots>()
  private readonly lastRequestAtMsByHost = new Map<string, number>()

  constructor(
    private readonly provider: ProviderDeclaration,
    private readonly transport: ProviderTransport,
    private readonly mode: CrawlMode = 'standard',
    access?: AccessConfigInput | null,
    private readonly robotsFetcher: RobotsFetcher = defaultRobotsFetcher,
  ) {
    this.chain = new ComplianceChain(crypto.randomUUID(), mode)
    this.access = normalizeAccessConfig(access)
    this.meta = {
      id: `provider-${provider.id}`,
      displayName: `provider:${provider.id} (${provider.declaredUserAgent ?? 'undeclared UA'})`,
      version: '0.1.0',
      // Cloud, per the contract: a third-party fetch is never merged into the
      // self-hosted column, because the thing being measured is partly theirs.
      hosting: 'cloud' as const,
    }
  }

  ledger(): ReturnType<ComplianceChain['toLedger']> {
    return this.chain.toLedger()
  }

  async fetch(url: string, deadlineMs?: number): Promise<FetchResult> {
    const start = Date.now()
    const trace: TraceEvent[] = [
      { at: 0, lane: 'provider', event: 'provider_selected', detail: { provider: this.provider.id } },
    ]

    // The capability refusal does not depend on the target, so it can be
    // decided before any network call — and must be, so a refused provider
    // never causes us to touch the origin at all.
    const preflight = evaluateProviderGate(this.provider, null, '/')
    if (preflight.refusal === 'refused_capability' || preflight.refusal === 'undeclared_user_agent') {
      return this.denied(url, start, trace, preflight, {
        robotsUrl: null,
        robotsSha256: null,
        matchedUserAgentGroup: null,
        appliedRules: [],
        decision: 'no_robots',
        skippedFetch: true,
      })
    }

    const ua = this.provider.declaredUserAgent!
    const cached = await this.robotsFor(url, ua)
    const path = this.pathOf(url)
    const verdict = evaluateProviderGate(this.provider, cached?.robots ?? null, path)
    trace.push({
      at: Date.now() - start,
      lane: 'provider',
      event: 'provider_gate',
      detail: {
        allowed: verdict.allowed,
        refusal: verdict.refusal,
        evaluatedUserAgent: verdict.evaluatedUserAgent,
        matchedGroup: verdict.matchedUserAgentGroup,
      },
    })

    const robotsDecision: ComplianceRobotsDecision = {
      robotsUrl: cached?.robotsUrl ?? null,
      robotsSha256: cached?.sha256 ?? null,
      matchedUserAgentGroup: verdict.matchedUserAgentGroup,
      appliedRules: verdict.appliedRules,
      decision:
        cached === null || cached.robots === null
          ? 'no_robots'
          : verdict.allowed
            ? 'allowed'
            : 'disallowed',
      skippedFetch: !verdict.allowed,
    }

    if (!verdict.allowed) {
      return this.denied(url, start, trace, verdict, robotsDecision)
    }

    const host = this.hostOf(url)
    const previousRequestAtMs = this.lastRequestAtMsByHost.get(host) ?? null
    const observedDelayMs = previousRequestAtMs === null ? null : Date.now() - previousRequestAtMs
    const requiredDelayMs = DEFAULT_NETWORK_POLICY.perHostMinDelayMs
    this.lastRequestAtMsByHost.set(host, Date.now())

    let res: ProviderResponse
    try {
      res = await this.transport.fetch(url, deadlineMs)
    } catch (err) {
      const wallMs = Date.now() - start
      trace.push({
        at: wallMs,
        lane: 'provider',
        event: 'provider_failed',
        detail: { error: err instanceof Error ? err.message.slice(0, 200) : String(err) },
      })
      return {
        requestedUrl: url,
        status: 'failed',
        // The provider broke, not the target. Reporting this as http_error
        // would blame the publisher for our vendor's outage.
        failureReason: 'provider_error',
        blockReason: null,
        budgetExceeded: null,
        lane: 'provider',
        escalations: [],
        markdown: null,
        truncated: false,
        truncatedAt: null,
        compliance: null,
        evidence: {
          finalUrl: url,
          httpStatus: null,
          redirectChain: [],
          contentType: null,
          rawBodySha256: null,
          artifacts: [],
        },
        usage: {
          wallMs,
          bytesWire: 0,
          bytesDecompressed: 0,
          requestCount: 1,
          attemptCount: 1,
          contentTokens: null,
          browserMs: 0,
          externalCostUsd: null,
        },
        trace,
      }
    }

    const wallMs = Date.now() - start

    // What the record should say went on the wire. The declared UA is what the
    // gate cleared; the observed one is what the transport actually saw. When
    // they disagree, the observed value is the truth and the disagreement is
    // itself a finding — a fetch that carried an identity the gate never
    // evaluated is a bug in the vendor integration, not a detail to smooth
    // over. Null observed means unobserved, which is not agreement.
    const observedUa = res.sentUserAgent ?? null
    const wireUa = observedUa ?? ua
    if (observedUa !== null && observedUa !== ua) {
      trace.push({
        at: wallMs,
        lane: 'provider',
        event: 'identity_mismatch',
        detail: { declared: ua, sent: observedUa },
      })
    } else if (observedUa === null) {
      trace.push({
        at: wallMs,
        lane: 'provider',
        event: 'identity_unobserved',
        detail: { declared: ua },
      })
    }

    const record: ComplianceRecord = this.chain.append({
      recordId: crypto.randomUUID(),
      mode: this.mode,
      requestedUrl: url,
      finalUrl: res.finalUrl,
      requestedAt: new Date(start).toISOString(),
      robots: robotsDecision,
      // The provider's UA is the honest answer to "what went on the wire".
      // Recording our own UA here would be a lie about a request we did not
      // send — the whole reason the gate evaluates theirs.
      sentHeaders: { headers: [{ name: 'user-agent', value: wireUa }] },
      rateLimit: {
        previousRequestAtMs,
        observedDelayMs,
        requiredDelayMs,
        compliant: observedDelayMs === null || observedDelayMs >= requiredDelayMs,
        recentSameHostCount: 1,
      },
      access: this.access,
    })

    const base = {
      requestedUrl: url,
      truncated: false,
      truncatedAt: null,
      compliance: record,
      // The vendor's session continuation material, when the policy enabled
      // persistence and the vendor produced it. The ladder saves this so an
      // independent next run resumes the same login state.
      resumeContext: res.resumeContext ?? null,
      evidence: {
        finalUrl: res.finalUrl,
        httpStatus: res.status,
        redirectChain: res.finalUrl !== url ? [url, res.finalUrl] : [],
        contentType: res.headers['content-type'] ?? null,
        rawBodySha256: sha256Hex(new TextEncoder().encode(res.body)),
        artifacts: [],
      },
      usage: {
        wallMs,
        bytesWire: Buffer.byteLength(res.body),
        bytesDecompressed: Buffer.byteLength(res.body),
        requestCount: 1,
        attemptCount: 1,
        contentTokens: null as number | null,
        browserMs: wallMs,
        // Only what the vendor actually told us. An estimate in this field
        // would read as a measurement.
        externalCostUsd: res.costUsd ?? null,
      },
      trace,
    }

    const gate = classifyGate({
      status: res.status,
      header: (name) => res.headers[name.toLowerCase()] ?? null,
      body: res.body,
    })
    const blocked = (v: NonNullable<typeof gate>): FetchResult => {
      trace.push({
        at: wallMs,
        lane: 'provider',
        event: 'gate_detected',
        detail: { blockReason: v.reason, signals: v.signals, status: res.status },
      })
      // For a detection gate this is the end of the ladder: escalationForBlock
      // returns null, because every remaining lane is weaker at exactly this
      // and the only thing that would "work" is the layer we refuse to build.
      // A login wall is different — that is a credentials problem, and it
      // still routes back to the user, who legitimately holds them.
      const next = escalationForBlock(v.reason, 'provider')
      return {
        ...base,
        status: 'blocked',
        failureReason: null,
        blockReason: v.reason,
        budgetExceeded: null,
        lane: 'provider',
        escalations: next === null ? [] : [{ ...next, improved: null }],
        markdown: null,
        // A captcha or login wall with an open live-view door is a handoff
        // point: the ladder pauses here and asks a human, exactly because
        // the refused capabilities (auto-solving) are not on the table. A
        // bot_gate with a live view is NOT handed off — a human staring at
        // Cloudflare is not a capability either.
        handoff:
          res.handoffUrl !== null && res.handoffUrl !== undefined &&
          (v.reason === 'captcha' || v.reason === 'login_wall')
            ? {
                reason: v.reason === 'captcha' ? 'captcha_required' : 'login_required',
                liveViewUrl: res.handoffUrl,
                rationale:
                  v.reason === 'captcha'
                    ? 'The target demands human verification. We do not solve captchas; a human can, in the live session.'
                    : 'The target requires an account. We do not create or share accounts; a human can sign in in the live session.',
              }
            : null,
      }
    }

    const nonOk = res.status !== 200 && res.status !== 0
    if (nonOk && gate !== null) return blocked(gate)
    if (nonOk) {
      return {
        ...base,
        status: 'failed',
        failureReason: 'http_error',
        blockReason: null,
        budgetExceeded: null,
        lane: 'provider',
        escalations: [],
        markdown: null,
      }
    }

    const extracted = extractTf.extract(res.body)
    trace.push({
      at: wallMs,
      lane: 'provider',
      event: 'extract',
      detail: {
        pageType: extracted.pageType,
        strategy: extracted.strategy,
        confidence: extracted.confidence,
        escalate: extracted.escalate,
      },
    })

    if (extracted.escalate) {
      if (gate !== null) return blocked(gate)
      return {
        ...base,
        status: 'failed',
        failureReason: 'empty_unverified',
        blockReason: null,
        budgetExceeded: null,
        lane: 'provider',
        escalations: [],
        markdown: null,
      }
    }

    const markdown = extracted.mainHtml.replace(
      /<table\b[\s\S]*?<\/table>/gi,
      (table) => `\n${toGfmTable(table)}\n`,
    )

    // THE UNIFIED IDENTITY RULE (ProviderSubject, LadderRunner, w2l-provider,
    // RoutingHistory all follow it): a fetch whose wire identity was
    // contradicted (identity_mismatch) or unobservable (identity_unobserved)
    // is NEVER delivered as success — not here, not on the last channel, not
    // after a handoff retry. The trace keeps which of the two findings
    // applied; the result is a clear, non-contentful failure.
    if (identityCompromised(trace)) {
      return {
        ...base,
        status: 'failed',
        failureReason: 'identity_compromised',
        blockReason: null,
        budgetExceeded: null,
        lane: 'provider',
        escalations: [],
        markdown: null,
        usage: { ...base.usage, contentTokens: null },
      }
    }

    return {
      ...base,
      status: 'success',
      failureReason: null,
      blockReason: null,
      budgetExceeded: null,
      lane: 'provider',
      escalations: [],
      markdown,
      usage: { ...base.usage, contentTokens: estimateTokens(markdown) },
    }
  }

  /**
   * A refusal is still a fetch we are accountable for, so it mints a record.
   * The record carries the gate's reason verbatim: an operator reading the
   * ledger should see why we declined, not just that we did.
   */
  private denied(
    url: string,
    start: number,
    trace: TraceEvent[],
    verdict: ProviderGateVerdict,
    robots: ComplianceRobotsDecision,
  ): FetchResult {
    const wallMs = Date.now() - start
    trace.push({
      at: wallMs,
      lane: 'provider',
      event: 'provider_refused',
      detail: {
        refusal: verdict.refusal,
        reason: verdict.reason,
        evaluatedUserAgent: verdict.evaluatedUserAgent,
        refusedCapabilities: verdict.refusedCapabilities,
      },
    })
    const record = this.chain.append({
      recordId: crypto.randomUUID(),
      mode: this.mode,
      requestedUrl: url,
      finalUrl: null,
      requestedAt: new Date(start).toISOString(),
      robots,
      sentHeaders: { headers: [] },
      rateLimit: {
        previousRequestAtMs: this.lastRequestAtMsByHost.get(this.hostOf(url)) ?? null,
        observedDelayMs: null,
        requiredDelayMs: DEFAULT_NETWORK_POLICY.perHostMinDelayMs,
        compliant: true,
        recentSameHostCount: 0,
      },
      access: this.access,
    })
    return {
      requestedUrl: url,
      status: 'failed',
      failureReason: 'policy_denied',
      blockReason: null,
      budgetExceeded: null,
      lane: 'provider',
      escalations: [],
      markdown: null,
      truncated: false,
      truncatedAt: null,
      compliance: record,
      evidence: {
        finalUrl: url,
        httpStatus: null,
        redirectChain: [],
        contentType: null,
        rawBodySha256: null,
        artifacts: [],
      },
      usage: {
        wallMs,
        bytesWire: 0,
        bytesDecompressed: 0,
        requestCount: 0,
        attemptCount: 0,
        contentTokens: null,
        browserMs: 0,
        externalCostUsd: null,
      },
      trace,
    }
  }

  private hostOf(url: string): string {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  }

  private pathOf(url: string): string {
    try {
      const u = new URL(url)
      return u.pathname + u.search
    } catch {
      return '/'
    }
  }

  private async robotsFor(url: string, userAgent: string): Promise<CachedRobots | null> {
    let origin: string
    let robotsUrl: string
    try {
      const parsed = new URL(url)
      origin = parsed.origin
      robotsUrl = `${parsed.origin}/robots.txt`
    } catch {
      return null
    }

    const cached = this.robotsByOrigin.get(origin)
    if (cached) return cached

    const res = await this.robotsFetcher(robotsUrl, userAgent)
    let entry: CachedRobots
    if (res === null) {
      // Fetch failure. NOT the same as "no robots.txt": absent stays false, so
      // a network error can never be read back as the publisher's permission.
      entry = { robotsUrl, robots: null, sha256: null, absent: false }
    } else if (res.status >= 400) {
      entry = { robotsUrl, robots: null, sha256: null, absent: true }
    } else if (!isPlainText(res.contentType)) {
      // A "robots.txt" served as HTML is a soft-404 or a catch-all route, not
      // a rules document; parsing it would invent groups out of markup.
      entry = { robotsUrl, robots: null, sha256: null, absent: true }
    } else {
      entry = {
        robotsUrl,
        robots: parseRobotsTxt(res.text),
        sha256: sha256Hex(new TextEncoder().encode(res.text)),
        absent: false,
      }
    }

    this.robotsByOrigin.set(origin, entry)
    return entry
  }

  async teardown(): Promise<void> {
    await this.transport.close?.().catch(() => {})
  }
}
