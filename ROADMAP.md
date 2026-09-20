# W2L Roadmap

This is the current product roadmap. It reorganizes the older Phase 1/2/3 plan into three product Sections without rewriting historical documents.

## Current Position

**Section A · Reliable Data Collection → Phase A4 · Real-task evaluation and diagnosis**

Current baseline: `main@2f4af0a`.

Current truth:

- P0 foundation is implemented and merged.
- P1 composition closeout is implemented and merged.
- Local Reliability Gate is implemented and continuously checked in GitHub Actions.
- L0–L2 internal quality benchmark is implemented.
- Phase 3 page-quality comparison has valid Docker-runner evidence. W2L leads this fixed synthetic suite on verified completion and false-success rate; Firecrawl leads raw P95 wall time.
- Cost per verified page is unavailable because the self-hosted comparators have no comparable invoice model.
- Recovery comparison is unsupported for the page-only Firecrawl/Crawl4AI adapters; W2L has URL-level SQLite recovery.
- Phase 4 has started with a six-task real-source slice. It has not passed the 100–200 page or design-partner thresholds.
- A4 diagnostic expansion now covers 20 tasks across 11 domains; A5 has one measured stability fix, but product repeat consistency remains incomplete.
- A6 scale slice now covers 100 pages across 10 domains with 20 holdout pages and two independent runs; outcome consistency is 100/100 and normalized-hash consistency is 99/100. Recovery, installation, manual correction, and support-boundary gates remain open.
- A5 reports one measured stability fix; remaining product-page drift is classified, not globally normalized away. Cost remains unknown and human correction time is not yet recorded.
- A5/A6 final gate report is generated at `output/phase4/final-gate-report.json`; it deliberately remains partial until operator-independent installation, expanded recovery, human correction, comparable cost, and support-boundary evidence are recorded.
- Hosted arbitrary-URL browser execution remains gated on a separate egress/security review.

## Section Map

```text
Section A: Reliable data collection
  A1 Core collection and local reliability       accepted
  A2 L0–L2 internal quality benchmark             accepted
  A3 External comparison evidence                 accepted for page quality
  A4 Real-task evaluation and diagnosis            current
  A5 Quality, efficiency, and cost fixes           next after A4 diagnosis
  A6 Expanded validation and base-product gate    later

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

Section B and Section C are future product directions, not current implementation commitments.

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

**Status:** in progress; diagnostic expansion complete, gate not closed.

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

**Focus:** fix reusable extraction, subject/product identity, tables, dynamic readiness, unnecessary browser escalations, retry policy, and reportable resource cost. Every fix needs before/after evidence and must not improve scores by weakening assertions.

### A6 · Expanded Validation And Base-Product Gate

**Entry condition:** A4/A5 stop finding broad correctness failures.

**Scope:** 100–200 permitted pages across 10–20 domains, development vs holdout separation, repeat runs, interruption/recovery checks, installation and first-task validation by another developer, and support-boundary documentation.

**Exit:** a self-hosted developer alpha with a clear supported scope. It is not a claim of universal web success or public hosted readiness.

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
