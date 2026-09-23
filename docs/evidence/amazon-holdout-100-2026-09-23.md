# Amazon 100 unseen products: Singapore holdout, 2026-09-23

**Result:** The five-field accuracy and visible-field coverage thresholds pass on the second, independently frozen 100-URL cohort, with Howard's raw-page review. The strict **100/100 requested-subject gate fails**: one captured page selected a different ASIN and W2L correctly returned `incomplete`. Amazon remains `beta`; the 1000-page reliability gate has not run. Do not describe this as a completed 100-product promotion gate.

## Scope and provenance

- Candidate URLs were discovered through W2L from public Amazon bestseller pages. The [first frozen cohort](../../research/amazon-product-holdout-100.v1.json) used Amazon.com; the [second frozen cohort](../../research/amazon-product-holdout-100-sg.v1.json) used Amazon.sg. Each contains 100 distinct URLs, with no overlap with the original ten or each other. The second cohort was frozen at clean source commit `991097f15e6513de58ccd3df165f7b789dfff201` before capture.
- Second-cohort capture ran from `2026-09-23T08:28:05.654Z` to `2026-09-23T08:31:34.295Z` using stdio MCP → W2L local API → `browser_local` only, with concurrency 2. The identity was anonymous Chrome/Playwright, `en-US`, local default egress, and an Amazon-only anonymous Singapore 238823 / SGD preference. No login or proxy was used. Ordinary `standard` requests were not changed.
- Node `v26.8.1`; npm `11.19.0`. Manifest file SHA256 `4764bf94aee623d6fbb762dc8cd00f2053b3eb7de8706584bb0e40ffe15257c5`; parsed JSON Schema serialized with `JSON.stringify` SHA256 `fdb13640d8a26c642b447ff44f5e4ecd1331dd5b87d92168def88d183c2fbc8b` (the raw formatted schema file has a different hash); anonymous-state file SHA256 `46da30659105f7018e15f1b3b294630d8ac27cb47f960751f4156ad38e375b0c`. The state content, cookies, and raw HTML remain in ignored local files.
- The [per-page record](amazon-holdout-100-2026-09-23.json) retains all 100 URLs, capture times, raw-body hashes, field witnesses, output values, issues, and timing. The ignored local raw report is `.w2l/amazon-baseline/2026-09-23T08-31-34-295Z.json` (SHA256 `a7928bb8797f8e55e764c14cff5f6da63bc79b0150f04824253df5404548afe1`). Its 100 HTML artifacts were individually hash-verified. The local row-by-row review packet is `.w2l/amazon-holdout-sg/field-review.md` (SHA256 `c05bc8acda7b9ee5a05f606c19615353d687e6ea3643d2f188f870b90012718f`).

The review packet can be regenerated locally with `node scripts/section-b/amazon-holdout-review.mjs --report .w2l/amazon-baseline/2026-09-23T08-31-34-295Z.json`. The script verifies each saved HTML body against its capture hash before scoring. It does not make the human sign-off or rewrite the raw captures.

## Results

Accuracy is **correct emitted values / emitted values**. Visible-field coverage is **correct emitted values / values visible and applicable in that captured page**. A missing or mismatched requested subject stays in the denominator; unavailable page fields are not counted as visible. Both metrics use the same five-field definition: subject ASIN, title, selected price, currency, and selected seller. This is snapshot truth, not a claim that Amazon prices or sellers remain unchanged.

| Field | Correct / emitted | Accuracy | Correct / visible | Visible coverage |
|---|---:|---:|---:|---:|
| ASIN | 99 / 99 | 100% | 99 / 100 | 99% |
| Title | 99 / 99 | 100% | 99 / 100 | 99% |
| Price | 86 / 86 | 100% | 86 / 87 | 98.85% |
| Currency | 86 / 86 | 100% | 86 / 87 | 98.85% |
| Seller | 86 / 86 | 100% | 86 / 86 | 100% |
| **All scored fields** | **456 / 456** | **100%** | **456 / 460** | **99.13%** |

All 100 requests returned a captured page; 99 JSON records were `complete`, one `incomplete`. There were zero recorded blocks, transport failures, or retries. Every raw page showed Singapore 238823. The 86 emitted selected quotes were SGD; 13 other pages had no selected visible quote, and the one visible quote on row 40 was withheld with the unverified subject. The complete batch took `200233.5 ms` (3m20s); per-page client p50/p95 were `3853.7 / 5014.3 ms`. These are observations at concurrency 2, not a speedup claim or the ten-page ≤20-second gate.

The independent HTML review found recognized recommendation regions on 100/100 pages and foreign recommendation ASIN candidates on 99/100. None of those candidate ASINs or images appeared in the subject JSON. All 138 emitted offer prices were witnessed in the subject buy box or offer list, and all 102 emitted images in the subject gallery. This is a check of captured-page evidence and recognized recommendation regions, supplemented by Howard's [explicit review](amazon-holdout-100-human-review-2026-09-23.json): “已核对：除第 40 行如实不完整外，无字段错误或串入”.

**Open subject failure:** row 40 requested `B000VW9PIK`. Its final URL still contained that ASIN, but both the page's selected-ASIN input and canonical identity were `B0CFV1W66Y`. W2L returned `subject_unverified / asin_mismatch`, emitted no fabricated product fields, and kept the row in the scored set. Thus the precise requested-subject result is **99/100**, below the 100/100 gate. The missing visible ASIN, title, price, and currency are the four coverage misses above. No URL was replaced or omitted to obtain a passing percentage.

## Earlier cohort and measurement boundary

The first clean-source Amazon.com cohort ran at `9938f0630941052b12589851ad47c03b72955834`, with frozen manifest SHA256 `840c6575372ad8e080d9d9ecd60b79a851bcbd711b76d8ab75c1960ecaca387a`. Its 100 requests succeeded, but only 94 structured records were complete. Five `asin_mismatch` results came from Amazon canonical links naming a parent variant while the selected page ASIN matched the request; the sixth involved a real cross-market subject change. We fixed the canonical-variant validation and added regression tests before freezing the new Singapore cohort. The first raw report remains in ignored local evidence at `.w2l/amazon-baseline/2026-09-23T08-21-24-643Z.json` (SHA256 `5d8b06c9e34e5ff244c880833e9f27a33001d3cd923399925fa32fdaa0d58d19`). Its misses are historical failure evidence, not part of the second cohort's denominator.

The existing `baseline:amazon` runner is designed for ten URLs and three rounds. With `--rounds 1`, its legacy summary labels every capture as a discovery record, reports `successes: 0`, and applies the ten-page ≤20-second acceptance rule, so it exits nonzero for both holdouts despite 100 successful per-record captures. The holdout scorer counts all frozen records directly from the raw report; the [per-page record](amazon-holdout-100-2026-09-23.json) and [review signature](amazon-holdout-100-human-review-2026-09-23.json) are the holdout result. Do not reuse the runner's ten-page summary as a 100-product score. The raw report and every `incomplete` record remain unchanged.

After the code fix, `npm run typecheck` passed; focused adapter tests passed 43/43; the full test suite passed 88 files / 989 tests. These checks support the extractor change, while the real-site results above determine the holdout outcome. The next Amazon correctness slice must investigate the page-selected variant behavior on row 40 and rerun a pre-frozen cohort under the same field and region rules. The separate 1000-page reliability test follows a successful subject gate.
