/**
 * Browserbase integration.
 *
 * Capability posture: Browserbase SELLS captcha solving (`solveCaptchas`
 * defaults to TRUE) and an "Advanced Stealth Mode". A session created with
 * the vendor's defaults would therefore be exactly the product the provider
 * gate refuses. The session body below is the compliance claim: it turns
 * both off explicitly rather than relying on any default, and the test suite
 * asserts the exact body so the claim cannot drift silently. There is no
 * parameter for turning them back on — a config knob for the refused
 * capability would just be the override flag the gate deliberately lacks.
 *
 * API shape (docs.browserbase.com, checked 2026-08-21):
 *   create : POST https://api.browserbase.com/v1/sessions   header X-BB-API-Key
 *   release: POST https://api.browserbase.com/v1/sessions/{id}  body {status:'REQUEST_RELEASE'}
 *   create response carries `id` and `connectUrl` (the CDP websocket).
 */

import { fetchVendorApi, type VendorApi } from './api.js'
import type { VendorOps, VendorSession } from './transport.js'

export interface BrowserbaseConfig {
  apiKey: string
  /** Optional; Browserbase infers the project from the key when omitted. */
  projectId?: string
  baseUrl?: string
}

export function browserbaseSessionBody(projectId?: string): unknown {
  return {
    ...(projectId === undefined ? {} : { projectId }),
    browserSettings: {
      // Defaults to true on the vendor side. Explicitly off: solving a
      // human-verification challenge is a refused capability, and leaving
      // the default in place would be buying it by omission.
      solveCaptchas: false,
      // The vendor's stealth mode forges fingerprint signals. Same refusal.
      advancedStealth: false,
    },
  }
}

export function browserbaseOps(config: BrowserbaseConfig, api: VendorApi = fetchVendorApi): VendorOps {
  const base = (config.baseUrl ?? 'https://api.browserbase.com').replace(/\/$/, '')
  const headers = { 'x-bb-api-key': config.apiKey } as const

  return {
    vendorId: 'browserbase',
    secrets: [config.apiKey],

    async createSession(): Promise<VendorSession> {
      const res = await api({
        method: 'POST',
        url: `${base}/v1/sessions`,
        headers,
        body: browserbaseSessionBody(config.projectId),
      })
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(`browserbase: session create returned ${res.status}`)
      }
      const json = res.json as { id?: unknown; connectUrl?: unknown } | null
      if (typeof json?.id !== 'string' || typeof json.connectUrl !== 'string') {
        throw new Error('browserbase: session create response missing id/connectUrl')
      }
      return { sessionId: json.id, connectUrl: json.connectUrl }
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
