#!/usr/bin/env node
/**
 * Provider lane entry point: point a real vendor session at a real URL and
 * print what came back, including the compliance record and whether its
 * ledger verifies.
 *
 * This is deliberately NOT part of `w2l-bench`. That runner drives a fixture
 * server on loopback, and a vendor's browser runs in the vendor's cloud — it
 * cannot reach 127.0.0.1, so a provider arm in the fixture suite would either
 * fail every case or need a tunnel that no longer measures the fixture. The
 * two are separate because the thing being measured is separate.
 *
 * Nothing here has a dry-run mode. A provider run without a vendor session is
 * not a smaller version of this, it is a different thing, and printing a
 * plausible-looking record for a fetch that never happened is the exact
 * failure this product exists to avoid.
 *
 *   BROWSERBASE_API_KEY=... w2l-provider https://example.com/some/page
 *   STEEL_API_KEY=...       w2l-provider --vendor steel https://example.com/p
 */

import { pathToFileURL } from 'node:url'
import { verifyLedger } from '@w2l/http-core'
import { ProviderSubject } from './subjects/provider.js'
import { browserbaseOps } from './vendors/browserbase.js'
import { steelOps } from './vendors/steel.js'
import { fetchVendorApi } from './vendors/api.js'
import { connectVendor } from './vendors/connect.js'
import type { VendorOps } from './vendors/transport.js'

export interface Args {
  url: string
  vendor: 'browserbase' | 'steel'
  /** Enable session_persistence: reuse a saved vendor context/profile. */
  persistSession: boolean
  /** Enable live_view_handoff: open the live-view door for human takeover. */
  liveView: boolean
}

export function parseArgs(argv: readonly string[]): Args {
  let vendor: Args['vendor'] | null = null
  let persistSession = false
  let liveView = false
  const positional: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--vendor') {
      const value = argv[++i]
      if (value !== 'browserbase' && value !== 'steel') {
        throw new Error(`--vendor must be browserbase or steel, got ${value ?? '(nothing)'}`)
      }
      vendor = value
    } else if (arg.startsWith('--vendor=')) {
      const value = arg.slice('--vendor='.length)
      if (value !== 'browserbase' && value !== 'steel') {
        throw new Error(`--vendor must be browserbase or steel, got ${value}`)
      }
      vendor = value
    } else if (arg === '--persist-session') {
      persistSession = true
    } else if (arg === '--live-view') {
      liveView = true
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown flag ${arg}`)
    } else {
      positional.push(arg)
    }
  }

  const url = positional[0]
  if (url === undefined) throw new Error('usage: w2l-provider [--vendor browserbase|steel] [--persist-session] [--live-view] <url>')
  try {
    new URL(url)
  } catch {
    throw new Error(`not a URL: ${url}`)
  }

  // Inferred from whichever key is present, so the common case needs no flag —
  // but never guessed when both are set, because picking one silently would
  // bill an account the operator did not name.
  if (vendor === null) {
    const hasBb = (process.env.BROWSERBASE_API_KEY ?? '') !== ''
    const hasSteel = (process.env.STEEL_API_KEY ?? '') !== ''
    if (hasBb && hasSteel) {
      throw new Error(
        'both BROWSERBASE_API_KEY and STEEL_API_KEY are set; pass --vendor to say which to bill',
      )
    }
    if (!hasBb && !hasSteel) {
      throw new Error('set BROWSERBASE_API_KEY or STEEL_API_KEY (no vendor credential in the environment)')
    }
    vendor = hasBb ? 'browserbase' : 'steel'
  }

  return { url, vendor, persistSession, liveView }
}

function opsFor(args: Args): VendorOps {
  // The policy the vendor adapters evaluate. Only the two authorizable
  // capabilities can ever be turned on, and only by an explicit operator
  // flag on this CLI — never by a default.
  const policy = {
    authorized: [
      ...(args.persistSession ? ['session_persistence'] : []),
      ...(args.liveView ? ['live_view_handoff'] : []),
    ] as const,
  }
  if (args.vendor === 'browserbase') {
    const apiKey = process.env.BROWSERBASE_API_KEY ?? ''
    if (apiKey === '') throw new Error('BROWSERBASE_API_KEY is not set')
    const projectId = process.env.BROWSERBASE_PROJECT_ID
    return browserbaseOps({ apiKey, ...(projectId ? { projectId } : {}) }, fetchVendorApi, policy)
  }
  const apiKey = process.env.STEEL_API_KEY ?? ''
  if (apiKey === '') throw new Error('STEEL_API_KEY is not set')
  return steelOps({ apiKey }, fetchVendorApi, policy)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  // Resolved before anything is announced, so a missing key never prints a
  // line claiming we opened something.
  const ops = opsFor(args)

  console.log(`vendor : ${args.vendor}`)
  console.log(`target : ${args.url}`)
  // The flags' observable effect: what the policy layer decided. Session
  // persistence and live view appear here only when the operator asked for
  // them — a run with neither flag must say exactly that.
  const enabled = ops.decision.enabled.map((c) => c.capability)
  console.log(
    `policy : ${enabled.length > 0 ? enabled.join(', ') : 'route capabilities only (no persistence, no live view)'}`,
  )
  console.log('opening session (captcha solving and fingerprint forging declined)...')

  const { declaration, transport } = await connectVendor(ops)
  // Printed before the fetch, because this is the string the gate is about to
  // evaluate robots.txt against — and it is the vendor's own, measured off the
  // live session, not one we picked. Expect HeadlessChrome. That is the point.
  console.log(`measured UA : ${declaration.declaredUserAgent}`)
  const subject = new ProviderSubject(declaration, transport)

  try {
    const result = await subject.fetch(args.url)

    console.log('')
    console.log(`status         : ${result.status}`)
    console.log(`failureReason  : ${result.failureReason ?? '-'}`)
    console.log(`blockReason    : ${result.blockReason ?? '-'}`)
    console.log(`httpStatus     : ${result.evidence.httpStatus ?? '-'}`)
    console.log(`finalUrl       : ${result.evidence.finalUrl}`)
    console.log(`contentTokens  : ${result.usage.contentTokens ?? '-'}`)
    console.log(`wallMs         : ${result.usage.wallMs}`)
    console.log(`vendor cost    : ${result.usage.externalCostUsd ?? 'not reported by vendor'}`)

    const record = result.compliance
    if (record !== null) {
      console.log('')
      console.log('robots')
      console.log(`  url          : ${record.robots.robotsUrl ?? '-'}`)
      console.log(`  sha256       : ${record.robots.robotsSha256 ?? '-'}`)
      console.log(`  matchedGroup : ${record.robots.matchedUserAgentGroup ?? '-'}`)
      console.log(`  decision     : ${record.robots.decision}`)
      const rules = record.robots.appliedRules
        .map((r) => `${r.allow ? 'Allow' : 'Disallow'}: ${r.pattern}`)
        .join('  ')
      console.log(`  appliedRules : ${rules || '-'}`)
      console.log('sent headers')
      for (const h of record.sentHeaders.headers) console.log(`  ${h.name}: ${h.value}`)
    }

    // The identity events are the point of the lane, so they are surfaced
    // rather than buried in the trace: a mismatch means the request carried an
    // identity the gate never cleared, and "unobserved" is not agreement.
    for (const event of result.trace) {
      if (event.event === 'identity_mismatch' || event.event === 'identity_unobserved') {
        console.log('')
        console.log(`identity: ${event.event} ${JSON.stringify(event.detail)}`)
      }
    }

    const ledger = subject.ledger()
    console.log('')
    console.log(`ledger : ${ledger.records.length} record(s), verified=${verifyLedger(ledger).valid}`)

    if (result.markdown !== null) {
      console.log('')
      console.log('--- extracted ---')
      console.log(result.markdown.slice(0, 2000))
    }
  } finally {
    // Always: an unreleased session keeps running on the vendor's meter.
    await subject.teardown()
  }
}

// Guarded so a test can import `parseArgs` without the CLI opening a vendor
// session as a side effect of the import.
const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}