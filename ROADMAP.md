# W2L Roadmap

This is the current product roadmap. It reorganizes the older Phase 1/2/3 plan into three product Sections without rewriting historical documents.

## Current Position

**Section A · Reliable Data Collection → A6 conditional developer alpha**

Current baseline: `main@e701aa4`.

Current truth:

- P0 foundation is implemented and merged.
- P1 composition closeout is implemented and merged.
- Local Reliability Gate is implemented and continuously checked in GitHub Actions.
- L0–L2 internal quality benchmark is implemented.
- Phase 3 page-quality comparison has valid Docker-runner evidence. W2L leads this fixed synthetic suite on verified completion and false-success rate; Firecrawl leads raw P95 wall time.
- Cost per verified page is unavailable because the self-hosted comparators have no comparable invoice model.
- Recovery comparison is unsupported for the page-only Firecrawl/Crawl4AI adapters; W2L has URL-level SQLite recovery.
- A4 diagnostic expansion covers 20 tasks / 11 domains. Pair-level A5 quality on that slice is AI 11/11 and product 9/9 consistent after scoring calibration; run-level correct-complete is AI 22/22 and product 18/18.
- A6 scale covers 100 pages / 10 domains / two runs. Outcome consistency 100/100; normalized-hash 99/100. Labeled every-fifth-task holdout is not an independent holdout.
- Interrupt/resume lost 0 checkpointed URLs. The killed attempt was previously left `running`; resume now marks it `interrupted`.
- Clean-clone install completed `ai-mdn-abortcontroller` on the author machine. Second-developer install is a recorded deferred exception, not a pass.
- External billed USD is unknown by design. Comparable cost is resource meters. Filling `0` is forbidden.
- A6 is a scoped developer alpha. Unconditional pass still requires a second human install.
- Anti-blocking reliability slice: Retry-After HTTP-date parsing, bounded 503 backoff/jitter, and same-host 429/503 cooldown are implemented. This is compliant request discipline, not stealth or CAPTCHA bypass.
- Hosted arbitrary-URL browser execution remains gated on a separate egress/security review.

## Section Map

```text
Section A: Reliable data collection
  A1 Core collection and local reliability       accepted
  A2 L0–L2 internal quality benchmark             accepted
  A3 External comparison evidence                 accepted for page quality
  A4 Real-task evaluation and diagnosis            accepted as diagnostic evidence
  A5 Quality, efficiency, and cost fixes           quality closed on 20-task slice; billed USD unknown
  A6 Expanded validation and base-product gate    conditional alpha; second-developer install deferred

Section B: Continuous updates and authorized access
  B1 Stateful recurring tasks and data versions
  B2 Trusted change detection and incremental updates
  B3 Chrome/user-authorized session reuse
  B4 Narrow authorized-backend automation

Section C: Workflow productization and delivery
  C1 Reliable downstream data delivery
  C2 n8n integration and a narrow task UI
  C3 Enterprise self-hosting and optional hosted delivery
  C4 Paid validation and limited scenario expansion
```

Section B is approved for a controlled B1+B2 prototype only. B3, B4, and Section C remain future directions.

Section B technical design: `docs/roadmap/section-b-technical-design-v1.md`.
Bounded B1+B2 handoff: `docs/roadmap/section-b-handoff.md`.

## Section A

### A1 · Core Collection And Local Reliability

**Goal:** deliver stable Markdown/JSON, traceable failure, checkpointed crawl execution, explicit cost/evidence, and safe local resource cleanup.

**Status:** accepted through the merged P0/P1 work and Phase 1 Local Reliability Gate.

**Evidence:** PRs #14–#19, current CI workflow, SQLite task/attempt/step runtime, browser and robots regression tests.

**Not included:** universal anti-bot bypass, stealth engine, proxy pool, public arbitrary-URL hosting.

### A2 · L0–L2 Internal Quality Benchmark

**Goal:** measure identity/policy integrity (L0), HTTP quality (L1), and browser escalation quality (L2) on a fixed, reproducible fixture suite.

**Status:** accepted as an internal regression instrument.

**Metrics:** verified completion, false-success rate, P95 wall time, escalation count, cost observability, and tiered quality output.

**Boundary:** this is not a real-web coverage claim.

### A3 · External Comparison Evidence

**Goal:** compare W2L against fixed self-hosted comparator configurations with raw evidence and explicit limits.

**Status:** page-quality comparison completed. W2L led the fixed synthetic suite on verified completion and false-success rate; Firecrawl led raw P95 latency.

**Unfinished metrics:** cost per verified page and equivalent recovery correctness.

**Evidence:** `docs/benchmark-gate.md`, GitHub Actions run artifacts, PRs #21–#30.

### A4 · Real-Task Evaluation And Diagnosis

**Goal:** prove that W2L can repeatedly deliver field-level data for real, permitted sources, not only synthetic fixtures.

**Status:** diagnostic expansion accepted as evidence. Not a general field-accuracy claim.

**First task families:**

- AI knowledge: official documentation with title, source URL, main content, headings/tables where present, timestamp, content hash, and missing-field reasons.
- Product information: official product/pricing pages with product name, specification/attributes, price where present, source URL, subject-vs-recommended distinction, update time, conflicts, and missing reasons.

**Current slice:** twenty tasks, forty runs, two repeats per task, eighteen holdout runs. Current slice is diagnostic evidence, not Phase A completion.

**Acceptance:**

- Two real task families repeat successfully.
- Each family has field-level assertions and explicit unknowns.
- Holdout sources are not used to tune extraction.
- Outcomes distinguish `correct_complete`, `partial_missing_fields`, `false_success`, `reasonable_rejection`, `retryable_failure`, and `non_retryable_failure`.
- Repeated runs record content hash consistency.
- Wall time, tokens, request count, lane, evidence, artifacts, and cost uncertainty are preserved.
- At least one task feeds a real research/data workflow.

### A5 · Quality, Efficiency, And Cost Fixes

**Entry condition:** A4 produces a trustworthy failure taxonomy and field-level diagnosis.

**Status:** quality on the 20-task slice is closed at pair level. Repeat scoring now counts task pairs, not r1-null plus r2. Billed USD remains unknown.

**Focus:** reusable extraction, subject/product identity, tables, dynamic readiness, unnecessary browser escalations, retry policy, and reportable resource cost. Every fix needs before/after evidence and must not improve scores by weakening assertions.

### A6 · Expanded Validation And Base-Product Gate

**Entry condition:** A4/A5 stop finding broad correctness failures.

**Scope:** 100–200 permitted pages across 10–20 domains, development vs holdout separation, repeat runs, interruption/recovery checks, installation and first-task validation by another developer, and support-boundary documentation.

**Status:** conditional developer alpha. Scale and recovery evidence exist, including a fresh recovery run that marks the killed attempt `interrupted`. Second-developer install is deferred (`research/phase4_deferred_exceptions.json`). Billed USD is unknown, not zero.

**Exit:** a self-hosted developer alpha with a clear supported scope. It is not a claim of universal web success or public hosted readiness. `accepted_with_unknown_external_usd` from PR #39 is evidence of recorded files, not this exit.

## Section B

Section B combines the future differentiators around one customer task rather than creating four separate products.

### B1 · Stateful Recurring Tasks And Versions

Track stable object identity, extraction-rule version, last valid result, last check, last success, and history. A failed refresh must not overwrite valid data.

### B2 · Trusted Change Detection And Incremental Updates

Distinguish `changed`, `unchanged`, `cannot_verify`, and `stale`. Compare target fields/content after quality validation. Do not promise a percentage cost reduction before measuring it.

### B3 · Authorized Session Reuse And Handoff

Reuse user-authorized sessions with isolation, expiry detection, revocation, and human handoff. Do not promise permanent login or automatic CAPTCHA defeat.

### B4 · Narrow Authorized-Backend Automation

Support a small number of repeatable, authorized workflows only after evidence shows multiple customers share the same backend and data shape.

## Section C

### C1 · Reliable Data Delivery

Keep the API. Add Webhook and one validated downstream destination first. Ensure idempotency, updates by stable key, retry without duplicates, and preservation of the last valid value after fetch failure.

### C2 · n8n Integration And Narrow Task UI

Integrate first; build a task configuration UI before considering a general workflow canvas. The first UI should be source → fields → schedule → output → sample check → run history.

### C3 · Self-Hosted And Optional Hosted Delivery

Self-hosted deployment, secrets, storage, backups, and allowed egress are one track. Public hosted delivery requires the separate Hosted Egress Gate, tenant isolation, quotas, cancellation, resource limits, and operational evidence.

### C4 · Paid Validation And Limited Expansion

Validate repeat use and willingness to pay before adding vertical connectors. Distinguish fixed monthly hosting value from usage pricing. Do not preselect SEO, commerce, or another branch before real repeated tasks identify it.

## Historical Mapping

The previous phase numbers remain valid historical references:

| Historical item | Current roadmap location |
| --- | --- |
| Phase 1 Local Reliability Gate | A1, with the gate accepted in CI |
| Phase 2 L0–L2 benchmark | A2 |
| Phase 3 external Benchmark Gate | A3 |
| Phase 4 real-task validation | A4 |
| Future real-quality and efficiency work | A5 |
| 100–200 page/base-product validation | A6 |

`PRODUCT_PLAN_V2.md` remains the historical detailed plan and milestone record. It is not rewritten wholesale to avoid erasing historical decisions and evidence.

## State Vocabulary

Every phase should use one of these states:

- `not_started`
- `in_progress`
- `implementation_complete_waiting_for_gate`
- `accepted`
- `blocked`

Merged PRs are evidence of code changes, not automatic phase acceptance.
