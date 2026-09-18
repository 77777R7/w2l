# W2L — Web-to-LLM Context Extraction

A transparent, verifiable web extraction system built for RAG and Agent workflows.

## Why This Exists

Most crawlers report "success" when they return empty pages, challenge screens, or the wrong content. W2L makes failure visible and fixable:

**Before (typical crawler):**
```
✓ Fetched example.com/article
  Status: 200 OK
  Content: 953 bytes
```

**After (W2L):**
```
✗ Fetched example.com/article
  Status: blocked (cloudflare_challenge)
  Lane: http → escalated to browser_local
   Evidence: artifacts=[] (no screenshot or DOM snapshot was produced)
  Cost: 847 tokens, 2.3s, $0.0042
  Fix: needs user login or proxy (tier 1b/2)
```

## What's Different

1. **Failure is a first-class outcome** — `empty_verified`, `blocked`, `failed` with reasons, not silent empties
2. **Five false-success checks** — challenge text, wrong-page content, missing facts, truncation, yield-below-floor
3. **Execution ladder** — HTTP → browser → user auth → proxy, with automatic routing, per-attempt trace, and task-level cost accounting
4. **Ground-truth benchmark** — 30 adversarial fixtures (soft 404s, challenge pages, SPAs, timeouts, zip bombs) with verified false-success rates
5. **Honest evidence** — `artifacts: []` is an explicit empty artifact list, not a promise that every failed page has a screenshot or DOM snapshot; browser `bytesWire: null` means wire bytes were not measured

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/w2l.git
cd w2l
npm install
npm run typecheck
npm test
npm run scrape -- https://example.com
npm run crawl -- https://example.com --max-pages 20
npm run api
npm run mcp
```

`npm run api` binds `127.0.0.1` and allows loopback/RFC1918 so fixture servers work. Hosted mode is explicit: `npm run api -- --hosted --token $W2L_API_TOKEN`. That binds `0.0.0.0`, requires `Authorization: Bearer`, denies private/metadata IPs, and defaults crawl `maxPages` to 100.

MCP (Cursor / Claude) talks to the REST server:

```json
{
  "mcpServers": {
    "w2l": {
      "command": "npm",
      "args": ["run", "mcp"],
      "env": { "W2L_API_URL": "http://127.0.0.1:8787" }
    }
  }
}
```

Firecrawl v1 clients: set the base URL to `http://127.0.0.1:8787/fc` so `/v1/scrape` and `/v1/crawl` hit the shim. Snapshot 2026-09-18; known diffs in [docs/firecrawl-shim.md](docs/firecrawl-shim.md). Search / Interact / Agent / Monitor are not implemented.

## Benchmark

Run the full fixture suite against the bare HTTP baseline:

```bash
npm run bench
```

Expected output:
```
Subject: bare-http
  Cases: 30
  Status matches: 17/30
  Contentful: 20
  False successes: 12
  False success rate: 60.0%
```

The bare HTTP baseline intentionally has a high false-success rate (no content extraction, no challenge detection, no redirect handling). A production subject should beat these numbers.

## Repository Structure

```
packages/
  contracts/       TypeScript types and ground-truth schema
  fixtures/        HTTP server with 30 ground-truth test cases
  http-core/       robots.txt parser (ReDoS-resistant)
   runtime/         TaskStore, frontier, bounded crawl orchestrator
  bench/           Benchmark runner, scrape/crawl CLI, scoring
  api/             REST server (AGPL)
  sdk/             TypeScript client (MIT)
  mcp/             stdio MCP server (MIT)

docs/
  PHASE1_ENGINEERING_NOTES.md    Decision log
  PRODUCT_PLAN_V2.md              Product roadmap
  firecrawl-shim.md               Firecrawl v1 scrape/crawl snapshot + diffs
```

## Roadmap

- [x] Contracts and ground-truth schema
- [x] Fixture server with 30 adversarial cases
- [x] robots.txt ReDoS fix (token-based glob matcher)
- [x] Benchmark pipeline with bare HTTP baseline
- [x] extract-tf + HTML→Markdown after extract
- [x] Browser lane (Playwright) and HTTP → browser → vendor ladder
- [x] Honest identity bundle (UA / hints / locale / viewport must agree)
- [x] `w2l scrape` product CLI (`w2l-fetch` is an alias)
- [x] `w2l crawl` + SQLite checkpoint resume
- [x] REST API + TypeScript SDK (`POST /v1/scrape`, `POST /v1/crawl`, `GET /v1/crawl/:id`)
- [x] MCP server (`scrape`, `crawl`, `get_crawl` over REST)
- [x] Firecrawl `/scrape` `/crawl` migration shim (snapshot 2026-09-18; not a compatibility layer)
- [x] Task-level ladder accounting, preserved per-channel attempts, and honest unknown cost/evidence fields
- [x] Bounded multi-page workers, shared host scheduling, conditional browser settling, and runtime resource reuse
- [ ] Phase 1 reliability gate: recovery edge cases, production hash/loop semantics, empty-result contract, browser egress isolation, and CI

See [PRODUCT_PLAN_V2.md](PRODUCT_PLAN_V2.md) for the full plan.

## Contributing

We use the [Developer Certificate of Origin (DCO)](https://developercertificate.org/) instead of a CLA. Every commit needs a `Signed-off-by` line:

```bash
git commit -s -m "Your commit message"
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

Server-side code: [AGPL-3.0](LICENSE)  
SDK and client libraries: MIT (when published)

See [PHASE1_ENGINEERING_NOTES.md §1.3](PHASE1_ENGINEERING_NOTES.md) for the rationale.

## Why AGPL?

AGPL requires network-deployed modifications to remain open. Anyone can fork, modify, and host W2L — as long as they share those modifications. The real differentiator is the name (trademark) and the hosted service, not the license lock.
