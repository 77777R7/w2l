# Advanced reference

Use the browser preview or [Codex MCP setup](/docs/connect-mcp/) for a first result. REST, SDK, and self-hosted operation are available for developers who need explicit configuration and persistent task control; they currently require a checkout of this repository.

## REST and SDK

The local API has `POST /v1/scrape` for one URL, `POST /v1/batches` for an explicit URL array, and `GET /v1/batches/:id/items?limit=...&cursor=...` for paginated outcomes. Monitor and Delivery have separate REST resources. The `@w2l/sdk` package is currently a private workspace package, not an independently published npm install.

Start the repository API only after reviewing its network and task-store settings. For full request shapes and examples, use the repository's `docs/onboarding.md`, `docs/batch-scrape.md`, and `examples/monitor-workflow.ts` from the **same checkout and commit** as the running service. Mixing a guide from another branch with a local server can change the apparent contract.

## Self-hosted operation

The local managed MCP service starts the API, scheduler, and delivery worker together; task state is SQLite-backed. Keep its task directory across restarts. The anonymous page preview is a separate request-based service and does not run persistent Monitor or Delivery tasks. A remote owner-only MCP implementation exists, but its WorkOS login, public URL, and hosted restart acceptance have not been completed.

If you are evaluating a hosted deployment, verify the authentication resource identifier, HTTPS receiver, persistent disk, outbound restrictions, quota store, and actual client flow before sharing a link. Do not point another user's Codex installation at the loopback URL; `127.0.0.1` refers to their own computer.

## Evidence and boundaries

The [result states](/docs/limits/) page explains user-facing outcomes. Repository evidence separates tested local transport, delivery recovery, Amazon field review, and still-open hosted gates. A green unit test or local sample is not evidence of a deployed service or an independent first-time user completing the flow.
