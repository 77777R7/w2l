# Phase 3 Benchmark Gate

The formal gate compares the same fixed fixture suite and ground-truth checks. It does not treat a comparator's transport-level `success` flag as a quality result.

## Pinned Comparator Baselines

### Firecrawl self-hosted

- Release: `v2.11.162`
- Source: `https://github.com/firecrawl/firecrawl.git`
- Runtime: Docker Compose v2
- API: `http://localhost:3002`
- Local baseline configuration: `USE_DB_AUTHENTICATION=false`, PostgreSQL queue, no Fire-engine, no optional AI provider
- Health check: `GET /v0/health/readiness`
- Scrape check: `POST /v2/scrape` with `formats: ["markdown"]`

The official self-hosting guide pins this release and requires Docker. W2L does not link Firecrawl or copy its source; it is an external benchmark-only comparator.

### Crawl4AI self-hosted

- Release: `0.9.3`
- Source: `https://github.com/unclecode/crawl4ai/releases/tag/v0.9.3`
- Install: `uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python crawl4ai==0.9.3`
- Browser setup: `.venv/bin/crawl4ai-setup`
- Runtime: `AsyncWebCrawler`, `CrawlerRunConfig(cache_mode=CacheMode.BYPASS)`

Crawl4AI is also external benchmark-only tooling. It must not be added as a W2L dependency or copied into the repository.

## Evidence Contract

Each comparator run must store:

- exact release/version and source commit when available;
- command line and configuration;
- machine, OS, Python/Node, browser, and git metadata;
- one raw JSON result per fixture URL;
- raw Markdown where the comparator returns Markdown;
- normalized ground-truth scoring output;
- run log and failure log.

The gate treats a comparator as `ready` only when both its version command succeeds and its raw evidence path exists. A version command alone is not a benchmark run.

## Current Blocker

On the current macOS runner:

- Docker is not installed, so Firecrawl `v2.11.162` cannot be started.
- Crawl4AI `0.9.3` was installed in an isolated `/tmp` virtual environment and its browser setup completed.
- Crawl4AI successfully scraped the local fixture server, but its `/spa/delayed` smoke result returned the loading shell instead of the delayed ground-truth fact. It therefore cannot be treated as a completed quality comparator without a full 56-case adapter and scoring run.

Until both comparators produce raw evidence for the same suite, the formal gate remains `blocked` and W2L has no defensible competitor-lead claim.

## Valid Run Evidence

Docker-capable run `35423895294` on `main@6dc2e6e` completed all three adapters with 56 raw records each. The normalized page-quality comparison was:

| Tool | Status matches | Verified completion | False success | Failure explainability | P95 wall |
| --- | ---: | ---: | ---: | ---: | ---: |
| W2L | 45/56 | 66.1% | 0.0% | 94.7% | 10.1s |
| Firecrawl self-hosted v2.11.162 | 39/56 | 32.1% | 67.9% | unavailable | 104ms |
| Crawl4AI 0.9.3 | 44/56 | 14.3% | 81.8% | 100.0% | 46.1s |

These values support a page-quality lead for W2L on verified completion and false-success rate for this fixed synthetic suite. They do not support a cost or recovery lead: those metrics were not measured comparably and remain unavailable. Full raw evidence is retained in the GitHub Actions artifact for run `35423895294`, not committed to the repository.

The cost model is explicit: the self-hosted adapters record `usdPerHour: 0.0` only to indicate that no provider invoice is present. This is not a claim that infrastructure has zero real-world cost, so cost-per-verified-page remains unavailable. W2L has URL-level SQLite checkpoint/resume; Firecrawl and Crawl4AI are marked `unsupported` for equivalent recovery in this page-only run, not failed and not passed.

## Run

```bash
npm ci
npm run typecheck
npm run benchmark:gate
```

The command writes W2L evidence and `gate.json` under `output/benchmark-gate/`. Comparator evidence is supplied externally through the configured command/evidence paths; generated raw outputs are not committed.
