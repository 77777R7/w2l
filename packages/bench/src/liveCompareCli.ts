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

async function runArm(arm: string, fn: () => Promise<FetchResult>): Promise<ArmOutcome> {
  const timer = setTimeout(() => {
    // The fetch itself is not cancellable here; the timeout bounds the WAIT.
    // The subject's own transport timeouts still apply inside.
  }, ARM_TIMEOUT_MS)
  timer.unref?.()
  try {
    const result = await fn()
    clearTimeout(timer)
    return { arm, ok: true, result: classifyResult(arm, result) }
  } catch (err) {
    clearTimeout(timer)
    return { arm, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function compareChannels(
  urls: readonly string[],
  opts: {
    policy?: VendorPolicy
    onProgress?: (line: string) => void
  } = {},
): Promise<{ perUrl: { url: string; arms: ArmOutcome[] }[] }> {
  const log = opts.onProgress ?? (() => {})

  // Local arms always exist.
  const http = new ResilientHttpSubject()
  const browser = new BrowserLocalSubject('standard')

  // Vendor arms exist only with a key. Skipped otherwise — reported, not hidden.
  const bbKey = process.env.BROWSERBASE_API_KEY ?? ''
  const steelKey = process.env.STEEL_API_KEY ?? ''
  const policy = opts.policy ?? { authorized: [] }

  const arms: { name: string; run: (url: string) => Promise<FetchResult>; available: boolean }[] = [
    {
      name: 'http',
      available: true,
      run: (url) => http.fetch(url),
    },
    {
      name: 'browser_local',
      available: true,
      run: (url) => browser.fetch(url),
    },
    {
      name: 'browserbase',
      available: bbKey !== '',
      run: async (url) => {
        const subject = await vendorProviderSubject(browserbaseOps({ apiKey: bbKey }, undefined, policy))
        return subject.fetch(url)
      },
    },
    {
      name: 'steel',
      available: steelKey !== '',
      run: async (url) => {
        const subject = await vendorProviderSubject(steelOps({ apiKey: steelKey }, undefined, policy))
        return subject.fetch(url)
      },
    },
  ]

  const perUrl: { url: string; arms: ArmOutcome[] }[] = []
  for (const url of urls) {
    log(`\n== ${url} ==`)
    const urlArms: ArmOutcome[] = []
    for (const arm of arms) {
      if (!arm.available) {
        urlArms.push({ arm: arm.name, ok: false, error: 'SKIPPED: no API key in environment' })
        continue
      }
      log(`  ${arm.name}...`)
      const outcome = await runArm(arm.name, () => arm.run(url))
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

  await browser.teardown()
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
