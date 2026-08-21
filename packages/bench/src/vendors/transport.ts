/**
 * Shared CDP-vendor transport: one vendor session per run, the vendor's own
 * default context, and the vendor's own identity — measured, not asserted.
 *
 * Why measured. The provider gate evaluates robots.txt against the UA the
 * provider ACTUALLY SENDS. Browserbase offers no session-level UA field, and
 * Playwright over CDP is explicitly lower-fidelity than its own protocol, so
 * any UA we tried to impose would be a claim we could not prove reached the
 * wire. Reading `navigator.userAgent` off the live session and declaring THAT
 * is provable, and it is also the honest question to ask: a publisher's
 * robots.txt binds the identity their access log will show.
 *
 * If the measured UA changes across sessions, the transport refuses to fetch
 * rather than keep using a declaration the gate already cleared. A vendor that
 * silently upgraded its engine is not a vendor whose old permission still
 * holds.
 */

import type { ProviderResponse, ProviderTransport } from '../subjects/provider.js'
import { scrubSecret } from './api.js'
import {
  measureUserAgent,
  navigateOnce,
  playwrightConnector,
  type CdpBrowser,
  type CdpConnector,
} from './cdp.js'

export interface VendorSession {
  sessionId: string
  /** CDP websocket endpoint. May embed a credential (Steel does). */
  connectUrl: string
}

/** What differs between vendors: how sessions start and stop, and which
 *  strings are secrets that must never leave in an error message. */
export interface VendorOps {
  vendorId: string
  secrets: readonly string[]
  createSession(): Promise<VendorSession>
  releaseSession(sessionId: string): Promise<void>
}

interface LiveSession {
  sessionId: string
  browser: CdpBrowser
}

export class CdpVendorTransport implements ProviderTransport {
  private live: LiveSession | null = null
  private declaredUserAgent: string | null = null

  constructor(
    private readonly ops: VendorOps,
    private readonly connector: CdpConnector = playwrightConnector,
  ) {}

  /**
   * Open the session if needed and report the UA it actually runs. Costs one
   * session create and one CDP connect against the VENDOR — no origin is
   * touched, because the page never leaves about:blank. The session stays open
   * for reuse: paying for a throwaway probe session would double the price of
   * being honest.
   */
  async resolveUserAgent(): Promise<string> {
    if (this.declaredUserAgent !== null) return this.declaredUserAgent
    const { browser } = await this.ensureSession()
    try {
      const ua = await measureUserAgent(browser)
      this.declaredUserAgent = ua
      return ua
    } catch (err) {
      await this.dropSession()
      throw new Error(this.scrub(err instanceof Error ? err.message : String(err)))
    }
  }

  async fetch(url: string): Promise<ProviderResponse> {
    const declared = await this.resolveUserAgent()
    const { browser } = await this.ensureSession()
    try {
      const res = await navigateOnce(browser, url)
      return {
        status: res.status,
        body: res.body,
        finalUrl: res.finalUrl,
        headers: res.headers,
        // Null when the CDP attachment did not surface request headers. The
        // subject treats that as unobserved, never as agreement.
        sentUserAgent: res.sentUserAgent,
        declaredUserAgent: declared,
        // Neither vendor states a per-request price in its API response, and
        // an estimate in this field would read as a measurement.
        costUsd: null,
      }
    } catch (err) {
      // The session is the likely casualty; drop it so the next fetch starts
      // clean rather than replaying against a dead browser.
      await this.dropSession()
      throw new Error(this.scrub(err instanceof Error ? err.message : String(err)))
    }
  }

  async close(): Promise<void> {
    await this.dropSession()
  }

  private async ensureSession(): Promise<LiveSession> {
    if (this.live !== null) return this.live

    let session: VendorSession
    try {
      session = await this.ops.createSession()
    } catch (err) {
      throw new Error(this.scrub(err instanceof Error ? err.message : String(err)))
    }

    let browser: CdpBrowser
    try {
      browser = await this.connector(session.connectUrl)
    } catch (err) {
      await this.ops.releaseSession(session.sessionId).catch(() => {})
      throw new Error(this.scrub(err instanceof Error ? err.message : String(err)))
    }

    if (this.declaredUserAgent !== null) {
      // A reconnect must still be the identity the gate cleared.
      let current: string
      try {
        current = await measureUserAgent(browser)
      } catch (err) {
        await browser.close().catch(() => {})
        await this.ops.releaseSession(session.sessionId).catch(() => {})
        throw new Error(this.scrub(err instanceof Error ? err.message : String(err)))
      }
      if (current !== this.declaredUserAgent) {
        await browser.close().catch(() => {})
        await this.ops.releaseSession(session.sessionId).catch(() => {})
        throw new Error(
          `${this.ops.vendorId}: session user agent changed from "${this.declaredUserAgent}" to ` +
            `"${current}". The identity the robots gate evaluated is not the identity on offer; ` +
            're-resolve the provider declaration and re-run the gate.',
        )
      }
    }

    this.live = { sessionId: session.sessionId, browser }
    return this.live
  }

  private async dropSession(): Promise<void> {
    const live = this.live
    this.live = null
    if (live === null) return
    await live.browser.close().catch(() => {})
    await this.ops.releaseSession(live.sessionId).catch(() => {})
  }

  private scrub(message: string): string {
    return this.ops.secrets.reduce((m, s) => scrubSecret(m, s), message)
  }
}
