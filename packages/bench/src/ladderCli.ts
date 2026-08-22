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
 *
 * Handoff: when a captcha/login wall is hit and a vendor live view exists,
 * the ladder prints the live-view URL and stops — a human takes over in the
 * vendor's UI; there is deliberately no in-terminal prompt pretending to be
 * that human.
 */

import { pathToFileURL } from 'node:url'
import type { FetchResult } from '@w2l/contracts'
import { LadderRunner, type Channel } from './routing/ladder.js'
import type { GovernedMode } from '@w2l/http-core'
import { ResilientHttpSubject } from './subjects/resilientHttp.js'
import { BrowserLocalSubject } from './subjects/browserLocal.js'
import { connectVendor } from './vendors/connect.js'
import { browserbaseOps } from './vendors/browserbase.js'
import { steelOps } from './vendors/steel.js'

interface Args {
  url: string
  mode: GovernedMode
  allowlistedDomains: string[]
}

export function parseArgs(argv: readonly string[]): Args {
  let mode: GovernedMode = 'standard'
  let allowlistedDomains: string[] = []
  const positional: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--research') mode = 'research'
    else if (arg === '--authed') mode = 'authed'
    else if (arg.startsWith('--allowlist-hosts')) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++i]!
      allowlistedDomains = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown flag ${arg}`)
    } else {
      positional.push(arg)
    }
  }

  const url = positional[0]
  if (url === undefined) throw new Error('usage: w2l-fetch [--research|--authed] <url>')
  try {
    new URL(url)
  } catch {
    throw new Error(`not a URL: ${url}`)
  }
  return { url, mode, allowlistedDomains }
}

export async function buildChannels(mode: GovernedMode): Promise<Channel[]> {
  // One subject per channel for the life of the run. A fresh Chromium per
  // fetch would be both slow and leaky; the channel's close() is what tears
  // the browser down at the end.
  const http = new ResilientHttpSubject()
  const browser = new BrowserLocalSubject('standard')

  const channels: Channel[] = [
    { id: 'http', fetch: (url) => http.fetch(url), close: async () => {} },
    {
      id: 'browser_local',
      fetch: (url) => browser.fetch(url),
      close: async () => {
        await browser.teardown()
      },
    },
  ]

  // Vendor channels exist only when a key is present AND the mode permits
  // the provider lane. No key => the rung does not exist, and the report
  // says so rather than pretending it ran.
  if (mode === 'standard') return channels

  const bbKey = process.env.BROWSERBASE_API_KEY ?? ''
  const steelKey = process.env.STEEL_API_KEY ?? ''
  const { ProviderSubject } = await import('./subjects/provider.js')

  if (bbKey !== '') {
    const { declaration, transport } = await connectVendor(browserbaseOps({ apiKey: bbKey }))
    const subject = new ProviderSubject(declaration, transport)
    channels.push({
      id: 'provider',
      vendorId: 'browserbase',
      fetch: (url) => subject.fetch(url),
      close: async () => {
        await transport.close()
      },
    })
  }
  if (steelKey !== '') {
    const { declaration, transport } = await connectVendor(steelOps({ apiKey: steelKey }))
    const subject = new ProviderSubject(declaration, transport)
    channels.push({
      id: 'provider',
      vendorId: 'steel',
      fetch: (url) => subject.fetch(url),
      close: async () => {
        await transport.close()
      },
    })
  }

  return channels
}

function describe(result: FetchResult): string {
  const parts = [`status=${result.status}`]
  if (result.blockReason !== null) parts.push(`block=${result.blockReason}`)
  if (result.failureReason !== null) parts.push(`failure=${result.failureReason}`)
  if (result.lane !== null) parts.push(`lane=${result.lane}`)
  return parts.join(' ')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const channels = await buildChannels(args.mode)

  console.log(`ladder mode : ${args.mode}`)
  console.log(`channels    : ${channels.map((c) => (c.vendorId !== undefined ? `${c.id}(${c.vendorId})` : c.id)).join(' → ')}`)
  console.log(`target      : ${args.url}`)

  const runner = new LadderRunner(channels, {
    mode: args.mode,
    allowlistedDomains: args.allowlistedDomains.length > 0 ? args.allowlistedDomains : undefined,
  })

  try {
    const run = await runner.run(args.url)
    console.log('')
    console.log(`tried       : ${run.channelsTried.join(' → ')}`)
    console.log(`outcome     : ${describe(run.result)}`)
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
  } finally {
    // The browser owns a Chromium process; leaving it alive is what makes a
    // CLI that "worked" hang forever.
    await Promise.all(channels.map((c) => c.close?.().catch(() => {})))
  }
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
