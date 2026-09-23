import { buildChannels, LadderRunner, OriginScheduler } from '@w2l/bench'
import { hostedNetworkPolicy, type FetchResult, type JsonValue, type StructuredExtractionResult } from '@w2l/contracts'
import { createExecutionScope } from '@w2l/http-core'
import { extractStructured } from '@w2l/api/structured'
import { parseHTML } from 'linkedom'
import { AMAZON_PRODUCT_SCHEMA } from './productSchema.js'

export type PreviewStatus = 'success' | 'incomplete' | 'blocked' | 'failed' | 'timeout' | 'quota_exceeded' | 'invalid_url'

export interface PreviewProduct {
  status: StructuredExtractionResult['status']
  asin: string | null
  region: string | null
  currency: string | null
  data: Record<string, unknown> | null
  issues: { code: string; message: string }[]
}

export interface PreviewResponse {
  status: PreviewStatus
  requestedUrl: string
  finalUrl: string | null
  title: string | null
  markdown: string | null
  /** Server-side total including acquisition and extraction. The UI measures round-trip time separately. */
  totalMs: number
  reason: string | null
  product?: PreviewProduct
  /** Returned only to an operator holding W2L_EVAL_TOKEN; never to visitors. */
  evaluation?: {
    rawBodySha256: string | null
    /** Same-capture witness, only emitted for a validated owner evaluation token. */
    rawHtml?: string
    fieldEvidence: { path: string; source: string; evidencePath?: string }[]
    sourceCommit?: string
    amazonStateSha256?: string
    schemaSha256?: string
    usage?: { attemptCount: number; statusRetryCount: number; retryWaitMs: number; browserMs: number; externalCostUsd: number | null }
  }
}

export interface NormalizedPreviewUrl {
  url: string
  amazonAsin: string | null
}

const AMAZON_HOSTS = new Set(['amazon.sg', 'www.amazon.sg'])
const AMAZON_ASIN_PATH = /^\/dp\/([A-Z0-9]{10})\/?$/i

/** Normalize only supported public URL forms. Do not pass visitor options to the crawler. */
export function normalizePreviewUrl(input: unknown): NormalizedPreviewUrl {
  if (typeof input !== 'string' || input.length > 2048 || input.length === 0) throw new Error('请输入不超过 2048 字符的公开网页链接。')
  let parsed: URL
  try { parsed = new URL(input) } catch { throw new Error('请输入有效的 HTTP 或 HTTPS 网页链接。') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port || !parsed.hostname) {
    throw new Error('仅支持不含账号密码或自定义端口的公开 HTTP/HTTPS 链接。')
  }
  parsed.hash = ''
  const asin = AMAZON_HOSTS.has(parsed.hostname) ? AMAZON_ASIN_PATH.exec(parsed.pathname)?.[1]?.toUpperCase() ?? null : null
  if (asin !== null) return { url: `https://www.amazon.sg/dp/${asin}`, amazonAsin: asin }
  return { url: parsed.href, amazonAsin: null }
}

export interface CaptureOutcome {
  result: FetchResult
  json?: StructuredExtractionResult
  /** Selected subject read from the hash-matched rendered DOM, not the URL. */
  selectedAsin?: string | null
  /** Present only when the caller requested a privileged evaluation. */
  rawHtml?: string
}

export type PreviewCapture = (url: NormalizedPreviewUrl, signal: AbortSignal, deadlineAt: number, amazonState: string | null, ownerEvaluation?: boolean, onRetryAfter?: (url: string, retryAt: number) => void) => Promise<CaptureOutcome>

export async function capturePreview(url: NormalizedPreviewUrl, signal: AbortSignal, deadlineAt: number, amazonState: string | null, ownerEvaluation = false, onRetryAfter?: (url: string, retryAt: number) => void): Promise<CaptureOutcome> {
  let rendered: { html: string; sha256: string } | undefined
  const policy = { ...hostedNetworkPolicy(), maxRedirects: 3, maxBodyBytes: 2 * 1024 * 1024, maxDecompressedBytes: 4 * 1024 * 1024, perHostConcurrency: 1 }
  const channels = buildChannels('standard', {
    networkPolicy: policy,
    robotsFailClosed: true,
    originScheduler: new OriginScheduler(policy),
    publicPreferenceState: url.amazonAsin === null ? null : amazonState,
    browserAllowedHosts: url.amazonAsin === null ? undefined : ['www.amazon.sg', 'm.media-amazon.com', 'images-na.ssl-images-amazon.com', 'images-eu.ssl-images-amazon.com'],
    onRenderedHtml: url.amazonAsin !== null ? (html, sha256) => { rendered = { html, sha256 } } : undefined,
    // No third-party provider calls, even if environment keys happen to exist.
    keys: {},
  }).filter(channel => channel.id === (url.amazonAsin === null ? 'http' : 'browser_local'))
  const scope = createExecutionScope({ signal, deadlineAt, onRetryAfter })
  try {
    const run = await new LadderRunner(channels, { mode: 'standard' }).run(url.url, null, scope)
    const json = url.amazonAsin === null ? undefined : await extractStructured(run.result, { type: 'json', schema: AMAZON_PRODUCT_SCHEMA, modelFallback: false }, scope, null)
    const sameCaptureHtml = rendered !== undefined && rendered.sha256 === run.result.evidence.rawBodySha256 ? rendered.html : undefined
    let selectedAsin: string | null = null
    if (sameCaptureHtml !== undefined) {
      const selected = parseHTML(sameCaptureHtml).document.querySelector('input[name="ASIN"], #ASIN')
      const value = selected?.getAttribute('value') ?? selected?.textContent
      selectedAsin = typeof value === 'string' && /^[A-Z0-9]{10}$/i.test(value.trim()) ? value.trim().toUpperCase() : null
    }
    return {
      result: run.result,
      ...(json === undefined ? {} : { json }),
      ...(url.amazonAsin === null ? {} : { selectedAsin }),
      ...(ownerEvaluation && sameCaptureHtml !== undefined ? { rawHtml: sameCaptureHtml } : {}),
    }
  } finally {
    scope.dispose()
    await Promise.allSettled(channels.map(channel => channel.close?.()))
  }
}

function jsonObject(value: JsonValue | StructuredExtractionResult['data']): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function field(data: Record<string, unknown> | null, key: string): string | null {
  const value = data?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function productView(expectedAsin: string, outcome: CaptureOutcome): PreviewProduct {
  const extraction = outcome.json
  const data = extraction ? jsonObject(extraction.data) : null
  const asin = field(data, 'asin')
  const location = field(data, 'deliveryLocation')
  const currency = field(data, 'currency')
  const identityVerified = outcome.result.document?.adapter.id === 'amazon-product'
    && outcome.result.document.adapterValidation?.valid === true && asin === expectedAsin && outcome.selectedAsin === expectedAsin
  const regionVerified = location !== null && /\bSingapore[\s,·-]*238823\b/i.test(location)
  const currencyVerified = currency === 'SGD'
  const issues: { code: string; message: string }[] = (extraction?.issues ?? []).map(issue => ({
    code: issue.code,
    message: issue.path ? `字段 ${issue.path} 暂时无法确认。` : issue.code === 'subject_unverified' ? '页面主体商品身份无法确认。' : '部分商品字段暂时无法确认。',
  }))
  if (!identityVerified) issues.push({ code: 'subject_unverified', message: '页面选中的商品 ASIN 与请求的 ASIN 未能核对一致。' })
  if (!regionVerified) issues.push({ code: location === null ? 'region_unverified' : 'region_mismatch', message: '无法确认此页面的配送地区为 Singapore 238823。' })
  if (!currencyVerified) issues.push({ code: 'currency_unverified', message: '无法确认此页面的报价币种为 SGD。' })
  const valid = outcome.result.status === 'success' && extraction?.status === 'complete' && identityVerified && regionVerified && currencyVerified
  // Do not leak a different selected product or an offer from an uncertain
  // shipping/currency context into a public price result.
  // Incomplete extraction may hide offer text inside nested specifications or
  // variants. Expose only scalar identity fields until the whole context is
  // verified; masking the two top-level price keys is insufficient.
  const safeData = !identityVerified || data === null || extraction?.status === 'invalid'
    ? null
    : valid ? data : {
      asin,
      title: field(data, 'title'),
      brand: field(data, 'brand'),
    }
  return {
    status: valid ? 'complete' : extraction?.status === 'invalid' ? 'invalid' : 'incomplete',
    asin: identityVerified ? asin : null,
    region: regionVerified ? location : null,
    currency: currencyVerified ? currency : null,
    data: safeData,
    issues,
  }
}

/** Public Amazon content is built from the checked subject record. The raw
 * page Markdown can contain unrelated offers and prices from recommendations. */
function productSummary(product: PreviewProduct): string | null {
  if (!product.asin || !product.data) return null
  const clean = (value: unknown): string | null => {
    if (typeof value !== 'string' || !value.trim()) return null
    return value.replace(/[\r\n]+/g, ' ').replace(/[\[\]()*_`]/g, '').trim()
  }
  const data = product.data
  const lines = [`# ${clean(data.title) ?? '商品页面'}`, '', `主体 ASIN：${product.asin}`]
  const add = (label: string, value: unknown): void => { const normalized = clean(value); if (normalized) lines.push(`${label}：${normalized}`) }
  add('品牌', data.brand)
  add('卖家', data.seller)
  add('库存', data.availability)
  add('配送地区', product.region)
  add('币种', product.currency)
  if (product.status === 'complete' && typeof data.price === 'number' && Number.isFinite(data.price) && product.currency === 'SGD') {
    lines.push(`价格：SGD ${data.price}`)
  }
  if (product.status !== 'complete') lines.push('', '部分商品字段仍待确认。')
  return lines.join('\n')
}

export function mapPreviewResult(requestedUrl: string, normalized: NormalizedPreviewUrl, outcome: CaptureOutcome, totalMs: number): PreviewResponse {
  const { result } = outcome
  const product = normalized.amazonAsin === null ? undefined : productView(normalized.amazonAsin, outcome)
  const status: PreviewStatus = result.status === 'blocked' ? 'blocked'
    : result.failureReason === 'timeout' || result.budgetExceeded === 'time' || result.status === 'cancelled' ? 'timeout'
      : result.status === 'success' ? product && product.status !== 'complete' ? 'incomplete' : 'success'
        : result.status === 'partial' || result.status === 'empty_verified' || (product && result.failureReason === 'identity_compromised') ? 'incomplete' : 'failed'
  const reason = status === 'success' ? null
    : status === 'blocked' ? '目标网站阻止了此次访问。'
      : status === 'timeout' ? '网页未能在试用期限内完成抓取。'
        : product && product.issues.length > 0 ? product.issues[0]!.message
          : result.failureReason ? `抓取失败（${result.failureReason}）。`
            : status === 'incomplete' ? '网页内容尚不完整。' : '暂时无法抓取此网页。'
  return {
    status,
    requestedUrl,
    finalUrl: result.evidence.finalUrl || null,
    title: result.document?.title ?? null,
    markdown: result.status === 'success' || result.status === 'partial'
      ? product === undefined ? (result.markdown?.slice(0, 1_000_000) ?? null) : productSummary(product)
      : null,
    totalMs,
    reason,
    ...(product === undefined ? {} : { product }),
  }
}

export function validateAmazonPublicState(serialized: string): void {
  let state: unknown
  try { state = JSON.parse(serialized) } catch { throw new Error('Amazon public preference state is not valid JSON') }
  if (state === null || typeof state !== 'object' || Array.isArray(state)) throw new Error('Amazon public preference state is invalid')
  const { cookies, origins } = state as Record<string, unknown>
  if (!Array.isArray(cookies) || !Array.isArray(origins)) throw new Error('Amazon public preference state is invalid')
  const scoped = (host: string) => AMAZON_HOSTS.has(host.replace(/^\./, '').toLowerCase())
  if (cookies.some(cookie => cookie === null || typeof cookie !== 'object' || Array.isArray(cookie)
    || typeof cookie.domain !== 'string' || !scoped(cookie.domain))) throw new Error('Amazon state contains out-of-scope cookies')
  if (origins.some(origin => {
    if (origin === null || typeof origin !== 'object' || Array.isArray(origin) || typeof origin.origin !== 'string') return true
    try { const url = new URL(origin.origin); return url.protocol !== 'https:' || !scoped(url.hostname) }
    catch { return true }
  })) throw new Error('Amazon state contains out-of-scope origins')
  if (!cookies.some(cookie => cookie.name === 'i18n-prefs' && cookie.value === 'SGD' && scoped(cookie.domain))) throw new Error('Amazon state lacks SGD preference')
}
