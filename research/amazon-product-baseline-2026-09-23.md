# Amazon product adapter live baseline — 2026-09-23

## Verdict

**Overall: FAIL; adapter remains `beta`.**

The run passed the current performance and response-size targets, and all 30 requests completed successfully. It did not establish a fixed-region 10-product field-accuracy baseline: only 10 of the 20 later-round records exposed the expected delivery region and stable currency context, and price/seller fields have not received the required human labels. A transport success is therefore not counted as adapter verification.

## Run identity

- UTC window: `2026-09-22T19:00:53.690Z` to `2026-09-22T19:02:00.615Z`
- Local window: 2026-09-23 03:00–03:02 (Asia/Shanghai)
- Source commit: `2ac38f39a4d1cf724863044e8287cf3f7beb1b48`, with a dirty working tree
- Runtime: Node `v26.8.1`, npm `11.19.0`
- Path: local W2L API → W2L stdio MCP → `scrape` → browser-local public page load
- Platform API/API key: none
- Manifest: `research/amazon-product-baseline.v1.json`
- Egress label: `local-default-network`
- Requested language/identity: `en-US`; `Chrome/Playwright anonymous`
- Observed delivery region: `Singapore`, with null or unstable observations on some pages
- Raw HTML: captured locally by SHA-256 under `.w2l/amazon-baseline/raw`; raw bodies are ignored by Git because they are dynamic and the current accumulated directory is about 98 MB
- Full local report: `.w2l/amazon-baseline/2026-09-22T19-02-00-615Z.json`

## Fixed URL set and first-round snapshot

| ASIN | URL | Outcome | First-round raw HTML SHA-256 |
|---|---|---|---|
| B08KT2Z93D | https://www.amazon.com/dp/B08KT2Z93D | success | `15b74f7d34b5d4353aca64ffcf468aacd3df7ba377f66ec2cf13eb289f1f90a7` |
| B09V7Z4TJG | https://www.amazon.com/dp/B09V7Z4TJG | success | `4b01e3bf797659199614886fed18f6b3c89b51b80453409d19da8df8bd3eab4f` |
| B07PBXXNCY | https://www.amazon.com/dp/B07PBXXNCY | success | `730987ecacac83163db1543116fdcfacb68107b943b91eddc1fdef423d33b5a7` |
| B00F1U0YB4 | https://www.amazon.com/dp/B00F1U0YB4 | success | `b376a69847e7c90b15a2b16cd64469ac8b8f9c28de5cebed380aeaa81fe259e6` |
| B09542G9ZN | https://www.amazon.com/dp/B09542G9ZN | success | `7fa49e74801f861c80cfea403a860823df3ed648734400fdf159c34c302cf9c5` |
| B09541P9WH | https://www.amazon.com/dp/B09541P9WH | success | `792449f2f1089138a9ad8191c89ef03da68ba8a9013580dc3c79d1f8b4c416b5` |
| B08JHCVHTY | https://www.amazon.com/dp/B08JHCVHTY | success | `3383eb6885f622324f3f8ef6482cf77a37b63fecebb2616338c7d579cb011de1` |
| B0DCH8VDXF | https://www.amazon.com/dp/B0DCH8VDXF | success | `2cedd288531ed42a640385debc0f52bc3e90a164806791bf2c0c59c43a6d03f3` |
| B0GJTFXNRX | https://www.amazon.com/dp/B0GJTFXNRX | success | `23c4d911092a4de15d3c4fddc6854364ecbf2547fba664eee8768806874bd6e0` |
| B0FQFB8FMG | https://www.amazon.com/dp/B0FQFB8FMG | success | `d464eea30be76986ed4c3e838c2eab2941be8663b4a46fe3168ee0e6273d3b49` |

## Performance and response size

- Whole 10-page round wall times: `19,875 ms`, `19,177 ms`, `18,935 ms`
- Three-run median: `19,177 ms`; target `≤20,000 ms` — **PASS**
- Comparable-record end-to-end p50/p95: `4,444 / 5,210 ms`
- Request p50/p95: `3,681 / 4,673 ms`
- Body-read p50/p95: `40 / 55 ms`
- Parse p50/p95: `15 / 26 ms`
- Extract p50/p95: `93 / 119 ms`
- Retry wait: `0 ms`; no record retried during this run
- Same-capture compact/debug response: `15,636 / 108,100 bytes`; compact is `14.46%` of debug, a reduction of about `85.54%` — **PASS**
- Compact response contained no nested duplicate Markdown, links, trace, ladder trace, or attempt body.

## Extraction observations

Among the 10 later-round records that matched the fixed expected region and stable per-ASIN currency context:

- ASIN exact: `10/10`
- Title present: `10/10`
- Recommendation ASIN leakage: `0/10`
- Evidence-backed scored fields: `10/10`
- Price/currency coverage: `4/10`
- Seller coverage: `2/10`

Coverage is not accuracy. Null price or seller values are honest omissions, but these counts do not meet the plan's 98% human-reviewed field-accuracy gate. The runner required the manifest's fixed expected `Singapore` region and did not promote records with an unobserved or mismatched region.

## Remaining Amazon v1 gates

1. Repeat the 10-URL run with the required egress label, fixed expected region, language, identity, and human field labels.
2. Reach 10/10 comparable products with exact subject identity and no recommendation contamination.
3. Validate at least 98% accuracy for applicable core fields, including price ownership, seller, stock, delivery region, variants, rating, review count, rank, specifications, and primary images.
4. Run the 100 unseen-product accuracy set only after the 10-product gate passes.
5. Run the 1000-product throughput, limiting, cancellation, retry, and recovery test only after the 100-product field gate passes.
