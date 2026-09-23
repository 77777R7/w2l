# Dual-flow MVP candidate: local transport and frozen Amazon 100

The [MVP contract](../roadmap/dual-flow-mvp-gates.md) was committed as
`b43aff69c18f4429cabe766a6d8e93cbd1f89d13` before this capture. Runtime
source was clean at `84644575c8b24eb28cb151eba415fcc82c484e78`.
The [per-page ledger](dual-flow-mvp-local-100-2026-09-23.json) preserves all
100 URL outcomes and raw-body SHA256 values. The actual HTML and full review
sheet remain in the ignored local run directory:
`.w2l/dual-flow-final-100/2026-09-23T12-03-19-460Z/`.

This was the candidate **Streamable HTTP MCP** path with the official MCP
client, real Amazon.sg browser captures, fixed product Schema and durable
batch pagination. It used a local test token verifier and local egress; it is
**not** WorkOS login, Render hosting, or independent-user acceptance.

| Measure | Observed |
| --- | --- |
| Window | 2026-09-23 12:03:19–12:05:56 UTC |
| Manifest SHA256 | `4764bf94aee623d6fbb762dc8cd00f2053b3eb7de8706584bb0e40ffe15257c5` |
| Normalized Schema SHA256 | `fdb13640d8a26c642b447ff44f5e4ecd1331dd5b87d92168def88d183c2fbc8b` |
| Anonymous state SHA256 | `a454947799452820745f4c6e1cf56f408eb6f01bb09cc720f42ec4c7ca118b97` |
| Runtime | Node v26.8.1, npm 11.19.0; anonymous en-US browser, Singapore 238823/SGD, local default egress, concurrency 2 |
| Batch and pagination | Completed, 100/100 distinct durable items, 100/100 retrieved across pages; client elapsed 157.36 s |
| Capture and identity | 100/100 success, 100/100 structured complete, 100/100 requested ASIN equals selected raw-page ASIN |
| Context | Singapore 238823 visible 100/100; every visible selected quote uses SGD |
| Per-page latency | p50 3.02 s, p95 3.50 s, max 5.61 s, including queue and any waits |
| Failure/retry | 0 failed/blocked, 0 status retries, 1 witnessed child-variant follow-up; the follow-up is not counted as a retry |
| Raw/recommendation checks | 100 HTML SHA256 verified; 0 recognized recommendation ASIN or image leaks; 142/142 emitted prices and 103/103 emitted images had subject-area witnesses |
| Resource/cost | 170,467,673 decompressed page bytes; summed browser time 293,104 ms; 0 model calls and 0 paid browser-vendor calls in this fixed path. Host/egress USD and actual hosted plan cost remain unknown. |

The independent raw-page reviewer compared emitted values and *visible*
values separately. ASIN and title were 100/100 accurate and 100/100 covered.
Price, currency and seller were each 88/88 accurate **and** 88/88 covered
where visible. On the other 12 pages those fields were not visible in the
selected offer, so the output is null with `field_unavailable` reasons. These
counts do not mean 100% of all products had a price. The reviewer is a script,
not Howard's required non-code-author signature. **The 100-product gate is
still pending his review**, and the hosted-path gate is still open.

To reproduce this local diagnostic from the frozen candidate, first run
`npm run typecheck`, then set `W2L_AMAZON_PUBLIC_STATE_FILE` to an operator-made
anonymous Singapore/SGD state and run
`node scripts/section-c/dual-flow-amazon-holdout.mjs`. For the resulting
`report.json`, run `node scripts/section-c/link-amazon-raw-evidence.mjs REPORT`
and `node scripts/section-b/amazon-holdout-review.mjs --report LINKED_REPORT --output-dir REVIEW_DIR`.
The state and full HTML stay under ignored `.w2l/`; a new run must retain its
own timestamp and cannot replace this record.

The same local unified MCP configuration, with the anonymous Amazon state
loaded, also passed the public-document Monitor → independent temporary HTTPS
receiver flow at 2026-09-23 12:10 UTC. Preview was valid; delivery and receiver
agreed on `eventId` `13c87949-735f-417a-9586-e12bc62df119`; receiver saved
one receipt. Real `SIGKILL` with a pending delivery and then a queued Monitor
run recovered the same state; the Monitor was paused afterward. That receiver
URL was a short-lived tunnel and is no longer a product endpoint. The full
local log is `.w2l/c2-first-use-1790165369977/evidence.json`.

`npm run typecheck` and the full 91-file/999-test suite passed on the candidate;
the Render Blueprint validated with two services. No PR, push, merge, Render
deployment, WorkOS authentication, hosted restart, 1000-page run, or external
trial occurred here. The 1000-page reliability run remains gated on the signed
100-product review and the final authenticated hosted path, as registered in
the MVP contract.
