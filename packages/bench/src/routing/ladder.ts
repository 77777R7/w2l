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
import type { SessionSnapshot } from './sessionStore.js'

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
}

export class LadderRunner {
  constructor(
    /** Channels in escalation order. Providers go after browser_local. */
    private readonly channels: readonly Channel[],
    private readonly policy: CrawlPolicy,
    private readonly history: RoutingHistory | null = null,
    private readonly handoff: HumanHandoff | null = null,
  ) {}

  /**
   * Walk the ladder for one URL. Governance first (allowlist + mode), then
   * channels in order. Vendor channels are attempted in history-ranked
   * order, not declaration order, when a history is attached.
   */
  async run(url: string, session?: SessionSnapshot | null): Promise<LadderRunResult> {
    const decision = evaluateGovernance(url, this.policy)
    const channelsTried: string[] = []

    if (!decision.allowed) {
      return {
        result: this.governanceRefusal(url, decision.reason ?? 'governance refused this url'),
        channelsTried,
        handoffRequested: false,
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
      const result = await channel.fetch(url, session)
      last = result

      // Vendor attribution happens for every attempt, successful or not —
      // a vendor's win IS its history. Record before the contentful early
      // return so domain stats never miss an outcome.
      if (channel.vendorId !== undefined && this.history !== null) {
        const cls = classifyFetchFailure(result)
        await this.recordVendorOutcome(url, channel.vendorId, result, cls)
      }

      if (CONTENTFUL_STATUS.has(result.status)) {
        return { result, channelsTried, handoffRequested: false }
      }

      if (result.handoff) {
        return await this.attemptHandoff(url, result, channelsTried, channel, session ?? null)
      }

      const cls = classifyFetchFailure(result)

      if (cls === null || !LADDER_CONTINUES_FAILURE_CLASS.has(cls)) {
        // rate_limited, infrastructure failure, empty unverified, policy
        // denial — nothing higher up the ladder answers these. Stop here and
        // report honestly rather than burn every channel on a problem none
        // of them can fix.
        return { result, channelsTried, handoffRequested: false }
      }

      // cls is bot_gate / captcha_required / login_required / geo_blocked
      // (escalate to the next rung) or provider_error / identity_mismatch
      // (the other vendor is next in the ordering, and domain history has
      // already recorded this one's failure). Either way the loop continues.
    }

    return {
      result:
        last ?? this.governanceRefusal(url, 'no permitted channel was configured'),
      channelsTried,
      handoffRequested: false,
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
  ): Promise<LadderRunResult> {
    if (this.handoff === null) {
      // No human configured: report the pause point rather than loop forever.
      return { result, channelsTried, handoffRequested: true }
    }
    const snapshot = await this.handoff.takeOver(url, result.handoff!)
    if (snapshot === null) {
      return { result, channelsTried, handoffRequested: true }
    }
    // Retry on the same channel with the fresh session. One retry only:
    // a human who cannot clear it on the second pass cannot clear it.
    const retry = await channel.fetch(url, snapshot)
    return {
      result: retry,
      channelsTried: [...channelsTried, `${channel.id}(retry)`],
      handoffRequested: true,
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
