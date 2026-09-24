# Monitor a document and deliver an event

The local MCP service can watch a public documentation page, keep its baseline and run history in SQLite, and send an event to a separately managed HTTPS receiver. This guide uses the tested `firecrawl-introduction` preset. It is a **local operator workflow**, not a hosted service for friends yet.

## Input

Complete [Connect MCP](/docs/connect-mcp/) on a Mac. `npm run first-use:local` also prepares the local HTTPS sample receiver and its signing secret in ignored files. Keep the secret value out of your conversation; MCP accepts the configured environment-variable **name**. Start with this Codex request:

```text
Preview W2L's firecrawl-introduction preset. If its sample is valid, create the Monitor paused, configure the locally installed HTTPS receiver, then resume it. Show the run, eventId, delivery state, and receiver receipt. Pause the Monitor when the check is complete.
```

The tool sequence is `preview_monitor` → `create_monitor` → `create_delivery_destination` → `resume_monitor` → `get_monitor` / `get_monitor_run` → `list_deliveries`. For the sample local receiver, the destination URL is `https://127.0.0.1:8788/webhook` and `secretEnv` is `W2L_WEBHOOK_SECRET_DEMO`. That loopback address is reachable only on the same Mac. A different HTTPS receiver needs its own registered URL and server-side secret configuration.

## Expected output

MCP creation starts **paused**, giving you time to register the destination. On resume, a run becomes due. The first valid observation initializes a baseline and can create an event. Compare its `eventId` with the delivery record and the receiver's stored receipt. A sent event, a `delivered` record, and one accepted receiver receipt are separate checks. A later unchanged page may produce no new change event.

`run_monitor` returns a durable `runId` immediately. Use `get_monitor_run` to inspect it later; disconnecting Codex does not cancel the queued run. `pause_monitor` stops future scheduling. Local service and receiver status can be checked with:

```bash
npm run local:mcp:status
npm run local:receiver:status
```

## If delivery or capture fails

Use `get_monitor_run` for source quality and missing-field reasons. Use `list_deliveries` and `get_delivery` for attempts, HTTP status, retry time, and the last error. A `dead_letter` delivery requires an explicit `retry_dead_letter`; the retry uses the same `eventId`, so the receiver must deduplicate it. If the receiver is down, restore it and inspect pending delivery after the worker restarts. Never report an event as consumed merely because a Monitor run completed.

The [advanced reference](/docs/reference/) points to the full local operations guide. The verified local crash/recovery and HTTPS evidence do not establish a permanent hosted Monitor service.
