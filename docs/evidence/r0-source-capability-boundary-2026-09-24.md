# R0 source capability and failure boundary — 24 September 2026

This is a task-level map of the **technical public preview**, not an MVP support promise. The deployed build at the time of the Amazon audit was `bb32cbf306251de4855b1249416079dc06d2631d`. A later R0 image may add explanations, but it does not repair the product captures or change their denominators.

| Source / task | Access | Environment | Capture route | Output scope | Level and verified build | Boundary |
| --- | --- | --- | --- | --- | --- | --- |
| Public documentation / one-page extraction | Anonymous visitor, 3/day and site-wide 100/day | Cloud Run preview | Restricted HTTP | Readable Markdown, final URL, status, elapsed time | Conditional, public documentation smoke on `bb32cbf` | Redirects/private IPs blocked; site policy, timeout, or dynamic rendering may prevent content. |
| Amazon.sg `/dp/{ASIN}` / one-product JSON | Anonymous, configured Singapore 238823 and SGD context | Cloud Run preview | Domain-limited Chromium | Verified selected subject, region, currency, selected quote and product fields when complete | Beta, 200-page public audit on `bb32cbf` | 85/100 fixed and 86/100 new complete; 29 incomplete, two selected-subject substitutions. The 100/100 gate failed. |
| X public status / one-post content | Anonymous public page | Cloud Run preview | Restricted HTTP only | Requested post text/author only if the post identity is verified | Conditional; hosted post success unverified | Robots, login, rendering and challenges can block. A local Beta adapter does not verify this hosted route. |
| Reddit public thread / post and visible comments | Anonymous public page | Cloud Run preview | Restricted HTTP only | Requested post and visible comments only if verified | Conditional; hosted thread success unverified | Robots, login, rendering and comment pagination may block or limit output. Local proxy experiments are separate. |
| Generic web page / one-page extraction | Anonymous public page | Cloud Run preview | Restricted HTTP | Readable Markdown and status | Conditional, `bb32cbf` | No arbitrary browser fallback or visitor-supplied capture settings. |
| Monitor → HTTPS webhook | Locally configured operator and storage | Local MCP/service | Local scheduler, capture and delivery | Persistent monitor events with `eventId` | Local only; see repository guides | No durable Monitor/Delivery worker on anonymous Cloud Run. |
| Persistent Batch → paginated results | Locally configured operator and storage | Local MCP/service | Local worker | Durable batch result pages | Local only; see repository guides | Not part of the anonymous one-page preview. |

The server's `GET /api/capability` returns the planned route for a URL from fixed local rules. It performs no target request and spends no quota. Known private or reserved targets are marked unsupported before capture; DNS results and redirects remain subject to guarded transport checks. The `POST /api/preview` result is the source of truth for an observed status and diagnostic. The preflight cannot guarantee that a public page is reachable, that a quote exists, or that a returned document is the requested subject.

## Frozen Amazon failure ledger

The [sanitized per-page ledger](amazon-public-r0-failure-ledger-2026-09-24.json) includes all 29 incomplete rows and 20 success controls selected by a deterministic hash rule **before** their raw HTML was reviewed. Its audit script rechecked all 200 source report hashes and all 200 same-capture HTML hashes against the committed audit records. Original reports and HTML remain under private ignored `.w2l/` storage. Historical redirect chains and screenshots were not recorded; those fields explicitly say `not_recorded`.

| Observed class in the captured selected-product area | Fixed 100 | New 100 | Interpretation |
| --- | ---: | ---: | --- |
| “Currently unavailable” | 1 | 3 | The captured page lacks a selected quote in that context. This does not prove the product never has an offer elsewhere. |
| “See All Buying Options” without a selected quote | 14 | 9 | The captured buy box offers an unopened options path. Other public offers were not assessed. |
| Requested ASIN differs from selected ASIN | 0 | 2 | A different product was selected; W2L withheld its record. One substitute page visibly had a quote, which does not belong to the requested product. |

Every row records the capture time, source commit, requested and selected ASIN, final URL, region/currency observation, quote selector, client/server/browser/retry timing, private witness location relative to `.w2l/`, witness SHA-256, classification and review status. The first two rows in this table are **capture observations**, not proven root causes of a site's commercial state. The 20 success controls showed matching selected ASIN, Singapore context and explicit SGD quote; they are contrast samples, not an accuracy sign-off. Independent human sign-off remains pending. The reported product-success and JSON-completeness denominators remain the original 100 per cohort.

R1 owns identity and quote fixes. R4 owns correctness revalidation and the 1000-page gate. R0 does not rerun or relax either gate.
