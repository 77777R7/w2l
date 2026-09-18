# Changelog

## 0.3.0 — 2026-09-18

Programmable scrape and crawl. Same runner as the CLI.

- REST: `POST /v1/scrape`, `POST /v1/crawl` (202 + taskId), `GET /v1/crawl/:id`. Responses are `FetchResult` / `CrawlReport`.
- TypeScript SDK (`@w2l/sdk`, MIT): `W2L.scrape` / `W2L.crawl` / `W2L.getCrawl`. Server remains AGPL.
- MCP stdio server (`@w2l/mcp`, MIT): tools `scrape`, `crawl`, `get_crawl` over the REST contract. No OAuth, no resources.
- Firecrawl v1 shim (`/fc/v1/scrape`, `/fc/v1/crawl`): snapshot 2026-09-18, maps onto the native contract. Challenge pages are not success; no fire-engine; resume defaults to refetch. Not a compatibility layer.
- 1000-page kill/resume probe: SIGKILL at 27 pages, resume to 1001 unique URLs, 0 lost, `cached=0`.
- Workspace packages versioned `0.3.0`.

## 0.2.0 — 2026-09-18

Crawl composes scrape. Checkpoint from day one.

- `w2l crawl <url>` with `--resume`, `--use-cached`, `--max-pages`, `--headed` (browser arm only; CI stays headless).
- `@w2l/runtime`: `TaskStore` (memory + SQLite next to the task dir), frontier, orchestrator.
- Checkpoint is `task → attempt → step` at URL granularity. Caller-generated UUIDs; repeat writes are idempotent.
- Resume restores the queue. Default is refetch; `--use-cached` is the only skip-fetch path and marks cached pages.
- Link harvest from the full document after extract, before HTML is dropped. Nav links are kept; markdown stays chrome-free.
- HTTP arm honours robots.txt with the same semantics as the browser arm.
- Loop stop: two distinct canonical URLs with the same `rawBodySha256` → `loop_detected`.
- Page / time / cost / token budgets can set `budget_exceeded`.
- Workspace packages versioned `0.2.0`.

## 0.1.0 — 2026-09-18

First product-shaped cut of the identity ladder.

- Anti-bot is a coverage ladder (ADR 0004), not an in-tree circumvention engine.
- L0 identity bundle: UA, Client Hints, locale, timezone, viewport must agree; fail closed.
- Product HTTP arms send that bundle (`standard` default; `research` is a declared bot).
- Ladder refuses channels with a missing or contradictory identity before `fetch`.
- `w2l scrape <url>` is the user entry (`w2l-fetch` remains an alias).
- Extract-tf emits Markdown after extraction, not raw HTML.
- Provider lane measures vendor identity and does not inject ours; HeadlessChrome / research-as-Chrome / UA-hint mismatch are not success.
- Changing IP or session does not change identity (`identityForRoute`).
- Workspace packages versioned `0.1.0`.
