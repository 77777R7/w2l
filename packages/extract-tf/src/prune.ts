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
