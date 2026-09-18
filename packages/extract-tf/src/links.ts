/**
 * Crawl link harvest from the FULL document.
 *
 * Extract-tf prune drops nav/footer before mainHtml is selected. Discovery
 * must run on the original HTML, after extract, before that HTML is dropped.
 * This is not markdown conversion and not main-content extraction.
 */

import { parse, qsa } from './dom.js'

export function collectLinks(html: string, baseUrl: string): readonly string[] {
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return []
  }

  const doc = parse(html)
  const seen = new Set<string>()
  const links: string[] = []
  for (const a of qsa(doc.document, 'a[href]')) {
    const href = a.getAttribute('href')?.trim()
    if (href === undefined || href.length === 0) continue
    let resolved: URL
    try {
      resolved = new URL(href, base)
    } catch {
      continue
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue
    resolved.hash = ''
    const abs = resolved.href
    if (seen.has(abs)) continue
    seen.add(abs)
    links.push(abs)
  }
  doc.close()
  return links
}
