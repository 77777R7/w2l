#!/usr/bin/env node
/**
 * The escalation ladder as a CLI: `w2l-fetch <url>`.
 *
 * Runs the URL through the ladder — HTTP, local browser, then (when keys and
 * mode permit) cloud vendors — and prints which channels were tried, where it
 * stopped, and why. This is the day-to-day entry point for "go get this page,
 * escalate only as far as you honestly can".
 *
 * Flags:
 *   --research        allow the provider lane (vendor keys still required)
 *   --authed          additionally allow an authed session / handoff rung
 *   --allowlist-hosts host1,host2   restrict to these hosts (wildcards ok)
 *   --session-store <file>          persist authorized sessions (0600)
 *   --history-file <file>           persist vendor routing history (0600)
 *   --handoff                        ask a human when the ladder reaches a
 *                                    handoff point (interactive prompt)
 *
 * Vendors connect LAZILY: a paid session is created only when governance has
 * cleared the URL and the ladder has actually reached the provider rung.
 * `--persist-session` on w2l-provider is mirrored here by loading a saved
 * SessionSnapshot for the domain and passing its resume context to the
 * vendor before the first fetch.
 */

import { pathToFileURL } from 'node:url'
import type { FetchResult, SessionConfig } from '@w2l/contracts'
import { CONTENTFUL_STATUS } from '@w2l/contracts'
import { LadderRunner, type Channel, type HumanHandoff } from './routing/ladder.js'
import type { AccessConfigInput, CrawlPolicy } from '@w2l/http-core'
import { ResilientHttpSubject } from './subjects/resilientHttp.js'
import { BrowserLocalSubject } from './subjects/browserLocal.js'
import { connectVendor } from './vendors/connect.js'
import { browserbaseOps } from './vendors/browserbase.js'
import { steelOps } from './vendors/steel.js'
import type { VendorResumeContext } from './vendors/transport.js'
import {
  FileRoutingHistory,
  MemoryRoutingHistory,
  type RoutingHistory,
} from './routing/vendorRouter.js'
import { FileSessionStore, type SessionSnapshot, type SessionStore } from './routing/sessionStore.js'

export interface Args {
  url: string
  mode: 'standard' | 'research' | 'authed'
  allowlistedDomains: string[]
  sessionStoreFile: string | null
  historyFile: string | null
  handoff: boolean
  persistSession: boolean
  liveView: boolean
}

export function parseArgs(argv: readonly string[]): Args {
  let mode: Args['mode'] = 'standard'
  let allowlistedDomains: string[] = []
  let sessionStoreFile: string | null = null
  let historyFile: string | null = null
  let handoff = false
  let persistSession = false
  let liveView = false
  const positional: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--research') mode = 'research'
    else if (arg === '--authed') mode = 'authed'
    else if (arg === '--handoff') handoff = true
    else if (arg === '--persist-session') persistSession = true
    else if (arg === '--live-view') liveView = true
    else if (arg.startsWith('--allowlist-hosts')) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++i]!
      allowlistedDomains = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    } else if (arg === '--session-store') {
      sessionStoreFile = argv[++i] ?? null
      if (sessionStoreFile === null) throw new Error('--session-store needs a file path')
    } else if (arg === '--history-file') {
      historyFile = argv[++i] ?? null
      if (historyFile === null) throw new Error('--history-file needs a file path')
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown flag ${arg}`)
    } else {
      positional.push(arg)
    }
  }

  const url = positional[0]
  if (url === undefined) throw new Error('usage: w2l-fetch [--research|--authed] [--persist-session] [--live-view] [--session-store f] [--history-file f] [--handoff] <url>')
  try {
    new URL(url)
  } catch {
    throw new Error(`not a URL: ${url}`)
  }
  return { url, mode, allowlistedDomains, sessionStoreFile, historyFile, handoff, persistSession, liveView }
}

/**
 * Build the ladder's channels. Vendors are LAZY: no session is created here.
 * `connectVendor` runs on the first fetch that reaches the rung — after
 * governance has cleared the URL and the local rungs have failed.
 * `keys` overrides the environment (tests); when omitted the process env is
 * consulted.
 */
export function buildChannels(
  mode: Args['mode'],
  opts: {
    onVendorConnect?: (vendorId: string) => void
    keys?: { browserbase?: string; steel?: string }
    vendorConnector?: import('./vendors/cdp.js').CdpConnector
    /** Test seam: vendor ops per vendor id, replacing the env-key-based ops. */
    vendorOps?: Record<string, import('./vendors/transport.js').VendorOps>
    /** Test seam: robots fetcher for provider subjects. */
    robotsFetcher?: import('./subjects/provider.js').RobotsFetcher
    /** Product policy for the vendor adapters (persistence / live view). */
    vendorPolicy?: import('@w2l/http-core').VendorPolicy
  } = {},
): Channel[] {
  // One subject per channel for the life of the run. A fresh Chromium per
  // fetch would be both slow and leaky; the channel's close() is what tears
  // the browser down at the end.
  const http = new ResilientHttpSubject()
  const plainBrowser = new BrowserLocalSubject(mode)

  // ----------------------------------------------------------------------
  // authed_session: the ONLY rung that uses login state. It exists solely in
  // authed mode; the plain browser_local rung above never receives a session
  // (standard/research must not load or use one — a user's account in a
  // public run is a leak, not a feature).
  //
  // Session acceptance is strict: the snapshot must be scoped to the URL's
  // own domain and must belong to this lane. A Steel resume handed to
  // Browserbase (or vice versa) is rejected rather than misapplied.
  // ----------------------------------------------------------------------
  const authedSubjects = new Map<string, BrowserLocalSubject>()
  const authedSubjectFor = (session: SessionSnapshot, urlHost: string): BrowserLocalSubject => {
    if (session.domain !== urlHost || session.vendor !== 'browser_local_authed') {
      throw new Error(
        `session for ${session.domain}/${session.vendor} does not match ${urlHost}/browser_local_authed`,
      )
    }
    let subject = authedSubjects.get(session.domain)
    if (subject === undefined) {
      const access: AccessConfigInput = {
        session: {} as SessionConfig,
        attestation: {
          principal: session.principal ?? session.attestedBy,
          at: session.attestedAt,
          statement: session.statement ?? 'session authorized by user for this domain',
        },
      }
      if (session.cookies !== undefined) access.session!.cookies = session.cookies
      if (session.storageState !== undefined) access.session!.storageState = session.storageState
      subject = new BrowserLocalSubject('authed', access)
      authedSubjects.set(session.domain, subject)
    }
    return subject
  }

  const channels: Channel[] = [
    {
      id: 'http',
      fetch: (url) => http.fetch(url),
      close: async () => {},
    },
    {
      id: 'browser_local',
      // No session here, ever: the plain rung is the public browser.
      fetch: (url) => plainBrowser.fetch(url),
      close: async () => {
        await plainBrowser.teardown()
      },
    },
  ]

  if (mode === 'authed') {
    channels.push({
      id: 'authed_session',
      fetch: async (url, session) => {
        if (session === undefined || session === null) {
          // No login state to offer: the rung declines without a fetch.
          const refusal: FetchResult = {
            requestedUrl: url,
            status: 'failed',
            failureReason: 'policy_denied',
            blockReason: null,
            budgetExceeded: null,
            lane: 'browser_local_authed',
            escalations: [],
            handoff: null,
            markdown: null,
            truncated: false,
            truncatedAt: null,
            compliance: null,
            evidence: {
              finalUrl: url,
              httpStatus: null,
              redirectChain: [],
              contentType: null,
              rawBodySha256: null,
              artifacts: [],
            },
            usage: {
              wallMs: 0,
              bytesWire: 0,
              bytesDecompressed: 0,
              requestCount: 0,
              attemptCount: 0,
              contentTokens: null,
              browserMs: 0,
              externalCostUsd: null,
            },
            trace: [
              { at: 0, lane: 'browser_local_authed', event: 'authed_session_unavailable', detail: {} },
            ],
          }
          return refusal
        }
        const host = new URL(url).hostname.toLowerCase()
        return authedSubjectFor(session, host).fetch(url)
      },
      close: async () => {
        for (const subject of authedSubjects.values()) await subject.teardown()
      },
    })
  }

  // Provider rungs exist only when a key is present AND the mode permits the
  // lane. connectVendor is deferred to the first fetch.
  if (mode === 'standard') return channels

  const bbKey = opts.keys?.browserbase ?? process.env.BROWSERBASE_API_KEY ?? ''
  const steelKey = opts.keys?.steel ?? process.env.STEEL_API_KEY ?? ''

  const vendorChannel = (
    vendorId: string,
    ops: ReturnType<typeof browserbaseOps> | ReturnType<typeof steelOps>,
  ): Channel => {
    let connected: Awaited<ReturnType<typeof connectVendor>> | null = null
    let pending: Promise<Awaited<ReturnType<typeof connectVendor>>> | null = null
    let establishedResume: VendorResumeContext | null = null
    let persistenceAttempted = false

    /** The resume context that must be on the transport BEFORE the first
     *  session is created. */
    let pendingResume: VendorResumeContext | null = null

    const preparePersistence = async (): Promise<void> => {
      if (persistenceAttempted) return
      persistenceAttempted = true
      if (typeof ops.ensurePersistence !== 'function') return
      establishedResume = await ops.ensurePersistence()
      if (establishedResume !== null) pendingResume = establishedResume
    }

    const ensureConnected = async () => {
      if (connected !== null) return connected
      if (pending === null) {
        opts.onVendorConnect?.(vendorId)
        // pendingResume was established by preparePersistence BEFORE this
        // point, so the very first session the transport creates already
        // carries the context — the UA probe and the fetch share it.
        pending = connectVendor(ops, opts.vendorConnector, pendingResume ?? null).then((c) => {
          connected = c
          return c
        })
      }
      return await pending
    }

    return {
      id: 'provider',
      vendorId,
      fetch: async (url, session) => {
        // Session resume acceptance is strict: only this vendor's own
        // material, only for this domain. A Steel profile never reaches
        // Browserbase.
        const host = new URL(url).hostname.toLowerCase()
        const sessionApplies =
          session !== undefined &&
          session !== null &&
          session.vendor === vendorId &&
          session.domain === host
        if (session !== undefined && session !== null && !sessionApplies) {
          const refusal: FetchResult = {
            requestedUrl: url,
            status: 'failed',
            failureReason: 'policy_denied',
            blockReason: null,
            budgetExceeded: null,
            lane: 'provider',
            escalations: [],
            handoff: null,
            markdown: null,
            truncated: false,
            truncatedAt: null,
            compliance: null,
            evidence: {
              finalUrl: url,
              httpStatus: null,
              redirectChain: [],
              contentType: null,
              rawBodySha256: null,
              artifacts: [],
            },
            usage: {
              wallMs: 0,
              bytesWire: 0,
              bytesDecompressed: 0,
              requestCount: 0,
              attemptCount: 0,
              contentTokens: null,
              browserMs: 0,
              externalCostUsd: null,
            },
            trace: [
              {
                at: 0,
                lane: 'provider',
                event: 'session_vendor_mismatch',
                detail: { sessionVendor: session.vendor, sessionDomain: session.domain, vendorId, host },
              },
            ],
          }
          return refusal
        }
        // ORDER MATTERS: persistence (first-use context creation) must
        // complete BEFORE the first session exists. connectVendor measures
        // the UA by opening a session; if the context is created after that,
        // the session that the gate cleared was not the session on offer.
        await preparePersistence()
        const { declaration, transport } = await ensureConnected()
        if (sessionApplies && session!.resume !== undefined && session!.resume !== null) {
          transport.useResumedSession(session!.resume as VendorResumeContext)
        } else if (pendingResume !== null) {
          transport.useResumedSession(pendingResume)
        }
        const { ProviderSubject } = await import('./subjects/provider.js')
        const subject = new ProviderSubject(
          declaration,
          transport,
          mode,
          null,
          opts.robotsFetcher ?? undefined,
        )
        return subject.fetch(url)
      },
      close: async () => {
        if (connected !== null) {
          await connected.transport.close()
        } else if (pending !== null) {
          await pending.then((c) => c.transport.close()).catch(() => {})
        }
      },
    }
  }

  if (bbKey !== '' || opts.vendorOps?.browserbase !== undefined) {
    const ops = opts.vendorOps?.browserbase ?? browserbaseOps({ apiKey: bbKey }, undefined, opts.vendorPolicy)
    channels.push(vendorChannel('browserbase', ops))
  }
  if (steelKey !== '' || opts.vendorOps?.steel !== undefined) {
    const ops = opts.vendorOps?.steel ?? steelOps({ apiKey: steelKey }, undefined, opts.vendorPolicy)
    channels.push(vendorChannel('steel', ops))
  }

  return channels
}

/** The terminal handoff prompt: ask, wait, and hand the answer to the ladder
 *  as a SessionSnapshot. This is an interactive prompt for a real human — it
 *  is not the human, and it does not claim to be. */
/**
 * The terminal handoff prompt: ask, wait, and hand the answer to the ladder.
 * After the human finishes in the live view, the session they produced is
 * read back from the session store (a prior run or a w2l-provider run with
 * --persist-session may have saved it) so the retry runs with it. Returns
 * null when no session material exists — the ladder then reports the pause
 * point honestly instead of pretending the retry happened.
 */
function terminalHandoff(sessionStore: SessionStore | null): HumanHandoff {
  return {
    async takeOver(url, request) {
      console.log('')
      console.log('=== HUMAN TAKEOVER REQUIRED ===')
      console.log(`target     : ${url}`)
      console.log(`reason     : ${request.reason}`)
      if (request.liveViewUrl !== null) console.log(`live view  : ${request.liveViewUrl}`)
      console.log(`rationale  : ${request.rationale}`)
      console.log('')
      console.log('Open the live view, complete the challenge / sign in, then press Enter.')
      console.log('The session will be saved and the task will retry with it.')
      console.log('Press Ctrl-C to abort instead.')
      await new Promise<void>((resolve) => {
        process.stdin.once('data', () => resolve())
      })
      if (sessionStore === null) return null
      const host = new URL(url).hostname
      const snapshot = await sessionStore.load(host)
      if (snapshot === null) {
        console.log('no saved session for this domain — reporting the pause point instead of retrying blind.')
      }
      return snapshot
    },
  }
}

function describe(result: FetchResult): string {
  const parts = [`status=${result.status}`]
  if (result.blockReason !== null) parts.push(`block=${result.blockReason}`)
  if (result.failureReason !== null) parts.push(`failure=${result.failureReason}`)
  if (result.lane !== null) parts.push(`lane=${result.lane}`)
  return parts.join(' ')
}

export async function runLadder(args: Args): Promise<number> {
  // The product policy the vendor adapters will evaluate. Only the two
  // authorizable capabilities can ever be turned on, and only by explicit
  // flags on this CLI — never by a default.
  const vendorPolicy = {
    authorized: [
      ...(args.persistSession ? ['session_persistence'] : []),
      ...(args.liveView ? ['live_view_handoff'] : []),
    ] as const,
  }
  const channels = buildChannels(args.mode, {
    vendorPolicy,
    onVendorConnect: (vendorId) => console.log(`vendor session : creating ${vendorId} session (lazy)`),
  })
  const policy: CrawlPolicy = {
    mode: args.mode,
    ...(args.allowlistedDomains.length > 0 ? { allowlistedDomains: args.allowlistedDomains } : {}),
  }
  const history: RoutingHistory =
    args.historyFile !== null ? new FileRoutingHistory(args.historyFile) : new MemoryRoutingHistory()
  const sessionStore = args.sessionStoreFile !== null ? new FileSessionStore(args.sessionStoreFile) : null
  const handoff = args.handoff ? terminalHandoff(sessionStore) : null

  console.log(`ladder mode : ${args.mode}`)
  console.log(`channels    : ${channels.map((c) => (c.vendorId !== undefined ? `${c.id}(${c.vendorId})` : c.id)).join(' → ')}`)
  console.log(`target      : ${args.url}`)
  console.log(
    `vendor policy: ${vendorPolicy.authorized.length > 0 ? vendorPolicy.authorized.join(', ') : 'default (no persistence, no live view)'}`,
  )
  if (sessionStore !== null) console.log(`session store: ${args.sessionStoreFile}`)
  if (args.historyFile !== null) console.log(`history file : ${args.historyFile}`)

  const runner = new LadderRunner(channels, policy, history, handoff, sessionStore)

  try {
    const run = await runner.run(args.url)
    console.log('')
    console.log(`tried       : ${run.channelsTried.join(' → ')}`)
    console.log(`outcome     : ${describe(run.result)}`)
    for (const step of run.ladderTrace) {
      console.log(`audit       : ${step.event} channel=${step.channel} ${JSON.stringify(step.detail)}`)
    }
    if (run.handoffRequested) {
      const h = run.result.handoff
      console.log('handoff     : a human must take over this page')
      if (h?.liveViewUrl !== null && h?.liveViewUrl !== undefined) {
        console.log(`live view   : ${h.liveViewUrl}`)
      }
      console.log(`rationale   : ${h?.rationale ?? 'human verification required'}`)
    }
    if (run.result.markdown !== null && run.result.markdown !== '') {
      console.log('')
      console.log('--- extracted ---')
      console.log(run.result.markdown.slice(0, 1500))
    }
    // Non-success outcomes exit non-zero so a scripted caller can react to
    // "the ladder did not get content" without parsing stdout.
    return CONTENTFUL_STATUS.has(run.result.status) ? 0 : 1
  } finally {
    // The browser owns a Chromium process; leaving it alive is what makes a
    // CLI that "worked" hang forever.
    await Promise.all(channels.map((c) => c.close?.().catch(() => {})))
  }
}

async function main(): Promise<number> {
  return runLadder(parseArgs(process.argv.slice(2)))
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exitCode = 1
    })
}
