# Section B Handoff

The full technical design is in [`section-b-technical-design-v1.md`](./section-b-technical-design-v1.md).

The imported design document is a draft written against an older baseline
(`main@fdc6559`). The current repository baseline is newer. Treat the design
as an architectural proposal and source of constraints, not as evidence that
the proposed B interfaces are already implemented or production-validated.

## Decision

Proceed with a controlled **B1+B2 minimum slice** only. Do not start B3, B4, multi-modal assistance, a general workflow UI, or a second orchestration framework.

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

- No login/session reuse.
- No existing-Chrome connection.
- No provider or model dependency.
- No arbitrary backend automation.
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

The current slice has verified initialization and unchanged refresh semantics through `POST /v1/monitors/firecrawl-introduction/run` and `GET /v1/monitors/firecrawl-introduction`. A field-change event is covered by the SQLite test; a real source change still requires a later live run when the document changes. Full regression is green at 826 tests.

## B3 Scope Now Started

B3 has started with the managed-profile-only session slice:

- `POST /v1/sessions/managed`
- `POST /v1/sessions/:id/authorize`
- `POST /v1/sessions/:id/capture`
- `POST /v1/sessions/:id/revoke`

The slice uses `workspaceId`, `accountRef`, `originScope`, `profileDir`, `grantEpoch`, `state`, and revoke/expiry checks. A new session starts as `waiting_user`; capture is denied until explicit authorization; revoke increments the grant epoch and blocks future capture.

Existing Chrome/CDP, vendor sessions, multi-step recipes, and CAPTCHA handling remain out of scope.

## Current Prototype Boundary

The prototype has one fixed monitor and one local SQLite control database. It now has persisted trigger idempotency, lease/epoch/baseline checks, an explicit `nextRunAt` path, and local outbox state. It is not yet a general scheduler, HTTP cache validator, session broker, or workflow engine. Those remain follow-up work after this vertical slice proves the data/version semantics.
