# Section B Handoff

Current status (2026-09-22, local freeze `99894bd636ecafd254a7c7bc79d26e9a97fa9199`, parent `e28500b`): **B1–B4 in_progress**.
The B1/B2 execution and trusted-change core plus C1 delivery engineering slice
passed [Gate 2–3 acceptance](gate-2-4-acceptance.md). Gate 4 has SDK/docs/examples
and an agent clean install; independent human acceptance remains pending.
Use [the stage review addendum](stage-review-2026-09-22.md#6-gate-24-冻结后的更新)
for resolution of earlier findings and [Section C](section-c-delivery.md) for
the next C2/C3 entry and runtime slices. No push or deployment is implied.

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
  -> ChangeEvent / local Outbox / durable Delivery
  -> HTTPS receiver / deduplicated projection
```

The slice must preserve the last valid snapshot when a refresh is blocked, partial, stale, or otherwise unverifiable.

## Existing Foundation To Reuse

- `LadderScrapeAtom` and `LadderRunner` remain the collection path.
- `LadderRunAudit.summary` is the execution-meter source.
- `CrawlOrchestrator` and SQLite `TaskStore` remain the checkpoint path.
- Existing REST/SDK/MCP scrape and crawl APIs remain compatible.

## Core Deliverables Now Implemented And Verified

1. Versioned monitor configuration with a stable `monitorId` and immutable revision.
2. Durable run state with one active logical run per monitor and an idempotent trigger key.
3. Observation and quality records that distinguish `valid`, `partial`, `invalid`, and `unknown`.
4. Snapshot and baseline persistence where invalid observations cannot advance the baseline.
5. A typed diff for one narrow field schema, with `changed`, `unchanged`, and `cannot_verify` outcomes.
6. An atomic outbox/delivery record, stable event ID, leased delivery worker and duplicate-safe receiver.
7. Actual process-crash and concurrent-claim experiments plus tests for stale workers, invalid refresh, duplicate trigger, A/B/A/B changes, HTTP 304 bodies and Monitor isolation.
8. Explicit captureMode, end-to-end cancellation/deadlines and persisted Retry-After; Crawl/Monitor/Delivery SDKs and installation examples.

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

## Historical First Real Task Evidence

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

That initial slice recorded initialization and unchanged semantics through
the fixed Monitor API; its change test constructed an assessment. The PR42
recovery smoke killed a waiting process and advanced the supplied clock, so it
did not establish capture-in-flight recovery. These historical limits are
preserved here; subsequent Gate 2 evidence now covers real SIGKILL during
capture/commit/retry waiting, real elapsed lease recovery, two-process cold
claims and production HTTP A/B/A/B, cache-body and isolation paths.

## Current Generic Monitor And Delivery Entry

Follow [onboarding](../onboarding.md) for installation, source/sample setup,
SDK calls, HTTPS destination, worker configuration and restart checks.
The API, scheduler and delivery worker share the same `W2L_TASK_ROOT`:

```bash
npm run api
# Separate terminals, with the same configured task root:
npm run monitors:worker
npm run delivery:worker
```

These remain separate commands, not a unified service manager. The local
fixture needs the explicit Monitor network-mode setting described in onboarding.
[Recovery](../../research/gate2-process-recovery.generated.json),
[claim race](../../research/gate2-claim-race.generated.json),
[real HTTPS](../../research/gate3-https-delivery.generated.json) and
[agent clean install](../../research/gate4-clean-install.generated.json)
retain their original test times. They do not establish cross-date endurance
or independent human installation.

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

The public-document core now supports generic typed Monitor configuration,
lease/fencing/baseline checks and durable HTTPS delivery. Controlled execution
checks and the real public-document delivery experiment passed. B1/B2/C1 stay
in_progress because long-term operation and actual customer use remain open.
The session broker and recipe libraries remain separate paths; integration
with Monitor waiting_user, baseline commit and delivery retains B3/B4 gates.
No installed supervisor, cross-date endurance, backup/restore drill or
permanent hosting is established by these records. Next: C2 Monitor/Delivery
MCP and simpler first use, C3 unified process management and remote URL MCP.
