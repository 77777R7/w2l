/**
 * Browserbase integration — TRANSPORT layer only.
 *
 * This file knows the Browserbase REST API and nothing else. It declares what
 * the vendor can do (the capability manifest) and translates a PolicyDecision
 * into the vendor's wire format. It does NOT decide product policy: whether
 * captcha solving is ever acceptable, whether sessions may persist, whether a
 * live view may open — those are decided by evaluateVendorPolicy in
 * packages/http-core/src/vendor.ts. The policy arrives here as a decision
 * object; the adapter only obeys it.
 *
 * The refused capabilities (captcha_solving, advanced stealth / fingerprint
 * forging) are structurally absent from the policy input, so the opt-outs
 * below are unconditional — not because this file believes they are wrong
 * (that would be policy in the adapter), but because the decision object can
 * never enable them, and Browserbase defaults them ON. An explicit false is
 * therefore the only honest wire encoding of the policy's structural refusal.
 *
 * API shape (docs.browserbase.com, checked 2026-08-22):
 *   create context : POST https://api.browserbase.com/v1/contexts {name}
 *   create session : POST https://api.browserbase.com/v1/sessions
 *                    header X-BB-API-Key
 *                    body {projectId?, keepAlive?, browserSettings:{...}}
 *                    browserSettings.context: {id, persist} — context id from
 *                    the create-context call; persist saves changes back.
 *   debug          : GET  https://api.browserbase.com/v1/sessions/{id}/debug
 *                    response: {debuggerUrl, debuggerFullscreenUrl, wsUrl, pages}
 *   release        : POST https://api.browserbase.com/v1/sessions/{id}
 *                    body {status:'REQUEST_RELEASE'}
 */

import type { CapabilityOffer, PolicyDecision, VendorPolicy } from '@w2l/http-core'
import { evaluateVendorPolicy } from '@w2l/http-core'
import { fetchVendorApi, type VendorApi } from './api.js'
import type { VendorOps, VendorResumeContext, VendorSession } from './transport.js'

export interface BrowserbaseConfig {
  apiKey: string
  /** Optional; Browserbase infers the project from the key when omitted. */
  projectId?: string
  baseUrl?: string
}

/**
 * What Browserbase can do — the capability layer's manifest. Declarative:
 * the policy decides, this file only reports. `vendorDefaultOn` marks the
 * capabilities Browserbase ships enabled and that therefore need an explicit
 * wire-side opt-out (solveCaptchas) or an explicit not-called (live view).
 */
export const BROWSERBASE_CAPABILITIES: readonly CapabilityOffer[] = [
  { capability: 'headless_browser', vendorDefaultOn: true, enableKey: null },
  { capability: 'datacenter_proxy', vendorDefaultOn: true, enableKey: null },
  { capability: 'retry_orchestration', vendorDefaultOn: false, enableKey: 'retry_orchestration' },
  { capability: 'session_persistence', vendorDefaultOn: false, enableKey: 'session_persistence' },
  { capability: 'live_view_handoff', vendorDefaultOn: true, enableKey: 'live_view_handoff' },
  { capability: 'captcha_solving', vendorDefaultOn: true, enableKey: 'captcha_solving' },
  { capability: 'fingerprint_spoofing', vendorDefaultOn: false, enableKey: 'fingerprint_spoofing' },
]

/**
 * The session body is the wire encoding of the policy decision. The policy
 * layer's structural refusals become unconditional opt-outs here; the
 * authorized capabilities become their wire fields (context persistence).
 */
export function browserbaseSessionBody(
  decision: PolicyDecision,
  projectId?: string,
  resume?: VendorResumeContext | null,
): unknown {
  const persistEnabled = decision.enabled.some((c) => c.capability === 'session_persistence')

  return {
    ...(projectId === undefined ? {} : { projectId }),
    browserSettings: {
      // Policy-level structural refusal. Browserbase defaults both to true;
      // leaving the default in place would be buying the refused capability
      // by omission, so the wire always says false.
      solveCaptchas: false,
      // The vendor's stealth mode forges fingerprint signals. Same refusal.
      advancedStealth: false,
      ...(persistEnabled && resume?.browserbaseContextId !== undefined
        ? { context: { id: resume.browserbaseContextId, persist: true } }
        : {}),
    },
  }
}

/**
 * Create a persistent context when session persistence is authorized but no
 * context exists yet. Returns the id to resume from later.
 */
export async function browserbaseCreateContext(
  config: BrowserbaseConfig,
  api: VendorApi = fetchVendorApi,
  name?: string,
): Promise<string> {
  const base = (config.baseUrl ?? 'https://api.browserbase.com').replace(/\/$/, '')
  const res = await api({
    method: 'POST',
    url: `${base}/v1/contexts`,
    headers: { 'x-bb-api-key': config.apiKey },
    body: { ...(name === undefined ? {} : { name }) },
  })
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`browserbase: context create returned ${res.status}`)
  }
  const json = res.json as { id?: unknown } | null
  if (typeof json?.id !== 'string') {
    throw new Error('browserbase: context create response missing id')
  }
  return json.id
}

export function browserbaseOps(
  config: BrowserbaseConfig,
  api: VendorApi = fetchVendorApi,
  policy: VendorPolicy = {},
): VendorOps {
  const base = (config.baseUrl ?? 'https://api.browserbase.com').replace(/\/$/, '')
  const headers = { 'x-bb-api-key': config.apiKey } as const
  const decision: PolicyDecision = evaluateVendorPolicy(BROWSERBASE_CAPABILITIES, policy)

  return {
    vendorId: 'browserbase',
    secrets: [config.apiKey],
    decision,

    async createSession(resume?: VendorResumeContext | null): Promise<VendorSession> {
      const body = browserbaseSessionBody(decision, config.projectId, resume ?? null)
      const res = await api({
        method: 'POST',
        url: `${base}/v1/sessions`,
        headers,
        body,
      })
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(`browserbase: session create returned ${res.status}`)
      }
      const json = res.json as { id?: unknown; connectUrl?: unknown } | null
      if (typeof json?.id !== 'string' || typeof json.connectUrl !== 'string') {
        throw new Error('browserbase: session create response missing id/connectUrl')
      }

      const sessionId = json.id
      const resumeKey = (json as { browserContextId?: unknown }).browserContextId
      const resumeContextId =
        typeof resumeKey === 'string' ? resumeKey : resume?.browserbaseContextId ?? null

      // Live view is fetched only when policy enabled it: the debug endpoint
      // is a door into a live session, and not calling it when unauthorized
      // is part of what "not authorized" means.
      let handoffUrl: string | null = null
      if (decision.enabled.some((c) => c.capability === 'live_view_handoff')) {
        const dbg = await api({ method: 'GET', url: `${base}/v1/sessions/${sessionId}/debug`, headers })
        if (dbg.status === 200) {
          const dbgJson = dbg.json as { debuggerFullscreenUrl?: unknown } | null
          if (typeof dbgJson?.debuggerFullscreenUrl === 'string') handoffUrl = dbgJson.debuggerFullscreenUrl
        }
      }

      return {
        sessionId,
        connectUrl: json.connectUrl,
        handoffUrl,
        resumeContext: resumeContextId === null ? null : { browserbaseContextId: resumeContextId },
      }
    },

    async releaseSession(sessionId: string): Promise<void> {
      await api({
        method: 'POST',
        url: `${base}/v1/sessions/${sessionId}`,
        headers,
        body: { status: 'REQUEST_RELEASE' },
      })
    },
  }
}
