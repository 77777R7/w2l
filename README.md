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
  Evidence: challenge.png, dom-snapshot.html
  Cost: 847 tokens, 2.3s, $0.0042
  Fix: needs user login or proxy (tier 1b/2)
```

## What's Different

1. **Failure is a first-class outcome** — `empty_verified`, `blocked`, `failed` with reasons, not silent empties
2. **Five false-success checks** — challenge text, wrong-page content, missing facts, truncation, yield-below-floor
3. **Execution ladder** — HTTP → browser → user auth → proxy, with automatic routing and cost accounting
4. **Ground-truth benchmark** — 30 adversarial fixtures (soft 404s, challenge pages, SPAs, timeouts, zip bombs) with verified false-success rates

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/w2l.git
cd w2l
npm install
npm run typecheck
npm test
npm run bench
```

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
  bench/           Benchmark runner and scoring

docs/
  PHASE1_ENGINEERING_NOTES.md    Decision log
  PRODUCT_PLAN_V2.md              Product roadmap
```

## Roadmap

- [x] Contracts and ground-truth schema
- [x] Fixture server with 30 adversarial cases
- [x] robots.txt ReDoS fix (token-based glob matcher)
- [x] Benchmark pipeline with bare HTTP baseline
- [ ] Production HTTP subject (undici + readability + turndown)
- [ ] Browser lane (Playwright)
- [ ] Execution ladder (HTTP → browser → auth → proxy)
- [ ] CLI tool
- [ ] REST API

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
