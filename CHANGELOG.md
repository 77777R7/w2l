# Changelog

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
