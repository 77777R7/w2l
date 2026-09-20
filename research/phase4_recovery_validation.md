# Phase 4 Recovery Validation

Status: `passed_with_live_fetch_failures`.

Executed against the A6 URL set on current `main` (`6d98982`) using the crawl checkpoint, not `runRealTasks()`.

## Protocol Run

1. Serve a synthetic listing whose only links are the 100 A6 manifest URLs.
2. `w2l crawl` that seed with `--allowlist-hosts` of the 10 A6 domains, `--max-pages 101`, `--max-depth 1`.
3. SIGKILL after 8 contentful checkpointed pages (9 steps including the seed).
4. `--resume` the same task directory. Resume opened a new attempt on the same task id.
5. Default resume refetched (cached pages = 0). No completed URL from the killed attempt was lost.

## Result

| Check | Evidence |
| --- | --- |
| Same task id | `2d168f19-6e7c-4fe2-8d03-a06d07f280cd` |
| New attempt after resume | yes (attempt 2 completed) |
| Lost completed URLs | 0 |
| Canonical A6 targets recovered | 99/99 (two Node.js hash URLs collapse to one page) |
| Field assertions on recovered pages | 96/100 `correct_complete` |
| Live fetch failures after resume | 4 URLs (`nodejs.org/api/streams.html`, TypeScript conditional-types, Firecrawl `/developers`, Firecrawl `/terms`) |
| External cost | unknown (`costUnknown: true`) |

The four failures are live fetch/content misses on resume, not checkpoint loss. They are recorded, not rewritten as success.

Machine-readable evidence: `output/phase4/a6-recovery.json` and `research/phase4_a6_recovery.json`.
