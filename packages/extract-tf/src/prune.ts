/**
 * Tree pruning: strip non-content elements before the cascade runs.
 *
 * Two layers, mirroring trafilatura's flow (research confirmed):
 *  - cleanTree: wholesale removal of elements that can never be main content
 *    (trafilatura's MANUALLY_CLEANED set).
 *  - prune: selector-driven removal of noise the clean pass can't see, with a
 *    built-in CMP/garbage table stronger than trafilatura's thin token list
 *    (the research reproduction showed 15 of 20 real CMP roots surviving
 *    trafilatura; our table covers those word families).
 */

import { detach, qsa, tagOf, textOf } from './dom.js'
import { looksLikePrice } from './product.js'

const MANUALLY_CLEANED = [
  'script',
  'style',
  'noscript',
  'iframe',
  'frame',
  'object',
  'embed',
  'applet',
  'aside',
  'nav',
  'footer',
  'form',
  'dialog',
  'button',
  'select',
  'textarea',
  'input',
  'canvas',
  'svg',
  'template',
] as const

const CLEANED_SELECTOR = MANUALLY_CLEANED.join(',')

/**
 * CMP / ad / junk selectors, applied by id or class token. Matched nodes are
 * removed entirely (a hidden node still feeds the cascade).
 *
 * Covers cookie-consent / gdpr / cmp / popup / banner / modal / ad word
 * families. `ad` is deliberately token-based (e.g. id="adblock-notice") and
 * excludes obvious false positives like "download".
 */
const CMP_ID_TOKENS = [
  'cookie', 'consent', 'gdpr', 'cmp', 'ccpa', 'privacy-banner',
  'onetrust', 'didomi', 'usercentrics', 'cookiebot', 'trustarc', 'sourcepoint',
] as const

const CMP_CLASS_TOKENS = [
  'cookie-banner', 'cookie-consent', 'consent-banner', 'consent-overlay',
  'gdpr-banner', 'gdpr-consent', 'cmp-banner', 'ccpa-banner',
  'popup-overlay', 'newsletter-popup', 'paywall-banner', 'age-gate',
  'interstitial', 'modal-backdrop', 'chat-widget', 'cookie-notice',
] as const

/** id/class tokens for advertisement containers (token match, not substring). */
const AD_TOKENS = ['ad', 'ads', 'advert', 'advertisement', 'sponsored', 'promo', 'banner-ad'] as const

function hasToken(attr: string, tokens: readonly string[]): boolean {
  const lower = attr.toLowerCase()
  return tokens.some((t) => lower.split(/[\s_-]+/).includes(t))
}

export interface PruneOptions {
  /** Extra selectors beyond the built-in table. */
  selectors?: readonly string[]
}

/**
 * Heading text that introduces a block of OTHER products. Kept to phrases
 * that are structurally about comparison or co-purchase — a heading like
 * "Specifications" or "Product description" is about THIS product and must
 * never match.
 */
const RECOMMENDATION_HEADINGS = [
  /\balso\s+(bought|viewed|like[d]?|purchased|considered)\b/i,
  /\b(customers|shoppers|buyers)\s+who\b/i,
  /\b(similar|related|recommended|sponsored|comparable)\s+(items?|products?|listings?)\b/i,
  /\b(you\s+m(ay|ight)\s+(also\s+)?like)\b/i,
  /\b(frequently\s+bought\s+together)\b/i,
  /\b(more\s+(items?|products?)\s+to\s+(explore|consider))\b/i,
  /\b(compare\s+with\s+similar)\b/i,
  /\b(top\s+picks?\s+for\s+you)\b/i,
  /(相关(商品|产品|推荐))|(猜你喜欢)|(购买了此商品的顾客)|(经常一起购买)/,
]

/**
 * id/class tokens storefronts use for co-purchase widgets. Matched against
 * both whole class tokens and their hyphen/underscore-split parts, so
 * "related-products" and "relatedProducts" and "sims-carousel" all land.
 *
 * Deliberately excludes a bare "carousel": the product's own image gallery is
 * a carousel on most storefronts, and cutting it would delete the product.
 */
const RECOMMENDATION_TOKENS = [
  'recommendation', 'recommendations', 'recommended',
  'crosssell', 'cross-sell', 'upsell', 'up-sell',
  'related-products', 'relatedproducts', 'similar-products', 'similarproducts',
  'also-bought', 'alsobought', 'also-viewed', 'alsoviewed',
  'sims-carousel', 'sponsored-products',
] as const

/**
 * Token match tolerant of the three casings storefronts actually ship:
 * space-separated classes, hyphen/underscore compounds, and camelCase.
 */
function hasRecommendationToken(attr: string): boolean {
  const normalized = attr
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .split(/\s+/)
    .filter((t) => t.length > 0)
  const camelSplit = attr.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  const parts = camelSplit.split(/[\s_]+/).filter((t) => t.length > 0)
  const all = new Set([...normalized, ...parts])
  return RECOMMENDATION_TOKENS.some((t) => all.has(t))
}

function isRecommendationHeading(text: string): boolean {
  const t = text.trim()
  if (t.length === 0 || t.length > 120) return false
  return RECOMMENDATION_HEADINGS.some((re) => re.test(t))
}

/**
 * A repeated-product grid: >= 3 sibling children that each carry a link AND a
 * price-shaped run. One priced card is a product; three in a row under one
 * parent is a shelf of other people's products.
 *
 * The price requirement is what keeps this off article pages — a nav list or a
 * related-articles rail has links without prices and is left alone.
 */
function isProductGrid(el: Element): boolean {
  const kids = Array.from(el.children)
  if (kids.length < 3) return false
  let priced = 0
  for (const kid of kids) {
    if (qsa(kid, 'a').length === 0) continue
    if (looksLikePrice(textOf(kid))) priced++
  }
  return priced >= 3 && priced >= kids.length * 0.6
}

/**
 * The region a recommendation heading introduces: the heading plus the
 * sibling run that follows it, up to the next heading of the same or higher
 * rank. Returns the nodes to cut, never a whole ancestor — cutting the
 * heading's parent on a flat DOM would take the product with it.
 */
function recommendationRegion(heading: Element): Element[] {
  const rank = Number(/^h([1-6])$/.exec(tagOf(heading))?.[1] ?? '6')
  const region: Element[] = [heading]
  for (let sib = heading.nextElementSibling; sib; sib = sib.nextElementSibling) {
    const sibRank = Number(/^h([1-6])$/.exec(tagOf(sib))?.[1] ?? '0')
    if (sibRank > 0 && sibRank <= rank) break
    region.push(sib)
  }
  return region
}

/**
 * Cut recommendation carousels from a product page.
 *
 * Two independent triggers, because storefronts split on which one they give
 * you: a labelled heading ("Customers also bought") and an unlabelled grid of
 * priced cards. Either alone is enough; neither is inferred from the other.
 *
 * Deliberately conservative about what it takes with it. The failure this
 * prevents is an LLM summarizing the wrong product's features; the failure it
 * must not cause is deleting the product being described.
 */
export function pruneRecommendations(doc: Document): void {
  // Trigger 1: labelled sections.
  for (const heading of qsa(doc, 'h1,h2,h3,h4,h5,h6')) {
    if (!heading.isConnected) continue
    if (!isRecommendationHeading(textOf(heading))) continue
    for (const node of recommendationRegion(heading)) detach(node)
  }

  // Trigger 2: unlabelled grids of priced, linked cards. Walk deepest-first
  // so the tightest qualifying container is cut, not a page-level wrapper
  // that happens to contain one.
  const containers = qsa(doc, 'div,section,ul,ol')
  for (const el of containers.reverse()) {
    if (!el.isConnected) continue
    if (isProductGrid(el)) detach(el)
  }

  // Trigger 3: id/class tokens, for carousels rendered without a heading and
  // without prices in the initial HTML (lazy-loaded cards).
  for (const el of qsa(doc, '[id],[class]')) {
    if (!el.isConnected) continue
    const attr = `${el.getAttribute('id') ?? ''} ${el.getAttribute('class') ?? ''}`
    if (hasRecommendationToken(attr)) detach(el)
  }
}

/**
 * Strip elements that can never be main content. Idempotent.
 */
export function cleanTree(doc: Document): void {
  for (const el of qsa(doc, CLEANED_SELECTOR)) detach(el)
}

/**
 * Remove noise by built-in + user selectors. Run after cleanTree.
 */
export function pruneTree(doc: Document, options: PruneOptions = {}): void {
  // Attribute-driven CMP/ad removal.
  const candidates = qsa(doc, '[id],[class]')
  for (const el of candidates) {
    const id = el.getAttribute('id') ?? ''
    const cls = el.getAttribute('class') ?? ''
    if (
      hasToken(id, CMP_ID_TOKENS) ||
      hasToken(cls, CMP_CLASS_TOKENS) ||
      hasToken(id, AD_TOKENS) ||
      hasToken(cls, AD_TOKENS)
    ) {
      detach(el)
      continue
    }
    // aria-label hints ("Close cookie banner").
    const aria = (el.getAttribute('aria-label') ?? '').toLowerCase()
    if (/(cookie|consent|gdpr)/.test(aria)) detach(el)
  }

  // Near-empty elements whose only content is a link farm (nav-shaped noise).
  for (const el of qsa(doc, 'div,section,li')) {
    const text = textOf(el).trim()
    const links = qsa(el, 'a').length
    if (links >= 3 && text.length > 0 && text.length < 40 && /ad|sponsor|promo|partner/i.test(el.className + el.id)) {
      detach(el)
    }
  }

  // User-provided selectors take precedence: they run last so they can
  // remove anything the built-ins missed.
  for (const sel of options.selectors ?? []) {
    for (const el of qsa(doc, sel)) detach(el)
  }

  void tagOf
}
