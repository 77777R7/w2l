export { ExtractTf, extractTf } from './extract.js'
export { classifyBlocks } from './classify.js'
export type { TextBlock, ClassifyOptions } from './classify.js'
export { cleanTree, pruneTree, pruneRecommendations } from './prune.js'
export type { PruneOptions } from './prune.js'
export { selectMain } from './main.js'
export {
  collectProductFacts,
  collectDeclaredProductFacts,
  fillPriceFromText,
  hasAnyProductFact,
  findPriceElement,
  looksLikePrice,
  microdataProductScope,
  selectProduct,
} from './product.js'
export { routePage, pageSignalsFor, selectList, selectTable, selectMinimal } from './route.js'
export type { RouteDecision } from './route.js'
