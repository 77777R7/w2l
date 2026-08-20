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

import type { Extractor, ExtractorOptions, ExtractorOutput, PageType } from '@w2l/contracts'
import { qsa, outerHtml, parse, textOf } from './dom.js'
import { cleanTree, pruneTree } from './prune.js'
import { classifyBlocks, type ClassifyOptions } from './classify.js'
import { selectMain } from './main.js'
import { routePage, selectList, selectTable } from './route.js'

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
  if (favorPrecision) conf = Math.min(conf, 0.85)
  if (favorRecall) conf = Math.max(conf, 0.3)
  return Math.round(conf * 100) / 100
}

export class ExtractTf implements Extractor {
  extract(html: string, options: ExtractorOptions = {}): ExtractorOutput {
    const { favorPrecision = false, favorRecall = false, pruneSelectors } = options
    const doc = parse(html)

    cleanTree(doc.document)
    pruneTree(doc.document, { selectors: pruneSelectors })

    const decision = routePage(doc.document)

    const classifyOptions: ClassifyOptions = { ...DEFAULT_CLASSIFY, favorPrecision }
    if (favorPrecision) classifyOptions.minTextLength = 60
    if (favorRecall) classifyOptions.minTextLength = 15

    let main: Element | null
    switch (decision.strategy) {
      case 'list':
        main = selectList(doc.document)
        break
      case 'table':
        main = selectTable(doc.document)
        break
      default: {
        const blocks = classifyBlocks(doc.document, classifyOptions)
        main = selectMain(doc.document, blocks)
      }
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
      ),
      // Escalate only when a strategy produced nothing at all. Routing to a
      // non-article strategy is not by itself an escalation reason.
      escalate: main === null,
      pageType: decision.type,
    }

    doc.close()
    return output
  }
}

/** Default instance. */
export const extractTf = new ExtractTf()
