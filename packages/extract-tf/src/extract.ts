/**
 * ExtractTf: the trafilatura-style extraction cascade with a page-type router.
 *
 * Flow: cleanTree -> pruneTree -> routePage -> strategy -> output.
 * The router (route.ts) decides the strategy before the block cascade runs —
 * W2L's precision headroom is on non-article pages (products ~0.670, listings
 * ~0.71 vs articles 0.924 per research), so each page type gets its own
 * extraction path.
 *
 * The cascade is CSS-selector + manual filtering because no Node DOM ships
 * native XPath (bake-off confirmed for jsdom/linkedom/happy-dom).
 */

import type { Extractor, ExtractorOptions, ExtractorOutput, PageType, ProductFacts } from '@w2l/contracts'
import { qsa, outerHtml, parse, textOf } from './dom.js'
import { cleanTree, pruneRecommendations, pruneTree } from './prune.js'
import { classifyBlocks, type ClassifyOptions } from './classify.js'
import { selectMain } from './main.js'
import { collectDeclaredProductFacts, fillPriceFromText, selectProduct } from './product.js'
import { pageSignalsFor, routePage, selectList, selectTable } from './route.js'

const DEFAULT_CLASSIFY: ClassifyOptions = {
  minTextLength: 25,
  maxLinkDensity: 0.2,
}

function pickTitle(doc: Document, main: Element | null): string | null {
  if (main) {
    const h1 = main.querySelector('h1')
    if (h1) {
      const t = textOf(h1).trim()
      if (t.length > 0) return t
    }
  }
  const docTitle = doc.querySelector('title')
  return docTitle ? textOf(docTitle).trim() : null
}

function confidenceOf(
  blocksLen: number,
  main: Element | null,
  totalBlocks: number,
  mainLength: number,
  pageType: PageType,
  favorPrecision: boolean,
  favorRecall: boolean,
  product: ProductFacts | null,
): number {
  // Base: share of all text blocks inside main.
  let conf = totalBlocks > 0 ? blocksLen / totalBlocks : 0
  // Semantic container presence strengthens it.
  if (main && ['ARTICLE', 'MAIN'].includes(main.tagName)) conf = Math.min(1, conf + 0.15)
  // Size sanity: very little extracted text is suspicious.
  if (mainLength < 80) conf = Math.min(conf, 0.4)
  // Non-article pages carry structurally less prose; cap their confidence
  // lower than a clean article so the escalation tier knows the difference.
  if (pageType !== 'article') conf = Math.min(conf, 0.75)
  // A PDP that declared its own name AND price in machine-readable markup is
  // corroborating our routing with the publisher's own statement. That is
  // evidence about the page, independent of how much prose we recovered —
  // and a terse buy-box is the normal shape of a correct PDP extraction, not
  // a thin one. Raise a floor rather than the value, so a genuinely empty
  // region still can't be dressed up as a good one.
  if (
    product !== null &&
    main !== null &&
    product.name !== null &&
    product.price !== null &&
    product.name.source !== 'text' &&
    product.price.source !== 'text'
  ) {
    conf = Math.max(conf, 0.6)
  }
  if (favorPrecision) conf = Math.min(conf, 0.85)
  if (favorRecall) conf = Math.max(conf, 0.3)
  return Math.round(conf * 100) / 100
}

export class ExtractTf implements Extractor {
  extract(html: string, options: ExtractorOptions = {}): ExtractorOutput {
    const { favorPrecision = false, favorRecall = false, pruneSelectors } = options
    const doc = parse(html)

    // Semantic page-type signals must be collected BEFORE cleaning: they live
    // in <script type="application/ld+json">, <meta>, and itemprop attributes,
    // and cleanTree strips script/form/button. cleanTree also detaches
    // article.post elements whose only content is a <form> (quick-reply),
    // which would otherwise suppress forum routing.
    const signals = pageSignalsFor(doc.document)

    // Declared product facts share those carriers, so they are read from the
    // raw tree too. The visible-price fallback runs much later, after
    // recommendation pruning — see below.
    const declaredFacts = collectDeclaredProductFacts(doc.document)

    cleanTree(doc.document)
    pruneTree(doc.document, { selectors: pruneSelectors })

    const decision = routePage(doc.document, signals)

    // Recommendation carousels are cut only on product pages. On a listing
    // page the priced cards ARE the content, and pruning them would delete
    // the answer.
    if (decision.type === 'product') pruneRecommendations(doc.document)

    const classifyOptions: ClassifyOptions = { ...DEFAULT_CLASSIFY, favorPrecision }
    if (favorPrecision) classifyOptions.minTextLength = 60
    if (favorRecall) classifyOptions.minTextLength = 15

    // Strategy may fall back, and the output must report what actually ran.
    let strategy = decision.strategy
    let main: Element | null
    switch (strategy) {
      case 'list':
        main = selectList(doc.document)
        break
      case 'table':
        main = selectTable(doc.document)
        break
      case 'product': {
        const blocks = classifyBlocks(doc.document, classifyOptions)
        main = selectProduct(doc.document, blocks)
        if (main === null) {
          // No defensible product region. The page is still a product page;
          // the article cascade is just what produced the HTML.
          strategy = 'article'
          main = selectMain(doc.document, blocks)
        }
        break
      }
      default: {
        const blocks = classifyBlocks(doc.document, classifyOptions)
        main = selectMain(doc.document, blocks)
      }
    }

    let product: ProductFacts | null = null
    if (decision.type === 'product') {
      product = declaredFacts
      // Only now, on a tree with the neighbouring products removed, is the
      // deepest price-shaped element safe to read as THIS product's price.
      fillPriceFromText(product, doc.document)
    }

    const blocks = classifyBlocks(doc.document, classifyOptions)
    const mainLength = main ? textOf(main).length : 0

    const output: ExtractorOutput = {
      title: pickTitle(doc.document, main),
      mainHtml: main ? outerHtml(main) : '',
      confidence: confidenceOf(
        blocks.filter((b) => main?.contains(b.el)).length,
        main,
        blocks.length,
        mainLength,
        decision.type,
        favorPrecision,
        favorRecall,
        product,
      ),
      // Escalate only when a strategy produced nothing at all. Routing to a
      // non-article strategy is not by itself an escalation reason.
      escalate: main === null,
      pageType: decision.type,
      strategy,
      product,
    }

    doc.close()
    return output
  }
}

/** Default instance. */
export const extractTf = new ExtractTf()
