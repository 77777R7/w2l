# Install, monitor a source, and receive a durable event

This guide runs the TypeScript SDK against the actual REST API, a controlled product page, and a durable webhook receiver. The sample price is demonstration data. Completing it demonstrates the workflow; Gate 4 additionally requires a non-author developer to record an independent run in [the acceptance checklist](independent-developer-acceptance.md).

## 1. Install the checkout you are evaluating

Use Node.js 22.12+ or 24+ and npm. The root manifest permits older Node versions, but locked dependencies require newer runtimes. Git is required; browser capture additionally requires Chromium. `@w2l/sdk` is currently a private workspace package, so these instructions use it from the repository, not an unpublished npm installation.

For a fresh checkout:

```bash
git clone https://github.com/77777R7/w2l.git
cd w2l
git rev-parse HEAD
test -f examples/monitor-workflow.ts
npm ci
npx playwright install chromium
npm run typecheck
npm test
```

Record the commit. If the example is missing, the cloned revision does not contain this implementation: obtain the review/release branch containing this guide and check it out before continuing. A clean clone of the current public default branch does not include someone else's uncommitted work.

If you already have the supplied working checkout, open its root directory and run `npm ci`, `npx playwright install chromium`, and `npm run typecheck` there. Preserve local changes. Run all commands below from that same directory. On Linux, Playwright may require system browser dependencies (`npx playwright install --with-deps chromium`).

For a supplied review tarball, extract into a new empty directory instead of cloning. This includes the reviewed working source, without Git history, dependencies, credentials or runtime databases:

```bash
mkdir w2l-review
tar -xzf /path/to/w2l-review-source.tar.gz -C w2l-review
cd w2l-review
cat handoff-manifest.json
npm ci
npx playwright install chromium
npm run typecheck
npx vitest run packages/sdk/test/client.test.ts packages/api/test/monitorReliability.test.ts packages/api/test/delivery.test.ts
```

Record the archive checksum, manifest `baseSha`, branch and capture time. The manifest's per-file hashes identify working edits beyond that base commit. A review archive is not a Git commit, merged branch or published release. The maintainer generates it after freezing source with `node scripts/section-b/package-handoff.mjs`; its default output is `.w2l/gate4-handoff/w2l-review-source.tar.gz`. A successful agent-run clean install is engineering evidence; independent human acceptance remains pending until a non-author completes the checklist.

## 2. Start the API and controlled source

API terminal:

```bash
export W2L_TASK_ROOT="$PWD/.w2l/onboarding"
npm run api
```

The API listens at `http://127.0.0.1:8787`. Keep `W2L_TASK_ROOT` identical for the API, Monitor worker, and delivery worker. The control database is `$W2L_TASK_ROOT/section-b-control.sqlite`; the default without this variable is `.w2l/api/section-b-control.sqlite`. Keep this directory across restarts.

Source terminal:

```bash
node --import tsx examples/monitor-workflow.ts source
```

This serves `http://127.0.0.1:8790/product`, honors `If-None-Match`, and prints whether it returned 200 or 304. The local API policy permits this loopback fixture. Hosted mode intentionally rejects private source addresses; use a permitted public source for hosted evaluation.

Control terminal:

```bash
node --import tsx examples/monitor-workflow.ts price 10.00
node --import tsx examples/monitor-workflow.ts setup
node --import tsx examples/monitor-workflow.ts run
node --import tsx examples/monitor-workflow.ts run
node --import tsx examples/monitor-workflow.ts price 12.00
node --import tsx examples/monitor-workflow.ts run
node --import tsx examples/monitor-workflow.ts inspect
```

On a fresh database, the first run creates baseline version 1 and an `initialized` event. The second returns `unchanged`, with a 304 in the source log and the cached body reassessed. The changed price creates version 2 and a `changed` event. The decimal field is normalized (`10.00` becomes `10`). Existing database history changes these version numbers. `inspect` prints the current baseline, runs, events, outbox, and deliveries.

The complete runnable SDK code is [examples/monitor-workflow.ts](../examples/monitor-workflow.ts). A Monitor configuration explicitly selects `captureMode: 'http'` for this example. `conditionalRequests` controls HTTP validators/cache reuse; it does not select the capture engine. Use `captureMode: 'ladder', conditionalRequests: false` for HTTP-to-browser capture. The combination `ladder` plus conditional requests is rejected until conditional caching is supported by the ladder. New omitted modes default to `ladder`; when migrating an older cached configuration, explicitly choose `http` in a new revision. Identity changes require a new Monitor.

Repeated `triggerKey` values replay the same logical run within one Monitor:

```bash
W2L_TRIGGER_KEY=onboarding-replay node --import tsx examples/monitor-workflow.ts run
W2L_TRIGGER_KEY=onboarding-replay node --import tsx examples/monitor-workflow.ts run
```

## 3. Add a real HTTPS destination

The receiver stores receipts and a sample product projection in SQLite. It authenticates requests using a shared demo secret and deduplicates by `eventId`; its projection only advances for a newer `eventVersion` within the same workspace/Monitor/entity/view. A retry therefore does not apply the same business update twice.

Generate demo credentials once in the control terminal. The file stays local under `.w2l`; do not include it in evidence or commits:

```bash
mkdir -p .w2l
node --input-type=module <<'JS'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
const secret = randomBytes(32).toString('hex')
writeFileSync('.w2l/onboarding.env', `WEBHOOK_SECRET=${secret}\nW2L_WEBHOOK_SECRET_DEMO=${secret}\nW2L_WEBHOOK_SECRET_ENV=W2L_WEBHOOK_SECRET_DEMO\n`, { mode: 0o600, flag: 'wx' })
JS
set -a
. .w2l/onboarding.env
set +a
```

If that file already exists, reuse it instead of generating another secret. In a new receiver terminal, load the same environment file and start the receiver:

```bash
set -a
. .w2l/onboarding.env
set +a
WEBHOOK_HOST=127.0.0.1 WEBHOOK_PORT=8788 WEBHOOK_DB=.w2l/onboarding-inbox.sqlite \
  node --import tsx examples/webhook-receiver.ts
```

Publish only this controlled sample receiver behind HTTPS. With `cloudflared` installed, use a separate tunnel terminal:

```bash
cloudflared tunnel --url http://127.0.0.1:8788
```

Use the HTTPS hostname printed by the tunnel, append `/webhook`, and set it in the control terminal:

```bash
export W2L_WEBHOOK_URL='https://YOUR-TUNNEL.trycloudflare.com/webhook'
node --import tsx examples/monitor-workflow.ts setup
```

This is a temporary development endpoint, not a permanent deployment. Cloudflare's [Quick Tunnels instructions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) describe installation and limitations. For an existing controlled HTTPS receiver, use its URL instead; for direct local TLS, the sample receiver accepts `TLS_CERT_FILE` and `TLS_KEY_FILE`. Delivery always validates TLS. A changed tunnel URL requires a new `W2L_DESTINATION_ID`, since destination configuration is immutable.

The destination records only `secretEnv: 'W2L_WEBHOOK_SECRET_DEMO'`, never the secret value. The delivery worker reads that environment variable at process start. Start it in another terminal:

```bash
set -a
. .w2l/onboarding.env
set +a
export W2L_TASK_ROOT="$PWD/.w2l/onboarding"
npm run delivery:worker
```

If this machine requires a network proxy, the operator may explicitly set `W2L_DELIVERY_PROXY_URL` before starting the worker, for example `http://127.0.0.1:7890` for an already configured local proxy. HTTP(S) proxy origin URLs are supported; credentials, non-root paths, queries and fragments are rejected. The worker does not inherit ambient `HTTP_PROXY`, `HTTPS_PROXY` or `NODE_USE_ENV_PROXY` settings. Proxy configuration cannot be supplied in a destination request. Destination addresses still pass the public-egress policy before CONNECT, and TLS verifies the original destination hostname.

For an operator-managed private HTTPS receiver, `W2L_DELIVERY_PRIVATE_ALLOWLIST` permits explicit comma-separated destination hosts/IPs and `W2L_DELIVERY_CA_FILE` supplies a trusted CA file if needed. Neither the local capture setting nor a proxy disables destination filtering or TLS verification. These overrides are unnecessary for the public HTTPS tunnel example.

Create another event and inspect both sender and receiver:

```bash
node --import tsx examples/monitor-workflow.ts price 15.00
node --import tsx examples/monitor-workflow.ts run
node --import tsx examples/monitor-workflow.ts inspect
curl -fsS -H "Authorization: Bearer $WEBHOOK_SECRET" http://127.0.0.1:8788/status
```

A committed Monitor event and a `delivered` delivery are separate outcomes. Check `state`, `attemptCount`, `lastStatus`, `lastError`, `nextAttemptAt` and receiver receipts. To inspect a selected delivery and its attempts, replace the ID below with one from `inspect`:

```bash
node --import tsx examples/monitor-workflow.ts delivery DELIVERY_ID
```

Delivery is at least once. The payload's `eventId` stays constant across attempts and manual retry; `eventVersion` is the committed snapshot version. The worker retries transient failures, honors `Retry-After`, uses leases/fencing for ownership, and moves exhausted/permanent failures to `dead_letter`. The receiver should persist its deduplication receipt and downstream mutation in the same transaction. The example implements that pattern for its local projection; an external business API needs its own idempotency contract.

After fixing a receiver for a `dead_letter` delivery, request another attempt using the same delivery/event identity. Pending retries already run automatically after `nextAttemptAt`; manually retrying a non-dead-letter delivery returns 409.

```bash
node --import tsx examples/monitor-workflow.ts retry DELIVERY_ID
```

`pauseDeliveryDestination(id)` suspends sending while events continue accumulating durably for that destination. `resumeDeliveryDestination(id)` allows its backlog to be sent. Other destinations continue independently.

## 4. Run continuously and verify restart recovery

Keep the source, receiver, tunnel, API and delivery worker running. Start the Monitor worker in a separate terminal:

```bash
export W2L_TASK_ROOT="$PWD/.w2l/onboarding"
export W2L_MONITOR_NETWORK_MODE=local
npm run monitors:worker
```

The Monitor worker defaults to a public-source network policy, independently of the API's local/hosted mode. `W2L_MONITOR_NETWORK_MODE=local` explicitly permits this guide's loopback source and other local/private sources. Omit that variable for hosted/public-source evaluation; do not enable local access on a worker consuming untrusted hosted Monitor configurations. The database stores tasks, not permission to bypass the worker's network policy.

The worker checks configured Monitors on their own intervals (this example uses one minute). `W2L_MONITOR_POLL_MS` controls polling, not each Monitor's schedule. To pause and resume this Monitor:

```bash
node --import tsx examples/monitor-workflow.ts pause
node --import tsx examples/monitor-workflow.ts resume
```

For a pending-delivery restart exercise:

1. Stop the delivery worker with Ctrl-C. Leave the API and receiver running.
2. Change the price and run again. Record the newly committed `eventId` and Monitor baseline; the durable outbox must retain the event while delivery is stopped.
3. Restart the worker, wait for its delivery record, and verify it reaches `delivered` with the same `eventId` in the receiver receipt.
4. Repeat with the receiver stopped first: the worker must record a pending retry. Stop both the delivery worker and API, keeping their database directories intact. Restart the receiver, API, and delivery worker with the same paths and credentials. Inspect the same delivery ID until it succeeds after `nextAttemptAt`.
5. A process crash during an active lease may wait until `leaseUntil` before being reclaimed. Reusing the database is required; deleting it creates a new system, not recovery.

For Monitor crash recovery, stop the process running an active capture, restart the Monitor worker with the same control database, and inspect the recovered Run after its lease expires. A small fast source may finish before you can interrupt it; use the repository's controlled crash/recovery test for deterministic interruption evidence. Graceful Ctrl-C shutdown and process-kill recovery are different checks.

SDK `request.signal` cancels the client's HTTP request; synchronous `scrape` and `runMonitor` also propagate that cancellation to the current server execution. An already-created background Crawl continues independently and requires `cancelCrawl(taskId)` to cancel it. Use `cancelMonitorRun(monitorId, runId)` for explicit persisted Monitor run control, including when you no longer hold its original request. Monitor runs and baseline/events can be inspected with `getMonitor`; its `runs` list contains the `runId` needed for cancellation.

## 5. Use the Crawl SDK from the same checkout

```bash
node --import tsx --input-type=module <<'JS'
import { setTimeout } from 'node:timers/promises'
import { W2L } from '@w2l/sdk'
const client = new W2L({ baseUrl: process.env.W2L_API_URL ?? 'http://127.0.0.1:8787', token: process.env.W2L_API_TOKEN })
const { taskId } = await client.crawl('http://127.0.0.1:8790/product', { maxPages: 1 })
let report = await client.getCrawl(taskId)
while (report.status === 'pending' || report.status === 'running') {
  await setTimeout(250)
  report = await client.getCrawl(taskId)
}
console.log(report)
for await (const page of client.listCrawlPages(taskId, { limit: 10 })) console.log(page)
console.log(await client.getCrawlErrors(taskId, { limit: 10 }))
JS
```

The SDK exports Crawl, Monitor and Delivery contract types. Mutation methods retain the server's error status/body. Optional final `{ signal }` arguments work with reads, mutations and pagination:

```ts
const view = await client.getMonitor('onboarding-price', { signal: AbortSignal.timeout(5_000) })
const destinations = await client.listDeliveryDestinations({ monitorId: view.revision.monitorId })
const deliveries = await client.listDeliveries({ destinationId: destinations[0]!.id, state: 'pending' })
```

## Troubleshooting and completion

| Symptom | Check |
| --- | --- |
| API/worker shows no Monitor | Same working directory and `W2L_TASK_ROOT`; `setup` completed against the intended API URL. |
| Connection refused | Keep the API/source/receiver terminal running; check `W2L_API_URL`, ports, and tunnel target. |
| Monitor returns `cannot_verify` | Inspect latest Run error/quality and source log. An invalid observation must not replace the last valid baseline. |
| Local source works manually but scheduled capture is denied | The Monitor worker defaults to public sources; set `W2L_MONITOR_NETWORK_MODE=local` only for this controlled local fixture. |
| Delivery retries with 401 | Load the same secret file in receiver and worker; confirm destination `secretEnv`. |
| Delivery remains pending | Start the delivery worker; inspect `nextAttemptAt`, destination enabled state, and `lastError`. |
| 409 when reconfiguring | Revisions/destinations are immutable. Increment the revision for supported config changes or choose a new identity. |
| Native SQLite install failure | Use a supported Node version and the platform's compiler/toolchain; rerun `npm ci`. |

Record commands, commit, environment, IDs and redacted outputs in [independent-developer-acceptance.md](independent-developer-acceptance.md). Automated tests and an author-run demo do not satisfy independent human onboarding, two external trial users, or two weeks of operation.
