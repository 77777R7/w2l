# A5 Repeat-Consistency Root Causes

Input: Phase 4 v0.2 report, then A5 v4 re-run of the same 20 tasks / 40 runs.

## Remaining Product Pairs, Then Fixes

| Task | Run difference | Classification | Fix |
| --- | --- | --- | --- |
| Browserbase browsers | HTTP vs browser, live session counter | execution-path difference plus dynamic marketing content | task-scoped `Monthly Browser Sessions` noise; pair now hash-stable |
| Browserbase search | browser on both repeats | normal dynamic/rendered content drift | same scoped noise pattern; pair now hash-stable |
| Browserbase pricing | browser on both repeats | normal dynamic/rendered content drift | same scoped noise pattern; pair now hash-stable |
| Firecrawl pricing | HTTP on both repeats | dynamic page drift, not route drift | normalized Markdown hash already equal in later runs |

The earlier raw-hash inconsistency was over-sensitive to representation noise. Repeat scoring previously counted only `repeat === 2`, so a fully consistent pair scored `1/2`. Every run in a pair now shares the pair result, so a consistent pair scores `2/2`.

## AI Knowledge Failures

| Task | Failure | Classification | Fix |
| --- | --- | --- | --- |
| MDN AbortController | missing `AbortSignal` / `abort` | documentation page misrouted as listing; breadcrumbs won `selectList` | article routing for `<main>` with prose; list-to-article fallback |
| MDN WebSocket | missing `two-way interactive communication` | assertion-contract drift; live page no longer contains that phrase | manifest now asserts `creating and managing` and `sending and receiving data` |

## A5 Decision

1. Keep normalized content hashing. It removes representation-only drift without hiding meaningful content changes.
2. Add dynamic-noise metadata/normalization only for known volatile patterns, with a before/after evidence test. The task manifest scopes this to Browserbase's `Monthly Browser Sessions` counter; raw Markdown and evidence remain unchanged. Do not strip arbitrary numbers or page content globally.
3. Preserve lane changes as an execution fact. A browser retry after HTTP is not equivalent to a stable HTTP repeat.
4. Repair task assertions when the expected source fact is not actually present. Assertion corrections are manifest changes, not crawler quality wins.
5. Prefer article extraction on documentation pages whose leftover nav/TOC looks like a listing.

## Status

- A5 quality on this slice: AI `22/22` correct-complete and `22/22` repeat-consistent; product `18/18` correct-complete and `18/18` repeat-consistent.
- Manual correction minutes and external cost remain unknown.
- A5 gate: quality scores closed; cost/maintenance evidence still open.
