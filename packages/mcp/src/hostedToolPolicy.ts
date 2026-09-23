import { parseMonitorRevision, type JsonSchema } from '@w2l/contracts'

/** One owner, two reviewed workflows. The remote endpoint never accepts an
 * arbitrary URL, browser session, model prompt, or caller-selected schema. */
export const REMOTE_TOOLS = new Set([
  'scrape', 'scrape_product', 'batch_scrape', 'batch_products', 'get_batch', 'get_batch_items', 'wait_batch', 'cancel_batch',
  'preview_monitor', 'create_monitor', 'list_monitors', 'get_monitor', 'run_monitor',
  'get_monitor_run', 'pause_monitor', 'resume_monitor', 'cancel_monitor_run',
  'create_delivery_destination', 'list_delivery_destinations', 'pause_delivery_destination',
  'resume_delivery_destination', 'list_deliveries', 'get_delivery', 'retry_dead_letter',
])

const DOCUMENT_HOSTS = new Set(['docs.firecrawl.dev', 'modelcontextprotocol.io'])
const AMAZON_HOST = 'www.amazon.sg'
const AMAZON_PATH = /^\/dp\/([A-Z0-9]{10})\/?$/i

function record(args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('tool arguments must be an object')
  return args as Record<string, unknown>
}

function onlyKeys(input: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error('unsupported remote tool option')
}

function url(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('a public HTTPS URL is required')
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new Error('a public HTTPS URL is required') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hash) throw new Error('a public HTTPS URL is required')
  return parsed
}

export function hostedAmazonUrl(value: unknown): string {
  const parsed = url(value)
  const asin = parsed.hostname === AMAZON_HOST ? AMAZON_PATH.exec(parsed.pathname)?.[1]?.toUpperCase() : null
  if (!asin) throw new Error('remote product capture supports Amazon.sg /dp/{ASIN} only')
  // Stable product identity and context: strip referral, tracking and caller
  // query parameters. The browser may add a witnessed selection follow-up.
  return `https://${AMAZON_HOST}/dp/${asin}`
}

export function hostedDocumentUrl(value: unknown): string {
  const parsed = url(value)
  if (!DOCUMENT_HOSTS.has(parsed.hostname)) throw new Error('remote Monitor source is outside the public documentation allowlist')
  return parsed.href
}

export function normalizeHostedToolCall(name: string, args: unknown, receiverUrl: string, schema: JsonSchema): unknown {
  if (!REMOTE_TOOLS.has(name)) throw new Error('tool not available in this deployment')
  const input = record(args)
  if (name === 'scrape_product') {
    onlyKeys(input,['url','debug'])
    if (input.debug !== undefined && typeof input.debug !== 'boolean') throw new Error('debug must be a boolean')
    return {url:hostedAmazonUrl(input.url),debug:input.debug === true}
  }
  if (name === 'batch_products') {
    onlyKeys(input,['urls'])
    if (!Array.isArray(input.urls) || input.urls.length < 1 || input.urls.length > 1000) throw new Error('batch requires 1..1000 Amazon.sg URLs')
    const urls=input.urls.map(hostedAmazonUrl)
    if(new Set(urls).size!==urls.length)throw new Error('batch URLs must be unique by ASIN')
    return {urls}
  }
  if (name === 'scrape') {
    onlyKeys(input, ['url', 'mode', 'formats', 'includeLinks', 'debug'])
    if (input.mode !== undefined && input.mode !== 'standard') throw new Error('remote product capture uses standard anonymous mode')
    if (input.formats !== undefined && JSON.stringify(input.formats) !== '["json"]') throw new Error('remote product capture uses the fixed product JSON schema')
    if (input.includeLinks !== undefined && input.includeLinks !== false) throw new Error('remote product capture does not return links')
    if (input.debug !== undefined && typeof input.debug !== 'boolean') throw new Error('debug must be a boolean')
    return {url:hostedAmazonUrl(input.url),mode:'standard',formats:[{type:'json',schema,modelFallback:false}],debug:input.debug === true}
  }
  if (name === 'batch_scrape') {
    onlyKeys(input, ['urls', 'mode', 'formats', 'includeLinks'])
    if (input.mode !== undefined && input.mode !== 'standard') throw new Error('remote product batches use standard anonymous mode')
    if (input.formats !== undefined && JSON.stringify(input.formats) !== '["json"]') throw new Error('remote product batches use the fixed product JSON schema')
    if (input.includeLinks !== undefined && input.includeLinks !== false) throw new Error('remote product batches do not return links')
    if (!Array.isArray(input.urls) || input.urls.length < 1 || input.urls.length > 1000) throw new Error('batch requires 1..1000 Amazon.sg URLs')
    const urls = input.urls.map(hostedAmazonUrl)
    if (new Set(urls).size !== urls.length) throw new Error('batch URLs must be unique by ASIN')
    return {urls,mode:'standard',formats:[{type:'json',schema,modelFallback:false}],includeLinks:false}
  }
  if (name === 'preview_monitor' || name === 'create_monitor') {
    if (input.preset === 'firecrawl-introduction') {
      onlyKeys(input, ['preset', 'enabled'])
      if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('enabled must be a boolean')
      return input
    }
    onlyKeys(input, ['monitorId', 'revision', 'url', 'ruleVersion', 'intervalMs', 'staleAfterMs', 'config', 'enabled'])
    const source = hostedDocumentUrl(input.url)
    if (!Number.isSafeInteger(input.intervalMs) || (input.intervalMs as number) < 900_000) throw new Error('remote Monitor interval must be at least 15 minutes')
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('enabled must be a boolean')
    const config = input.config
    if (config === null || typeof config !== 'object' || Array.isArray(config) || (config as Record<string, unknown>).captureMode !== 'http') {
      throw new Error('remote documentation Monitor requires explicit captureMode: http')
    }
    const normalized = {...input,url:source}
    parseMonitorRevision({...normalized,createdAt:Date.now()})
    return normalized
  }
  if (name === 'create_delivery_destination') {
    if (input.url !== receiverUrl || input.secretEnv !== 'W2L_WEBHOOK_SECRET_DEMO') throw new Error('remote pilot only supports the controlled HTTPS receiver and configured secret reference')
    if (input.maxAttempts !== undefined && (!Number.isSafeInteger(input.maxAttempts) || (input.maxAttempts as number) > 8)) throw new Error('remote delivery maxAttempts must be at most 8')
    return input
  }
  if (name === 'wait_batch' && input.timeoutMs !== undefined && (!Number.isSafeInteger(input.timeoutMs) || (input.timeoutMs as number) > 30_000)) throw new Error('remote wait_batch timeout must be at most 30000ms')
  return input
}
