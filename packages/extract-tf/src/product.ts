/**
 * Product-detail-page (PDP) extraction.
 *
 * Two jobs the article cascade cannot do:
 *
 *  1. FACTS. A PDP's payload is not prose — it is a name, a price, a currency,
 *     a SKU, availability. The cascade emits mainHtml and leaves a consumer to
 *     re-read the price out of rendered text. This module reads it once, from
 *     the strongest evidence the page offers, and records WHICH evidence that
 *     was (`ProductFactSource`). A price lifted from a JSON-LD `offers` block
 *     is the publisher's own machine-readable claim; a price matched out of a
 *     `<span class="a-price">` is our reading of their layout. Those are not
 *     the same claim and are not reported as the same claim.
 *
 *  2. REGION. On a real PDP the title, the price, and the description sit in
 *     one region, and the rest of the page is other products. Scoring by text
 *     volume (main.ts) reliably picks the recommendation grid, because on a
 *     PDP the recommendations ARE the bulk of the text.
 *
 * Nothing here is keyed to one retailer's class names. The strong path is
 * schema.org (JSON-LD / microdata / OpenGraph product meta), which is what
 * every large storefront actually publishes; the weak path is a bounded
 * price-shape match inside elements whose id/class carries a `price` token,
 * which covers Amazon's `a-price`, Shopify's `price`, and WooCommerce's
 * `woocommerce-Price-amount` without naming any of them.
 */

import type { ProductFact, ProductFactSource, ProductFacts } from '@w2l/contracts'
import { commonAncestor, qsa, tagOf, textOf } from './dom.js'
import type { TextBlock } from './classify.js'

/**
 * A currency-shaped run of text. Bounded on every quantifier: this runs over
 * attacker-supplied page text, and an unbounded alternation here is the same
 * class of bug as the robots matcher's.
 */
const CURRENCY_SYMBOLS = '[$£€¥₹₽₩฿]'
const CURRENCY_CODES = '(?:USD|EUR|GBP|JPY|CNY|RMB|AUD|CAD|CHF|HKD|SGD|INR|KRW|BRL|MXN|SEK|NOK|DKK|PLN|TRY|ZAR)'
const AMOUNT = '\\d{1,12}(?:[.,]\\d{1,3}){0,4}'
const PRICE_RE = new RegExp(
  `(?:${CURRENCY_SYMBOLS}|${CURRENCY_CODES})\\s{0,3}${AMOUNT}|${AMOUNT}\\s{0,3}(?:${CURRENCY_SYMBOLS}|${CURRENCY_CODES})`,
  'u',
)

/** Does this text carry a price-shaped run? Exported for the prune pass. */
export function looksLikePrice(text: string): boolean {
  return PRICE_RE.test(text)
}

/** id/class token that marks a price container across storefront conventions. */
function hasPriceToken(el: Element): boolean {
  const attr = `${el.getAttribute('id') ?? ''} ${el.getAttribute('class') ?? ''}`.toLowerCase()
  return attr.split(/[\s_-]+/).includes('price')
}

// ---------------------------------------------------------------------------
// Fact collection
// ---------------------------------------------------------------------------

function fact(value: string | null | undefined, source: ProductFactSource): ProductFact | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  return trimmed.length > 0 ? { value: trimmed, source } : null
}

/** Empty facts: we looked at a product page and every field came back unstated. */
function emptyFacts(): ProductFacts {
  return { name: null, price: null, priceCurrency: null, sku: null, brand: null, availability: null }
}

/**
 * Fill only the fields still null. Callers run strongest source first, so a
 * JSON-LD price is never overwritten by a text-scraped one.
 */
function fillMissing(into: ProductFacts, from: Partial<ProductFacts>): void {
  for (const key of Object.keys(into) as (keyof ProductFacts)[]) {
    if (into[key] === null && from[key]) into[key] = from[key]!
  }
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return null
}

/**
 * schema.org allows a scalar, an object with a `name`, or an array of either
 * almost anywhere (`brand`, `availability`). Reduce to the first scalar we can
 * defend; never join an array into a synthetic string.
 */
function scalarOf(v: unknown): string | null {
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = scalarOf(item)
      if (s !== null) return s
    }
    return null
  }
  if (typeof v === 'object' && v !== null) {
    const rec = v as Record<string, unknown>
    return asString(rec['name']) ?? asString(rec['@id']) ?? asString(rec['value'])
  }
  return asString(v)
}

/** Strip a schema.org enumeration IRI to its short name (…/InStock -> InStock). */
function shortEnum(v: string | null): string | null {
  if (v === null) return null
  return /[#/]([^#/]+)$/.exec(v.trim())?.[1] ?? v
}

/** Depth-first search of parsed JSON-LD for the first node typed Product. */
function findProductNode(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProductNode(item)
      if (found) return found
    }
    return null
  }
  if (typeof node !== 'object' || node === null) return null
  const rec = node as Record<string, unknown>
  const t = rec['@type']
  const types = (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string')
  // Product and its schema.org subtypes (IndividualProduct, ProductModel,
  // SomeProducts) all describe one product; a ProductGroup does not.
  if (types.some((x) => /(^|[#/:])(individual)?product(model)?$|someproducts$/i.test(x.trim()))) {
    return rec
  }
  for (const value of Object.values(rec)) {
    if (typeof value === 'object' && value !== null) {
      const found = findProductNode(value)
      if (found) return found
    }
  }
  return null
}

/** The first Offer-ish object under a Product node's `offers`. */
function firstOffer(product: Record<string, unknown>): Record<string, unknown> | null {
  const offers = product['offers']
  const list = Array.isArray(offers) ? offers : [offers]
  for (const o of list) {
    if (typeof o === 'object' && o !== null) return o as Record<string, unknown>
  }
  return null
}

function factsFromJsonLd(doc: Document): Partial<ProductFacts> {
  for (const el of qsa(doc, 'script[type="application/ld+json"]')) {
    const text = (el.textContent ?? '').trim()
    if (text.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      continue // Malformed JSON-LD is not evidence.
    }
    const product = findProductNode(parsed)
    if (!product) continue
    const offer = firstOffer(product)
    return {
      name: fact(scalarOf(product['name']), 'jsonld'),
      price: fact(offer ? asString(offer['price']) : null, 'jsonld'),
      priceCurrency: fact(offer ? asString(offer['priceCurrency']) : null, 'jsonld'),
      sku: fact(asString(product['sku']) ?? asString(product['mpn']), 'jsonld'),
      brand: fact(scalarOf(product['brand']), 'jsonld'),
      availability: fact(offer ? shortEnum(scalarOf(offer['availability'])) : null, 'jsonld'),
    }
  }
  return {}
}

/**
 * The value a microdata element asserts: `content`/`href`/`src` when the
 * element carries one (schema.org's escape hatch for machine values), else its
 * text. Reading the text of a `<meta itemprop="price" content="84.00">` would
 * yield the empty string.
 */
function microdataValue(el: Element): string | null {
  const tag = tagOf(el)
  const content = el.getAttribute('content')
  if (content !== null) return content
  if (tag === 'a' || tag === 'link') return el.getAttribute('href')
  if (tag === 'img') return el.getAttribute('src')
  if (tag === 'time') return el.getAttribute('datetime') ?? textOf(el)
  return textOf(el)
}

/** The element scoping a microdata Product, if the page declares one. */
export function microdataProductScope(doc: Document): Element | null {
  for (const el of qsa(doc, '[itemscope][itemtype]')) {
    const raw = el.getAttribute('itemtype') ?? ''
    for (const token of raw.split(/[\t\n\f\r ]+/)) {
      const short = (/[#/]([^#/]+)$/.exec(token.trim())?.[1] ?? token.trim()).toLowerCase()
      if (short === 'product') return el
    }
  }
  return null
}

function factsFromMicrodata(doc: Document): Partial<ProductFacts> {
  const scope = microdataProductScope(doc)
  if (!scope) return {}
  const pick = (prop: string): string | null => {
    for (const el of qsa(scope, `[itemprop~="${prop}"]`)) {
      const v = microdataValue(el)
      if (v !== null && v.trim().length > 0) return v
    }
    return null
  }
  return {
    name: fact(pick('name'), 'microdata'),
    price: fact(pick('price'), 'microdata'),
    priceCurrency: fact(pick('priceCurrency'), 'microdata'),
    sku: fact(pick('sku') ?? pick('mpn'), 'microdata'),
    brand: fact(pick('brand'), 'microdata'),
    availability: fact(shortEnum(pick('availability')), 'microdata'),
  }
}

/** OpenGraph / Facebook product meta tags, the third machine-readable path. */
function factsFromMeta(doc: Document): Partial<ProductFacts> {
  const meta = (names: readonly string[]): string | null => {
    for (const name of names) {
      for (const el of qsa(doc, `meta[property="${name}"],meta[name="${name}"]`)) {
        const v = el.getAttribute('content')
        if (v !== null && v.trim().length > 0) return v
      }
    }
    return null
  }
  return {
    name: fact(meta(['og:title', 'product:title']), 'meta'),
    price: fact(meta(['product:price:amount', 'og:price:amount']), 'meta'),
    priceCurrency: fact(meta(['product:price:currency', 'og:price:currency']), 'meta'),
    sku: fact(meta(['product:retailer_item_id', 'product:sku']), 'meta'),
    brand: fact(meta(['product:brand', 'og:brand']), 'meta'),
    availability: fact(shortEnum(meta(['product:availability', 'og:availability'])), 'meta'),
  }
}

/**
 * The visible price element: the deepest element carrying a `price` id/class
 * token whose own text is price-shaped. Deepest wins so a wrapper reporting
 * "list price / our price / you save" does not become the price.
 */
export function findPriceElement(scope: ParentNode): Element | null {
  let best: Element | null = null
  let bestDepth = -1
  for (const el of qsa(scope, '[id],[class]')) {
    if (!hasPriceToken(el)) continue
    const text = textOf(el).trim()
    if (text.length === 0 || text.length > 60 || !looksLikePrice(text)) continue
    let depth = 0
    for (let p = el.parentElement; p; p = p.parentElement) depth++
    if (depth > bestDepth) {
      bestDepth = depth
      best = el
    }
  }
  return best
}

/**
 * Last-resort price: our reading of rendered text. Weaker than every
 * machine-readable path above, and labelled as such.
 */
function factsFromText(doc: Document): Partial<ProductFacts> {
  const el = findPriceElement(doc)
  if (!el) return {}
  const text = textOf(el).trim().replace(/\s+/g, ' ')
  const matched = PRICE_RE.exec(text)?.[0] ?? null
  return { price: fact(matched, 'text') }
}

/**
 * Collect the facts the page DECLARES about the product, strongest evidence
 * first. Machine-readable paths only.
 *
 * MUST run on the raw document, before cleanTree: JSON-LD lives in
 * <script>, OpenGraph in <meta>, and cleanTree removes both carriers.
 */
export function collectDeclaredProductFacts(doc: Document): ProductFacts {
  const facts = emptyFacts()
  fillMissing(facts, factsFromJsonLd(doc))
  fillMissing(facts, factsFromMicrodata(doc))
  fillMissing(facts, factsFromMeta(doc))
  return facts
}

/**
 * Fill a still-missing price from rendered text. Weaker than every declared
 * path, so it only ever fills a null.
 *
 * MUST run AFTER recommendation pruning, not before: the deepest price-shaped
 * element on an unpruned PDP is usually a recommendation card's price, and
 * reporting a neighbouring product's price as this product's is the exact
 * contamination this whole module exists to prevent.
 */
export function fillPriceFromText(facts: ProductFacts, doc: Document): void {
  fillMissing(facts, factsFromText(doc))
}

/**
 * Both passes at once, for callers holding a single document. Prefer the
 * split form inside the cascade, where pruning happens in between.
 */
export function collectProductFacts(doc: Document): ProductFacts {
  const facts = collectDeclaredProductFacts(doc)
  fillPriceFromText(facts, doc)
  return facts
}

/** True when no field of a ProductFacts was stated. */
export function hasAnyProductFact(facts: ProductFacts): boolean {
  return Object.values(facts).some((f) => f !== null)
}

// ---------------------------------------------------------------------------
// Region selection
// ---------------------------------------------------------------------------

function isRootish(doc: Document, el: Element | null): boolean {
  return el === null || el === doc.body || el === doc.documentElement
}

/**
 * The region of a PDP that is about THIS product.
 *
 * Anchors on two independent landmarks — the page heading (what the product is
 * called) and the price element (what it costs) — and returns their lowest
 * common ancestor. On a PDP those two sit close together inside the buy-box
 * region; on the recommendation grid they do not, so the grid loses even when
 * it carries more text than the product does.
 *
 * Widens once if the resulting region carries no prose at all, so a
 * title-and-price-only region does not swallow the description. Returns null
 * when no defensible region exists, which is the extractor's signal to fall
 * back to the article cascade rather than emit a guess.
 */
export function selectProduct(doc: Document, blocks: readonly TextBlock[]): Element | null {
  // A declared microdata scope is the publisher telling us the boundary
  // outright — but only when it is not simply the whole page.
  const scope = microdataProductScope(doc)
  if (scope && !isRootish(doc, scope)) return scope

  const heading = doc.querySelector('h1') ?? doc.querySelector('h2')
  const price = findPriceElement(doc)

  if (heading && price && !price.contains(heading)) {
    const lca = commonAncestor(heading, price)
    if (!isRootish(doc, lca)) {
      const region = lca!
      const prose = blocks.filter((b) => region.contains(b.el))
      if (prose.length > 0) return region
      // Title + price but no description: widen one level to reach it.
      const wider = region.parentElement
      if (!isRootish(doc, wider) && blocks.some((b) => wider!.contains(b.el))) return wider
      return region
    }
  }

  // No price landmark: the smallest container holding the heading and at
  // least one text block still beats scoring the whole page by volume.
  if (heading) {
    for (let p = heading.parentElement; p && !isRootish(doc, p); p = p.parentElement) {
      if (blocks.some((b) => p!.contains(b.el))) return p
    }
  }
  return null
}
