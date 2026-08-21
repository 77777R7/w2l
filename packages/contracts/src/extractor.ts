/**
 * Extractor contract: the seam every main-content extractor implements
 * (extract-tf, the v0 readability wrapper, and any future tier).
 */

/** Page shape the extractor routed to. */
export type PageType = 'article' | 'listing' | 'collection' | 'product' | 'forum'

/** Extraction strategy that produced mainHtml, independent of pageType. */
export type ExtractStrategy = 'article' | 'list' | 'table' | 'product'

/**
 * Where a product fact came from. The ordering is a strength ordering:
 * `jsonld` and `microdata` are the publisher's own machine-readable claim,
 * `meta` is a tag written for machines, `text` is our reading of rendered
 * prose. A price we matched out of visible text is a weaker claim than one
 * the publisher declared, and a consumer is entitled to know which it got.
 */
export type ProductFactSource = 'jsonld' | 'microdata' | 'meta' | 'text'

/** One product fact plus the evidence class it was drawn from. */
export interface ProductFact {
  /** The value exactly as the page carried it. Never normalized — a
   *  normalized price is a claim we would be making, not one we read. */
  value: string
  source: ProductFactSource
}

/**
 * Facts a product-detail page asserted about the product it is about.
 * Every field is independently nullable: a page may declare a price and no
 * SKU, and inventing the missing one is worse than reporting null.
 */
export interface ProductFacts {
  name: ProductFact | null
  price: ProductFact | null
  priceCurrency: ProductFact | null
  sku: ProductFact | null
  brand: ProductFact | null
  availability: ProductFact | null
}

export interface ExtractorOutput {
  /** Page title, or null when none could be found. */
  title: string | null
  /** Extracted main content as HTML. Markdown conversion happens later in the pipeline. */
  mainHtml: string
  /** 0..1 self-assessed extraction confidence. */
  confidence: number
  /**
   * True when this page should be routed to a higher tier (LLM/neural).
   * The escalation target is intentionally unimplemented in v0.
   */
  escalate: boolean
  /** Page type the router detected. */
  pageType: PageType
  /**
   * The strategy that produced mainHtml. Independent of pageType: a product
   * page may use the table strategy, a forum thread the article cascade.
   */
  strategy: ExtractStrategy
  /**
   * Product facts, present only when pageType is 'product'. Null on every
   * other page type — an article has no price, and an empty ProductFacts
   * object would read as "we looked and found none".
   */
  product?: ProductFacts | null
}

export interface ExtractorOptions {
  /**
   * Prefer less text but correct extraction (tighten thresholds, require a
   * semantic container). Mirrors trafilatura's favor_precision.
   */
  favorPrecision?: boolean
  /** When unsure, prefer more text (loosen thresholds). Mirrors favor_recall. */
  favorRecall?: boolean
  /** Extra CSS selectors to prune from the tree before extraction. */
  pruneSelectors?: readonly string[]
}

export interface Extractor {
  extract(html: string, options?: ExtractorOptions): ExtractorOutput
}
