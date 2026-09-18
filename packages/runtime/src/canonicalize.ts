/**
 * Crawl URL canonicalization. Dedupes tracking variants, not content.
 *
 * `/duplicate/a` and `/duplicate/c?utm_source=x` stay distinct: the path is
 * the page. Two `/duplicate/c` URLs that differ only by `utm_*` collapse.
 *
 * This is not HTTP redirect following and not content-hash dedupe.
 */

const TRACKING_PARAM = /^(utm_.*|gclid|gclsrc|fbclid|msclkid|dclid|mc_cid|mc_eid|_ga|_gl|yclid|ttclid)$/i

export function canonicalizeUrl(raw: string, base?: string): string | null {
  let parsed: URL
  try {
    parsed = base === undefined ? new URL(raw) : new URL(raw, base)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  parsed.username = ''
  parsed.password = ''
  parsed.hash = ''
  parsed.hostname = parsed.hostname.toLowerCase()

  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = ''
  }

  if (parsed.pathname === '') parsed.pathname = '/'

  const kept = [...parsed.searchParams.entries()]
    .filter(([name]) => !TRACKING_PARAM.test(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  parsed.search = ''
  for (const [name, value] of kept) parsed.searchParams.append(name, value)

  return parsed.href
}

export function hostOf(canonicalUrl: string): string {
  return new URL(canonicalUrl).hostname
}
