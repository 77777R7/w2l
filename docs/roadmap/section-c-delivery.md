# Section C · Workflow Productization And Delivery

Section C packages a validated recurring data task for adoption. It does not
replace the API, create a second scraping engine, or turn W2L into a general
purpose browser agent.

Status at `main@e29dc6b`: **not started**. The current B1/B2, B3, and B4 code
are controlled slices, not proof that Section C is ready for general delivery.

## Product Outcome

Section C should let a user move from:

```text
configured source + fields + schedule
    -> validated snapshot/change event
    -> reliable downstream destination
    -> observable run history and failure state
```

The customer-facing promise is:

> When a validated source changes, deliver the new value exactly enough for the
> receiving workflow to use it; when validation fails, preserve the last valid
> value and expose the reason.

## Non-Goals

- No second scraper or extraction engine.
- No general workflow canvas in the first C release.
- No arbitrary hosted browser execution before the Hosted Egress Gate.
- No universal connector catalog.
- No automatic delivery of unverified or `effect_unknown` data.
- No claim that webhooks are end-to-end exactly-once; use idempotency and
  version checks instead.

## Dependency Order

```text
A evidence and supported boundary
        ↓
B1/B2 valid Snapshot + ChangeEvent
        ↓
C1 reliable delivery to one destination
        ↓
C2 integration and narrow task UI
        ↓
C3 self-hosted/hosted deployment modes
        ↓
C4 repeat-use and willingness-to-pay validation
```

B3/B4 are only required by C1/C2 tasks that actually use authorization or
backend recipes. A public documentation monitor can reach C1 without login.

---

# C1 · Reliable Data Delivery

## Goal

Deliver one validated Snapshot or ChangeEvent to one useful destination while
preserving stable identity, ordering, retry state, and the last valid value.

## Highest-ROI First Destination

Use a generic HTTPS Webhook as the first destination because it validates the
delivery contract without prematurely choosing a database, CRM, or vertical
connector.

The first production-shaped demo should deliver the Firecrawl Introduction
monitor event to a local test receiver or a user-provided endpoint. A second
destination, preferably a simple SQL table or spreadsheet-like store, follows
only after the webhook contract is stable.

## Delivery Contract

Every delivery should include:

```json
{
  "eventId": "evt-...",
  "monitorId": "firecrawl-introduction",
  "entityKey": "firecrawl:introduction",
  "eventVersion": 2,
  "changeKind": "changed",
  "fromSnapshotId": "snap-1",
  "toSnapshotId": "snap-2",
  "changedFields": [
    { "field": "scrapeDescription", "before": "...", "after": "..." }
  ],
  "observedAt": "...",
  "verifiedAt": "...",
  "evidenceRefs": ["obs-...", "assessment-..."]
}
```

The payload must distinguish:

- `initialized`: first valid snapshot;
- `changed`: validated field change;
- `unchanged`: normally no delivery;
- `cannot_verify`: no business event and no baseline movement;
- `stale`: old valid data may be readable, but not presented as fresh.

## Outbox State Machine

```text
pending -> delivering -> acknowledged
                 └──> retry_wait -> delivering
                 └──> dead_letter
```

Required fields:

```text
eventId
destinationId
attemptCount
nextAttemptAt
lastStatus
lastErrorClass
leaseUntil
payloadHash
acknowledgedAt
```

The outbox row and ChangeEvent are created in the same control-database
transaction as the valid Snapshot/Baseline commit. Network delivery happens
after the transaction.

## Idempotency and Ordering

The receiver must use `eventId` for duplicate suppression and
`monitorId + entityKey + eventVersion` for stale-update rejection.

The sender may retry after a timeout. It must not create a new business event
just because the HTTP response was lost.

If a receiver reports that it has already accepted an event, the sender marks
the existing delivery acknowledged. If the receiver does not support
idempotency, W2L must label the destination as duplicate-prone rather than
promising exactly-once delivery.

## C1 Acceptance

1. First valid snapshot creates exactly one delivery.
2. Unchanged refresh creates no new delivery.
3. Changed refresh creates one new delivery with typed before/after fields.
4. Invalid/partial refresh preserves the old destination value.
5. Lost response causes retry of the same event ID, not a new event.
6. Duplicate receiver acknowledgement is safe.
7. Delivery failure becomes visible and retryable.
8. Old event versions cannot overwrite newer destination state.
9. Payload contains evidence references but no cookies, passwords, or CDP URLs.

---

# C2 · n8n Integration And Narrow Task UI

## Goal

Make one validated recurring task configurable and observable without building
a general workflow canvas.

## Integration Order

1. **Webhook contract and examples.**
2. **n8n integration** using one trigger/node pair.
3. **Narrow task UI** that configures the same API, not a second state system.

The integration should expose:

```text
create monitor
run now
pause/resume
view current snapshot
view run history
view change events
view failure / waiting_user state
test destination
```

The UI must call the API and never directly edit SQLite or browser profiles.

## First UI Flow

```text
source URL
    -> fields/schema
    -> schedule
    -> destination
    -> sample check
    -> save revision
    -> run now
    -> history / evidence / failure state
```

The sample check must show the extracted fields, quality decision, source
identity, lane, resource meters, and what would be delivered. Save is blocked
when the sample is invalid or the destination is not safely configured.

## n8n Node Boundary

Initial nodes:

- `W2L Monitor Trigger`: emits a validated ChangeEvent or initialized snapshot.
- `W2L Get Snapshot`: returns the last valid data and freshness state.
- `W2L Run Monitor`: explicit manual run with an idempotency key.

Do not expose arbitrary browser commands or arbitrary JavaScript to n8n.

## C2 Acceptance

1. UI-created monitor and API-created monitor have the same stored revision.
2. n8n receives one event per event ID and survives duplicate delivery.
3. User can see why a run is waiting, stale, partial, blocked, or failed.
4. Login handoff is a first-class state; no cookie or profile material appears
   in UI or n8n payloads.
5. A failed delivery can be retried without re-running the source scrape.

---

# C3 · Self-Hosted And Optional Hosted Delivery

## C3.1 Self-Hosted Track

Self-hosted delivery is the first deployment target.

Required surfaces:

- reproducible install and upgrade;
- secrets and session-profile storage;
- control database and evidence backups;
- retention and cleanup;
- structured logs;
- allowed egress configuration;
- health and readiness checks;
- cancellation and graceful shutdown;
- outbox retry visibility;
- SQLite/WAL backup procedure;
- browser cleanup verification.

The self-hosted package must make the supported scope explicit: public GET
sources, permitted authorized sessions, bounded local browser use, and the
recipe capabilities actually installed.

## C3.2 Hosted Track

Hosted delivery is gated separately and is not a consequence of the local
prototype passing.

Required before public hosted browser execution:

- DNS-to-connection binding;
- subresource egress policy;
- SSRF and metadata protection;
- workspace/tenant isolation;
- browser and model quotas;
- cancellation and lease cleanup;
- request size and download limits;
- evidence retention and deletion;
- secret isolation;
- abuse controls;
- operational alerting;
- cost attribution with real provider meters.

No hosted promise should be made while arbitrary URL browser execution remains
outside the separate Hosted Egress Gate.

## C3 Acceptance

1. Clean self-hosted install can create a monitor and complete a first run.
2. Upgrade preserves control state and last valid snapshots.
3. Backup/restore preserves baseline, events, and pending outbox rows.
4. Shutdown does not leave unbounded browser or worker processes.
5. Hosted mode has a separate security evidence package before exposure.

---

# C4 · Paid Validation And Limited Expansion

## Goal

Validate repeated use and willingness to pay before adding vertical connectors
or a broad platform surface.

## Evidence To Collect

For each pilot task:

```text
who uses the data
what decision it supports
refresh frequency
manual work before W2L
manual work after W2L
false alerts
missed changes
support minutes
delivery failures
retention / repeated runs
requested destination
price or budget signal
```

Do not infer product-market fit from one successful scrape, one demo, or a
large benchmark.

## Expansion Rule

Add a vertical adapter only when multiple real users share:

- the same backend shape;
- the same object and field semantics;
- the same authorization pattern;
- enough repeated volume to justify maintenance.

Otherwise keep the work in the generic monitor, quality, diff, or delivery
layers.

## C4 Acceptance

1. At least one real workflow uses the output repeatedly.
2. The user can identify the value of freshness and validation, not only raw
   extraction.
3. Support and correction time are recorded.
4. Pricing evidence is separated from technical success evidence.
5. Expansion decisions reference actual repeated demand.

---

# C Implementation Order

```text
C1.1 event payload + outbox delivery state
    -> C1.2 webhook receiver test + idempotency
    -> C1.3 one SQL/table destination
    -> C2.1 n8n integration
    -> C2.2 narrow task UI
    -> C3.1 self-host packaging and backup/restore
    -> C3.2 hosted egress/security gate
    -> C4 pilot measurement and pricing validation
```

The next implementation after the current B work is **C1.1/C1.2**, but only
after B1/B2 has a stable event contract and one recurring monitor has a real
consumer. Do not start C2 UI work as a substitute for proving delivery.

---

# Implementation Contracts And Work Packages

All items below are **proposals / not_started**, not existing endpoints or
approved deployment actions. Source of current status:
[stage review](stage-review-2026-09-22.md).

## C1 Detailed Units

| Unit | Deliverable | Gate / dependencies |
| --- | --- | --- |
| C1.1 | Versioned event envelope; destination/subscription/delivery tables and migrations | B1/B2 valid-event contract; `(eventId,destinationId)` uniqueness |
| C1.2 | Delivery worker, leases, HTTP receipt, retry/backoff, dead letter | No DB transaction around network I/O; crash during send recovers same delivery |
| C1.3 | Controlled receiver + reconciliation/replay API | Receiver deduplicates after ACK loss; rejects stale entity versions |
| C1.4 | One real receiver adapter selected with the user | Full snapshot initially; credentials referenced, not embedded in event payload |

Use a single control DB for Snapshot/Baseline/Event/Delivery creation. The
existing monitor_outbox table must be migrated rather than treated as a
complete delivery subsystem. Separate event schema version from monotonically
increasing per-entity data version. Include workspace, revision, event cause,
assessment/observation references and lastVerifiedAt in the envelope. A replay
keeps eventId; a new A→B change later in history gets a new eventId.

### Sender/receiver protocol

- Idempotency key: `eventId + destinationId`; payload hash is stable across
  retries. The consumer commits receipt and data update in its own transaction.
- Sign the exact request bytes with destination-specific HMAC key plus
  timestamp and key ID. Verify signature, replay window and duplicate receipt;
  retry gets a new signature timestamp, not a new business event.
- Use bounded request/body sizes and deadlines. Retry timeouts, 429 and selected
  5xx with backoff; preserve Retry-After as a lower bound. If it exceeds the
  current budget, schedule later instead of shortening it.
- Treat authentication failure as a destination configuration problem;
  structured 2xx receipt is successful acknowledgement under the agreed
  receiver contract. Do not treat arbitrary 409 as “already delivered”.
- Pin the destination configuration revision for each delivery. Editing a URL
  must not silently redirect an old event containing customer data elsewhere.
- Resolve allowed destinations separately from scrape origins. Revalidate
  redirects/connection targets; private test receivers require explicit local
  configuration. Public hosted delivery needs its own egress validation.
- Dead-letter replay is an explicit action on the same immutable event.
  Record attempt/reason/nextAttemptAt and expose backlog age.

### Proposed API additions

`POST /v1/destinations`, `POST /v1/destinations/:id/test`,
`POST /v1/monitors/:id/subscriptions`, `GET /v1/deliveries`,
`POST /v1/deliveries/:id/retry`, `GET /v1/monitors/:id/events`.

Workspace authorization and pagination apply to every read/write. Generic
monitor creation is a B dependency; the current fixed Firecrawl route does
not already satisfy these APIs.

## C2 Detailed Units

| Unit | Deliverable | Gate |
| --- | --- | --- |
| C2.1 | n8n example workflow using existing HTTP/Webhook nodes | End-to-end duplicate-safe event consumption; versioned example |
| C2.2 | Custom node only if the example shows repeated friction | Credentials, pagination, retry and upgrade compatibility tested |
| C2.3 | Narrow task UI | Source→fields→schedule→destination→sample→history through one API |
| C2.4 | Operational actions | Pause future schedule vs cancel active run distinguished; failed delivery retry does not recrawl |

“Trigger/node pair” is an interface goal, not a requirement to publish a new
n8n package before proving an ordinary workflow. UI shows initialization,
changed, cannot_verify, stale, waiting_user, revoked and delivery failures as
different states. Waiting-user resume requests must reference the current
handoff and revalidate account/scope; a button click is not login proof.

## C3 Detailed Units

| Unit | Deliverable | Gate |
| --- | --- | --- |
| C3.1 | Pinned self-host install, readiness, runner supervision | Second developer installs from release commit and completes first task |
| C3.2 | Explicit DB migration/upgrade and rollback plan | Restore old state from pre-upgrade backup; incompatible schema fails clearly |
| C3.3 | Backup + evidence/profile retention + restore drill | Pending deliveries retain IDs; baseline/evidence references valid after restore |
| C3.4 | Resource/operations dashboard and runbook | Queue age, run health, browser count, disk limits, retry/correction meters observable |
| C3.5 | Optional hosted track | Independent tenant/auth/egress/quota/cancellation evidence; not a local-mode switch |

Use actual `sqlite_version()` and `sqlite_source_id()` in release evidence.
Back up consistently through the SQLite backup mechanism; copying only a live
DB file can lose WAL data. Export secrets separately with an explicit owner
and encryption/key-storage decision. File permission 0600 is not encryption.
Treat browser profiles as credentials, not ordinary evidence artifacts.

RPO/RTO, retention, resource budgets and alert thresholds must be agreed for
the pilot, then measured in a restore drill; no SLA is claimed in advance.
Self-hosted C3 is required before handing an unattended pilot to another
operator and may run alongside C2; it need not wait for the UI to be complete.

## C4 Detailed Units

| Unit | Deliverable | Gate |
| --- | --- | --- |
| C4.1 | Pilot brief: user, decision, source, fields, destination, baseline manual process | Named consumer and explicit supported scope |
| C4.2 | Repeat-use observation and support ledger | Real dates, event outcomes, correction minutes and failures; no fabricated zeroes |
| C4.3 | Offer/pricing experiment | Actual quote/acceptance/payment outcomes separated; no hard-coded price assumptions |
| C4.4 | Expansion decision | Repeated shared demand and maintenance economics justify second adapter/template |

C4 interviews and recruitment can begin before C1; repeat-use/payment gates
depend on delivered value. Suggested initial observation window is seven
consecutive real days for one workflow (a proposed pilot criterion, not a
claim of production durability). Quiet source days still count as checks, not
as proof of detecting changes. Use a separate controlled-change test.

## Cross-Phase Verification Matrix

| Failure/scenario | Expected outcome | Owner |
| --- | --- | --- |
| Invalid source refresh | No new valid snapshot or business delivery | B1/B2 |
| Receiver committed, ACK lost | Same event retried, business update deduplicated | C1 |
| Older event arrives late | Recorded receipt; no stale overwrite | C1 |
| Sender dies during delivery | Expired delivery lease recovered, same ID | C1 |
| Destination returns long Retry-After | Deferred until allowed time | C1 |
| Source rule revised | `extraction_reprocessed`, not fabricated source change | B2/C1 |
| n8n workflow restarts | Cursor/receipts preserve consumer semantics | C2 |
| Login expires or account changes | waiting_user/cannot_verify; last valid data retained | B3/C2 |
| Disk full / failed migration | Clear failure; no half-published baseline/delivery | B1/C3 |
| Restore with pending deliveries | Same event IDs; receiver handles possible duplicates | C3/C1 |
| No demand for another connector | Keep current adapter; record decision | C4 |

## Execution Policy

For each unit: inspect → implement → focused tests → real/controlled evidence
→ review → CI → merge → evaluate acceptance separately. Do not turn a green
CI into customer adoption, paid validation or multi-day operational evidence.

The next concrete implementation is **B1/B2 acceptance closeout for Firecrawl**,
then **C1.1+C1.2 with a test receiver**. Select the real receiver and usage owner
before claiming C1 delivered. B3/B4 must pass their own gates before C is used
for authenticated backend work.
