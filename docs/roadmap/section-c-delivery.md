# Section C · Workflow Productization And Delivery

Section C packages a validated recurring data task for adoption. It reuses the
existing collection engine, REST/SDK contracts and stored task state.

Status updated 2026-09-23 for the C2/C3 implementation on a branch based on
`main@8ff8863`. The earlier Gate 2–4 source freeze
`99894bd636ecafd254a7c7bc79d26e9a97fa9199` was merged by PR #50 and
published as source prerelease `v0.4.0-rc.1`:

| Phase | Status | Boundary |
| --- | --- | --- |
| C1 | in_progress | Delivery engineering slice passed; real customer consumption over time unverified |
| C2 | in_progress | Monitor/Delivery MCP and local HTTPS first-use flow implemented; n8n, task UI and independent human acceptance open |
| C3 | in_progress | Unified loopback MCP managed on macOS and authenticated hosted Streamable HTTP implemented; Render, WorkOS/Codex login and hosted restart acceptance open |
| C4 | not_started | External pilot, repeat-use and willingness-to-pay evidence pending |

Current evidence: [Gate 2–4 acceptance](gate-2-4-acceptance.md).
[C2/C3 local MCP evidence](../evidence/c2-c3-mcp-local-2026-09-23.md)
records the HTTPS flow and actual local `SIGKILL` recovery, along with the
remaining hosted gates.
[Managed loopback MCP evidence](../evidence/c2-c3-loopback-local-2026-09-23.md)
adds the single-process local installation and clean-source recovery run.
[The earlier stage review](stage-review-2026-09-22.md) retains its original
baseline and records subsequent resolution separately. No new Section D is added.

## Product Outcome And Dependencies

```text
A: reliable collection within its supported scope
    -> B1/B2: valid snapshot + trusted change event
    -> C1: durable delivery and idempotent consumption
    -> C2: MCP tools and simpler first use
       + C3: managed processes and remote HTTPS MCP
    -> independent onboarding and external pilot
    -> C4: repeat-use and willingness-to-pay validation
```

C2 and C3 can progress together. B3/B4 gates apply to tasks using authorized
sessions or backend recipes; public documentation delivery does not require
all B3/B4 work to finish.

When validation fails, preserve the last valid value and expose the reason.
No general workflow canvas, universal connector catalog, automatic delivery
of unverified/effect_unknown data, or end-to-end exactly-once promise is made.
Public hosted execution still requires the separate Hosted Egress Gate.

# C1 · Reliable Data Delivery

## Implemented Engineering Slice

The first destination is an HTTPS Webhook. The recorded experiment captured
the public Firecrawl Introduction page and delivered its event to a receiver
under our control through a temporary HTTPS tunnel. After injected ACK loss,
receiver and sender restarted and retried the same event: two attempts,
one durable receipt and one document projection. The tunnel is now stopped;
it is neither a permanent hosted service nor a real customer's downstream use.

The worker persists destinations, deliveries, attempts, leases/fencing,
Retry-After/backoff and dead-letter state. Monitor snapshot/baseline/event/
outbox/delivery creation shares a control-database transaction. Destination
registration and historical-event backfill are atomic. Paused destinations
retain backlog; network delivery runs outside the transaction.

## Current Event Contract

The implemented wire shape is
[`WebhookEventEnvelope`](../../packages/contracts/src/delivery.ts), with
nested [Monitor event and snapshot types](../../packages/contracts/src/monitor.ts):

```typescript
interface WebhookEventEnvelope {
  schemaVersion: 'w2l.monitor-event/v1'
  eventId: string
  eventVersion: number
  monitorId: string
  workspaceId: string
  entityKey: string
  viewKey: string
  event: MonitorEvent
  snapshot: MonitorSnapshot
}
```

`event.kind` is initialized or changed. Typed changes and event cause live in
the nested event; revision, fields, observation/assessment references and
version live in the snapshot. Unchanged/cannot_verify are run outcomes, not
additional event kinds. Freshness/stale status is available through the
Monitor view; there is no top-level delivery `lastVerifiedAt` field.

The snapshot version is scoped to the Monitor/entity/view, distinct from
schemaVersion. A later A→B transition creates a new event; delivery retries
and dead-letter replay keep the original eventId and payload.

## Current Delivery State Machine

```text
pending -> delivering -> delivered
              |  |
              |  +-> dead_letter --explicit replay--> pending
              +----> pending (nextAttemptAt)
```

Expired delivery leases are reclaimed with a new fencing token. Retry waiting
is represented by pending plus nextAttemptAt, not a separate retry_wait state.

Public delivery fields are `id`, `destinationId`, `monitorId`, `eventId`,
`eventVersion`, `state`, `attemptCount`, `maxAttempts`, `nextAttemptAt`,
`leaseUntil`, `fencingToken`, `createdAt`, `deliveredAt`, `lastStatus`,
`lastError` and `payload`. Detail reads include the attempt history.
There are no public payloadHash, lastErrorClass or acknowledgedAt fields.

The legacy monitor_outbox retains pending/acknowledged and its manual
acknowledgement API. Automatic acknowledgement waits for all fanout deliveries
to succeed. That legacy state machine is separate from delivery state.

## Sender/Receiver Protocol And Boundaries

- Each event/destination pair is unique. Retry preserves the immutable event
  bytes and eventId; a lost response cannot create a new business event.
- The example receiver deduplicates eventId with a body hash. It commits
  receipt and business projection together, rejecting stale projection updates
  by workspace + Monitor + entity + view identity and eventVersion.
- Optional destination `secretEnv` references an operator environment variable
  named `W2L_WEBHOOK_SECRET_[A-Z0-9_]+`. HMAC-SHA256 covers timestamp + "." +
  body; headers are `x-w2l-timestamp` and `x-w2l-signature`. The signed example
  validates the replay window. Key-ID/versioned rotation remains a proposal.
- Any 2xx HTTP status acknowledges delivery; no structured receipt body is
  required by the sender. An arbitrary 409 is not treated as duplicate success.
- Timeouts, 429 and retryable server failures use bounded attempts and backoff.
  Retry-After is a lower bound, persists across restart and is shared by
  receiver origin, including explicit replay. Exhaustion or terminal failure
  becomes dead_letter; explicit retry does not recrawl.
- Destination URL/configuration is immutable for an existing ID; enabled state
  can change. A different URL requires a new destination ID. There is no
  separate subscription resource or destination revision model.
- HTTPS verifies TLS and pins an address accepted by delivery egress policy.
  Redirects are refused. Delivery policy is separate from local crawler mode.
  An operator may explicitly configure a trusted CONNECT proxy; this does not
  establish general hosted egress readiness.

## Current REST Surface

These endpoints are implemented, with matching SDK operations:

| Operation | Route |
| --- | --- |
| Register/list Monitor | POST / GET `/v1/monitors` |
| Read Monitor view | GET `/v1/monitors/:id` |
| Create revision | POST `/v1/monitors/:id/revisions` |
| Run now | POST `/v1/monitors/:id/run` (`triggerKey` optional) |
| Cancel active run | POST `/v1/monitors/:id/runs/:runId/cancel` |
| Pause/resume Monitor | POST `/v1/monitors/:id/pause` or `/resume` |
| Register/list destination | POST / GET `/v1/delivery/destinations` (list filter: monitorId) |
| Pause/resume destination | POST `/v1/delivery/destinations/:id/pause` or `/resume` |
| List deliveries | GET `/v1/deliveries` (monitorId, destinationId, state filters) |
| Read delivery and attempts | GET `/v1/deliveries/:id` |
| Retry dead-letter | POST `/v1/deliveries/:id/retry` (409 unless dead_letter) |

Monitor views include events; no standalone Monitor events endpoint is
implemented. Monitor/Delivery lists are currently unpaginated. The optional
API bearer token does not provide per-workspace authorization.

The older proposed `/v1/destinations`, destination `/test`, Monitor
`/subscriptions` and `/events` routes remain proposals, not aliases for these
APIs. Workspace authorization, pagination and destination revisioning must
not be described as already shipped.

## C1 Acceptance And Work Units

The scoped checks passed: initialization/change creates one delivery per
registered destination; unchanged or invalid refresh creates no new business
delivery; failures preserve the last valid value; ACK loss retries the same
event; receiver duplicates are safe; older versions cannot overwrite newer
data; retry/dead-letter is observable. Evidence references are included without
cookies, passwords or CDP URLs.

| Unit | Current status | Deliverable / remaining boundary |
| --- | --- | --- |
| C1.1 | Engineering slice passed | Versioned envelope, destination-to-Monitor binding, atomic delivery rows and event/destination uniqueness; separate subscriptions not implemented |
| C1.2 | Engineering slice passed | Persistent worker, leases/fencing, HTTP ACK, retry/Retry-After, dead-letter and restart recovery |
| C1.3 | Engineering slice passed | Controlled durable receiver, deduplication/version checks and delivery replay API; generalized reconciliation tooling remains future work |
| C1.4 | not_started | A real customer's receiver and repeated downstream consumption; the controlled document projection is engineering evidence only |

# C2 · MCP Integrations, n8n And Narrow Task UI

## Next Priority: Monitor/Delivery MCP And First Use

MCP now exposes Monitor preview, creation, listing, run queue/detail,
pause/resume/cancel, plus destination configuration, paginated delivery reads,
attempts and explicit dead-letter retry. The local stdio entry remains and a
restricted Streamable HTTP entry uses the same REST/SDK contracts and stored
state. Manual MCP runs return a durable `runId`; disconnecting a client does
not cancel the queued run.

The [local first-use flow](../mcp-first-use.md) is conversational: inspect a
sample, create a paused task, configure a controlled HTTPS receiver, resume,
obtain results and understand failure. It shows extracted fields, quality,
freshness, evidence and missing reasons. Invalid samples must be explained
before enabling an unattended schedule. A future narrow UI uses the same
business contract; it never edits SQLite or profiles directly.

## Later Integration And UI

After the MCP entry slice, validate an n8n workflow using ordinary HTTP/Webhook
nodes before deciding whether a custom node is worthwhile. Proposed interfaces:
Monitor Trigger, Get Snapshot and Run Monitor. Do not expose arbitrary browser
commands or JavaScript. A narrow UI follows source → fields → schedule →
destination → sample → revision → run/history.

| Unit | Status | Deliverable / acceptance |
| --- | --- | --- |
| C2.1 | not_started | Versioned n8n example; duplicate-safe consumption survives workflow restart |
| C2.2 | not_started | Custom node only after repeated friction; credentials, pagination, retry and upgrades verified |
| C2.3 | not_started | Narrow task UI; same stored revisions as API/MCP-created tasks |
| C2.4 | in_progress | Monitor and Delivery control exposed through MCP/SDK; UI entry open |
| C2.5 | local engineering complete | Monitor/Delivery MCP and guided first use passed a local HTTPS receiver flow; hosted Codex acceptance open |

UI/MCP must distinguish initialization, changed, cannot_verify, stale and delivery
failure. Authorized-session waiting_user/revoked flows remain subject to B3;
a resume click is not proof of restored login or account scope.

# C3 · Self-Hosted And Optional Hosted Delivery

## Self-Hosted Foundation And Unified Management

Docs, source packaging, SDK examples and an agent clean-install smoke exist.
Independent non-author installation is still pending. The new hosted entry
starts an in-process REST API, Monitor scheduler and delivery worker together,
with `/healthz`, signal-driven shutdown and one persisted control DB. A local
`SIGKILL` recovery check preserves a queued run and a pending delivery across
process restarts. An actual Render restart and operational alerting remain to
be measured.
Persistent monitors outlive an MCP conversation.

## Remote URL MCP (C3, Implementation; Hosted Acceptance Open)

The server implements Streamable HTTP `/mcp`, protected-resource metadata,
Origin/host checks and WorkOS access-token verification. The remote pilot
exposes only the Firecrawl public-document preset and a configured independent
HTTPS receiver. A Render Blueprint and client instructions are provided, but
there is no deployed public MCP URL, verified WorkOS browser OAuth flow, or
permanent hosted service yet. This transport and hosting are C3; Monitor/
Delivery tool semantics are C2.

Accept separately:

1. Connection: authenticated client can connect and discover tools.
2. Task completion: create a real task, inspect its result and receive its event.
3. Continued monitoring: scheduling/delivery survive client disconnect and
   server restart without losing or duplicating business effects.

Client setup documentation must use the actual deployed endpoint and tested
authentication flow, not a speculative domain or an unverified one-click claim.

## Hosted Track And Remaining Operational Gates

Hosted deployment is separately gated: identity/workspace/tenant isolation,
DNS-to-connection binding, subresource egress, SSRF/metadata protection, secret
isolation, quotas, cancellation/lease cleanup, request/download/resource limits,
retention/deletion, abuse controls, alerting and actual cost attribution.
Local tests and a temporary HTTPS receiver do not satisfy these requirements.

| Unit | Status | Deliverable / acceptance |
| --- | --- | --- |
| C3.1 | in_progress | Unified process/readiness/local service-recreation check done; actual hosted restart and independent installation open |
| C3.2 | not_started | Explicit DB upgrade/rollback plan; incompatible schema fails clearly and pre-upgrade state restores |
| C3.3 | not_started | Consistent backup, evidence/profile retention and restore drill; baseline references and pending event IDs survive |
| C3.4 | not_started | Operations dashboard/runbook for queue age, health, browser count, disk limits, retries and correction cost |
| C3.5 | not_started | Persistent hosted mode; independent identity/auth/egress/quota/resource/cancellation evidence before exposure |
| C3.6 | implementation complete locally | Streamable HTTP and auth checks tested locally; WorkOS/Codex browser login, actual URL and three hosted gates open |

Record actual sqlite_version() and sqlite_source_id() in release evidence.
Use SQLite's backup mechanism, not a copy of a live DB without WAL. Secrets
need a separate owner and key-storage decision; 0600 is not encryption.
Browser profiles are credentials, not ordinary evidence. Pilot RPO/RTO,
retention, budgets and alert thresholds require an agreed target and measured
restore drill; no SLA is implied by this freeze.

# C4 · Paid Validation And Limited Expansion

Status remains not_started. Gate 5 requires at least two external trial users,
at least two weeks of operation, at least one repeat user and one real
downstream consumption scenario. No such outcome is claimed by this work.

For each pilot record the user, decision supported, source/fields/destination,
refresh frequency, manual work before/after, false alerts, missed changes,
support/correction minutes, delivery failures, repeated use and price/budget
signals. Quiet days are checks, not evidence of detecting changes; controlled
change tests remain separate. Pricing, offer acceptance and payment are
separate from technical success.

| Unit | Status | Deliverable / acceptance |
| --- | --- | --- |
| C4.1 | not_started | Pilot brief with named consumer, decision, supported scope and manual baseline |
| C4.2 | not_started | Real dated repeat-use/support ledger; Gate 5 external two-week evidence |
| C4.3 | not_started | Actual offer/pricing experiment; quotes, acceptance and payment distinguished |
| C4.4 | not_started | Expansion justified by repeated shared demand and maintenance economics |

Recruitment/interviews may start before all product surfaces are complete.
Add a vertical adapter only when real users share backend shape, field
semantics, authorization pattern and sufficient repeated volume. One scrape
or successful demo is not product-market fit.

## Cross-Phase Verification Matrix

| Scenario | Expected outcome | Owner / current boundary |
| --- | --- | --- |
| Invalid refresh | No new valid snapshot/business delivery | B1/B2 scoped checks passed |
| Receiver committed, ACK lost | Same event retried, business update deduplicated | C1 scoped checks passed |
| Older event arrives late | Receipt retained, no stale overwrite | C1 scoped checks passed |
| Sender dies during delivery | Lease recovery retains event ID | C1 scoped checks passed |
| Long Retry-After | No early retry; persisted delay respected | B1/C1 scoped checks passed |
| Rule revised | extraction_reprocessed, not fabricated source change | B2 scoped checks passed |
| n8n restarts | Receipt semantics survive | C2 planned |
| Login/account changes | waiting_user/cannot_verify; last valid data retained | B3/C2 still open |
| Disk full / failed migration | Clear failure without half-published data | B1/C3 still open |
| Restore pending deliveries | IDs and evidence survive; receiver handles duplicates | C3/C1 backup drill still open |
| No repeated connector demand | Keep current adapter and record decision | C4 planned |

## Next Slice Order And Execution Policy

1. Resolve Render workspace billing suspension and create/configure the WorkOS
   AuthKit MCP application for the actual deployed resource URL.
2. Deploy both persistent Render services; accept real Codex OAuth connection,
   task completion, and continued monitoring after disconnect and process
   restart as separate outcomes.
3. Independent human Gate 4 acceptance, then Gate 5 external two-week use;
   n8n/narrow UI and C4 expansion follow demonstrated friction and demand.

These are priorities, not delivery-date commitments. Inspect → implement → focused verification
→ evidence → review → acceptance; commits, CI, merges, deployments, customer
adoption and payments are distinct outcomes. B3/B4 retain their own open gates.
