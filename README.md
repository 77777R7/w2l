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

For the no-install, single-page web preview and its deployment requirements, see
[Public preview](docs/public-preview.md). The page is implemented in this branch;
it does not have a permanent public URL until the Cloud Run deployment and live
acceptance are complete.

Use Node.js 22.12+ or 24+ and npm. The SDK is currently a private workspace package; build it from this checkout. For the full Monitor → result → HTTPS event → restart workflow, follow [the onboarding guide](docs/onboarding.md) and [independent developer acceptance checklist](docs/independent-developer-acceptance.md).

```bash
git clone https://github.com/77777R7/w2l.git
cd w2l
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run scrape -- https://example.com
npm run crawl -- https://example.com --max-pages 20
```

For local MCP use, one background service runs the API, Monitor scheduler,
delivery worker and MCP endpoint. On macOS, install it as a LaunchAgent and
connect Codex to its loopback URL:

```bash
npm run local:mcp:install
codex mcp add w2l-local --url http://127.0.0.1:8791/mcp
npm run local:mcp:status
```

It restarts after a process crash and at login. No Render or WorkOS account is
needed for this local path. `npm run local:mcp:uninstall` removes the agent;
`codex mcp remove w2l-local` removes the client entry. On other systems, run
`npm run local:mcp` in one terminal. The state stays in `.w2l/api` by default.
See the [MCP first-use walkthrough](docs/mcp-first-use.md) for the actual
Monitor and HTTPS delivery flow and secret setup. Keep this checkout while
the LaunchAgent points to it.

To receive signed events on the same Mac with a fixed HTTPS loopback URL,
run `npm run local:receiver:install`, then reinstall the MCP service with
`W2L_LOCAL_DELIVERY_LOOPBACK=1 npm run local:mcp:install`. The option only
permits loopback delivery and pins trust to the generated local certificate.
The receiver and its SQLite inbox run as a separate LaunchAgent; neither
service becomes reachable from another machine.

The legacy standalone REST API remains available for SDK and Firecrawl-shim
clients:

```bash
npm run api
```

To connect a standalone stdio MCP process to that API, run:

```bash
npm run mcp
```

`npm run api` binds `127.0.0.1` and allows loopback/RFC1918 so fixture servers work. Hosted mode is explicit: `npm run api -- --hosted --token $W2L_API_TOKEN`. That binds `0.0.0.0`, requires `Authorization: Bearer`, denies private/metadata IPs, and defaults crawl `maxPages` to 100.

The unified local MCP covers scrape, Crawl, persistent URL-array batches, and
Monitor/Delivery without separate worker terminals. A unified service also
implements authenticated Streamable HTTP for the reviewed public-document
Monitor and anonymous Amazon.sg product JSON/batch flows; its permanent Render
URL and final hosted acceptance are pending. For both flows on one Mac, run
`npm run first-use:local` after `npm ci`; see the
[two-flow first-use guide](docs/dual-flow-first-use.md),
[MCP first-use walkthrough](docs/mcp-first-use.md) and
[C2/C3 status](docs/roadmap/section-c-delivery.md). Advanced clients may
still launch the legacy stdio adapter from this repository:

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

MCP `scrape` is compact by default: it returns the selected content, document/product metadata, aggregate usage and errors without repeating the body under `summary.attempts`. Pass `debug: true` when you need the full route, trace and per-attempt audit. REST and SDK calls that omit `formats` and `debug` keep the legacy full Markdown response.

For many known URLs, use `batch_scrape` in MCP, then `get_batch`, `get_batch_items`, or `wait_batch`. REST and SDK support the same durable task, paginated items, and completion events; see [batch scraping](docs/batch-scrape.md). The per-origin concurrency ceiling is configurable up to four, with a shared Retry-After cooldown and minimum request interval. The controlled [1/2/4 comparison](docs/evidence/same-origin-concurrency-controlled.json) is local fixture evidence, not an Amazon speed claim.

Request deterministic structured data with a JSON Schema alongside, or instead of, Markdown:

```ts
const product = await w2l.scrape('https://www.amazon.com/dp/B08KT2Z93D', {
  debug: false,
  formats: [{
    type: 'json',
    schema: {
      type: 'object',
      properties: {
        asin: { type: 'string' },
        title: { type: 'string' },
        price: { type: ['number', 'null'] },
        currency: { type: ['string', 'null'] },
        seller: { type: ['string', 'null'] }
      },
      required: ['asin', 'title', 'price', 'currency', 'seller'],
      additionalProperties: false
    }
  }]
})
```

W2L maps supported product fields directly from subject-bound HTML, JSON-LD, metadata and DOM evidence. A missing nullable field is `null` with a `field_unavailable` issue. Model fallback is opt-in with `modelFallback: true`; configure an OpenAI-compatible endpoint through `W2L_EXTRACT_BASE_URL`, `W2L_EXTRACT_MODEL` and optional `W2L_EXTRACT_API_KEY`. Without those variables, page content is never sent to a model and the JSON result reports `model_unavailable`.

Run the fixed 10-product, three-round Amazon MCP baseline with:

```bash
node scripts/section-b/amazon-public-state.mjs
npm run baseline:amazon -- --concurrency 1
npm run baseline:amazon -- --concurrency 2
# After 1 and 2 are comparable and unblocked:
npm run baseline:amazon -- --concurrency 4
```

The setup uses an anonymous Singapore public delivery preference for this benchmark only. Round 1 pins the observed context; later unobserved or mismatched region/currency records remain in the report and do not count as comparable. Reports and raw HTML stay under ignored `.w2l/amazon-baseline/`; the URL manifest and schema are versioned. The [signed ten-product result](docs/evidence/amazon-adapter-integration-2026-09-23.md) passed at limited concurrency, but Amazon remains beta pending the 100/1000 promotion gates. The [older baseline](research/amazon-product-baseline-2026-09-22.md) is historical.
The concurrency-1 command can exit nonzero because its ten-page median exceeds 20 seconds; inspect its report for comparability and blocking before continuing to 2. The signed run had 37.93 seconds at 1, 19.92 at 2, and 12.39 at 4.
This signed Amazon slice is currently on the local `codex/amazon-adapter-integration` branch, not the released `main` or `v0.4.0-rc.1` source.

Firecrawl v1 clients: set the base URL to `http://127.0.0.1:8787/fc` so `/v1/scrape` and `/v1/crawl` hit the shim. Snapshot 2026-09-18; known diffs in [docs/firecrawl-shim.md](docs/firecrawl-shim.md). Firecrawl Search / Interact / Agent / Monitor compatibility is not implemented. W2L's native Monitor and Delivery APIs use their own contracts.

## Continuous Monitors and event delivery

The native SDK includes Crawl pagination/cancellation, Monitor creation/revisions/runs/control, and Delivery destinations/status/retry. [The runnable example](examples/monitor-workflow.ts) uses a controlled price source, explicit `captureMode`, validated baselines, conditional HTTP requests, and persisted events. [The webhook receiver](examples/webhook-receiver.ts) stores event receipts and applies a versioned product projection transactionally.

The API, Monitor scheduler and delivery worker share a persistent control database.
`npm run local:mcp:install` manages all three for local MCP users. For a
standalone API deployment, run the workers in separate terminals with the
same `W2L_TASK_ROOT` as the API:

```bash
export W2L_TASK_ROOT="$PWD/.w2l/api"
npm run monitors:worker
```

The Monitor worker defaults to public-source network policy. For the controlled local source in the onboarding example, explicitly set `W2L_MONITOR_NETWORK_MODE=local` in that worker terminal. A locally running worker does not inherit broader network access from the API or database.

```bash
export W2L_TASK_ROOT="$PWD/.w2l/api"
npm run delivery:worker
```

See [onboarding](docs/onboarding.md) for the HTTPS receiver, authentication, worker configuration, and pending-delivery restart exercise. Gate 2–4 source freeze `99894bd636ecafd254a7c7bc79d26e9a97fa9199` is on `main` through [PR #50](https://github.com/77777R7/w2l/pull/50) and is published as source prerelease [`v0.4.0-rc.1`](https://github.com/77777R7/w2l/releases/tag/v0.4.0-rc.1). Clone `main` or check out that tag. Workspace packages remain private and independent human installation remains pending.

The [Gate 2–4 acceptance record](docs/roadmap/gate-2-4-acceptance.md) links the process-crash, concurrent-claim, public HTTPS and agent clean-install evidence. Gate 2/3 engineering acceptance passed; Gate 4 awaits a non-author human, and Gate 5 external two-week/repeat-use validation has not started. `npm run package:handoff` captures review source with per-file hashes. The existing tested archive is a preserved pre-commit snapshot, not a package of subsequent roadmap edits.

C2 Monitor/Delivery MCP and its local HTTPS first-use workflow are implemented. C3 has a unified process and authenticated Streamable HTTP implementation; Render hosting, WorkOS browser login, real-client connection, and a hosted restart drill remain unverified. B1/B2 and C1 remain in_progress for their broader operational/adoption gates. See the [first-use walkthrough](docs/mcp-first-use.md) and [dated local evidence](docs/evidence/c2-c3-mcp-local-2026-09-23.md).

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
  mcp/             stdio and restricted Streamable HTTP MCP server (MIT)

examples/monitor-workflow.ts       Runnable Monitor + Delivery SDK workflow
examples/webhook-receiver.ts       Durable idempotent sample receiver

ROADMAP.md                         Current Section A/B/C roadmap

docs/
  onboarding.md                  Install, Crawl, Monitor, HTTPS events and recovery
  mcp-first-use.md               Conversational Monitor/Delivery and hosted pilot setup
  independent-developer-acceptance.md  Pending human Gate 4 run sheet
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
- [x] REST API + TypeScript SDK (`POST /v1/scrape`, `POST /v1/crawl`, `GET /v1/crawl/:id`, paginated crawl pages/errors, cancel)
- [x] MCP server (`scrape`, `crawl`, `get_crawl`, paginated pages/errors, and cancel over REST)
- [x] Compact MCP scrape responses, direct structured JSON/JSON Schema extraction, and Amazon subject adapter/baseline
- [x] Firecrawl `/scrape` `/crawl` migration shim (snapshot 2026-09-18; not a compatibility layer)
- [x] Task-level ladder accounting, preserved per-channel attempts, and honest unknown cost/evidence fields
- [x] Bounded multi-page workers, shared host scheduling, conditional browser settling, and runtime resource reuse
- [x] Phase 1 Local Reliability Gate: Chromium-backed full test suite and GitHub Actions
- [x] Phase 2 L0-L2 quality benchmark: W2L ladder, verified completion, false-success, P95, escalation, and tiered reports
- [x] Phase A4 real-task harness: AI knowledge and product-info manifests, field assertions, repeat consistency, holdout and cost/evidence records
- [ ] Phase A4 real-task gate: 100-200 permitted pages, human correction time, repeated task evidence, and complete failure taxonomy
- [x] Phase A4 diagnostic expansion: 20 real tasks, 11 domains, 40 repeated runs, and holdout results
- [x] A6 scale slice: 100 pages, 10 domains, two runs; labeled holdout is not independent
- [x] A6 recovery/install evidence recorded: interrupt-resume lost 0 URLs; same-machine clean-clone first task; historical 18-minute correction record lacks human confirmation; billed USD unknown
- [x] A6 deferred exceptions recorded: second-developer install is deferred, not passed; billed USD is unknown, not zero
- [ ] A6 unconditional pass still needs a second human install
- [x] A5/A6 gate report: conditional alpha; billed USD remains unknown
- [x] Gate 2 execution contract, actual process recovery, controlled changes/cache and Monitor isolation
- [x] Gate 3 durable HTTPS delivery, same-event retry, deduplication and restart recovery
- [x] Gate 4 SDK, docs, examples and agent clean installation
- [ ] Gate 4 independent non-author human installation and full workflow
- [x] C2 Monitor/Delivery MCP and local conversational first-use flow
- [ ] C2 n8n and narrow task UI
- [x] C3 unified single-instance process and authenticated Streamable HTTP implementation
- [ ] C3 permanent Render URL, WorkOS/Codex OAuth acceptance and hosted restart drill
- [ ] Gate 5 two external trial users, two weeks, repeat use and real downstream consumption
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
