# Dual-flow MVP: frozen scope and pre-registered gates

Status: **not accepted for external trial**. This contract is locked before a
new Amazon 100-product run or any 1000-page run. Its source baseline is
`main@7015a3fc828f3f997dea8d8b8cea10ad9212def4`; later implementation
must record its own clean commit. Historical captures are not proof for that
later commit.

The first public promise has two flows through **one authenticated HTTPS MCP
URL**. Users connect without cloning this repository or starting workers.
Connection, useful result, event delivery, and restart survival are separate
checks.

## Supported scope

1. **Public documentation Monitor and HTTPS events.** Preview a user-selected,
   public HTTPS documentation page from a reviewed allowlist, initially
   `docs.firecrawl.dev` and `modelcontextprotocol.io`; create, run, pause, and
   resume a durable Monitor; inspect the last valid result, field evidence,
   missing reasons, and failures. Deliver initialized/changed events to a
   pre-approved public HTTPS receiver, signed with a server-side secret; the
   receiver may deduplicate by `eventId`. Firecrawl Introduction remains a
   preset, not the only usable source. No login walls, CAPTCHA bypass, private
   networks, arbitrary domains, or exactly-once network delivery are promised.
2. **Amazon Singapore product JSON and persistent URL batches.** Accept public
   `https://www.amazon.sg/dp/{ASIN}` product pages in an unsigned-in browser
   with Singapore 238823 delivery preference, SGD currency preference,
   `en-US` language, and fixed egress identity. Return verified subject ID,
   title, selected price/currency/seller when visible, field-level evidence,
   and explicit null/missing reasons. A mismatched subject, challenge, or
   unavailable offer is not a successful product record. No logged-in price,
   private API, CAPTCHA bypass, universal stock, or other Amazon marketplaces
   are promised. Batches expose status, paginated results, and cancellation;
   server-side concurrency, spacing, deadlines, and resource budgets are
   bounded.

This release does not promise Reddit/X promotion, arbitrary-site hosted
browser automation, a general workflow canvas, or a plugin ecosystem.

## Correctness gate before scale

- Reuse the frozen 100 unseen Amazon.sg URL cohort, JSON Schema, and field
  definitions. Keep all URLs, including `B000VW9PIK`; pin region, currency,
  language, browser identity, and egress. Record clean source SHA,
  manifest/Schema/state hashes, raw HTML hashes, timing, attempts, and every
  failure. No URL replacement or removal of blocked/incomplete rows.
- **100/100** requested ASINs must match an independently witnessed selected
  page subject and yield a complete subject record. Request URLs alone cannot
  prove identity. Emitted-value accuracy and visible-field coverage of ASIN,
  title, selected price, currency, and selected seller must **each reach
  98%**, scored separately. Absent page fields require null plus reason and
  are not counted as visible. Recommendation ASIN/price/image contamination
  must be **zero**. A non-code author reviews raw-page evidence before signoff.
- The `991097f` capture remains historical: 99/100 exact subjects, 456/456
  emitted values correct, 456/460 visible fields covered. Row 40 is a failure,
  not a URL to drop. Investigate its selected-variant behavior, then rerun
  the fixed cohort on the final candidate.

## 1000-page reliability gate, registered before execution

Run only after the 100-product correctness gate passes. Freeze **1000 distinct
Amazon.sg product URLs** excluding the 10-product development set and the
100-product holdout; record manifest SHA before capture. Use the **same hosted
MCP, browser, region state, egress, and resource limits** as the launch path,
with same-origin concurrency initially 2. A local Mac run is diagnostic, not
a substitute. Do not deliberately flood Amazon to create errors; inject
429/503, Retry-After and deadline conditions on a controlled source instead.

| Measure | Pass line |
| --- | --- |
| Accounting | 1000/1000 URLs have exactly one durable terminal item after pagination and restart; zero lost or duplicate items. Every blocked, incomplete and failed item remains in the denominator. |
| Product completion | At least 990/1000 return `complete` with requested ASIN matching the selected subject; **zero** wrong-subject `complete` results and zero known recommendation contamination. Every other item has a specific reason. |
| Region/quote comparability | Every `complete` record witnesses Singapore delivery context; every visible selected quote uses SGD. Missing or changed context is non-complete and remains in the 1000 denominator. |
| Latency | Batch wall time at most 90 minutes; per-URL client p50 at most 8 seconds and p95 at most 15 seconds, including failures and retry waits. Report complete and non-complete latency separately too. |
| Durability | A real process kill during queued/active work restores the same task ID and remaining items; all 1000 become terminal without duplicate product records. Cancellation of a separate active batch stops future work within its deadline. |
| Rate/retry | Same-origin limits and minimum interval remain in force. Controlled 429/503 and Retry-After exercises yield zero premature retries; deadline and cancellation interrupt waits. Live 429/503 and retries are reported. |
| Resources/cost | No OOM or disk exhaustion within the selected single-instance plan. Record peak RSS, CPU time, browser count, bytes, plan/rate assumptions, actual paid provider usage or verified zero; unknown billed USD stays unknown. No savings claim without a comparable baseline. |

Report run time, clean source SHA, Node/npm, URL/Schema/state hashes,
host/region, all 1000 records, p50/p95, retries, failures, and resource/cost
ledger. Review a preselected 100-page field sample **plus every anomalous
item** against saved raw HTML; any wrong subject or recommendation leak fails.
This reliability run cannot replace the separate 100-page accuracy gate.
Threshold changes require a new version of this document **before** another
run, retaining every earlier failed run.

## One-link and independent-use gate

The hosted endpoint must expose both documented Monitor/Delivery and Amazon
scrape/batch tools. The actual Codex client must authenticate, preview,
complete both flows, retrieve paginated batch results, receive one signed
event with matching `eventId`, disconnect, then reconnect after a service
restart and inspect durable state. Invalid Origin, token, owner, private
egress, and over-budget requests fail closed. Browser subresource policy,
DNS-to-connection checks, quotas, and cleanup need hosted evidence, not just
loopback tests.

One non-author developer must independently complete both flows from the
published connection guide. Record setup and first-result minutes,
assistance, failures, and actual downstream use. This controlled acceptance
precedes broader external trial but does not count as Gate 5's two-user,
two-week adoption result. Consider a new RC only after every gate passes on
one clean candidate commit.
