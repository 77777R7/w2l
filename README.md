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
npm ci
npx playwright install chromium
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

ROADMAP.md                         Current Section A/B/C roadmap

docs/
  roadmap/section-a-foundation.md  Section A phases and A4 gate
  roadmap/section-b-continuous-data.md  Section B future direction
  roadmap/section-c-delivery.md    Section C future delivery direction
  PHASE1_ENGINEERING_NOTES.md    Decision log
  PRODUCT_PLAN_V2.md              Product roadmap
  firecrawl-shim.md               Firecrawl v1 scrape/crawl snapshot + diffs
  benchmark-gate.md               Phase 3 comparator versions, evidence contract, and blockers
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
- [x] Phase 1 Local Reliability Gate: Chromium-backed full test suite and GitHub Actions
- [x] Phase 2 L0-L2 quality benchmark: W2L ladder, verified completion, false-success, P95, escalation, and tiered reports
- [x] Phase A4 real-task harness: AI knowledge and product-info manifests, field assertions, repeat consistency, holdout and cost/evidence records
- [ ] Phase A4 real-task gate: 100-200 permitted pages, human correction time, repeated task evidence, and complete failure taxonomy
- [x] Phase A4 diagnostic expansion: 20 real tasks, 11 domains, 40 repeated runs, and holdout results
- [x] A6 scale slice: 100 pages, 10 domains, two runs; labeled holdout is not independent
- [x] A6 recovery/install/correction/cost evidence: interrupt-resume lost 0 URLs; clean-clone first task; 18 minutes human correction; billed USD unknown
- [x] A6 deferred exceptions recorded: second-developer install is deferred, not passed; billed USD is unknown, not zero
- [ ] A6 unconditional pass still needs a second human install
- [x] A5/A6 gate report: conditional alpha; billed USD remains unknown
- [x] Phase 3 Benchmark Gate harness: fixed W2L run, comparator evidence, and blocked-until-real-comparators decision
- [ ] Hosted Egress Gate: browser subresource policy enforcement and DNS-to-connection binding

See [ROADMAP.md](ROADMAP.md) for the current Section/Phase plan. [PRODUCT_PLAN_V2.md](PRODUCT_PLAN_V2.md) remains the historical detailed plan.

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
