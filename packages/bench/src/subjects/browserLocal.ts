import { estimateTokens, type FetchResult, type TraceEvent } from '@w2l/contracts'
import { extractTf } from '@w2l/extract-tf'
import { toGfmTable } from '@w2l/fixtures'
import { chromium, type Browser } from 'playwright'
import type { SubjectAdapter } from '../subject.js'
import { POLITE_UA } from '../ua.js'

/**
 * Browser-local subject: the escalation target the http lane flags into.
 * Direct Playwright (ADR 0001) — one headless Chromium per run, one fresh
 * page per case, real script execution, real fingerprint, polite UA.
 *
 * The rendered DOM goes through the SAME extract-tf cascade as the http
 * arms, so any score delta against resilient-http is attributable to
 * render-and-execute alone. This is the tier-2 canary's whole question:
 * how much of the bot-gated / JS-shell wall does a real browser clear?
 */
export class BrowserLocalSubject implements SubjectAdapter {
  readonly meta = {
    id: 'browser-local',
    displayName: 'browser-local (playwright chromium × extract-tf)',
    version: '0.1.0',
    hosting: 'self_hosted' as const,
  }

  private browser: Browser | null = null

  async fetch(url: string): Promise<FetchResult> {
    const start = Date.now()
    const trace: TraceEvent[] = [{ at: 0, lane: 'browser_local', event: 'browser_start' }]
    const browser = await this.getBrowser()

    let context
    let page
    try {
      context = await browser.newContext({ userAgent: POLITE_UA })
      page = await context.newPage()
      trace.push({ at: Date.now() - start, lane: 'browser_local', event: 'navigate', detail: { url } })
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      // Give JS shells a beat to render after first paint; networkidle never
      // fires on long-polling pages, so use a bounded settle instead.
      await page.waitForTimeout(1500)
      const status = response?.status() ?? 0
      const finalUrl = page.url()
      const body = await page.content()
      const wallMs = Date.now() - start
      const browserMs = wallMs
      trace.push({ at: wallMs, lane: 'browser_local', event: 'rendered', detail: { status } })

      const base = {
        requestedUrl: url,
        truncated: false,
        truncatedAt: null,
        evidence: {
          finalUrl,
          httpStatus: status,
          redirectChain: finalUrl !== url ? [url, finalUrl] : [],
          contentType: 'text/html; rendered',
          rawBodySha256: null,
          artifacts: [],
        },
        usage: {
          wallMs,
          bytesWire: Buffer.byteLength(body),
          bytesDecompressed: Buffer.byteLength(body),
          requestCount: 1,
          attemptCount: 1,
          contentTokens: null as number | null,
          browserMs,
          externalCostUsd: null,
        },
        trace,
      }

      if (status === 429) {
        return {
          ...base,
          status: 'blocked',
          failureReason: null,
          blockReason: 'rate_limit',
          budgetExceeded: null,
          lane: 'browser_local',
          escalations: [],
          markdown: null,
        }
      }
      if (status !== 200 && status !== 0) {
        return {
          ...base,
          status: 'failed',
          failureReason: 'http_error',
          blockReason: null,
          budgetExceeded: null,
          lane: 'browser_local',
          escalations: [],
          markdown: null,
        }
      }

      const extracted = extractTf.extract(body)
      trace.push({
        at: wallMs,
        lane: 'browser_local',
        event: 'extract',
        detail: {
          pageType: extracted.pageType,
          strategy: extracted.strategy,
          confidence: extracted.confidence,
          escalate: extracted.escalate,
        },
      })

      if (extracted.escalate) {
        return {
          ...base,
          status: 'failed',
          failureReason: 'empty_unverified',
          blockReason: null,
          budgetExceeded: null,
          lane: 'browser_local',
          escalations: [],
          markdown: null,
        }
      }

      const markdown = extracted.mainHtml.replace(
        /<table\b[\s\S]*?<\/table>/gi,
        (table) => `\n${toGfmTable(table)}\n`,
      )
      return {
        ...base,
        status: 'success',
        failureReason: null,
        blockReason: null,
        budgetExceeded: null,
        lane: 'browser_local',
        escalations: [],
        markdown,
        usage: { ...base.usage, contentTokens: estimateTokens(markdown) },
      }
    } catch (err) {
      const wallMs = Date.now() - start
      trace.push({
        at: wallMs,
        lane: 'browser_local',
        event: 'navigate_failed',
        detail: { error: err instanceof Error ? err.message.slice(0, 200) : String(err) },
      })
      return {
        requestedUrl: url,
        status: 'failed',
        failureReason: 'connection_error',
        blockReason: null,
        budgetExceeded: null,
        lane: 'browser_local',
        escalations: [],
        markdown: null,
        truncated: false,
        truncatedAt: null,
        evidence: {
          finalUrl: url,
          httpStatus: null,
          redirectChain: [],
          contentType: null,
          rawBodySha256: null,
          artifacts: [],
        },
        usage: {
          wallMs,
          bytesWire: 0,
          bytesDecompressed: 0,
          requestCount: 1,
          attemptCount: 1,
          contentTokens: null,
          browserMs: wallMs,
          externalCostUsd: null,
        },
        trace,
      }
    } finally {
      await page?.close().catch(() => {})
      await context?.close().catch(() => {})
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true })
    }
    return this.browser
  }

  async teardown(): Promise<void> {
    await this.browser?.close().catch(() => {})
    this.browser = null
  }
}
