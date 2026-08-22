/**
 * The escalation ladder: HTTP → local browser → cloud vendor(s) →
 * user-authorized session → human handoff.
 *
 * One fetch request, tried across channels in policy-permitted order, until a
 * channel returns contentful or the ladder runs out of escalation. The audit
 * trail is `LadderRunResult.channelsTried` — the ladder does not mutate the
 * subject's result objects; a result is the subject's record and stays that
 * subject's record.
 *
 * The ladder does NOT decide policy — governance (http-core/governance.ts)
 * decides which channels are permitted for a URL; the ladder only walks what
 * it is given, in the order it is given it. A challenge page is never
 * contentful: a channel that returns a block with an empty body classifies as
 * bot_gate/captcha_required/... and escalates; a block that somehow returned
 * content is caught by the false-success checks upstream.
 */

import type { FetchResult, HandoffRequest } from '@w2l/contracts'
import { CONTENTFUL_STATUS } from '@w2l/contracts'
import {
  classifyFetchFailure,
  evaluateGovernance,
  LADDER_CONTINUES_FAILURE_CLASS,
  type CrawlPolicy,
  type RoutingFailureClass,
} from '@w2l/http-core'
import type { RoutingHistory, VendorOutcome } from './vendorRouter.js'
import { rankVendors, startingVendor } from './vendorRouter.js'
import type { SessionSnapshot, SessionStore } from './sessionStore.js'

/** One channel: a lane implementation the ladder can try. */
export interface Channel {
  /** Lane id, e.g. 'http', 'browser_local', 'provider'. */
  id: string
  /** Vendor id for provider channels, so history can attribute outcomes. */
  vendorId?: string
  /** Run the channel against url, optionally with a user session attached. */
  fetch(url: string, session?: SessionSnapshot | null): Promise<FetchResult>
  /** Release the channel's resources (browser processes, vendor sessions).
   *  The owner of the channel list calls this when the run is over. */
  close?(): Promise<void>
}

/** The human in the loop. Called exactly when a result asks for takeover. */
export interface HumanHandoff {
  /**
   * Present the live view / instructions to a human and wait. Resolve with
   * the session they produced (saved and reused for the retry), or null to
   * abort the attempt.
   */
  takeOver(url: string, request: HandoffRequest): Promise<SessionSnapshot | null>
}

export interface LadderRunResult {
  /** The final result — from the winning channel or the last refusal. */
  result: FetchResult
  /** Channel ids tried, in order. The audit trail of this escalation. */
  channelsTried: readonly string[]
  /** Set when the ladder paused for a human. */
  handoffRequested: boolean
  /**
   * One event per ladder step: which channel ran, under which vendor, what
   * the result was, and (when it escalated) why. The caller is expected to
   * append these to the final result's trace so the escalation audit is part
   * of the signed record.
   */
  ladderTrace: readonly { at: number; event: string; channel: string; detail: Record<string, unknown> }[]
}

/**
 * Whether a result is asking to escalate: the subject itself flagged the
 * escalation (escalations carries an unresolved hop) or — the quality case —
 * a successful HTTP extraction was thin and low-confidence. The ladder
 * honours the subject's own ask rather than re-deriving it.
 */
function resultRequestsEscalation(result: FetchResult): boolean {
  return (
    result.escalations.some((e) => e.improved === null) ||
    result.trace.some((t) => t.event === 'quality_low_yield')
  )
}

export class LadderRunner {
  constructor(
    /** Channels in escalation order. Providers go after browser_local. */
    private readonly channels: readonly Channel[],
    private readonly policy: CrawlPolicy,
    private readonly history: RoutingHistory | null = null,
    private readonly handoff: HumanHandoff | null = null,
    /**
     * Authorized-session persistence. When set, the ladder loads a saved
     * snapshot for the target domain (unless the caller passed one) and saves
     * the snapshot a human produced — so the next run resumes, not restarts.
     */
    private readonly sessionStore: SessionStore | null = null,
  ) {}

  /**
   * Walk the ladder for one URL. Governance first (allowlist + mode), then
   * channels in order. Vendor channels are attempted in history-ranked
   * order, not declaration order, when a history is attached.
   *
   * Escalation sources, in the order the subject's own record is consulted:
   *   1. block/failure classes (bot_gate → next lane, provider_error → next
   *      vendor, ...) — LADDER_CONTINUES_FAILURE_CLASS;
   *   2. the result's own `escalations` array — empty_unverified /
   *      extract_low_confidence requests from the subject are honoured as
   *      asks, not re-derived;
   *   3. `quality_low_yield` — a thin, low-confidence success from the http
   *      lane gets offered to a higher lane instead of being the answer.
   * All of it lands in `ladderTrace`, which the CLI appends to the final
   * result's trace before the record is signed.
   */
  async run(url: string, session?: SessionSnapshot | null): Promise<LadderRunResult> {
    const decision = evaluateGovernance(url, this.policy)
    const channelsTried: string[] = []
    const ladderTrace: LadderRunResult['ladderTrace'][number][] = []

    // The caller may hand a session in; otherwise the store's snapshot for
    // this domain is the session, so a handoff saved last run resumes here.
    const effectiveSession =
      session !== undefined && session !== null
        ? session
        : this.sessionStore !== null
          ? await this.sessionStore.load(safeHost(url))
          : null
    if (effectiveSession !== null) {
      ladderTrace.push({
        at: 0,
        event: 'ladder_session_loaded',
        channel: '—',
        detail: { domain: effectiveSession.domain, vendor: effectiveSession.vendor },
      })
    }

    if (!decision.allowed) {
      ladderTrace.push({
        at: 0,
        event: 'ladder_governance_refusal',
        channel: '—',
        detail: { reason: decision.reason ?? 'governance refused this url' },
      })
      return {
        result: this.governanceRefusal(url, decision.reason ?? 'governance refused this url'),
        channelsTried,
        handoffRequested: false,
        ladderTrace,
      }
    }

    const permitted = new Set(decision.permittedChannels)
    // Local lanes first, in declaration order, then providers (history-ranked).
    const local = this.channels.filter((c) => c.vendorId === undefined && permitted.has(c.id))
    const providers = this.channels.filter((c) => c.vendorId !== undefined && permitted.has(c.id))

    const ordered = [...local, ...(await this.orderProviders(url, providers))]

    let last: FetchResult | null = null
    for (const channel of ordered) {
      channelsTried.push(channel.id)
      const result = await channel.fetch(url, effectiveSession)
      last = result

      // Vendor attribution happens for every attempt, successful or not —
      // a vendor's win IS its history. Record before the contentful early
      // return so domain stats never miss an outcome.
      if (channel.vendorId !== undefined && this.history !== null) {
        const cls = classifyFetchFailure(result)
        await this.recordVendorOutcome(url, channel.vendorId, result, cls)
      }

      if (CONTENTFUL_STATUS.has(result.status)) {
        // A contentful vendor fetch may carry resume material (Browserbase
        // contextId / Steel profileId). Persisting it now is what lets the
        // NEXT independent process resume this session instead of starting
        // one from zero.
        if (
          channel.vendorId !== undefined &&
          this.sessionStore !== null &&
          result.resumeContext !== undefined &&
          result.resumeContext !== null
        ) {
          const snapshot: SessionSnapshot = {
            domain: safeHost(url),
            attestedBy: 'operator',
            attestedAt: new Date().toISOString(),
            vendor: channel.vendorId,
            resume: result.resumeContext as SessionSnapshot['resume'],
          }
          await this.sessionStore.save(snapshot)
          ladderTrace.push({
            at: result.usage.wallMs,
            event: 'ladder_session_saved',
            channel: channel.id,
            detail: { domain: snapshot.domain, vendor: channel.vendorId },
          })
        }

        // Quality escalation: a thin, low-confidence http success is offered
        // to the next lane rather than accepted as the answer. The status is
        // NOT rewritten — the record keeps the real success and its real
        // token count; the ladder just isn't done yet.
        const thinHttp =
          channel.id === 'http' && result.trace.some((t) => t.event === 'quality_low_yield')
        if (thinHttp) {
          ladderTrace.push({
            at: result.usage.wallMs,
            event: 'ladder_step',
            channel: channel.id,
            detail: { vendorId: channel.vendorId ?? null, status: result.status, escalate: 'quality_low_yield' },
          })
          continue
        }
        ladderTrace.push({
          at: result.usage.wallMs,
          event: 'ladder_step',
          channel: channel.id,
          detail: { vendorId: channel.vendorId ?? null, status: result.status, escalate: null },
        })
        return { result, channelsTried, handoffRequested: false, ladderTrace }
      }

      if (result.handoff) {
        return await this.attemptHandoff(url, result, channelsTried, channel, effectiveSession, ladderTrace)
      }

      const cls = classifyFetchFailure(result)
      const subjectAsked = resultRequestsEscalation(result)

      ladderTrace.push({
        at: result.usage.wallMs,
        event: 'ladder_step',
        channel: channel.id,
        detail: {
          vendorId: channel.vendorId ?? null,
          status: result.status,
          failureClass: cls,
          escalate: subjectAsked ? 'subject_escalations' : null,
        },
      })

      if (cls === null && !subjectAsked) {
        // Infrastructure failure or a terminal refusal, and the subject did
        // not ask for anything higher. Stop here and report honestly rather
        // than burn every channel on a problem none of them can fix.
        return { result, channelsTried, handoffRequested: false, ladderTrace }
      }

      if (cls !== null && !LADDER_CONTINUES_FAILURE_CLASS.has(cls) && !subjectAsked) {
        // rate_limited — a class that deliberately stops the ladder even
        // though it is "classified". Nothing higher answers a rate limit.
        return { result, channelsTried, handoffRequested: false, ladderTrace }
      }

      // cls is bot_gate / captcha_required / login_required / geo_blocked
      // (escalate to the next rung) or provider_error / identity_mismatch
      // (the other vendor is next), or the subject's own escalations array
      // asked for a higher lane. Either way the loop continues.
    }

    return {
      result:
        last ?? this.governanceRefusal(url, 'no permitted channel was configured'),
      channelsTried,
      handoffRequested: false,
      ladderTrace,
    }
  }

  // -------------------------------------------------------------------------

  private async orderProviders(url: string, providers: readonly Channel[]): Promise<readonly Channel[]> {
    if (providers.length <= 1 || this.history === null) return providers
    const host = safeHost(url)
    const domainHistory = await this.history.read(host)
    const ranked = rankVendors(
      domainHistory,
      providers.map((p) => p.vendorId!),
    )
    const first = startingVendor(ranked, domainHistory)
    if (first === null) return providers
    return [
      ...providers.filter((p) => p.vendorId === first),
      ...providers.filter((p) => p.vendorId !== first),
    ]
  }

  private async recordVendorOutcome(
    url: string,
    vendorId: string,
    result: FetchResult,
    cls: RoutingFailureClass | null,
  ): Promise<void> {
    const outcome: VendorOutcome = {
      contentful: CONTENTFUL_STATUS.has(result.status),
      wallMs: result.usage.wallMs,
      costUsd: result.usage.externalCostUsd ?? 0,
      failureClass: cls,
    }
    await this.history?.record(safeHost(url), vendorId, outcome)
  }

  private async attemptHandoff(
    url: string,
    result: FetchResult,
    channelsTried: string[],
    channel: Channel,
    session: SessionSnapshot | null,
    ladderTrace: LadderRunResult['ladderTrace'][number][],
  ): Promise<LadderRunResult> {
    ladderTrace.push({
      at: result.usage.wallMs,
      event: 'ladder_step',
      channel: channel.id,
      detail: {
        vendorId: channel.vendorId ?? null,
        status: result.status,
        handoff: result.handoff?.reason ?? 'handoff_requested',
        liveViewUrl: result.handoff?.liveViewUrl ?? null,
      },
    })
    if (this.handoff === null) {
      // No human configured: report the pause point rather than loop forever.
      return { result, channelsTried, handoffRequested: true, ladderTrace }
    }
    const snapshot = await this.handoff.takeOver(url, result.handoff!)
    if (snapshot === null) {
      return { result, channelsTried, handoffRequested: true, ladderTrace }
    }
    // Persist the human's session so the NEXT run — including an independent
    // process — resumes with it instead of asking again.
    if (this.sessionStore !== null) {
      await this.sessionStore.save(snapshot)
      ladderTrace.push({
        at: result.usage.wallMs,
        event: 'ladder_session_saved',
        channel: channel.id,
        detail: { domain: snapshot.domain, vendor: snapshot.vendor },
      })
    }
    // Retry on the same channel with the fresh session. One retry only:
    // a human who cannot clear it on the second pass cannot clear it.
    const retry = await channel.fetch(url, snapshot)
    ladderTrace.push({
      at: retry.usage.wallMs,
      event: 'ladder_step',
      channel: `${channel.id}(retry)`,
      detail: { vendorId: channel.vendorId ?? null, status: retry.status, afterHandoff: true },
    })
    return {
      result: retry,
      channelsTried: [...channelsTried, `${channel.id}(retry)`],
      handoffRequested: true,
      ladderTrace,
    }
  }

  private governanceRefusal(url: string, reason: string): FetchResult {
    return {
      requestedUrl: url,
      status: 'failed',
      failureReason: 'policy_denied',
      blockReason: null,
      budgetExceeded: null,
      lane: 'http',
      escalations: [],
      handoff: null,
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
        wallMs: 0,
        bytesWire: 0,
        bytesDecompressed: 0,
        requestCount: 0,
        attemptCount: 0,
        contentTokens: null,
        browserMs: 0,
        externalCostUsd: null,
      },
      trace: [{ at: 0, lane: 'http', event: 'governance_refusal', detail: { reason } }],
    }
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return url
  }
}
