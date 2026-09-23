# Monitor and Delivery through MCP

This walkthrough uses the public Firecrawl Introduction page and an HTTPS
webhook receiver controlled by the operator. It does not create an Amazon
price alert. The Monitor, delivery, and receiver keep their state in SQLite;
the MCP connection can close after each request.

## Use locally now

From this checkout on Howard's Mac, install the single managed service and
register its loopback MCP URL:

```bash
npm ci
npm run local:mcp:install
codex mcp add w2l-local --url http://127.0.0.1:8791/mcp
npm run local:mcp:status
```

Open a **new** Codex task so it loads the MCP configuration, then ask it to
call `preview_monitor` with the `firecrawl-introduction` preset. The service
starts at login, restarts on a crash and keeps the SQLite task state under
`.w2l/api`. It listens only on `127.0.0.1`; REST is internal and there is no
public URL or WorkOS login on this local path. Keep this checkout in place
while the LaunchAgent points at it. On a non-macOS system, run
`npm run local:mcp` in one terminal instead.

For a signed HTTPS receiver on the **same Mac**, install the separate
LaunchAgent and explicitly allow the local delivery worker to reach its
verified loopback certificate:

```bash
npm run local:receiver:install
W2L_LOCAL_DELIVERY_LOOPBACK=1 npm run local:mcp:install
npm run local:receiver:status
npm run local:mcp:status
```

Installation generates a private signing secret and a local TLS certificate
under ignored `.w2l/` files if absent; it preserves existing values on
reinstall. The worker verifies the certificate through its explicit CA file
and only gains egress to `127.0.0.1`/`::1` in this opt-in mode. Register a
destination with URL `https://127.0.0.1:8788/webhook` and `secretEnv` set to
`W2L_WEBHOOK_SECRET_DEMO`. Never pass the secret value through MCP. The
receiver stores receipts and idempotent projections in
`.w2l/local-receiver/receiver.sqlite`. Both services restart at login; use
`npm run local:receiver:uninstall` and `npm run local:mcp:uninstall` to stop
them. This loopback address is not accessible to other computers. A remote
receiver or friend trial still needs a public HTTPS service later.
The [live same-Mac acceptance record](evidence/c2-local-https-delivery-2026-09-23.md)
shows the persisted event, 503 retry, idempotency and service recovery.

## Local first-use check

Install from a checkout and run the end-to-end check:

```bash
npm ci
npm run verify:c2-first-use-local
```

The check starts the local unified service and an independent receiver, gives the
receiver a temporary public HTTPS tunnel, and connects with an actual MCP
Streamable HTTP SDK client. It previews the source, creates a paused Monitor,
configures delivery, resumes it, checks the initial event, then uses actual
`SIGKILL` process crashes with a pending delivery and a queued Monitor run.
After each restart it reconnects, finishes the work, and checks the same
`eventId` at both ends.
This loopback check does not validate WorkOS or a deployed Codex login.
`npm run verify:c2-first-use` remains the authenticated-host test seam.
Detailed, potentially sensitive
evidence stays under ignored `.w2l/c2-first-use-*/evidence.json`.
The dated [loopback acceptance note](evidence/c2-c3-loopback-local-2026-09-23.md)
records a clean-source run and the live macOS service check.

For a conversational client, use these MCP calls in order:

1. `preview_monitor({"preset":"firecrawl-introduction"})` to inspect
   identity, field evidence, quality, missing reasons, and a short sample.
2. `create_monitor({"preset":"firecrawl-introduction"})`. MCP defaults to
   **paused**. REST/SDK creation keeps its existing enabled default.
3. `create_delivery_destination` with `monitorId` set to
   `firecrawl-introduction`, the controlled HTTPS `/webhook` URL, and
   `secretEnv` set to an operator-configured environment variable name.
   Never provide a secret value to a tool.
4. `resume_monitor({"id":"firecrawl-introduction"})`, then
   `get_monitor` until `latestRun.state` is `completed`. Compare
   `latestEvent.id` with `list_deliveries` and the receiver's receipt.
5. For an extra run, call `run_monitor({"id":"firecrawl-introduction"})`.
   It returns a persisted `runId` immediately. Use `get_monitor_run` to
   inspect the result, even after disconnecting and reconnecting.
6. Use `pause_monitor` to stop future scheduling. `cancel_monitor_run`
   explicitly cancels one queued or active run. A failed delivery can be
   inspected with `get_delivery`; `retry_dead_letter` retries that delivery
   with the **same** `eventId`.

`list_monitors`, `list_delivery_destinations`, and paginated
`list_deliveries` expose state without loading full histories. Read tools
accept `debug: true` where the full audit is needed. A missing or invalid
sample should be resolved before enabling a recurring task.

## Unified self-hosted process

`npm run hosted:mcp` runs the in-process REST API, Monitor scheduler, delivery
worker, and Streamable HTTP endpoint in one process. REST is internal; the
public listener exposes `/mcp`, `/.well-known/oauth-protected-resource`, and
`/healthz`. It requires these environment variables:

| Variable | Meaning |
| --- | --- |
| `W2L_MCP_URL` | Exact external `https://.../mcp` resource URL |
| `WORKOS_ISSUER` | AuthKit access-token issuer origin |
| `W2L_OWNER_SUBJECT` | Howard's WorkOS user ID (`sub`) |
| `W2L_RECEIVER_URL` | Exact controlled `https://.../webhook` URL |
| `W2L_WEBHOOK_SECRET_DEMO` | Delivery signing secret, equal to receiver `WEBHOOK_SECRET` |
| `W2L_TASK_ROOT` | Persistent task directory, `/var/data/w2l` on Render |

The protected-resource metadata advertises the exact MCP URL and WorkOS
authorization server. The server verifies signed access tokens against the
issuer JWKS, exact audience and owner subject, expiration, and `openid`
scope. Browser OAuth setup must use the same MCP resource identifier. Remote
tools are limited to Monitor/Delivery operations for the Firecrawl preset and
the operator's receiver. Hosted capture is HTTP only, with no browser rung
or browser subresource fetch. Local stdio still exposes the broader tool set.

## Render pilot deployment

The [Blueprint](../render.yaml) defines **two** Singapore web services,
each with its own persistent disk. Deploy the Blueprint to the intended
workspace, then set the `sync: false` variables in the Render dashboard.
Use the actual assigned service domains for `W2L_MCP_URL` and
`W2L_RECEIVER_URL`; do not assume the names in the Blueprint become those
domains. Create/configure the WorkOS AuthKit MCP application for the exact
`W2L_MCP_URL`, obtain the issuer and Howard user ID, and enter those values
in Render. Put the same random signing secret in the main service's
`W2L_WEBHOOK_SECRET_DEMO` and receiver's `WEBHOOK_SECRET` variables.

After both `/healthz` and `/health` report healthy, connect a Codex client:

```bash
codex mcp add w2l --url https://ACTUAL-MCP-DOMAIN/mcp
```

Complete browser sign-in in the client and run the sequence above. Validate
connection, task completion with matching `eventId`, and continued Monitor
operation after disconnect and an actual Render service restart **separately**.
Also exercise invalid Origin, missing token, another user, forbidden source,
delivery failure, Retry-After and dead-letter. A successful tool listing
alone is not an accepted product flow.

The first hosted pilot is one owner and one Render instance: a SQLite disk
cannot be shared by multiple instances. Do not use this deployment as a
multi-tenant arbitrary-URL crawler. Independent human onboarding, a real
customer downstream consumer, and the two-week Gate 5 trial remain separate
acceptance work.
