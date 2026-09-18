# Firecrawl scrape/crawl shim

Snapshot date: **2026-09-18**. Source: Firecrawl API v1
[`POST /scrape`](https://docs.firecrawl.dev/api-reference/v1-endpoint/scrape),
[`POST /crawl`](https://docs.firecrawl.dev/api-reference/v1-endpoint/crawl-post),
[`GET /crawl/{id}`](https://docs.firecrawl.dev/api-reference/v1-endpoint/crawl-get).

This is a **one-shot migration tool**, not a compatibility layer. Point a
Firecrawl v1 client at `http://127.0.0.1:8787/fc` so its `/v1/scrape` and
`/v1/crawl` calls hit the shim, which translates them onto the native
contract (`POST /v1/scrape`, `POST /v1/crawl` 202, `GET /v1/crawl/:id`).

Covered:

- `POST /fc/v1/scrape` → native scrape → `{ success, data }`
- `POST /fc/v1/crawl` → native crawl start → `{ success, id, url }` (HTTP 200)
- `GET /fc/v1/crawl/:id` → native report + steps → Firecrawl crawl status

Not covered (will not be added): Search, Interact, Agent, Monitor, Map, Extract.

## Known diffs

- Challenge / block pages are `success: false`. Firecrawl often returns the interstitial as success markdown.
- No fire-engine, proxy pools, `actions`, JSON extract, or screenshots.
- Resume / cache defaults to refetch. A Firecrawl body never sets `useCached`.
- Omitted `limit` / `maxDepth` stay unbounded. Firecrawl defaults are 10000 / 10.
- Shim crawl start is HTTP 200 `{success,id,url}`. Native crawl start stays 202 `{taskId}`.
- `creditsUsed` is always 0. Formats other than markdown / links are dropped.
