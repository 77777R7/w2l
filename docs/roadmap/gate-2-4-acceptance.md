# Gate 2–4 implementation and acceptance record

Date: 2026-09-22 (Asia/Shanghai). Scope: the user's execution/reliability, event delivery, and developer onboarding gates. The technical design is context; broader B3/B4, login automation, external pilots and two-week operation are not claimed here.

Outcome: Gate 2's listed engineering acceptance checks and Gate 3's delivery checks passed. Gate 4's implementation and handoff are supplied; independent human acceptance remains pending.

Source freeze: `99894bd636ecafd254a7c7bc79d26e9a97fa9199` on `codex/gate2-delivery-sdk`, parent `e28500b09116eb5931305e8638d9d5cc704a8205`. The supplied Gate 1 and interdependent Crawl/SDK/MCP working edits were retained. Evidence was collected before the freeze commit. [PR #50](https://github.com/77777R7/w2l/pull/50) later merged it into `main` at `1c1481722ade26b717d18a34fa4b46362f53acf8`, and that merge was published as source prerelease [`v0.4.0-rc.1`](https://github.com/77777R7/w2l/releases/tag/v0.4.0-rc.1). The review archive's `handoff-manifest.json` identifies the original 346 captured files and SHA-256 hashes. Those files match the first commit; that commit additionally contains the sanitized clean-install record. Subsequent roadmap/document changes are separate from the tested source archive.

## Gate 2: execution contract and reliability

| Requirement | Implementation and checked evidence |
| --- | --- |
| Explicit capture mode | `captureMode: http \| ladder`; omitted new mode defaults to ladder. Conditional requests require explicit HTTP mode. A cache switch never changes the capture engine. Older cached revisions need an explicit new revision. |
| Cancellation and deadlines | Shared execution context reaches synchronous API requests, HTTP/robots/origin queues, response bodies, retry waits, browser launch/pages, provider REST/CDP and Crawl/Monitor orchestration. The shorter caller deadline is persisted with the run/lease and rechecked after synchronous assessment and inside database transactions; expired commits roll back. Shutdown preserves resumable work; explicit cancellation fences it. Controlled resource cleanup tests include late-created browser resources. |
| Retry-After | Delta-seconds and HTTP-date are respected without shortening long delays. Receipt-time callbacks persist origin cooldown before inline waiting, so process death, manual trigger, pause/resume or another Monitor cannot bypass it. Recovery synchronizes the scheduler's due time with the retry time; an actual scheduler-module test verifies a 60-second retry does not wait for a one-hour ordinary interval. |
| Actual crash/recovery | Four real child-process SIGKILL experiments: capture in progress, before commit, after commit/before receipt, and inside a Retry-After wait. Same logical run resumes; old attempts are interrupted and fencing increases; committed receipts replay without another event. |
| Claim/fencing/baseline | Two independent cold-start Node processes race the same trigger against one SQLite database. Exactly one source capture, run, attempt, observation, assessment, baseline, event and outbox row. Separate tests reject old-worker writes and stale expected baselines; injected transaction failures roll back baseline/event/outbox/delivery together. |
| B1/B2 changes | Actual controlled HTTP source follows A/B/A/B: versions 1/2/3/4 and four distinct events. Invalid and partial evidence does not replace the last valid baseline. |
| 304 and body | Actual conditional HTTP requests reuse matching stored Markdown and reassess it under the current rule. Missing/corrupt bodies, mismatched representations and invalid cached content cannot bless a baseline; verifiedAt is preserved after invalid observations. |
| Multiple Monitors | Concurrent Monitors sharing URL/trigger keys retain separate workspace/entity/view identity, baselines, representation caches and event/delivery histories. Origin rate limits are deliberately shared. |

Reproducible process experiments:

```bash
npm run gate2:recovery
npm run gate2:claim-race
```

Evidence: [process recovery JSON](../../research/gate2-process-recovery.generated.json), [cold-start claim race JSON](../../research/gate2-claim-race.generated.json). The recovery experiment uses real elapsed lease time (700 ms test lease), not a future clock passed to claim. This verifies process-crash recovery; it is not a host power-loss, disk-full, backup/restore or multi-week endurance result.

The production HTTP/browser paths have controlled integration coverage. Paid browser-provider network services were not exercised live; their transport/cancellation adapters have automated coverage.

## Gate 3: actual HTTPS delivery

The delivery worker persists destination, payload, attempts, next attempt time, lease/fencing and dead-letter state in the same control SQLite database. Monitor commit enqueues delivery atomically. Destination registration and historical backfill are atomic too. Paused destinations retain backlog. Automatic acknowledgement of the legacy outbox waits until all fanout deliveries succeed.

Retry-After persists across events/destinations at the same receiver origin, restart and explicit dead-letter replay. Retries preserve `eventId` and immutable payload. HTTPS validates the certificate and pins an address accepted by the egress policy; redirects are not followed. A trusted operator can explicitly configure an HTTP(S) CONNECT proxy. Ambient proxy settings do not silently alter the delivery transport.

The sample receiver verifies HMAC-SHA256, durably deduplicates `eventId` and advances a workspace/Monitor/entity/view projection only for a newer `eventVersion`. Receipt and business projection share one transaction.

**Real HTTPS experiment passed at 2026-09-22 17:54 CST:**

- Source: `https://docs.firecrawl.dev/introduction`, production capture and configured assessment, baseline version 1.
- Receiver: a local receiver under our control, exposed at `https://happens-task-production-treating.trycloudflare.com/webhook` for this experiment.
- Event: `22cda19c-cfa1-4e1e-9b9a-bdebf87b211d`.
- First HTTPS receipt committed; injected loss of its ACK left the delivery pending.
- Receiver restarted with its original SQLite database; a fresh sender worker process retried the same event and received HTTP 200.
- Final result: two attempts, one receipt, one document projection, zero duplicate business updates.
- TLS validation stayed enabled; an explicitly selected local CONNECT proxy was used on this host. The ephemeral signing secret was not saved in the report or source package.

[HTTPS evidence JSON](../../research/gate3-https-delivery.generated.json) contains IDs and attempt timestamps. A separate automated test kills the real sender process after receiver commit and before ACK, then verifies recovery and deduplication. The HTTPS experiment above injects ACK loss and restarts processes; these are distinct pieces of evidence.

```bash
# Requires cloudflared and outbound HTTPS. Creates and stops its own temporary tunnel.
npm run gate3:https
# On a host requiring an operator proxy, set W2L_DELIVERY_PROXY_URL for delivery.
# NODE_USE_ENV_PROXY=1 can separately enable Node's proxy support for health/status probes.
```

The acceptance tunnel has been stopped. It was a development endpoint, not a permanent hosted service. Cloudflare documents [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) as temporary testing infrastructure. The receiver and worker commands remain runnable for a new endpoint.

## Gate 4: handoff ready; independent human acceptance pending

Crawl, Monitor and Delivery SDK methods, cancellation controls, complete installation commands, a controlled source, signed receiver and restart walkthrough are supplied in [onboarding.md](../onboarding.md). The [independent developer checklist](../independent-developer-acceptance.md) remains pending. An agent's clean installation cannot satisfy this human gate.

```bash
npm run package:handoff
```

The preserved `w2l-review-source.tar.gz` is a **pre-commit review snapshot**, with source/tests, a per-file hash manifest and the acceptance record as it existed then. Its SHA-256 remains `b86534484ec8e24025fc634e158332bbdbce3e5299ce4b122ecbd95b8551096c`. It has not been regenerated to include the later documentation updates. Git history, dependencies, runtime databases, environment files, credentials and unrelated untracked duplicate documents are excluded. The archive and original checksums remain local under `.w2l/gate4-handoff/`; they are not committed.

The [sanitized clean-install record](../../research/gate4-clean-install.generated.json) retains the original 2026-09-22 10:07:45–10:07:52 UTC timestamps, Node v26.8.1, npm 11.19.0, archive/manifest/log hashes, command results and SDK/restart outcomes. It identifies the executor as Codex agent. Its focused installation check passed 4 files / 22 tests; public HTTPS was verified in the separate Gate 3 experiment, not repeated by that installation smoke.

Gate 5 remains unstarted by this work: there is no claimed external trial user, repeat customer, two-week run or real customer's downstream use case. The controlled document projection demonstrates delivery mechanics.

## Validation record

- Full workspace TypeScript build passed.
- Final full regression suite: **79 files / 925 tests passed**, started 2026-09-22 18:06:34 CST, including synchronous API cancellation, persisted caller deadlines, transaction rollback after deadline, and scheduler retry recovery.
- Standalone strict TypeScript check passed for all `scripts/section-b/*.ts` and `examples/*.ts` using `--allowImportingTsExtensions` for the pre-existing scripts.
- Four actual process-recovery experiments passed; two-process cold-start claim experiment passed.
- Public HTTPS delivery, lost-ACK retry, sender/receiver restart and persistent receiver deduplication passed.
- Clean archive installation smoke: [committed sanitized record](../../research/gate4-clean-install.generated.json); original `.w2l/gate4-handoff/clean-install-smoke.json` and logs remain local. It remains distinct from independent human acceptance.

Freeze verification: the 346-file manifest matched the source, all three experiment reports passed with their original timestamps, and archive/full-regression-log hashes matched the installation record. The first commit includes 83 existing changed files plus the sanitized installation record (84 files total). Eight unrelated `* 2.md` / `* 2.mjs` files were excluded and preserved. The second commit changes only status/roadmap documentation. No runtime code changed during this freeze; the 79-file / 925-test result above is the original run, not a new run attributed to document editing.

Tests can be rerun with `npm run typecheck && npm test`. Commits, source archive, prerelease and runtime output are separate artifacts. PR #50 is merged and the source prerelease is published; no npm package or permanent service deployment has been performed.

## Next slice and phase boundaries

B1/B2 and C1 remain in_progress: scoped execution/change/delivery engineering passed, while long-term operation, broader completeness and actual customer consumption remain open. C3 has installation foundations; C2's new entry points and C3's remote/managed runtime are still pending. B3/B4/C4 are not upgraded by the regression total.

Next in [Section C](section-c-delivery.md): C2 Monitor/Delivery MCP plus a simpler conversational first-use flow; C3 unified API/scheduler/delivery-worker management plus authenticated remote HTTPS URL MCP. Persistent hosting requires identity isolation, egress and resource gates. Connection, a completed task and continued monitoring have separate acceptance. These are planned priorities, not implementations or delivery-date commitments.
