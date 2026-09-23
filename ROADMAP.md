# W2L Roadmap

This is the current product roadmap. It reorganizes the older Phase 1/2/3 plan into three product Sections without rewriting historical documents.

## Current Position

**Section B core reliability validated → Section C delivery and onboarding**

Source freeze: `99894bd636ecafd254a7c7bc79d26e9a97fa9199`, merged by [PR #50](https://github.com/77777R7/w2l/pull/50) into `main` at `1c1481722ade26b717d18a34fa4b46362f53acf8` and published as source prerelease [`v0.4.0-rc.1`](https://github.com/77777R7/w2l/releases/tag/v0.4.0-rc.1), reviewed 2026-09-22. No npm package or permanent hosted deployment is implied. Section A remains a conditional developer alpha.

Current truth:

- P0 foundation is implemented and merged.
- P1 composition closeout is implemented and merged.
- Local Reliability Gate is implemented and continuously checked in GitHub Actions.
- L0–L2 internal quality benchmark is implemented.
- Phase 3 page-quality comparison has valid Docker-runner evidence. W2L leads this fixed synthetic suite on verified completion and false-success rate; Firecrawl leads raw P95 wall time.
- Cost per verified page is unavailable because the self-hosted comparators have no comparable invoice model.
- Recovery comparison is unsupported for the page-only Firecrawl/Crawl4AI adapters; W2L has URL-level SQLite recovery.
- A4 diagnostic expansion covers 20 tasks / 11 domains. Pair-level A5 quality on that slice is AI 11/11 and product 9/9 consistent after scoring calibration; run-level correct-complete is AI 22/22 and product 18/18.
- The A4/B2 Amazon correctness slice at source SHA `04ce581` passed the fixed ten-product, three-round gate: 20/20 later-round context-comparable captures at each 1/2/4 concurrency setting, signed core-field accuracy and visible-field coverage both 105/105, and zero reviewed recommendation intrusion. It was merged by [PR #52](https://github.com/77777R7/w2l/pull/52) into `main@8ff8863`; Amazon remains beta until the 100 holdout subject gate and 1000-page reliability gate both pass. [Evidence](docs/evidence/amazon-adapter-integration-2026-09-23.md).
- The [100-unseen-product Amazon holdout](docs/evidence/amazon-holdout-100-2026-09-23.md) at clean source `991097f` has Howard-reviewed five-field accuracy 456/456 and visible-field coverage 456/460, with no reviewed recommendation leakage. One page selected a different ASIN and was correctly `incomplete`: exact requested-subject completion is 99/100, so this gate is **not passed**. Amazon remains beta and 1000-page reliability has not run.
- A6 scale covers 100 pages / 10 domains / two runs. Outcome consistency 100/100; normalized-hash 99/100. Labeled every-fifth-task holdout is not an independent holdout.
- Interrupt/resume lost 0 checkpointed URLs. The killed attempt was previously left `running`; resume now marks it `interrupted`.
- Clean-clone install completed `ai-mdn-abortcontroller` on the author machine. Second-developer install is a recorded deferred exception, not a pass.
- External billed USD is unmeasured for the recorded local runs. Resource meters are separate; missing cost must not be invented as zero. A vendor-evidenced zero is a legitimate measurement.
- A6 is a scoped developer alpha. Unconditional pass still requires a second human install.
- Anti-blocking reliability slice: Retry-After HTTP-date parsing, bounded 503 backoff/jitter, and same-host 429/503 cooldown are implemented. This is compliant request discipline, not stealth or CAPTCHA bypass.
- Gate 2 execution checks passed: explicit captureMode, cancellation/deadline propagation, uncapped Retry-After, persisted Monitor origin cooldown, actual process-crash recovery and concurrent claim/fencing.
- Generic B1/B2 public-document configuration, typed fields, rule/schema attribution, A/B/A/B changes, real HTTP 304 with cached-body reassessment and multi-Monitor isolation have controlled integration evidence. Cross-date endurance, backup/restore and broader completeness remain open.
- B3 managed-session APIs exist; Existing Chrome/CDP and B4 Recipe are library-level implementations without dedicated integration evidence in this baseline.
- C1's delivery engineering slice passed: persistent worker/leases, retry/dead-letter, real HTTPS, stable event IDs, receiver deduplication and restart recovery. Long-term use by a real downstream customer is unverified.
- Gate 4 includes Crawl/Monitor/Delivery SDKs, examples, installation docs and an agent clean-install record. Independent human acceptance is pending; Gate 5 external pilots have not started.
- C2 Monitor/Delivery MCP and the local public-document → independent HTTPS receiver first-use flow are implemented. C3 has a unified single-instance process and authenticated Streamable HTTP implementation. Render hosting, WorkOS browser OAuth, real Codex client connection and hosted restart acceptance remain open; [walkthrough](docs/mcp-first-use.md).
- B3/B4 external validation is blocked on an authorized backend/account and a second reusable workflow; see `research/section-b-real-adoption-blockers.md`.
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
  B1 Stateful recurring tasks and data versions          in_progress (core reliability validated)
  B2 Trusted change detection and incremental updates   in_progress (typed changes/cache validated)
  B3 Chrome/user-authorized session reuse                in_progress (API + CDP library)
  B4 Narrow authorized-backend automation                in_progress (Recipe library)

Section C: Workflow productization and delivery
  C1 Reliable downstream data delivery                   in_progress (engineering slice validated)
  C2 MCP integrations, n8n and a narrow task UI           in_progress (MCP local flow; n8n/UI open)
  C3 Self-hosting, remote URL MCP and optional hosting    in_progress (implementation; hosted acceptance open)
  C4 Paid validation and limited scenario expansion      not_started
```

Section B has controlled B1+B2, B3 managed-session, B3 CDP, and B4 restricted-Recipe slices. None is a universal production claim; B3/B4 remain bounded prototypes.

Section B technical design: `docs/roadmap/section-b-technical-design-v1.md`.
B/C handoff: `docs/roadmap/section-b-handoff.md`.
Stage review: `docs/roadmap/stage-review-2026-09-22.md`.
Section C complete plan: `docs/roadmap/section-c-delivery.md`.

### Gate Status

| Gate | Current status |
| --- | --- |
| Gate 2 · Sustainable execution | Listed execution-contract and reliability engineering checks passed |
| Gate 3 · Deliverable events | Durable delivery, real HTTPS, retry, deduplication and restart recovery passed |
| Gate 4 · Independent onboarding | SDK, docs, examples and agent clean install complete; non-author human acceptance pending |
| Gate 5 · Pilot readiness | Two external users, two weeks of operation, repeat use and a real downstream scenario not yet verified |

Evidence and boundaries: [Gate 2–4 acceptance](docs/roadmap/gate-2-4-acceptance.md).
Next priority: finish C3 deployment and WorkOS/Codex browser login, then separately accept connection, task completion and continued monitoring after an actual hosted restart. C2 n8n/UI, Gate 4 independent human onboarding and Gate 5 pilots remain open. The roadmap remains A → B → C.

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

**Status:** diagnostic expansion accepted as evidence. A separate fixed ten-Amazon-product field gate passed with Howard's signed raw-page review on the isolated integration branch; it is not a general field-accuracy claim.

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

**Status:** conditional developer alpha. Scale and recovery evidence exist, including a fresh recovery run that marks the killed attempt `interrupted`. Second-developer install is deferred. Quality/holdout evidence and the unverified human-time record also need calibration; see the current stage review. Billed USD is unknown, not zero.

**Exit:** a self-hosted developer alpha with a clear supported scope. It is not a claim of universal web success or public hosted readiness. `accepted_with_unknown_external_usd` from PR #39 is evidence of recorded files, not this exit.

## Section B

Section B combines the future differentiators around one customer task rather than creating four separate products.

### B1 · Stateful Recurring Tasks And Versions

Track stable object identity, extraction-rule version, last valid result, last check, last success, and history. A failed refresh must not overwrite valid data.

**Status:** in_progress. Generic Monitor configuration, cancellation/deadlines, durable run claims, fencing and actual crash recovery passed the scoped Gate 2 checks. Cross-date operation, managed deployment and backup/restore remain open.

### B2 · Trusted Change Detection And Incremental Updates

Distinguish `changed`, `unchanged`, `cannot_verify`, and `stale`. Compare target fields/content after quality validation. Do not promise a percentage cost reduction before measuring it.

**Status:** in_progress. Typed fields, rule/schema attribution, controlled A/B/A/B changes, conditional HTTP/cache-body validation and multi-Monitor isolation passed. The [signed ten-Amazon-product subject/field gate](docs/evidence/amazon-adapter-integration-2026-09-23.md) adds a real-site correctness slice. The [100-unseen-product holdout](docs/evidence/amazon-holdout-100-2026-09-23.md) passes five-field accuracy and visible-field coverage thresholds but fails the strict 100/100 requested-subject gate on one honestly incomplete page. Broader list completeness/deletion semantics, a completed 100-product subject gate, 1000-page reliability and real-world efficiency measurements remain open.

### B3 · Authorized Session Reuse And Handoff

Reuse user-authorized sessions with isolation, expiry detection, revocation, and human handoff. Do not promise permanent login or automatic CAPTCHA defeat.

**Status:** in_progress. Managed-session API and CDP library exist; verified login/handoff, shared control path and real browser lifecycle evidence remain open.

### B4 · Narrow Authorized-Backend Automation

Support a small number of repeatable, authorized workflows only after evidence shows multiple customers share the same backend and data shape.

**Status:** in_progress. Recipe library exists; product entry, dedicated execution tests and an authorized backend pilot remain open.

## Section C

### C1 · Reliable Data Delivery

**Status:** in_progress. Persistent HTTPS Webhook delivery, leases, retry/dead-letter and an idempotent receiver are implemented and verified. Actual customer consumption over time remains unverified. Keep the existing API/SDK as the business contract.

### C2 · MCP Integrations, n8n And Narrow Task UI

**Status:** in_progress. Monitor/Delivery MCP tools and the local conversational source → sample → paused task → HTTPS delivery → result/failure flow are implemented over REST/SDK and stored task state. n8n and a narrow task UI remain planned; they share the same contract.

### C3 · Self-Hosted And Optional Hosted Delivery

**Status:** in_progress. Installation docs, source packaging and agent clean-install evidence exist. A unified API/scheduler/delivery-worker process and restricted authenticated Streamable HTTP MCP are implemented and tested locally. Permanent Render deployment, WorkOS browser login, real Codex connection and hosted restart/continuity acceptance remain open. The wider public-hosting gates for arbitrary sources are still separate.

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
