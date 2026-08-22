/**
 * Wiring: turn a vendor's ops into a ProviderSubject whose declaration
 * describes what that vendor session actually is.
 *
 * Two doctrinal points live here rather than in the vendor files:
 *
 * 1. The declared UA is MEASURED off the live session, never chosen. The gate
 *    only means something if the string it evaluates is the string on the
 *    wire, and the only way to know that string is to ask the browser that
 *    will send it. See `CdpVendorTransport.resolveUserAgent`.
 *
 * 2. `honoursCallerUserAgent` is false, and that is not a limitation to
 *    apologise for. We do not impose an identity on the vendor: Browserbase
 *    exposes no session-level UA field, and an override we cannot prove
 *    reached the wire would be a claim, not a fact. Taking the vendor's own
 *    identity and gating on it is the honest arrangement — and our own probe
 *    already found an honest UA scores the same as a flattering one, so there
 *    is nothing to buy here anyway.
 *
 * The capability list describes the session AS CONFIGURED by this package's
 * session bodies, which explicitly decline captcha solving and fingerprint
 * forging. A hand-written declaration claiming clean capabilities over a
 * dirty config is out of this factory's reach, which is why the factory is
 * the supported path.
 */

import type { CrawlMode } from '@w2l/contracts'
import type {
  AccessConfigInput,
  PolicyDecision,
  ProviderDeclaration,
  VendorPolicy,
} from '@w2l/http-core'
import { ProviderSubject, type RobotsFetcher } from '../subjects/provider.js'
import { playwrightConnector, type CdpConnector } from './cdp.js'
import { CdpVendorTransport, type VendorOps, type VendorResumeContext } from './transport.js'

export interface ConnectedVendor {
  declaration: ProviderDeclaration
  transport: CdpVendorTransport
}

/**
 * Open the vendor session and derive the declaration from what is actually
 * running. Network happens here — one session create, one CDP connect — but
 * only against the VENDOR. The probe page never leaves about:blank, so no
 * origin is touched before its robots gate has run.
 */
export async function connectVendor(
  ops: VendorOps,
  connector: CdpConnector = playwrightConnector,
  /** Resume context to inject BEFORE the first session is created (first-use
   *  persistence: Browserbase's context must exist before the UA probe's
   *  session). Order matters — a context added after the probe would mean the
   *  session the gate cleared was not the session on offer. */
  resume?: VendorResumeContext | null,
): Promise<ConnectedVendor> {
  const transport = new CdpVendorTransport(ops, connector)
  if (resume !== undefined && resume !== null) {
    transport.useResumedSession(resume)
  }
  const declaredUserAgent = await transport.resolveUserAgent()
  const declaration: ProviderDeclaration = {
    id: ops.vendorId,
    declaredUserAgent,
    // As decided by the policy layer (evaluateVendorPolicy), not written
    // here: the three-layer split means the vendor adapter declares what it
    // CAN do, policy decides what we WILL use, and this list is the result.
    capabilities: ops.decision.enabled.map((c) => c.capability),
    honoursCallerUserAgent: false,
  }
  return { declaration, transport }
}

/** One-call wiring for the common case. */
export async function vendorProviderSubject(
  ops: VendorOps,
  opts: {
    mode?: CrawlMode
    access?: AccessConfigInput | null
    connector?: CdpConnector
    robotsFetcher?: RobotsFetcher
  } = {},
): Promise<ProviderSubject> {
  const { declaration, transport } = await connectVendor(ops, opts.connector)
  return new ProviderSubject(
    declaration,
    transport,
    opts.mode ?? 'standard',
    opts.access ?? null,
    opts.robotsFetcher,
  )
}
