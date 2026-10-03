/**
 * Names the extraction and Markdown conversion that turn a raw page into
 * Markdown: main-content selection (`extractTf.extract`) plus `htmlToMarkdown`.
 *
 * Monitors store it with every observation. A field that changes while the raw
 * body stayed the same is then attributed to W2L (`extraction_reprocessed`),
 * never to the source.
 *
 * Bump it in the same change as anything that can alter the Markdown produced
 * from the same HTML in any lane: converter or golden-file changes, cleaning,
 * pruning, main-content selection, link resolution, or DOM preparation in the
 * browser lane. `test/version.test.ts` pins it to the output digest of fixed
 * pages and fails when that output changes without a bump; it cannot see every
 * path, so bump it also when that test stays green. Timings, routing
 * diagnostics and product facts that never reach the Markdown need no bump.
 */
export const EXTRACTOR_VERSION = 'extract-tf/15'
