/**
 * Steel integration.
 *
 * Capability posture: Steel injects a synthetic browser fingerprint BY
 * DEFAULT and sells captcha solving as an option. The session body below is
 * the compliance claim: `skipFingerprintInjection: true` opts out of the
 * forged fingerprint (their docs reserve it for "tasks that control the
 * browser fingerprint" — this transport does, by declaring the engine's own
 * identity), `solveCaptcha: false` and `autoCaptchaSolving: false` decline
 * the solving product, and `humanizeInteractions: false` declines synthetic
 * human input. No parameter can turn any of these back on.
 *
 * Credential note: Steel authenticates the CDP websocket with the API key AS
 * A QUERY PARAMETER, so the connect URL itself is a secret. It is listed in
 * `secrets` and the shared transport scrubs it out of every error before one
 * can reach a trace or a bench artifact.
 *
 * API shape (docs.steel.dev + steel-node SDK source, checked 2026-08-21):
 *   create : POST https://api.steel.dev/v1/sessions        header steel-api-key
 *   connect: wss://connect.steel.dev?apiKey={key}&sessionId={id}
 *   release: POST https://api.steel.dev/v1/sessions/{id}/release
 */

import { fetchVendorApi, type VendorApi } from './api.js'
import type { VendorOps, VendorSession } from './transport.js'

export interface SteelConfig {
  apiKey: string
  /** Override both for a self-hosted Steel (it is open-source). */
  baseUrl?: string
  connectBaseUrl?: string
}

export function steelSessionBody(): unknown {
  return {
    solveCaptcha: false,
    stealthConfig: {
      autoCaptchaSolving: false,
      humanizeInteractions: false,
      // Steel injects a synthetic fingerprint unless told not to. This is
      // the opt-out, and it is what makes the provider declaration's
      // capability list true.
      skipFingerprintInjection: true,
    },
  }
}

export function steelOps(config: SteelConfig, api: VendorApi = fetchVendorApi): VendorOps {
  const base = (config.baseUrl ?? 'https://api.steel.dev').replace(/\/$/, '')
  const connectBase = (config.connectBaseUrl ?? 'wss://connect.steel.dev').replace(/\/$/, '')
  const headers = { 'steel-api-key': config.apiKey } as const

  return {
    vendorId: 'steel',
    secrets: [config.apiKey],

    async createSession(): Promise<VendorSession> {
      const res = await api({
        method: 'POST',
        url: `${base}/v1/sessions`,
        headers,
        body: steelSessionBody(),
      })
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(`steel: session create returned ${res.status}`)
      }
      const json = res.json as { id?: unknown } | null
      if (typeof json?.id !== 'string') {
        throw new Error('steel: session create response missing id')
      }
      // Constructed per Steel's docs rather than read from the response —
      // they explicitly warn against using the returned websocketUrl directly.
      const connectUrl = `${connectBase}?apiKey=${encodeURIComponent(config.apiKey)}&sessionId=${encodeURIComponent(json.id)}`
      return { sessionId: json.id, connectUrl }
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
