/**
 * Handing a page to a person, in the Chrome they already use: a page W2L
 * was stopped at (a captcha, a challenge, a login wall) is opened in a new
 * tab of their Chrome, they get through it there as they would on their own,
 * and W2L reads the page once it is through. W2L passes no check itself and
 * changes nothing about the browser: the person does, in their browser.
 *
 * The connection is the one `w2l login import` uses: Chrome's remote
 * debugging, turned on by the person at chrome://inspect/#remote-debugging
 * and approved by them in Chrome's "Allow remote debugging?" dialog, once
 * for all the pages of one handoff. W2L touches only the tabs it opens, and
 * closes each when it has read it or given up on it.
 *
 * W2L reads a page only after the person acted in its tab: a click or a key
 * press Chrome itself counts as a user's (the document's user activation,
 * read in a world of W2L's own the page's script cannot reach, or a
 * navigation Chrome marks as made with a user gesture). Nothing the page
 * does by itself (a reload, a redirect, a check that passes on its own, a
 * script filling a field) counts, so one Allow never lets a caller read the
 * sites the person is signed into: a page that shows what they want read
 * waits for them to click on it.
 *
 * A page counts as through when, on CLEAR_READS reads a poll apart, it has
 * loaded; its document answered 2xx; W2L's gate, given the document's own
 * status and headers (what the stop was detected by, a vendor header
 * included), finds no check in it; it is on the site asked for and not on a
 * login path; the person is not at a step of their own (no password or
 * one-time-code field showing, no field whose value is changing); and it is
 * the page asked for: the URL itself, or where that URL leads when W2L
 * opens it. A way through that ends elsewhere on the site (the home page a
 * sign-in lands on) is followed by W2L taking the tab back to the URL, at
 * most RETURNS times; a page that is still elsewhere is not read. Its
 * address is Chrome's, not what the page's script says.
 */

import { extractTf } from '@w2l/extract-tf'
import { classifyGate, type GateVerdict } from '@w2l/http-core'
import { isLoginPath, sessionCoversHost, type UserBrowserRead } from '@w2l/bench'
import { chromeEndpoint, chromeUserDataDir, ChromeLoginError, connectCdp, type CdpConnection } from './chromeLogin.js'

export interface UserChromeOptions {
  /** Chrome's user data directory; default the stable channel's for this OS. */
  userDataDir?: string
  /** How long to wait for the person to click Allow in Chrome. Default 120 s. */
  approveTimeoutMs?: number
  /** Opens the connection; a test passes its own. Default a WebSocket. */
  connect?: (endpoint: string, timeoutMs: number, signal?: AbortSignal) => Promise<CdpConnection>
}

export interface UserChromeReadOptions {
  /** How long to wait for the person, per page. Default 10 minutes. */
  waitMs?: number
  /** Between two reads of the page. Default 0.5 s: a click just before the page moves on is seen. */
  pollMs?: number
  /** Told once, when the page shows a check the person has to pass. */
  onWaiting?: (url: string, check: string) => void
  /** Told once, when the page shows no check and W2L waits for the person to click on it to have it read. */
  onConfirm?: (url: string) => void
  /** Ends the wait: the caller went away. The page is not read and its tab is closed. */
  signal?: AbortSignal
}

/** Reads in a row a page must pass to count as through: about 1.5 s at the default poll. */
const CLEAR_READS = 3
/** Times W2L takes the tab back to the page asked for when the person's way through ended elsewhere on the site (a home page after a sign-in). */
const RETURNS = 2
/** A document answered with one of these is a check, whatever its body. */
const CHECK_STATUSES: ReadonlySet<number> = new Set([401, 403, 407, 429, 503])
/** How long one read of the tab waits for Chrome: a Chrome that stopped answering this long is gone. */
const READ_TIMEOUT_MS = 10_000
/** W2L's own world in the page, where the page's script cannot change what it reads. */
const WORLD = 'w2l-handoff'

/** A page the person did not get through in time, left (closed its tab, quit Chrome), or that ended off the page asked for: it is not read. */
export class HandoffNotThrough extends Error {
  constructor(message: string, readonly check: string | null) {
    super(message)
  }
}

export interface UserChrome {
  /** Open `url` in a new tab, wait for the person to get through, read the page, close the tab. */
  read(url: string, options?: UserChromeReadOptions): Promise<UserBrowserRead>
  close(): void
}

interface PageState {
  href: string
  ready: string
  status: number | null
  html: string
  /** A password or one-time-code field shows on the page: a sign-in step. */
  secret: boolean
  /** The form field in focus and what it holds, or null: a value that changed between two reads is a step under way. */
  field: string | null
}

/** What the page shows now. */
const STATE = `JSON.stringify({
  href: location.href,
  ready: document.readyState,
  status: (performance.getEntriesByType('navigation')[0] || {}).responseStatus || null,
  html: document.documentElement ? document.documentElement.outerHTML : '',
  secret: Array.from(document.querySelectorAll('input[type=password], input[autocomplete="one-time-code"]')).some((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'),
  field: (() => { const el = document.activeElement; if (!el) return null; if (el.isContentEditable) return 'edit:' + String(el.textContent).slice(0, 500); return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ? el.tagName + ':' + String(el.value).slice(0, 500) : null })(),
})`

/** The main document's last response, as the browser received it. */
interface DocumentResponse {
  url: string
  status: number
  headers: Record<string, string>
}

/** Connect to the person's running Chrome, with their approval. */
export async function openUserChrome(options: UserChromeOptions = {}, signal?: AbortSignal): Promise<UserChrome> {
  const endpoint = await chromeEndpoint(options.userDataDir ?? chromeUserDataDir())
  const connection = await (options.connect ?? connectCdp)(endpoint, options.approveTimeoutMs ?? 120_000, signal)
  // A connection a test opened without the signal: one opened after a cancel is not used.
  if (signal?.aborted === true) { connection.close(); throw new ChromeLoginError('the connection to Chrome was cancelled') }
  let browser = 'chrome'
  try {
    const version = await connection.send('Browser.getVersion') as { product?: string }
    if (typeof version.product === 'string' && version.product.length > 0) browser = version.product
  } catch {
    // The version is evidence, not a condition: unknown is recorded as `chrome`.
  }
  return {
    read: (url, readOptions = {}) => readPage(connection, browser, url, readOptions),
    close: () => connection.close(),
  }
}

async function readPage(connection: CdpConnection, browser: string, url: string, options: UserChromeReadOptions): Promise<UserBrowserRead> {
  const waitMs = options.waitMs ?? 600_000
  const pollMs = options.pollMs ?? 500
  const host = new URL(url).hostname
  const started = Date.now()
  let sawGate: string | null = null
  // A tab or a Chrome that is gone; a page between two documents ("navigated or closed") is not gone, only moving.
  const gone = (error: unknown): HandoffNotThrough | null =>
    error instanceof ChromeLoginError && !/navigated or closed/i.test(error.message) && /Session with given id not found|No session with given id|No target with given id|closed the connection|Target closed|target not found|did not answer Target\.getTargetInfo/i.test(error.message)
      ? new HandoffNotThrough(`the tab for ${url} was closed, or Chrome quit, before W2L read it`, sawGate)
      : null
  // Any other refusal from Chrome ends this page alone, not the handoff of the others.
  const ended = (error: unknown): unknown => gone(error) ?? (error instanceof ChromeLoginError ? new HandoffNotThrough(`${url} was not read: ${error.message}`, sawGate) : error)
  let targetId: string
  try {
    // A blank tab first, so the page's own requests and responses are heard from its first one.
    targetId = (await connection.send('Target.createTarget', { url: 'about:blank' }) as { targetId: string }).targetId
  } catch (error) {
    throw ended(error)
  }
  const stops: Array<() => void> = []
  try {
    const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string }
    // Set by the event listeners: the main document's last response; how the person acted (a navigation Chrome marks as a user's);
    // where the URL leads each time W2L takes the tab back to it once the person is through (the page it names when a site
    // redirects it; not where it led before, which for a signed-out visit may be the sign-in or the home page).
    const heard: { document: DocumentResponse | null; act: string | null; ours: boolean; landings: Set<string>; documents: number } = { document: null, act: null, ours: false, landings: new Set(), documents: 0 }
    if (connection.on !== undefined) {
      stops.push(connection.on('Network.requestWillBeSent', sessionId, (params) => {
        if (params.type === 'Document' && params.frameId === targetId && params.hasUserGesture === true) heard.act ??= 'gesture_navigation'
      }))
      stops.push(connection.on('Network.responseReceived', sessionId, (params) => {
        const response = params.response as { url?: string; status?: number; headers?: Record<string, string> } | undefined
        if (params.type !== 'Document' || params.frameId !== targetId || response === undefined) return
        heard.documents++
        heard.document = { url: String(response.url ?? ''), status: Number(response.status ?? 0), headers: Object.fromEntries(Object.entries(response.headers ?? {}).map(([name, value]) => [name.toLowerCase(), String(value)])) }
        if (heard.ours) { heard.landings.add(pageOf(heard.document.url)); heard.ours = false }
        // A check answered in the response alone (a challenge status or a vendor's header): evidence of what the page showed.
        const seen = heard.document
        const check = classifyGate({ status: seen.status, header: (name) => seen.headers[name.toLowerCase()] ?? null, body: '' })
        if (check !== null || CHECK_STATUSES.has(seen.status)) sawGate ??= check?.reason ?? `http_${seen.status}`
      }))
      await connection.send('Network.enable', {}, sessionId)
    }
    // The tab in front, in the person's window: the one they are to act in, not one left from before.
    await connection.send('Target.activateTarget', { targetId }).catch(() => undefined)
    // Chrome answers Page.navigate when the page's response begins: a slow page is waited for in the reads, not here.
    let navigation: unknown = null
    const open = (returning: boolean) => {
      heard.ours = returning
      void connection.send('Page.navigate', { url }, sessionId).catch((error: unknown) => { navigation = error })
    }
    open(false)
    let told = false
    let confirming = false
    let returns = 0
    let documentsAtReturn = 0
    // The world W2L reads the person's activation in, made once for each document the tab shows.
    let world: { documents: number; href: string; id: number } | null = null
    let field: string | null | undefined
    let clear = 0
    let last: { state: PageState; response: DocumentResponse | null } | null = null
    while (Date.now() - started < waitMs) {
      await new Promise((resolve) => setTimeout(resolve, pollMs))
      if (options.signal?.aborted === true) throw new HandoffNotThrough(`the handoff of ${url} was cancelled before W2L read it`, sawGate)
      if (navigation !== null && gone(navigation) !== null) throw gone(navigation)
      let state: PageState
      try {
        // The tab first, from the browser: one the person closed is gone however its page answers. Its address is Chrome's, which the page's script cannot change.
        // A Chrome that does not answer this, the browser's own lightest command, within READ_TIMEOUT_MS has quit.
        const info = await connection.send('Target.getTargetInfo', { targetId }, undefined, READ_TIMEOUT_MS) as { targetInfo?: { url?: string } }
        const answer = await connection.send('Runtime.evaluate', { expression: STATE, returnByValue: true }, sessionId) as { result?: { value?: string } }
        if (typeof answer.result?.value !== 'string') { clear = 0; continue }
        state = JSON.parse(answer.result.value) as PageState
        if (typeof info.targetInfo?.url === 'string') state.href = info.targetInfo.url
        // The person's activation of this document, which a click or a key press gives it (a click in a captcha's frame included) and its script cannot.
        if (heard.act === null) {
          if (world === null || world.documents !== heard.documents || world.href !== state.href) {
            const made = await connection.send('Page.createIsolatedWorld', { frameId: targetId, worldName: WORLD }, sessionId) as { executionContextId: number }
            world = { documents: heard.documents, href: state.href, id: made.executionContextId }
          }
          const active = await connection.send('Runtime.evaluate', { expression: 'navigator.userActivation.hasBeenActive', contextId: world.id, returnByValue: true }, sessionId) as { result?: { value?: unknown } }
          if (active.result?.value === true) heard.act = 'user_activation'
        }
      } catch (error) {
        // A page between two documents has no context to evaluate in; one that is gone is the person's answer.
        const left = gone(error)
        if (left !== null) throw left
        world = null
        clear = 0
        continue
      }
      // The document's own response, when it is the one shown (the address may differ by its fragment alone).
      const response: DocumentResponse | null = heard.document !== null && sameDocument(heard.document.url, state.href) ? heard.document : null
      const status = response?.status ?? state.status
      last = { state, response }
      const { full, decisive, gate } = checksOf(state, response, status)
      // What the page showed, as evidence: a generic bot check only on decisive markers, not a loading page's weak ones.
      if (full !== null && (full.reason !== 'bot_detected_generic' || decisive !== null)) sawGate ??= full.reason
      if (gate !== null && !told) { told = true; options.onWaiting?.(url, gate.reason) }
      const typing = state.field !== null && field !== undefined && state.field !== field
      field = state.field
      // The page asked for: the URL, or where it leads when W2L opens it; after a return, once its document has come.
      const asked = pageOf(state.href) === pageOf(url) || heard.landings.has(pageOf(state.href))
      const arrived = returns === 0 || connection.on === undefined || heard.documents > documentsAtReturn
      const through = state.ready === 'complete' && gate === null && (status === null || (status >= 200 && status < 300))
        && sameSite(state.href, host) && !onLoginPath(state.href, url) && !state.secret && !typing && arrived
      clear = through ? clear + 1 : 0
      if (clear < CLEAR_READS) continue
      // The person has not acted in the tab: a page clear without them is not read until they click on it.
      if (heard.act === null) {
        if (!confirming) { confirming = true; options.onConfirm?.(url) }
        continue
      }
      // Through, but elsewhere on the site (a sign-in that ends on the home page): the tab goes back to the page asked for.
      if (!asked) {
        if (returns >= RETURNS) throw new HandoffNotThrough(`${url} was not read: after you got through, the tab stayed on ${pageOf(state.href)}, not the page asked for`, sawGate)
        returns++
        documentsAtReturn = heard.documents
        clear = 0
        open(true)
        continue
      }
      return {
        requestedUrl: url,
        finalUrl: state.href,
        status,
        contentType: response?.headers['content-type'] ?? null,
        html: state.html,
        fetchedAt: new Date().toISOString(),
        wallMs: Date.now() - started,
        sawGate,
        act: heard.act,
        browser,
      }
    }
    const where = last === null ? 'it never loaded'
      : !sameSite(last.state.href, host) ? `it was on ${safeHost(last.state.href)}, not ${host}`
        : stillGated(last) !== null ? `it still showed a check (${stillGated(last)!.reason}: ${stillGated(last)!.signals.join(', ')})`
          : clear >= CLEAR_READS && heard.act === null ? 'the page showed no check, and you did not click on it to have it read (W2L reads a page in your Chrome only once you act in its tab; a site you are signed into is read with your login through w2l login import and mode authed)'
            : 'it was not yet the page: still loading, at a sign-in step, or not answering 2xx'
    throw new HandoffNotThrough(`${url} was not through within ${Math.round(waitMs / 1000)} s: ${where}`, sawGate)
  } catch (error) {
    throw ended(error)
  } finally {
    for (const stop of stops) stop()
    await connection.send('Target.closeTarget', { targetId }).catch(() => undefined)
  }
}

/**
 * The checks W2L's gate reads on a page: `full`, any evidence; `decisive`,
 * the evidence that names a check on a page with content; `gate`, the one
 * that holds the page, as W2L's own lanes judge it: a page with content (an
 * article that embeds a captcha widget, a page that keeps the widget's
 * script once passed) by decisive evidence alone, one without by any.
 */
function checksOf(state: PageState, response: DocumentResponse | null, status: number | null): { full: GateVerdict | null; decisive: GateVerdict | null; gate: GateVerdict | null } {
  const header = (name: string) => response?.headers[name.toLowerCase()] ?? null
  const full = classifyGate({ status: status ?? 200, header, body: state.html })
  const decisive = classifyGate({ status: status ?? 200, header, body: state.html, contentful: true })
  const gate = full === null || decisive !== null || state.ready !== 'complete' ? full ?? decisive : extractTf.extract(state.html, { url: state.href }).escalate ? full : null
  return { full, decisive, gate }
}

/** The check that held the page as last read, with what it was read from. */
function stillGated(last: { state: PageState; response: DocumentResponse | null }): GateVerdict | null {
  return checksOf(last.state, last.response, last.response?.status ?? last.state.status).gate
}

/** Whether a page's address is on the site asked for: the same host, a subdomain of it, or a parent domain of it. */
function sameSite(href: string, host: string): boolean {
  let page: string
  try {
    page = new URL(href).hostname
  } catch {
    return false
  }
  return sessionCoversHost(page, host) || sessionCoversHost(host, page)
}

/** Whether the page is on a login path the URL asked for was not: the site's sign-in, not the page. */
function onLoginPath(href: string, asked: string): boolean {
  try {
    return isLoginPath(new URL(href).pathname) && !isLoginPath(new URL(asked).pathname)
  } catch {
    return false
  }
}

/** A page's path and query, without a trailing slash or the fragment: the page an address names, on whichever host of the site. */
function pageOf(href: string): string {
  try {
    const parsed = new URL(href)
    return `${parsed.pathname.replace(/\/+$/, '') || '/'}${parsed.search}`
  } catch {
    return href
  }
}

/** Two addresses of one document: the same but for the fragment. */
function sameDocument(a: string, b: string): boolean {
  return a.split('#')[0] === b.split('#')[0]
}

function safeHost(href: string): string {
  try {
    return new URL(href).hostname
  } catch {
    return 'another page'
  }
}
