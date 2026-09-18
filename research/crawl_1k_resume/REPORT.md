# 1000-page crawl kill/resume probe

- Date: 2026-09-18
- Runtime: v0.2.0 (`w2l crawl` + SQLite `task → attempt → step`)
- Site: `research/crawl_1k_resume/site.ts` — same host, no hard gates, listing → 1000 items, items do not link back
- Evidence: `evidence.json` (raw CLI tails + URL lists)
- Runtime was not changed for this probe

## Method

1. Start the synthetic catalog on loopback.
2. `w2l crawl --max-pages 1001 --max-depth 1 --task-dir <dir> <seed>`
3. After 8s, `SIGKILL` the crawl process (not a graceful shutdown).
4. Snapshot `checkpoint.sqlite`.
5. `w2l crawl --resume <dir> --max-pages 1001 --max-depth 1` (default refetch, no `--use-cached`).
6. Snapshot again and compare URL sets.

## Result

| | After SIGKILL | After resume |
| --- | --- | --- |
| Signal / exit | SIGKILL / code null | exit 0 |
| Attempts | 1 | 2 |
| Step rows | 27 | 1028 |
| Unique URLs | 27 | **1001** (listing + items 1–1000) |
| Lost URLs | — | **0** |
| Cached steps | 0 | 0 (refetch default held) |
| Lane | `http` only | `http` only |
| Status | all `success` | all `success` |
| Wall | 8.0s to kill | 260s total |

Completed URLs from the killed attempt were still present after resume. Resume opened a new attempt on the same task id (`f6982549-166c-4452-8b06-f014fe4df3bf`). Every page row has `lane=http` and usage fields on `FetchResult` (token/cost/wall); this probe incurred no `externalCostUsd`.

1028 step rows vs 1001 unique URLs is the refetch: the 27 pages written before kill were fetched again on resume instead of being reused. That is the PRODUCT_PLAN_V2 §4.3 default (correctness over saving work). `--use-cached` was not used.

## Blockers / not reached

None for this catalog. The run hit the 1001-page budget (seed + 1000 items) and stopped cleanly. Host politeness (`perHostConcurrency=2`, `perHostMinDelayMs=250`) is the main time cost; ~4 minutes for the resume half is expected, not a hang.

Not claimed: Cloudflare/enterprise sites, headed browser, vendor lanes, or a 1000-page crawl of a live origin.

## Files

- `site.ts` — catalog server
- `run.ts` — kill + resume harness
- `evidence.json` — machine record of this run
