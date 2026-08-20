import type { GroundTruth, Suite } from '@w2l/contracts'

/**
 * Canary suite: real open-web pages, one per shape the page-type router
 * claims to handle. These are NOT correctness fixtures — no mustContain
 * annotation can be guaranteed on a live page — they are the W2L claim's
 * first contact with the real world. Every site was curated by a live
 * fetch with a polite UA and a robots.txt allow-check on 2026-08-20.
 *
 * What a canary run measures:
 *  - crawlable rate: how many targets return contentful results
 *  - challenge/block rate: how much of the open web is gated (the browser
 *    lane's whole reason to exist)
 *  - extraction yield: token distribution and escalate rate on real HTML
 *  - redirect following: the 301-heavy MDN/toscrape cases only resolve
 *    through the resilient arm
 *
 * Curation rules: only robots-permitted targets (robots.txt allow-checked
 * at curation time), one request per case per arm, read-only GETs, a
 * real user-agent, and a 1s inter-case delay. Banned from this suite:
 * old.reddit (403 with polite UA), lobste.rs (connect timeout), and
 * gutenberg.org (robots.txt Disallow: / — dropped at curation, a real
 * finding already).
 */

const budget = (maxTokens: number, maxWallMs = 30_000, maxAttempts = 2) => ({
  maxTokens,
  maxWallMs,
  maxAttempts,
})

function truth(id: string, url: string, category: string, notes: string): GroundTruth {
  return {
    id,
    target: url,
    kind: 'canary',
    category,
    // No annotation: canaries exercise the evidence-only checks
    // (challenge_text_returned, wrong_page_content, silent_truncation)
    // and yield distribution, never fact assertions.
    mustContain: [],
    mustNotContain: [],
    expectedLane: 'http',
    emptyIsLegit: false,
    expectedMainTokens: null,
    budget: budget(4000),
    expectedStatus: 'success',
    notes,
  }
}

const SITES: readonly GroundTruth[] = [
  truth(
    'canary-example-com',
    'https://example.com',
    'smoke',
    'Minimal page. The extractor should escalate (or yield almost nothing); a full-token result here would mean boilerplate is being extracted.',
  ),
  truth(
    'canary-wikipedia-article',
    'https://en.wikipedia.org/wiki/Web_scraping',
    'article',
    'Long-form article with references and templates. Robots-permitted; needs a polite UA (bare undici default got 403 at curation).',
  ),
  truth(
    'canary-wikipedia-table',
    'https://en.wikipedia.org/wiki/List_of_HTTP_status_codes',
    'table',
    'Huge real-world table with nested structures. Probes the table strategy on real markup, not synthetic geometry.',
  ),
  truth(
    'canary-mdn-docs',
    'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status',
    'article',
    'Docs article; the target 301-redirects first, so only the resilient arm can reach the content.',
  ),
  truth(
    'canary-github-docs',
    'https://docs.github.com/en/rest/quickstart',
    'article',
    'JS-heavy docs portal. Probes whether server-rendered docs survive without a browser lane.',
  ),
  truth(
    'canary-hackernews',
    'https://news.ycombinator.com/',
    'listing',
    'Link-farm listing, the shape the listing strategy exists for.',
  ),
  truth(
    'canary-quotes-listing',
    'https://quotes.toscrape.com/',
    'listing',
    'The canonical scraping sandbox listing (bot-friendly, robots 404 = allowed).',
  ),
  truth(
    'canary-books-product',
    'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html',
    'product',
    'Real e-commerce product page: spec table + price + description. The product router must beat "one table = product" heuristics on real markup.',
  ),
  truth(
    'canary-books-listing',
    'https://books.toscrape.com/',
    'listing',
    'Real e-commerce category listing with product cards.',
  ),
  // NOTE: canary-httpbin-redirect (https://httpbin.org/redirect/3) was
  // REMOVED from the suite on the first run: httpbin.org returned 503 on
  // every endpoint (/get, /status/200, /redirect/*) — external service
  // degradation, not a W2L defect. A drifting external dependency cannot
  // serve as a measurement target; MDN's 301 covers real redirect chains.
]

export const CANARY_SUITE: Suite = {
  name: 'canary-open-web-v1',
  version: '0.1.0',
  curatedAt: '2026-08-20',
  cases: SITES,
}
