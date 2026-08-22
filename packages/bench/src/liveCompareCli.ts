#!/usr/bin/env node
/**
 * Live channel comparison: run the SAME URL list through every available
 * channel and report, per channel:
 *
 *   content success rate  — status success/partial over attempts
 *   false success rate    — contentful BUT challenge-page markers detected
 *   cost                  — externalCostUsd as reported (never estimated)
 *   speed                 — median wall ms
 *   human intervention    — share of attempts that asked for handoff
 *
 * Channels are run independently and in sequence: HTTP, local browser, then
 * Browserbase and Steel if the respective API key is present in the
 * environment. A channel without a key is reported as SKIPPED, not silently
 * dropped — an honest comparison must say which arms were never measured.
 *
 * Usage: w2l-live-compare <url> [url...]
 *
 * This is the measurement counterpart to the escalation ladder: the ladder
 * reports which channel won per URL; this reports how good each channel
 * actually is, which is the only evidence base for tuning the ladder's
 * channel order.
 */

import { pathToFileURL } from 'node:url'
import type { FetchResult, HandoffRequest } from '@w2l/contracts'
import { CONTENTFUL_STATUS } from '@w2l/contracts'
import { ResilientHttpSubject } from './subjects/resilientHttp.js'
import { BrowserLocalSubject } from './subjects/browserLocal.js'
import { vendorProviderSubject } from './vendors/connect.js'
import { browserbaseOps } from './vendors/browserbase.js'
import { steelOps } from './vendors/steel.js'
import type { VendorPolicy } from '@w2l/http-core'

interface ArmResult {
  arm: string
  status: string
  blockReason: string | null
  failureReason: string | null
  failureClass: string | null
  wallMs: number
  tokens: number | null
  costUsd: number | null
  handoff: HandoffRequest | null
  contentful: boolean
  falseSuccess: boolean
}

export interface ArmOutcome {
  arm: string
  ok: boolean
  error?: string
  result?: ArmResult
}

/** Challenge-page markers, same list as checker.ts (keep in sync). */
const CHALLENGE_MARKERS = [
  'Just a moment',
  'Enable JavaScript and cookies',
  'Checking your browser',
  'Are you a robot',
  'Access denied',
  'Cloudflare Ray ID',
  'Please wait',
  'Humans only',
]

function classifyResult(arm: string, result: FetchResult): ArmResult {
  const contentful = CONTENTFUL_STATUS.has(result.status)
  const md = result.markdown ?? ''
  const challengeText = CHALLENGE_MARKERS.some((m) => md.includes(m))
  const falseSuccess = contentful && challengeText

  let failureClass: string | null = null
  if (!contentful) {
    if (result.blockReason === 'cloudflare_challenge' || result.blockReason === 'bot_detected_generic') failureClass = 'bot_gate'
    else if (result.blockReason === 'captcha') failureClass = 'captcha_required'
    else if (result.blockReason === 'login_wall') failureClass = 'login_required'
    else if (result.blockReason === 'rate_limit') failureClass = 'rate_limited'
    else if (result.blockReason === 'geo_restricted') failureClass = 'geo_blocked'
    else if (result.failureReason === 'provider_error') failureClass = 'provider_error'
    else if (result.trace.some((t) => t.event === 'identity_mismatch')) failureClass = 'identity_mismatch'
  }

  return {
    arm,
    status: result.status,
    blockReason: result.blockReason,
    failureReason: result.failureReason,
    failureClass,
    wallMs: result.usage.wallMs,
    tokens: result.usage.contentTokens,
    costUsd: result.usage.externalCostUsd ?? null,
    handoff: result.handoff ?? null,
    contentful,
    falseSuccess,
  }
}

const ARM_TIMEOUT_MS = 120_000

/**
 * A REAL deadline: the arm promise races a timer that rejects. The subject
 * underneath is not abortable (its own transport timeouts still apply), so a
 * timed-out arm's fetch may keep running in the background — but the REPORT
 * stops waiting, which is what the deadline is for. The subject is torn down
 * by compareChannels' finally so the session does not outlive the run.
 */
async function runArm(
  arm: string,
  fn: (signal: AbortSignal) => Promise<FetchResult>,
  timeoutMs: number = ARM_TIMEOUT_MS,
): Promise<ArmOutcome> {
  // The arm's own cancellation signal: the same deadline that stops the
  // report also reaches the vendor transport, so the navigation (and the
  // paid session behind it) knows the run is over.
  const signal = AbortSignal.timeout(timeoutMs)
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`arm ${arm} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref?.()
  })
  try {
    const result = await Promise.race([fn(signal), deadline])
    return { arm, ok: true, result: classifyResult(arm, result) }
  } catch (err) {
    return { arm, ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** A subject as tests inject it: fetch plus optional release. */
type FakeSubject = {
  fetch: (url: string, signal?: AbortSignal) => Promise<FetchResult>
  teardown?: () => Promise<void>
}

export async function compareChannels(
  urls: readonly string[],
  opts: {
    policy?: VendorPolicy
    onProgress?: (line: string) => void
    /** Test seam: arm timeout. */
    armTimeoutMs?: number
    /** Test seam: subject factories per arm, so tests need no Chromium and
     *  no vendor account. Each factory may return a subject with teardown. */
    overrides?: {
      http?: () => Promise<FakeSubject>
      browser_local?: () => Promise<FakeSubject>
      browserbase?: () => Promise<FakeSubject>
      steel?: () => Promise<FakeSubject>
    }
    keys?: { browserbase?: string; steel?: string }
  } = {},
): Promise<{ perUrl: { url: string; arms: ArmOutcome[] }[] }> {
  const log = opts.onProgress ?? (() => {})

  // Local arms always exist.
  const http = new ResilientHttpSubject()
  const browser = new BrowserLocalSubject('standard')

  // Vendor arms exist only with a key. Skipped otherwise — reported, not hidden.
  const bbKey = opts.keys?.browserbase ?? process.env.BROWSERBASE_API_KEY ?? ''
  const steelKey = opts.keys?.steel ?? process.env.STEEL_API_KEY ?? ''
  const policy = opts.policy ?? { authorized: [] }

  // ONE subject per vendor arm for the whole run, created lazily on the first
  // fetch that reaches the arm — a fresh paid session per URL would be both
  // wrong (no reuse) and expensive (a second session per comparison row).
  let bbFakeSubject: FakeSubject | null = null
  let steelFakeSubject: FakeSubject | null = null
  let httpFakeSubject: FakeSubject | null = null
  let browserFakeSubject: FakeSubject | null = null
  let bbSubject: Awaited<ReturnType<typeof vendorProviderSubject>> | null = null
  let steelSubject: Awaited<ReturnType<typeof vendorProviderSubject>> | null = null
  const bbFake = opts.overrides?.browserbase ?? null
  const steelFake = opts.overrides?.steel ?? null
  const httpFake = opts.overrides?.http ?? null
  const browserFake = opts.overrides?.browser_local ?? null

  interface Arm {
    name: string
    run: (url: string, signal?: AbortSignal) => Promise<FetchResult>
    available: boolean
    close: () => Promise<void>
  }

  // Pending subject-creation promises, so close() can await a factory that
  // was still running when the arm deadline fired — then tear the subject
  // down instead of leaking a session the run already abandoned.
  let bbFakePending: Promise<FakeSubject> | null = null
  let steelFakePending: Promise<FakeSubject> | null = null

  const arms: Arm[] = [
    {
      name: 'http',
      available: true,
      run: async (url, signal) => {
        if (httpFake !== null) {
          if (httpFakeSubject === null) httpFakeSubject = await httpFake()
          return httpFakeSubject.fetch(url, signal)
        }
        return http.fetch(url)
      },
      close: async () => {
        if (httpFakeSubject !== null) await httpFakeSubject.teardown?.()
      },
    },
    {
      name: 'browser_local',
      available: true,
      run: async (url, signal) => {
        if (browserFake !== null) {
          if (browserFakeSubject === null) browserFakeSubject = await browserFake()
          return browserFakeSubject.fetch(url, signal)
        }
        return browser.fetch(url)
      },
      close: async () => {
        await browser.teardown()
        if (browserFakeSubject !== null) await browserFakeSubject.teardown?.()
      },
    },
    {
      name: 'browserbase',
      available: bbKey !== '' || bbFake !== null,
      run: async (url, signal) => {
        if (bbFake !== null) {
          if (bbFakeSubject === null) {
            bbFakePending = bbFake().then((s) => {
              bbFakeSubject = s
              return s
            })
            bbFakeSubject = await bbFakePending
          }
          // The arm deadline may have fired while the factory was still
          // running. A fetch now would be work the run already abandoned.
          if (signal?.aborted === true) {
            throw new Error('arm cancelled before the subject was ready')
          }
          return bbFakeSubject.fetch(url, signal)
        }
        if (bbSubject === null) {
          bbSubject = await vendorProviderSubject(browserbaseOps({ apiKey: bbKey }, undefined, policy))
        }
        return bbSubject.fetch(url, signal)
      },
      close: async () => {
        if (bbFakePending !== null) {
          await bbFakePending.catch(() => {})
        }
        if (bbSubject !== null) await bbSubject.teardown()
        if (bbFakeSubject !== null) await bbFakeSubject.teardown?.()
      },
    },
    {
      name: 'steel',
      available: steelKey !== '' || steelFake !== null,
      run: async (url, signal) => {
        if (steelFake !== null) {
          if (steelFakeSubject === null) {
            steelFakePending = steelFake().then((s) => {
              steelFakeSubject = s
              return s
            })
            steelFakeSubject = await steelFakePending
          }
          // The arm deadline may have fired while the factory was still
          // running. A fetch now would be work the run already abandoned.
          if (signal?.aborted === true) {
            throw new Error('arm cancelled before the subject was ready')
          }
          return steelFakeSubject.fetch(url, signal)
        }
        if (steelSubject === null) {
          steelSubject = await vendorProviderSubject(steelOps({ apiKey: steelKey }, undefined, policy))
        }
        return steelSubject.fetch(url, signal)
      },
      close: async () => {
        if (steelFakePending !== null) {
          await steelFakePending.catch(() => {})
        }
        if (steelSubject !== null) await steelSubject.teardown()
        if (steelFakeSubject !== null) await steelFakeSubject.teardown?.()
      },
    },
  ]

  const perUrl: { url: string; arms: ArmOutcome[] }[] = []
  try {
    for (const url of urls) {
      log(`\n== ${url} ==`)
      const urlArms: ArmOutcome[] = []
      for (const arm of arms) {
        if (!arm.available) {
          urlArms.push({ arm: arm.name, ok: false, error: 'SKIPPED: no API key in environment' })
          continue
        }
        log(`  ${arm.name}...`)
        const outcome = await runArm(arm.name, (signal) => arm.run(url, signal), opts.armTimeoutMs)
        urlArms.push(outcome)
        if (outcome.result !== undefined) {
          log(
            `    ${outcome.result.status}${outcome.result.failureClass !== null ? ` (${outcome.result.failureClass})` : ''} ` +
              `${outcome.result.wallMs}ms ${outcome.result.tokens ?? '-'}tok ${outcome.result.costUsd ?? 'cost-unknown'}`,
          )
        }
      }
      perUrl.push({ url, arms: urlArms })
    }
  } finally {
    // Success, failure and timeout all land here: every arm's resources are
    // released before the report leaves this function.
    await Promise.all(arms.map((a) => a.close().catch(() => {})))
  }

  return { perUrl }
}

function summarize(perUrl: { url: string; arms: ArmOutcome[] }[]): string {
  const lines: string[] = []
  lines.push('# Live channel comparison', '')
  lines.push('| URL | arm | status | class | failure | wall | tokens | cost | handoff |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  for (const { url, arms } of perUrl) {
    for (const a of arms) {
      const r = a.result
      if (r === undefined) {
        lines.push(`| ${url} | ${a.arm} | ERROR | — | ${a.error ?? '—'} | — | — | — | — |`)
      } else {
        lines.push(
          `| ${url} | ${a.arm} | ${r.status}${r.falseSuccess ? ' (false success!)' : ''} | ${r.failureClass ?? '—'} | ${r.failureReason ?? '—'} | ${r.wallMs} | ${r.tokens ?? '—'} | ${r.costUsd ?? '—'} | ${r.handoff !== null ? 'yes' : '—'} |`,
        )
      }
    }
  }

  lines.push('', '## Summary per arm', '')
  lines.push('| arm | contentful | false success | median wall | total cost | handoffs |')
  lines.push('|---|---|---|---|---|---|')
  const armNames = ['http', 'browser_local', 'browserbase', 'steel']
  for (const name of armNames) {
    const results = perUrl
      .map((p) => p.arms.find((a) => a.arm === name)?.result)
      .filter((r): r is ArmResult => r !== undefined)
    if (results.length === 0) {
      lines.push(`| ${name} | SKIPPED | — | — | — | — |`)
      continue
    }
    const contentful = results.filter((r) => r.contentful).length
    const falsePos = results.filter((r) => r.falseSuccess).length
    const walls = results.map((r) => r.wallMs).sort((x, y) => x - y)
    const median = walls.length > 0 ? walls[Math.floor(walls.length / 2)] : null
    const cost = results.reduce((s, r) => s + (r.costUsd ?? 0), 0)
    const handoffs = results.filter((r) => r.handoff !== null).length
    lines.push(
      `| ${name} | ${contentful}/${results.length} | ${falsePos} | ${median ?? '—'} | ${cost === 0 ? '—' : cost.toFixed(4)} | ${handoffs} |`,
    )
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  const urls = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  if (urls.length === 0) {
    throw new Error('usage: w2l-live-compare <url> [url...]')
  }
  for (const url of urls) {
    try {
      new URL(url)
    } catch {
      throw new Error(`not a URL: ${url}`)
    }
  }

  console.log(`comparing ${urls.length} url(s) across http, browser_local, browserbase, steel`)
  console.log('(vendor arms run only when their API key is present; otherwise SKIPPED)')

  const { perUrl } = await compareChannels(urls, { onProgress: console.log })
  const report = summarize(perUrl)
  console.log('')
  console.log(report)
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
