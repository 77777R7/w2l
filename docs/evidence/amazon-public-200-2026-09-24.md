# Public Amazon.sg 100 + 100 evaluation — 24 September 2026

The fixed cohort is a previously seen regression set; only the second cohort was frozen before product capture and is unseen relative to the recorded 532-ASIN exclusion ledger. Both used the public HTTPS `/api/preview` path with an owner-only evaluation witness against deployed source `bb32cbf306251de4855b1249416079dc06d2631d`. Raw same-capture HTML and full reports remain in the local ignored `.w2l/` directory; the committed ledger records each HTML SHA-256 without publishing raw pages, cookies, local paths or the evaluation credential.

| Measure | Fixed 100 | New 100 |
|---|---:|---:|
| Same-capture HTML hash verified | 100/100 | 100/100 |
| Public product success | 85/100 | 86/100 |
| JSON complete | 85/100 | 86/100 |
| Requested = raw selected ASIN | 100/100 | 98/100 |
| Singapore 238823 in raw capture | 100/100 | 100/100 |
| Singapore verified in output | 100/100 | 98/100 |
| SGD verified in output | 85/100 | 86/100 |
| Detected recommendation ASIN/image leak rows | 0/0 | 0/0 |
| Client p50 / p95 | 11.83 / 16.02 s | 11.60 / 17.73 s |

The new cohort has 12 pages without a selected quote and two substituted subjects: requested `B0BDXSK2K7` selected `B0D1V6F7Y9`, and requested `B0CMCQ3684` selected `B0CMCPRT3L`. W2L withheld their unverified product data. No safe adapter patch or redeployment followed this run. The five-field machine-assisted review scored 455/455 emitted values accurate and 455/455 visible values covered on the fixed set; 454/454 accurate and 454/461 visible values covered on the new set. Human source review remains pending.

The strict 100/100 product-success, JSON-completeness and selected-subject gates **failed**; this does not promote Amazon.sg from beta or open the 1000-page gate. Actual Cloud Run cost remains unreconciled with Billing.

- [Fixed 100 per-page audit](amazon-public-fixed-100-audit-2026-09-24.json) (15 incomplete; each row includes its same-capture HTML hash).
- [New 100 pre-frozen manifest](amazon-public-unseen-100-manifest-2026-09-24.json) (original SHA-256 `8e9d297224c2bf9c1ed6002d13f2d1874ee3cf583b2f919ce71e22357429540a`; listing discovery report SHA-256 `69d5b101bd960c3d04dc13bba664920270b9332bea262dd2f92ae244dce0c04c`).
- [New 100 per-page audit](amazon-public-unseen-100-audit-2026-09-24.json) (14 incomplete; includes both subject substitutions).

The frozen manifest's discovery report path points to local private evidence; it is deliberately not a public hyperlink. “Unseen” means absent from the frozen recorded ledger, not never viewed by anyone.
