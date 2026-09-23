# Amazon adapter and batch integration: frozen-source evidence

The adapter and durable batch paths were integrated on `codex/amazon-adapter-integration` from `6693bcdce53e66a471b29cdc4b9b90bd0404cab7`. The final source freeze for this run is **`04ce58156e7c69e35afcc2ac3b5d15b8f207ed77`**. The checkout was clean before all three Amazon runs and the actual batch-crash test. The original dirty checkout and unrelated `* 2.*` files were not changed.

The fixed ten-product engineering and field gate passed after Howard reviewed and signed all 30 raw-page captures. Amazon remains `beta adapter`; the later 100-product and 1000-page promotion gates were not run.

## Fixed context and traceability

All runs used the same ten URLs from `research/amazon-product-baseline.v1.json`, the same `research/amazon-product-schema.v1.json`, `en-US`, the local default network, an anonymous Chrome/Playwright identity, and a Singapore 238823 public delivery preference. The benchmark-only state held SGD preferences for both Amazon.com and Amazon.sg; it was confined to Amazon domains and is ignored by Git. No account, proxy, or ordinary `standard` session rule was changed.

| Item | Value |
| --- | --- |
| Node / npm | v26.8.1 / 11.19.0 |
| Manifest SHA256 | `0150b8e19124e9abb7d24fa892dc44747a36c63c80adf95b9ede7940a840484a` |
| Schema SHA256 | `fdb13640d8a26c642b447ff44f5e4ecd1331dd5b87d92168def88d183c2fbc8b` |
| Anonymous-state SHA256 | `46da30659105f7018e15f1b3b294630d8ac27cb47f960751f4156ad38e375b0c` |
| Capture route | stdio MCP → local API → W2L browser capture |
| Raw capture integrity | All 90 saved HTML bodies rehashed against their per-page SHA256 records |

The [sanitized record](amazon-adapter-integration-2026-09-23.json) contains all 90 per-page outcomes, exact final URLs, times, raw-body hashes, selected fields, retries, response bytes, and source-report hashes. It contains no cookies, keys, or raw HTML. The raw reports and human review packet remain in the ignored `.w2l/amazon-baseline/` directory on the test machine.

## Engineering results

Each concurrency setting ran three complete ten-page rounds. Round 1 discovered page context; rounds 2–3 assessed comparability. The latter 20/20 records per setting kept Singapore delivery, the same final marketplace per URL, and the same price-currency outcome. Five URLs had no selected subject offer in the captured page, so their price and currency fields remained `null` in every round. This is stable absence, **not an observed quoted currency**. Blink Plus quoted USD 11.99 despite the SGD public preference and remained USD in every round. The other visible quotes were SGD. No mismatch, block, failed capture, or retry was dropped from the reports.

| Same-site concurrency | Ten-page round times (s) | Median (s) | Comparable | Success / blocked / failed | Compact / debug |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | 40.73 / 37.65 / 37.93 | 37.93 | 20/20 | 30 / 0 / 0 | 38.87% |
| 2 | 19.92 / 21.41 / 19.68 | 19.92 | 20/20 | 30 / 0 / 0 | 38.85% |
| 4 | 13.00 / 12.39 / 12.12 | 12.39 | 20/20 | 30 / 0 / 0 | 38.87% |

Concurrency 1 missed the ≤20 s median target; 2 and 4 met it in this fixed test. Concurrency 4 was tested only after the 1/2 comparison had no abnormal blocks. The compact-size comparison used one debug capture serialized both ways; default output had no nested duplicate body and stayed below the 60% gate. These timings are observations for this context, not a general Amazon throughput guarantee.

On the same frozen source, type checking passed and **86 test files / 980 tests passed**, including X exact-status and Reddit parent-chain counterexamples, Amazon identity/offer tests, MCP custom-Schema and legacy-links compatibility, and batch behavior. The [actual `SIGKILL` recovery record](batch-crash-recovery-integration-2026-09-23.json) shows a two-URL batch finishing after API restart: the completed first URL was fetched once and the interrupted second URL twice.

## Field review status

The review packet binds each of the 30 concurrency-4 captures to its capture time, raw HTML SHA256, field evidence location, output, and independent raw-HTML witness. Howard confirmed the five locked core fields (`asin`, `title`, `price`, `currency`, `seller`) and recommendation boundaries on every capture, then signed at **2026-09-23T04:38:03Z**. The [signed score and capture-hash list](amazon-field-review-signed-2026-09-23.json) record **105/105 correct emitted values** and **105/105 visible applicable values emitted**. Accuracy and visible-field coverage use separate denominators; both exceed the 98% gate.

The captured pages expose a primary price/currency/seller on five products per round. For the other five, two show “See All Buying Options” without a featured subject offer, and three show a Singapore shipping restriction. Recommendation prices visible on those restricted pages were excluded from subject fields. The selected Blink Plus buy box shows USD 11.99; USD 14.99 belongs to the different Plus AI plan. Automated fixed-cohort ASIN leakage checks and Howard's raw-page review found no cross-subject content.

| Acceptance item | Current state |
| --- | --- |
| Ten subject ASINs | 10/10 in each round; body/canonical and title corroboration in the review packet |
| Signed output accuracy | 105/105 (100%) |
| Signed visible-field coverage | 105/105 (100%) |
| Recommendation and cross-subject exclusion | Zero in automated checks and Howard's 30-page review |
| Howard review/signature | **Passed**, 2026-09-23T04:38:03Z; [signed record](amazon-field-review-signed-2026-09-23.json) |

The earlier `8a7637f` dirty-tree and adapter failure reports remain historical evidence. They are not used as this freeze's baseline. Cache is evaluated separately; these Amazon pages are not claimed to benefit from public 304 caching. No push, PR, publication, or deployment occurred in this slice.
