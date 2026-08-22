/**
 * Page-type router. W2L's precision headroom is on non-article pages (the
 * published ceiling for products is ~0.670 and listings ~0.71 against 0.924
 * for articles — research/extraction_precision_deep_research.md), so the
 * router decides the strategy before the block cascade runs.
 *
 * Routing runs AFTER cleanTree/pruneTree, so boilerplate (nav, aside, footer)
 * never drives a listing/collection misroute. The semantic page-type signals
 * (JSON-LD, microdata, post markup) are collected BEFORE cleaning — they live
 * in <script type="application/ld+json">, <meta>, and itemprop attributes,
 * and cleanTree strips script/form/button, which would erase them.
 *
 * Page type and strategy are independent: a product page can use the table
 * strategy, but "one standalone table" by itself never proves "product".
 */

import type { PageType } from '@w2l/contracts'
import { commonAncestor, qsa } from './dom.js'

interface RouterCounts {
  li: number
  a: number
  table: number
  tableInArticle: number
  article: number
  main: number
  textChars: number
  headings: number
  /** Links per 100 chars of visible text — div-based listings have high density. */
  linkDensity: number
}

function countAll(doc: Document): RouterCounts {
  const textChars = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim().length
  const a = qsa(doc, 'a').length
  return {
    li: qsa(doc, 'li').length,
    a,
    table: qsa(doc, 'table').length,
    tableInArticle: qsa(doc, 'article table').length,
    article: qsa(doc, 'article').length,
    main: qsa(doc, 'main').length,
    headings: qsa(doc, 'h1,h2,h3').length,
    textChars,
    linkDensity: textChars > 0 ? (a / textChars) * 100 : 0,
  }
}

export interface RouteDecision {
  type: PageType
  /** Which strategy's result to use. */
  strategy: 'article' | 'list' | 'table' | 'product'
}

export interface PageSignals {
  /** Normalized JSON-LD @type names, collected by real JSON parsing. */
  jsonLdTypes: string[]
  /** itemprop tokens (split on HTML whitespace, lower-cased). */
  itempropTokens: string[]
  /** itemtype tokens (microdata scope declarations, lower-cased). */
  itemTypeTokens: string[]
  /** Count of <article class~="post"> elements. */
  postArticles: number
}

/** itemprop tokens that indicate a product/offer context. */
const PRICE_ITEMPROPS = ['price', 'offers', 'sku', 'gtin', 'mpn', 'brand'] as const

/** Split an HTML attribute on ASCII whitespace (like itemprop tokenization). */
function splitTokens(value: string): string[] {
  return value.split(/[\t\n\f\r ]+/).filter((t) => t.length > 0)
}

/**
 * Normalize a JSON-LD @type value to its short name: strip schema.org IRI
 * prefixes ("https://schema.org/Product", "schema:Product") to the last
 * path segment or fragment, lower-cased.
 */
function normalizeTypeName(raw: string): string {
  const trimmed = raw.trim()
  const last =
    /[#/]([^#/]+)$/.exec(trimmed)?.[1] ??
    /^([^:]+):(.+)$/.exec(trimmed)?.[2] ??
    trimmed
  return last.toLowerCase()
}

/**
 * Recursively walk parsed JSON-LD (objects, arrays, @graph) and collect
 * every normalized @type. Malformed JSON is caught by the caller.
 */
function collectJsonLdTypes(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdTypes(item, out)
    return
  }
  if (typeof node !== 'object' || node === null) return
  const t = (node as Record<string, unknown>)['@type']
  if (typeof t === 'string') {
    out.push(normalizeTypeName(t))
  } else if (Array.isArray(t)) {
    for (const item of t) if (typeof item === 'string') out.push(normalizeTypeName(item))
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null) collectJsonLdTypes(value, out)
  }
}

/**
 * Collect semantic signals BEFORE cleanTree/pruneTree removes their carriers.
 * JSON-LD is parsed with JSON.parse (never regex) and walked recursively;
 * malformed scripts are ignored without throwing. itemprop/itemtype
 * attributes are split into whitespace tokens for exact, case-insensitive
 * matching — no substring includes.
 */
function collectPageSignals(doc: Document): PageSignals {
  const jsonLdTypes: string[] = []
  for (const el of qsa(doc, 'script[type="application/ld+json"]')) {
    const text = (el.textContent ?? '').trim()
    if (text.length === 0) continue
    try {
      collectJsonLdTypes(JSON.parse(text), jsonLdTypes)
    } catch {
      // Malformed JSON-LD is not a routing signal; ignore it.
    }
  }
  const itempropTokens: string[] = []
  for (const el of qsa(doc, '[itemprop]')) {
    itempropTokens.push(...splitTokens(el.getAttribute('itemprop') ?? '').map((t) => t.toLowerCase()))
  }
  const itemTypeTokens: string[] = []
  for (const el of qsa(doc, '[itemtype]')) {
    // itemtype values are IRIs (https://schema.org/Product) or bare tokens;
    // normalize to the last segment the same way JSON-LD @type names are.
    itemTypeTokens.push(
      ...splitTokens(el.getAttribute('itemtype') ?? '').map((t) => normalizeTypeName(t)),
    )
  }
  return {
    jsonLdTypes,
    itempropTokens,
    itemTypeTokens,
    postArticles: qsa(doc, 'article.post').length,
  }
}

/** Exact, case-insensitive membership across all tokens. */
function hasToken(values: readonly string[], needle: string): boolean {
  return values.includes(needle)
}

/** How many tokens from `needles` appear in `values`. */
function countTokens(values: readonly string[], needles: readonly string[]): number {
  let count = 0
  for (const n of needles) if (values.includes(n)) count++
  return count
}

/**
 * Semantic product signals, strength-weighted:
 *  - STRONG: JSON-LD Product, microdata Product scope, itemprop "product"/"offer".
 *    One is enough.
 *  - WEAK: price/sku/gtin/mpn/brand-style itemprops. Needs >=2 independent ones.
 *  - OfferCatalog (JSON-LD or microdata) is a CATALOG, not a single product:
 *    routed to collection.
 * A bare spec table is never a product signal — it stays a collection.
 */
function hasProductSignals(s: PageSignals): boolean {
  const strong =
    hasToken(s.jsonLdTypes, 'product') ||
    hasToken(s.itemTypeTokens, 'product') ||
    hasToken(s.itempropTokens, 'product') ||
    hasToken(s.itempropTokens, 'offer')
  if (strong) return true
  return countTokens(s.itempropTokens, PRICE_ITEMPROPS) >= 2
}

function hasOfferCatalogSignals(s: PageSignals): boolean {
  return hasToken(s.jsonLdTypes, 'offercatalog') || hasToken(s.itemTypeTokens, 'offercatalog')
}

/**
 * Multiple posts, or DiscussionForumPosting. Plain JSON-LD Comment / a
 * comment section on an article does NOT make a forum.
 */
function hasForumSignals(s: PageSignals): boolean {
  if (s.postArticles >= 2) return true
  if (hasToken(s.jsonLdTypes, 'discussionforumposting')) return true
  return hasToken(s.jsonLdTypes, 'forum') || hasToken(s.itemTypeTokens, 'forum')
}

function routeByCounts(c: RouterCounts, s: PageSignals): RouteDecision {
  // Semantic product signals get the dedicated PDP strategy: a product page's
  // payload is a name/price/spec region, not the longest run of prose, and
  // scoring by text volume on a PDP reliably picks the recommendation grid.
  // The strategy reports null when no defensible product region exists, and
  // the extractor falls back to the article cascade — recording the strategy
  // that actually produced the output, not the one it hoped for.
  if (hasProductSignals(s)) {
    return { type: 'product', strategy: 'product' }
  }

  // OfferCatalog is a collection of products, not one product.
  if (hasOfferCatalogSignals(s)) {
    return { type: 'collection', strategy: 'article' }
  }

  // Semantic forum signals (multiple posts, DiscussionForumPosting).
  // Still extracted by the article cascade.
  if (hasForumSignals(s)) return { type: 'forum', strategy: 'article' }

  // A page whose only structure is one standalone table (readings, schedules,
  // dashboards). Tables inside <article> stay on the article cascade.
  if (c.tableInArticle === 0 && c.table === 1 && c.li < 10 && c.a < 20 && c.headings <= 2) {
    return { type: 'collection', strategy: 'table' }
  }

  // Several tables with little prose: a comparison/dashboard page.
  if (c.tableInArticle === 0 && c.table >= 2 && c.li < 15) {
    return { type: 'collection', strategy: 'table' }
  }

  // Link farm: most content is a list of links.
  if (c.li >= 6 && c.a >= 6 && c.textChars < 2000) {
    return { type: 'listing', strategy: 'list' }
  }

  // Div-based listing: no <li> structure, but a high link density means the
  // page IS its links (quotes.toscrape.com: 55 links/1702 chars = 3.2/100;
  // Wikipedia prose: ~1/100). The list strategy falls back to picking the
  // densest link container when no ul/ol qualifies.
  if (c.a >= 15 && c.linkDensity >= 2 && c.table === 0 && c.article === 0) {
    return { type: 'listing', strategy: 'list' }
  }

  // Small collection page: some linked sections, not a dominant list.
  if (c.li >= 4 && c.a >= 4 && c.textChars < 2000) {
    return { type: 'collection', strategy: 'article' }
  }

  // Long multi-heading pages with many sections and links are collections.
  if (c.textChars > 3000 && c.headings >= 5 && c.a >= 20) {
    return { type: 'collection', strategy: 'article' }
  }

  // Everything else runs the article cascade; when it finds no blocks the
  // result escalates (empty shell, genuinely empty page).
  return { type: 'article', strategy: 'article' }
}

/**
 * Collect pre-clean semantic signals for the page being routed. Extract
 * calls this once on the raw document, before cleanTree/pruneTree, so
 * script/meta-carried signals survive to routePage.
 */
export function pageSignalsFor(doc: Document): PageSignals {
  return collectPageSignals(doc)
}

/**
 * Route the page to a page type + strategy. `signals` are the pre-clean
 * semantic signals; when omitted they are collected from the current tree
 * (so direct routePage callers keep working on already-cleaned documents).
 */
export function routePage(doc: Document, signals: PageSignals = collectPageSignals(doc)): RouteDecision {
  return routeByCounts(countAll(doc), signals)
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/** The article cascade: blocks -> semantic/container scoring (unchanged). */
export { selectMain } from './main.js'

/**
 * Listing strategy: the ordered/unordered list whose items share a common
 * link-plus-text shape. Returns the list element, or null.
 */
export function selectList(doc: Document): Element | null {
  let best: Element | null = null
  let bestItems = 0
  for (const el of qsa(doc, 'ul,ol')) {
    const items = qsa(el, ':scope > li')
    const linked = items.filter((li) => qsa(li, 'a').length > 0).length
    if (linked >= 3 && linked >= items.length * 0.6 && linked > bestItems) {
      bestItems = linked
      best = el
    }
  }
  if (best) return best

  // Div-based listings: no list markup, but the page's content is a set of
  // link-carrying sibling cards. Pick the container with the most linked
  // children, preferring the DEEPEST qualifying one so the whole page
  // wrapper doesn't win by aggregate link count.
  let bestDiv: Element | null = null
  let bestDivDepth = -1
  let bestDivLinks = 0
  for (const el of qsa(doc, 'div,section')) {
    const kids = Array.from(el.children)
    const linkedKids = kids.filter((k) => qsa(k, 'a').length > 0).length
    if (linkedKids < 3) continue
    let depth = 0
    for (let p = el.parentElement; p; p = p.parentElement) depth++
    if (linkedKids > bestDivLinks || (linkedKids === bestDivLinks && depth > bestDivDepth)) {
      bestDivLinks = linkedKids
      bestDivDepth = depth
      bestDiv = el
    }
  }
  return bestDiv
}

/**
 * Table strategy: the main data table of a table page. Skips layout tables
 * (single cell, no data cells) and hidden/empty tables. When a lone page
 * heading shares a container with the table (product pages: title + specs),
 * that container is returned instead so the title survives.
 */
export function selectTable(doc: Document): Element | null {
  const tables = qsa(doc, 'table')
  if (tables.length === 0) return null
  const dataTables = tables.filter((t) => {
    const rows = qsa(t, 'tr')
    if (rows.length < 2) return false
    return qsa(t, 'td,th').length >= 4
  })
  if (dataTables.length === 0) return null
  const table = dataTables.sort(
    (a, b) => qsa(b, 'td,th').length - qsa(a, 'td,th').length,
  )[0]!

  const h1s = qsa(doc, 'h1')
  if (h1s.length === 1 && !table.contains(h1s[0]!)) {
    const lca = commonAncestor(table, h1s[0]!)
    if (lca && lca !== doc.body && lca !== doc.documentElement) return lca
  }
  return table
}

/**
 * Minimal extraction for pages with no recognizable shape: the page heading.
 * Used by callers that want a graceful small result; the extractor itself
 * falls back to the article cascade instead (a page whose only content is a
 * heading should escalate, not be reported as content).
 */
export function selectMinimal(doc: Document): Element | null {
  return doc.querySelector('h1') ?? doc.querySelector('h2,h3')
}
