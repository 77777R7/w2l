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
import { qsa } from './dom.js'

interface RouterCounts {
  li: number
  a: number
  table: number
  tableInArticle: number
  article: number
  main: number
  textChars: number
  headings: number
}

function countAll(doc: Document): RouterCounts {
  return {
    li: qsa(doc, 'li').length,
    a: qsa(doc, 'a').length,
    table: qsa(doc, 'table').length,
    tableInArticle: qsa(doc, 'article table').length,
    article: qsa(doc, 'article').length,
    main: qsa(doc, 'main').length,
    headings: qsa(doc, 'h1,h2,h3').length,
    textChars: (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim().length,
  }
}

export interface RouteDecision {
  type: PageType
  /** Which strategy's result to use: 'article' | 'list' | 'table'. */
  strategy: 'article' | 'list' | 'table'
}

interface PageSignals {
  /** JSON-LD @type list. */
  jsonLdTypes: string[]
  /** itemprop attribute values across the document. */
  itemprops: string[]
  /** itemtype attribute values (microdata scope declarations). */
  itemTypes: string[]
  /** Count of <article class~="post"> elements. */
  postArticles: number
}

/** itemprop tokens that indicate a product/offer context. */
const PRICE_ITEMPROPS = ['price', 'offers', 'sku', 'gtin', 'mpn', 'brand'] as const

/** itemprop tokens that indicate a forum thread/post context. */
const POST_ITEMPROPS = ['comment', 'commentcount', 'commenttext', 'interactioncount'] as const

/**
 * Collect semantic signals BEFORE cleanTree/pruneTree removes their carriers.
 * JSON-LD @type names are lower-cased for matching; the raw graph text is
 * deliberately not kept — routing must rest on structured signals, not on
 * words inside quoted names or titles.
 */
function collectPageSignals(doc: Document): PageSignals {
  const jsonLdTypes: string[] = []
  for (const el of qsa(doc, 'script[type="application/ld+json"]')) {
    const text = (el.textContent ?? '').trim()
    if (text.length === 0) continue
    for (const m of text.matchAll(/"@type"\s*:\s*"?([A-Za-z]+)"?/g)) {
      jsonLdTypes.push(m[1]!.toLowerCase())
    }
  }
  return {
    jsonLdTypes,
    itemprops: qsa(doc, '[itemprop]').map((el) => (el.getAttribute('itemprop') ?? '').toLowerCase()),
    itemTypes: qsa(doc, '[itemtype]').map((el) => (el.getAttribute('itemtype') ?? '').toLowerCase()),
    postArticles: qsa(doc, 'article.post').length,
  }
}

function hasAny(values: readonly string[], needles: readonly string[]): boolean {
  return values.some((v) => needles.some((n) => v.includes(n)))
}

/**
 * Semantic product signals: JSON-LD Product/OfferCatalog type, microdata
 * Product/Offer scope (itemtype URL ending in the schema.org type), or
 * price/sku-style itemprops. A bare spec table is NOT a product signal —
 * that stays a collection.
 */
function hasProductSignals(s: PageSignals): boolean {
  if (s.jsonLdTypes.includes('product') || s.jsonLdTypes.includes('offercatalog')) return true
  if (s.itemprops.includes('product') || s.itemprops.includes('offer')) return true
  if (s.itemTypes.some((t) => /(?:^|\/)(product|offer|catalog)$/.test(t))) return true
  return hasAny(s.itemprops, PRICE_ITEMPROPS)
}

/**
 * Multiple posts, JSON-LD thread shapes, or microdata comment semantics.
 * A single post alone does not make a forum.
 */
function hasForumSignals(s: PageSignals): boolean {
  if (s.postArticles >= 2) return true
  if (s.jsonLdTypes.includes('discussionforumposting')) return true
  return hasAny(s.itemprops, POST_ITEMPROPS) && s.jsonLdTypes.includes('comment')
}

function routeByCounts(c: RouterCounts, s: PageSignals): RouteDecision {
  // Semantic product signals. Falls back to the table strategy when the page
  // carries a spec-table shape; the strategy handles "no table" itself.
  if (hasProductSignals(s)) {
    return c.tableInArticle === 0 && c.table >= 1
      ? { type: 'product', strategy: 'table' }
      : { type: 'product', strategy: 'article' }
  }

  // Semantic forum signals (multiple posts, DiscussionForumPosting, or
  // comment microdata). Still extracted by the article cascade.
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
  return best
}

function commonAncestor(a: Element, b: Element): Element | null {
  const ancestors = new Set<Element>()
  let p: Element | null = a.parentElement
  while (p) {
    ancestors.add(p)
    p = p.parentElement
  }
  p = b
  while (p) {
    if (ancestors.has(p)) return p
    p = p.parentElement
  }
  return null
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
