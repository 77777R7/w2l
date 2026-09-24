# Page through a durable batch

Use a batch when you already have an explicit list of public URLs. A batch visits those URLs only; it does not discover links or turn one seed into a crawl. The local REST, SDK, and MCP batch keep checkpoints so results remain queryable after the client disconnects.

## Input

After [connecting the local MCP service](/docs/connect-mcp/), ask Codex:

```text
Use W2L batch_scrape with these URLs: https://docs.firecrawl.dev/introduction and https://modelcontextprotocol.io/specification/2025-11-25/basic/transports. Use Markdown. Return the taskId, wait for completion, then page through every item with get_batch_items at limit 1. Include failed items and their reasons.
```

The corresponding MCP start arguments are:

```json
{
  "urls": [
    "https://docs.firecrawl.dev/introduction",
    "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
  ],
  "formats": ["markdown"]
}
```

These are example inputs. The site may change or block a later request.

## Expected output

`batch_scrape` returns a `taskId` immediately. Pass it to `get_batch` or `wait_batch` for progress. `get_batch_items` accepts `id`, `limit` (maximum 50), and the returned `cursor` for the next page. Continue until no next cursor remains, and inspect **each** item's status and failure reason. A completed batch can contain failed URLs. The task persists independently of the MCP connection; only `cancel_batch` explicitly cancels remaining work.

For a checked Amazon.sg product list, `batch_products` uses the reviewed product schema and requires distinct ASINs. It accepts up to 1000 URLs, but that input limit is **not** evidence that the 1000-page reliability gate passed.

## If results are missing or slow

Check `get_batch` for `requested`, `completed`, `remaining`, and task status. `wait_batch` may return while the task is still running; repeat it or page through finished items. Keep the same task store when restarting the local service. Examine per-item blocks, retries, and timeouts instead of treating the batch-level completion flag as universal success.
