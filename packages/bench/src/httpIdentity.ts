/**
 * Shared L0 wiring for product HTTP subjects. The bundle is asserted before
 * any bytes leave; the same object is what we send and what honesty checks.
 */

import {
  checkIdentityHonesty,
  headersFromIdentity,
  identityBundleFrom,
  modeIdentity,
  type CrawlMode,
  type ModeIdentity,
  type SentHeadersFact,
  type TraceEvent,
} from '@w2l/contracts'

export interface PreparedHttpIdentity {
  mode: CrawlMode
  identity: ModeIdentity
  headers: Record<string, string>
  sentHeaders: SentHeadersFact
}

export function prepareHttpIdentity(mode: CrawlMode = 'standard'): PreparedHttpIdentity {
  const identity = modeIdentity(mode)
  const headers = headersFromIdentity(identityBundleFrom(identity))
  const sentHeaders: SentHeadersFact = {
    headers: Object.entries(headers)
      .map(([name, value]) => ({ name: name.toLowerCase(), value }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
  return { mode, identity, headers, sentHeaders }
}

/** Record the declared wire identity and whether it matched what we sent. */
export function recordHttpIdentity(
  prepared: PreparedHttpIdentity,
  trace: TraceEvent[],
  at: number,
): boolean {
  trace.push({
    at,
    lane: 'http',
    event: 'identity_sent',
    detail: { mode: prepared.mode, headers: prepared.sentHeaders.headers },
  })
  const honesty = checkIdentityHonesty(prepared.identity, prepared.sentHeaders)
  if (!honesty.honest) {
    trace.push({
      at,
      lane: 'http',
      event: 'identity_mismatch',
      detail: { mismatches: honesty.mismatches },
    })
    return false
  }
  return true
}
