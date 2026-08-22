/**
 * Steel integration — TRANSPORT layer only.
 *
 * Same discipline as browserbase.ts: this file knows the Steel API and the
 * vendor's capability manifest. Product policy arrives as a PolicyDecision
 * from packages/http-core/src/vendor.ts; the adapter translates it to wire
 * fields and never re-decides it.
 *
 * Steel specifics, from the steel-node SDK source (checked 2026-08-22):
 *   create : POST https://api.steel.dev/v1/sessions   header steel-api-key
 *   connect: wss://connect.steel.dev?apiKey={key}&sessionId={id}
 *            (built per docs; do NOT use the returned websocketUrl directly)
 *   release: POST https://api.steel.dev/v1/sessions/{id}/release
 *   create params (relevant subset):
 *     profileId: string, persistProfile: boolean, sessionContext: {
 *       cookies, localStorage, sessionStorage, indexedDB }
 *   session response: { id, sessionViewerUrl, debugUrl, status }
 *
 * Persistence: `persistProfile: true` + `profileId` restores a previous
 * profile across sessions; `sessionContext` seeds cookies/storage for a new
 * one. sessionViewerUrl is the human-handoff door (a live view of the
 * session), returned by create directly — no second call needed.
 *
 * Credential note: Steel authenticates the CDP websocket with the API key AS
 * A QUERY PARAMETER, so the connect URL itself is a secret. It is listed in
 * `secrets` and the shared transport scrubs it out of every error before one
 * can reach a trace or a bench artifact.
 */

import type { CapabilityOffer, PolicyDecision, VendorPolicy } from '@w2l/http-core'
import { evaluateVendorPolicy } from '@w2l/http-core'
import { fetchVendorApi, type VendorApi } from './api.js'
import type { VendorOps, VendorResumeContext, VendorSession } from './transport.js'

export interface SteelConfig {
  apiKey: string
  /** Override both for a self-hosted Steel (it is open-source). */
  baseUrl?: string
  connectBaseUrl?: string
}

/** Steel's capability manifest — facts, not policy. */
export const STEEL_CAPABILITIES: readonly CapabilityOffer[] = [
  { capability: 'headless_browser', vendorDefaultOn: true, enableKey: null },
  { capability: 'datacenter_proxy', vendorDefaultOn: true, enableKey: null },
  { capability: 'residential_proxy', vendorDefaultOn: false, enableKey: 'residential_proxy' },
  { capability: 'retry_orchestration', vendorDefaultOn: false, enableKey: 'retry_orchestration' },
  { capability: 'session_persistence', vendorDefaultOn: false, enableKey: 'session_persistence' },
  { capability: 'live_view_handoff', vendorDefaultOn: true, enableKey: 'live_view_handoff' },
  { capability: 'captcha_solving', vendorDefaultOn: false, enableKey: 'captcha_solving' },
  { capability: 'fingerprint_spoofing', vendorDefaultOn: true, enableKey: 'fingerprint_spoofing' },
]

export function steelSessionBody(
  decision: PolicyDecision,
  resume?: VendorResumeContext | null,
): unknown {
  const persistEnabled = decision.enabled.some((c) => c.capability === 'session_persistence')

  return {
    // Steel injects a synthetic fingerprint BY DEFAULT. skipFingerprintInjection
    // is the opt-out; the policy layer's structural refusal of
    // fingerprint_spoofing makes this unconditional, exactly as with
    // Browserbase's solveCaptchas. A session body without it would be buying
    // the refused capability by omission.
    stealthConfig: {
      skipFingerprintInjection: true,
      autoCaptchaSolving: false,
      humanizeInteractions: false,
    },
    solveCaptcha: false,
    // First use persists the profile so the create response's profileId can
    // be saved and resumed later; a later run passes the saved profileId.
    ...(persistEnabled ? { persistProfile: true } : {}),
    ...(persistEnabled && resume?.steelProfileId !== undefined
      ? { profileId: resume.steelProfileId }
      : {}),
    ...(persistEnabled && resume?.steelSessionContext !== undefined
      ? { sessionContext: resume.steelSessionContext }
      : {}),
  }
}

export function steelOps(
  config: SteelConfig,
  api: VendorApi = fetchVendorApi,
  policy: VendorPolicy = {},
): VendorOps {
  const base = (config.baseUrl ?? 'https://api.steel.dev').replace(/\/$/, '')
  const connectBase = (config.connectBaseUrl ?? 'wss://connect.steel.dev').replace(/\/$/, '')
  const headers = { 'steel-api-key': config.apiKey } as const
  const decision: PolicyDecision = evaluateVendorPolicy(STEEL_CAPABILITIES, policy)

  return {
    vendorId: 'steel',
    secrets: [config.apiKey],
    decision,

    /**
     * First-use persistence: Steel persists the profile when the session is
     * created with `persistProfile: true`, and the create response carries the
     * resulting `profileId`. There is no separate "create profile" call — the
     * session itself is the creation — so this reports null and the profileId
     * from the create response becomes the resume material the ladder saves.
     */
    async ensurePersistence(): Promise<VendorResumeContext | null> {
      return null
    },

    async createSession(resume?: VendorResumeContext | null): Promise<VendorSession> {
      const body = steelSessionBody(decision, resume ?? null)
      const res = await api({
        method: 'POST',
        url: `${base}/v1/sessions`,
        headers,
        body,
      })
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(`steel: session create returned ${res.status}`)
      }
      const json = res.json as {
        id?: unknown
        sessionViewerUrl?: unknown
        profileId?: unknown
      } | null
      if (typeof json?.id !== 'string') {
        throw new Error('steel: session create response missing id')
      }
      // Constructed per Steel's docs rather than read from the response —
      // they explicitly warn against using the returned websocketUrl directly.
      const connectUrl = `${connectBase}?apiKey=${encodeURIComponent(config.apiKey)}&sessionId=${encodeURIComponent(json.id)}`

      const handoffEnabled = decision.enabled.some((c) => c.capability === 'live_view_handoff')
      const handoffUrl = handoffEnabled && typeof json.sessionViewerUrl === 'string' ? json.sessionViewerUrl : null

      const resumeContext: VendorResumeContext | null =
        typeof json.profileId === 'string' ? { steelProfileId: json.profileId } : resume ?? null

      return { sessionId: json.id, connectUrl, handoffUrl, resumeContext }
    },

    async releaseSession(sessionId: string): Promise<void> {
      await api({
        method: 'POST',
        url: `${base}/v1/sessions/${sessionId}/release`,
        headers,
      })
    },
  }
}
