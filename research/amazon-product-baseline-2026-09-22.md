# Amazon product baseline — 2026-09-22

This is the versioned summary of the real W2L stdio MCP run. The raw local report remains at
`.w2l/amazon-baseline/2026-09-22T18-25-04-509Z.json`; it contains all 30 records, field evidence,
issues, timing and response-size measurements.

## Reproduction identity

- Source commit: `193133e36be86aa5406a2299c8628c182eb5455d`
- Run: 2026-09-22T18:22:44.627Z to 2026-09-22T18:25:04.509Z
- Node/npm: v26.8.1 / 11.19.0
- Schema SHA256: `fdb13640d8a26c642b447ff44f5e4ecd1331dd5b87d92168def88d183c2fbc8b`
- Region policy: pin the first real observed delivery region; the placeholder `Update location` is not a region
- Observed region: Singapore

## Results

- All 30 requests succeeded, and all 30 returned the exact URL ASIN plus a non-empty title.
- Round 1 contains 10 discovery records. Of the later 20 records, 12 exposed the pinned region and were comparable; 8 did not expose a region and were retained as `region_unobserved` rather than mixed into the comparison.
- Comparable client latency was p50 4,061 ms and p95 4,766 ms. API end-to-end `totalMs` was p50 4,049 ms and p95 4,751 ms.
- The comparable final lane was browser-local, so its optional transport/extract split is unavailable; monotonic queue and end-to-end totals remain present. Controlled HTTP tests separately cover body delay, retry wait, 429, deadline and cancellation phase timing.
- Comparable checks: ASIN 12/12, title 12/12, price/currency consistency 12/12, evidence-backed scored fields 12/12, and zero known recommendation-ASIN leaks.
- Field coverage was price 10/12, currency 10/12 and seller 2/12. Missing fields remain `null`; coverage is not presented as extraction accuracy.
- The same-capture compact Markdown MCP response was 84,853 bytes versus 198,658 bytes in debug mode (42.71%). It contained no nested attempt body and passed the 60% ceiling.

## Interpretation boundary

This run proves repeatability, identity binding, region filtering, evidence carriage and response compaction for the observed captures. It does not substitute automated consistency checks for independent human truth. A person must still compare title, price, currency and seller against the page as displayed at capture time before claiming live-field accuracy.
