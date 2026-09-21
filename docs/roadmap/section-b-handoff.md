# Section B Handoff

Current status (2026-09-22, `main@e29dc6b`): **B1–B4 in_progress**.
Use [the stage review](stage-review-2026-09-22.md) for current evidence limits
and [Section C](section-c-delivery.md) for the next delivery plan. Earlier
completion summaries do not supersede these acceptance gaps.

The full technical design is in [`section-b-technical-design-v1.md`](./section-b-technical-design-v1.md).

The imported design document is a draft written against an older baseline
(`main@fdc6559`). The current repository baseline is newer. Treat the design
as an architectural proposal and source of constraints, not as evidence that
the proposed B interfaces are already implemented or production-validated.

## Decision

Proceed with bounded B1+B2, B3, and B4 slices only. Do not claim universal
session access, general backend automation, model-driven repair, or a second
orchestration framework.

## Highest-ROI Slice

Build one real recurring task for a public official documentation or product page:

```text
Monitor revision
  -> Run / Attempt
  -> Observation
  -> QualityAssessment
  -> valid Snapshot / Baseline
  -> typed field diff
  -> ChangeEvent / local Outbox
```

The slice must preserve the last valid snapshot when a refresh is blocked, partial, stale, or otherwise unverifiable.

## Existing Foundation To Reuse

- `LadderScrapeAtom` and `LadderRunner` remain the collection path.
- `LadderRunAudit.summary` is the execution-meter source.
- `CrawlOrchestrator` and SQLite `TaskStore` remain the checkpoint path.
- Existing REST/SDK/MCP scrape and crawl APIs remain compatible.

## First Deliverables

1. Versioned monitor configuration with a stable `monitorId` and immutable revision.
2. Durable run state with one active logical run per monitor and an idempotent trigger key.
3. Observation and quality records that distinguish `valid`, `partial`, `invalid`, and `unknown`.
4. Snapshot and baseline persistence where invalid observations cannot advance the baseline.
5. A typed diff for one narrow field schema, with `changed`, `unchanged`, and `cannot_verify` outcomes.
6. A local outbox record with a stable event ID and duplicate-safe retry state.
7. Failure-injection tests for restart, stale worker submission, invalid refresh, and duplicate trigger.

## Explicit Non-Goals

- No CAPTCHA bypass or stealth.
- No unbounded Existing Chrome control.
- No provider or model dependency in the first verified slice.
- No universal backend automation.
- No claim of billed USD; external billed cost remains `unknown` unless a vendor states it.

## Entry Evidence

- Section A is a scoped developer alpha, not an unconditional A6 pass.
- Second-developer installation is explicitly deferred in `research/phase4_deferred_exceptions.json`.
- Resource meters are available; billed USD remains unknown.
- A6 quality subset is separate from the scale/nonempty check.

## B1 Exit Gate

The first slice is complete only when the same monitor can run repeatedly and after a restart while preserving the last valid snapshot, refusing stale-worker commits, producing at most one event per committed change, and exposing the full run/quality/change state through one API path.

## First Real Task Evidence

The first real task is `https://docs.firecrawl.dev/introduction`, using the deterministic `firecrawl-introduction/v1` field schema. The recorded local evidence is in [`../../research/section-b-firecrawl-monitor-evidence.json`](../../research/section-b-firecrawl-monitor-evidence.json).

Run it locally with:

```bash
npm run section-b:firecrawl
W2L_B1_TRIGGER_KEY=manual:second npm run section-b:firecrawl
W2L_B1_TRIGGER_KEY=manual:second npm run section-b:firecrawl # idempotent replay
W2L_B1_ROOT=.w2l/section-b npm run section-b:firecrawl -- --view
```

The persisted scheduler path can be exercised once with:

```bash
W2L_B1_ROOT=.w2l/section-b npm run section-b:scheduler -- --once
W2L_B1_ROOT=.w2l/section-b npm run section-b:export-evidence
```

It reads `nextRunAt` from SQLite. A production scheduler would replace the
polling loop, not the persisted claim/lease/commit protocol.

The slice has recorded initialization and unchanged refresh semantics through
the fixed monitor API. Field change is covered by a constructed-assessment
SQLite test, not by a captured-source controlled-mutation experiment. The
PR42 recovery smoke kills a waiting process and advances the supplied clock;
it is not full capture-in-flight recovery. Historical regression totals are
not acceptance evidence for untested paths.

## B3 Scope Now Started

B3 has started with the managed-profile-only session slice:

- `POST /v1/sessions/managed`
- `POST /v1/sessions/:id/authorize`
- `POST /v1/sessions/:id/capture`
- `POST /v1/sessions/:id/revoke`
- `GET /v1/sessions/:id`
- `POST /v1/sessions/:id/renew`
- `POST /v1/sessions/:id/handoff`

The slice uses workspace/account/origin references and grant epochs. These
are caller-supplied scope declarations, not verified browser account identity.
New capture checks authorization at entry; the managed API has not yet been
unified with BrowserControl's ongoing grant checks.

Existing Chrome/CDP and restricted Recipe slices exist on the current main
branch, but still require real authorized-user and backend validation. Vendor
session reuse, CAPTCHA handling, model repair, and unrestricted automation
remain out of scope.

External inputs and blockers are tracked in
`research/section-b-real-adoption-blockers.md`.

## B3 Phase 2

Phase 2 adds stored handoff metadata, status querying and renewal. PR45 fixes
revoked-session resurrection through authorize/handoff. Expiry is checked by
grant, but GET status can still show the persisted active state; handoff is
not bound to Run/Step/Recipe. End-to-end reauthentication remains unverified.

## Current Prototype Boundary

The prototype has one fixed monitor, lease/epoch/baseline checks and local
outbox rows. The session broker and recipe libraries are separate paths;
their integration with monitor waiting_user, baseline commit and actual
delivery remains work. No installed scheduler or cross-date operation is
established by the checked-in evidence alone.
