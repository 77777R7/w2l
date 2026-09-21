import { createHash } from 'node:crypto'
import { mkdir, rmdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type { ManagedSessionRef, SessionGrant, NetworkPolicy } from '@w2l/contracts'
import { SessionBroker, validateCdpEndpoint } from './sessionBroker.js'
import { assertSafeUrl } from '../egress.js'

/** W2L command serialization, not an isolation claim about a user's CDP context. */
export class BrowserControl {
  constructor(private readonly root: string, private readonly broker: SessionBroker, private readonly policy: NetworkPolicy) {}

  async acquire(grant: SessionGrant): Promise<() => Promise<void>> {
    const session = await this.broker.getSession(grant.sessionRef)
    const key = session.backend === 'existing_chrome'
      ? new URL(validateCdpEndpoint(session.cdpEndpoint!)).host
      : resolve(session.profileDir)
    const directory = join(this.root, 'browser-locks', createHash('sha256').update(key).digest('hex'))
    await mkdir(join(this.root, 'browser-locks'), { recursive: true, mode: 0o700 })
    try { await mkdir(directory, { mode: 0o700 }) } catch { throw new Error('browser control busy; stale lock requires operator confirmation') }
    return async () => { await rmdir(directory) }
  }

  async open(grant: SessionGrant, deadline: number): Promise<ControlledPage> {
    if (!await this.broker.validateGrant(grant)) throw new Error('authorization_lost')
    const session = await this.broker.getSession(grant.sessionRef)
    let browser: Browser | undefined
    let context: BrowserContext | undefined
    let page: Page | undefined
    const owned = session.backend !== 'existing_chrome'
    try {
      if (owned) {
        await mkdir(session.profileDir, { recursive: true, mode: 0o700 })
        context = await chromium.launchPersistentContext(session.profileDir, { headless: true, serviceWorkers: 'block', acceptDownloads: true, timeout: Math.max(1,deadline-Date.now()) })
      } else {
        let endpoint = validateCdpEndpoint(session.cdpEndpoint!)
        if (endpoint.startsWith('http:')) {
          const res = await fetch(new URL('/json/version', endpoint), { redirect: 'error', signal: AbortSignal.timeout(Math.max(1,Math.min(5000,deadline-Date.now()))) })
          const data = await res.json() as { webSocketDebuggerUrl?: string }
          endpoint = validateCdpEndpoint(data.webSocketDebuggerUrl ?? '')
          if (new URL(endpoint).host !== new URL(session.cdpEndpoint!).host) throw new Error('CDP discovery endpoint changed')
        }
        browser = await chromium.connectOverCDP(endpoint, { timeout: Math.max(1,deadline-Date.now()) })
        if (browser.contexts().length !== 1) throw new Error('ambiguous browser context')
        context = browser.contexts()[0]!
        if (context.serviceWorkers().length) throw new Error('existing service worker unsupported for restricted recipes')
      }
      page = await context.newPage()
      let cancelled = false
      const abort = () => { cancelled = true; void page?.close().catch(() => {}) }
      const timer = setTimeout(abort, Math.max(1,deadline-Date.now()))
      const poll = setInterval(() => {
        void this.broker.validateGrant(grant).then((ok) => { if (!ok) abort() }).catch(abort)
      }, 100)
      page.on('popup', (popup) => { void popup.close(); abort() })
      let requestPermission: { method: string; path: string } | null = null
      let violation = false
      await page.route('**/*', async (route) => {
        try {
          const req = route.request()
          const url = new URL(req.url())
          await assertSafeUrl(url.href, this.policy)
          const safeMethod = req.method() === 'GET' || req.method() === 'HEAD'
          const queryAllowed = requestPermission && req.method() === requestPermission.method && url.pathname === requestPermission.path
          if (url.origin !== grant.originScope || (!safeMethod && !queryAllowed) || !await this.broker.validateGrant(grant)) throw new Error('request scope violation')
          await route.continue()
        } catch { violation = true; await route.abort().catch(() => {}) }
      })
      const openedPage = page
      const openedContext = context
      return {
        page: openedPage,
        backend: owned ? 'managed' : 'existing_chrome',
        capabilities: { ownsBrowser: owned, sharesUserContext: !owned, newOwnedTab: true, serviceWorkerIsolation: owned, safeDetach: true },
        allowQuery: (request) => { requestPermission = request },
        check: async () => {
          if (cancelled || Date.now() >= deadline || !await this.broker.validateGrant(grant)) throw new Error('authorization_or_deadline_lost')
          if (violation) throw new Error('request_scope_violation')
          if (openedPage.url() !== 'about:blank' && new URL(openedPage.url()).origin !== grant.originScope) throw new Error('navigation_scope_violation')
        },
        close: async () => {
          clearTimeout(timer); clearInterval(poll)
          await openedPage.close().catch(() => {})
          if (owned) await openedContext.close()
          else await browser!.close() // connectOverCDP close disconnects; never context.close/Browser.close CDP command.
        },
      }
    } catch {
      await page?.close().catch(() => {})
      if (owned) await context?.close().catch(() => {})
      else await browser?.close().catch(() => {})
      throw new Error('browser_connection_failed') // do not leak CDP endpoint/profile path
    }
  }
}

export interface ControlledPage {
  page: Page
  backend: 'managed' | 'existing_chrome'
  capabilities: { ownsBrowser: boolean; sharesUserContext: boolean; newOwnedTab: boolean; serviceWorkerIsolation: boolean; safeDetach: boolean }
  allowQuery(request: { method: string; path: string } | null): void
  check(): Promise<void>
  close(): Promise<void>
}
