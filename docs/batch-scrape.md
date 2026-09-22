# Persistent URL-array scraping

`POST /v1/batches` accepts 1–1000 distinct HTTP(S) URLs and returns a durable `taskId` immediately. URLs that collapse to the same crawl canonical URL are rejected. A batch visits only the supplied URLs; it does not follow links. Omitting `formats` selects Markdown. JSON formats use the same deterministic-first Schema extraction as single-page scrape.

```bash
curl -sS -X POST http://127.0.0.1:8787/v1/batches \
  -H 'content-type: application/json' \
  -d '{"urls":["https://example.com/a","https://example.com/b"],"formats":["markdown"]}'
```

Use the returned ID with `GET /v1/batches/:id` for `requested`, `completed`, `remaining`, and task status. `GET /v1/batches/:id/items?limit=50&cursor=...` returns all per-URL outcomes, including failures, in stable pages (default 10, maximum 50). Items omit attempt audits and trace content by default; pass `debug=true` to include the routing audit and trace. Persisted attempt audits omit repeated Markdown/links bodies; the selected top-level result remains available. `GET /v1/batches/:id/events` streams `progress`, `paused`, and terminal `complete` SSE events; reconnecting after a restart receives the current state. `POST /v1/batches/:id/cancel` cancels unfinished work. A completed batch can contain failed URLs, so inspect each item's `status` and `failureReason`.

```ts
const { taskId } = await w2l.batchScrape(urls, {
  formats: [{ type: 'json', schema: productSchema }],
})
const done = await w2l.waitBatch(taskId)
for await (const item of w2l.listBatchItems(taskId, { limit: 50 })) {
  console.log(item.url, item.status, item.json?.data)
}
```

MCP exposes `batch_scrape`, `get_batch`, `get_batch_items`, `wait_batch`, and `cancel_batch`. `wait_batch` waits at most 30 seconds by default (configurable with `timeoutMs` up to 300 seconds) and returns the current state if the batch is still running; for incremental work, page through items while the task runs. The task and item checkpoints are SQLite-backed; after a process restart, pending/running/paused batches resume missing URLs and keep prior results.

An [actual process-kill test](evidence/batch-crash-recovery.json) stopped the API with `SIGKILL` after URL 1 completed and URL 2 started. The restarted API finished 2/2 items; URL 1 was requested once and URL 2 twice. Repeat with `npm run verify:batch-crash`. Run one API process per task root; multi-process ownership/lease coordination is not part of this batch contract.

The process shares one origin scheduler across local HTTP, browser, and Monitor paths. It caps same-origin work to the operator's `perHostConcurrency` (hard maximum four), enforces `perHostMinDelayMs` between starts, and holds queued requests during Retry-After. Queued cancellation and deadlines release their place. The controlled 1→2→4 comparison and test setup are in [the evidence JSON](evidence/same-origin-concurrency-controlled.json); run `npm run baseline:concurrency` to repeat it. This experiment does not establish a safe or faster Amazon setting. Test the same URLs, fields, and observed delivery region separately before changing the hosted setting.

Set `W2L_PER_HOST_CONCURRENCY=1|2|3|4` and `W2L_PER_HOST_MIN_DELAY_MS` (1–60000, default 250) on the API process to tune the shared origin gate. These are operator settings, not batch-request parameters.

The [real 10-URL Amazon comparison](evidence/amazon-batch-concurrency.json) used the same URLs, JSON Schema, and 250 ms interval. Both 1 and 2 completed 10/10 pages with complete JSON and correct ASINs. Client batch time was 44.5 seconds at 1 and 23.5 seconds at 2. This raw difference is **not** a fully controlled speed claim: four pages in each arm lacked an observed delivery region. The other six kept the same observed region, currency, and route. Real concurrency 4 was withheld; the local controlled 4-arm experiment remains separate evidence. The [earlier run](evidence/amazon-batch-concurrency-before-transport-pacing.json) is retained because the implementation subsequently added pacing at the actual transport start.

Public Monitor 304 caching is a different path. A response with `Set-Cookie`, `Cache-Control: no-cache`, and no ETag/Last-Modified is not saved as a reusable public representation by the current cache. The controlled cache test confirms two full 200 fetches with no validator; it does not claim a cache speedup for Amazon.
