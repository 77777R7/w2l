import { createExecutionScope, raceWithSignal, throwIfExecutionStopped } from '@w2l/http-core'
/**
 * The CDP seam: what a vendor transport needs from a remote browser, as a
 * structural subset of Playwright's types. Injectable so the transports can
 * be tested against a scripted fake instead of a live vendor session.
 *
 * Two shapes here are forced by how the vendors actually work, not by taste:
 *
 *  - The DEFAULT context is used, never `newContext()`. Both Browserbase and
 *    Steel provision a running browser with a live context, and both document
 *    `browser.contexts()[0]`; Playwright itself calls a CDP attachment
 *    "significantly lower fidelity" than its own protocol. Creating a fresh
 *    context would bypass the context the platform set up — including the
 *    session-level proxy the caller may be paying for.
 *
 *  - The user agent is READ, not written. Browserbase exposes no session-level
 *    UA field at all, so any UA we "set" would be an override we cannot prove
 *    reached the wire. Measuring theirs and gating on it is both provable and
 *    the honest question: robots.txt binds the identity the publisher's access
 *    log will show, which is the vendor's, not one we wish for.
 */

export interface CdpRequest {
  headers(): Record<string, string>
}

export interface CdpResponse {
  status(): number
  headers(): Record<string, string>
  request(): CdpRequest
}

export interface CdpPage {
  goto(
    url: string,
    opts: { waitUntil: 'domcontentloaded'; timeout: number },
  ): Promise<CdpResponse | null>
  evaluate(expression: string): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  content(): Promise<string>
  url(): string
  close(): Promise<void>
}

export interface CdpContext {
  newPage(): Promise<CdpPage>
  pages(): CdpPage[]
}

export interface CdpBrowser {
  /** Contexts the vendor already provisioned. `[0]` is the default context. */
  contexts(): CdpContext[]
  close(): Promise<void>
}

export type CdpConnector = (wsUrl: string, deadlineMs?: number, signal?: AbortSignal) => Promise<CdpBrowser>

/**
 * Real connector: Playwright over CDP. Imported lazily so a test run that
 * fakes the seam never loads a browser engine. The caller's deadline becomes
 * the connect timeout — an explicit remaining-ms computation, never a read
 * of a non-standard signal property.
 */
export const playwrightConnector: CdpConnector = async (wsUrl, deadlineMs, signal) => {
  throwIfExecutionStopped({ signal, deadlineAt: deadlineMs })
  const { chromium } = await import('playwright')
  const remaining = deadlineMs === undefined ? 30_000 : Math.max(1, deadlineMs - Date.now())
  const pending = chromium.connectOverCDP(wsUrl, { timeout: remaining })
  void pending.then(browser => { if (signal?.aborted) void browser.close().catch(() => {}) }, () => {})
  return raceWithSignal(pending, signal)
}

/** The vendor's default context, or a clear error if it provisioned none. */
export function defaultContext(browser: CdpBrowser): CdpContext {
  const context = browser.contexts()[0]
  if (context === undefined) {
    throw new Error('vendor session exposed no browser context over CDP')
  }
  return context
}

/**
 * Read the User-Agent the vendor's browser reports, without touching any
 * origin: a fresh page in the default context starts at about:blank, so this
 * costs zero network. That matters — the gate has not run yet, and a probe
 * request to the target before the gate clears would be the exact ordering
 * violation the provider lane exists to prevent.
 *
 * This is `navigator.userAgent`, the JS-visible identity. Probed against a
 * real CDP attachment (local headless Chrome 151, a recording origin): the
 * navigator string, `response.request().headers()['user-agent']`, and the UA
 * the origin actually received were all identical, and the about:blank probe
 * sent zero requests. So the measurement is sound for a plain attachment —
 * but a vendor's stack is not ours, and anything between the engine and the
 * wire could rewrite the header. Hence every fetch re-checks it and reports a
 * mismatch rather than assuming they agree.
 */
/** A page created after cancellation is still owned here and must be closed. */
async function createExecutionPage(browser: CdpBrowser, signal: AbortSignal): Promise<CdpPage> {
  signal.throwIfAborted()
  const pending = defaultContext(browser).newPage()
  void pending.then(page => { if (signal.aborted) void page.close().catch(() => {}) }, () => {})
  return raceWithSignal(pending, signal)
}

export async function measureUserAgent(browser: CdpBrowser, deadlineMs?: number, signal?: AbortSignal): Promise<string> {
  const scope = createExecutionScope({ signal, deadlineAt: deadlineMs })
  let page: CdpPage | undefined
  const abort = () => { void page?.close().catch(() => {}) }
  scope.signal.addEventListener('abort', abort, { once: true })
  try {
    throwIfExecutionStopped(scope)
    page = await createExecutionPage(browser, scope.signal)
    throwIfExecutionStopped(scope)
    const ua = await raceWithSignal(page.evaluate('navigator.userAgent'), scope.signal)
    if (typeof ua !== 'string' || ua.trim().length === 0) {
      throw new Error('vendor browser reported no navigator.userAgent')
    }
    return ua
  } finally {
    scope.signal.removeEventListener('abort', abort)
    scope.dispose()
    await page?.close().catch(() => {})
  }
}

export interface NavigationOutcome {
  status: number
  body: string
  finalUrl: string
  headers: Record<string, string>
  /** The UA actually on the request, when the CDP connection reported it. */
  sentUserAgent: string | null
  /** Client hints on the same request, when CDP surfaced them. */
  sentClientHints: Record<string, string>
}

/**
 * Navigate one page in the vendor's default context and report what the
 * ORIGIN did. Shared by every CDP vendor so the navigation policy
 * (domcontentloaded plus a bounded settle, mirroring the browser_local lane)
 * cannot drift between them.
 *
 * Note a real property of this lane, not hidden: the page is fresh per fetch
 * but the CONTEXT is the vendor's single session context, so cases in one run
 * share its cookie jar. browser_local opens a fresh context per case and does
 * not. That difference is the vendor's architecture, and a bench comparison
 * should know about it rather than have it papered over.
 */
/**
 * The page-goto budget for a caller deadline: remaining time, capped at the
 * navigation default. Exported so the "1234ms must not become 20000ms" rule
 * is a pure-function unit test, not an accident of integration timing.
 */
export function navigationTimeout(deadlineMs: number | undefined, nowMs: number): number {
  if (deadlineMs === undefined) return 20_000
  return Math.min(20_000, Math.max(1, deadlineMs - nowMs))
}

export async function navigateOnce(
  browser: CdpBrowser,
  url: string,
  deadlineMs?: number,
  signal?: AbortSignal,
): Promise<NavigationOutcome> {
  // The caller's absolute deadline maps onto the page's own navigation
  // timeout. Remaining budget is computed explicitly from the deadline —
  // no AbortSignal.timeout property is read anywhere.
  const scope = createExecutionScope({ signal, deadlineAt: deadlineMs })
  let page: CdpPage | undefined
  const abort = () => { void page?.close().catch(() => {}) }
  scope.signal.addEventListener('abort', abort, { once: true })
  try {
    throwIfExecutionStopped(scope)
    page = await createExecutionPage(browser, scope.signal)
    throwIfExecutionStopped(scope)
    const timeout = navigationTimeout(deadlineMs, Date.now())
    const response = await raceWithSignal(page.goto(url, { waitUntil: 'domcontentloaded', timeout }), scope.signal)
    await raceWithSignal(waitForRenderedStability(page, {
      maxMs: deadlineMs === undefined ? 1_500 : Math.min(1_500, Math.max(1, deadlineMs - Date.now())),
    }), scope.signal)
    throwIfExecutionStopped(scope)

    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(response?.headers() ?? {})) {
      headers[name.toLowerCase()] = value
    }

    let sentUserAgent: string | null = null
    const sentClientHints: Record<string, string> = {}
    try {
      const requestHeaders = response?.request().headers() ?? {}
      for (const [name, value] of Object.entries(requestHeaders)) {
        const lower = name.toLowerCase()
        if (lower === 'user-agent') sentUserAgent = value
        if (lower.startsWith('sec-ch-ua')) sentClientHints[lower] = value
      }
    } catch {
      // A CDP attachment may not surface request headers. Null means
      // "unobserved", which the caller must not read as "matched".
      sentUserAgent = null
    }

    return {
      status: response?.status() ?? 0,
      body: await raceWithSignal(page.content(), scope.signal),
      finalUrl: page.url(),
      headers,
      sentUserAgent,
      sentClientHints,
    }
  } finally {
    scope.signal.removeEventListener('abort', abort)
    scope.dispose()
    await page?.close().catch(() => {})
  }
}
import { waitForRenderedStability } from '../browserSettle.js'
