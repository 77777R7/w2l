# Changelog

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
