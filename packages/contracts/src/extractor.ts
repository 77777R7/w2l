/**
 * Extractor contract: the seam every main-content extractor implements
 * (extract-tf, the v0 readability wrapper, and any future tier).
 */

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
