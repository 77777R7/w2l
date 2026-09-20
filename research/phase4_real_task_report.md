# Phase 4 Real Task Validation

Initial slice: `phase4-v0.1-2026-09-19`

## Scope

- 3 AI knowledge tasks: MDN and Playwright official documentation.
- 3 product-info tasks: Browserbase, Steel, and Firecrawl official pages.
- 2 repeats per task.
- 6 holdout runs.
- GET-only, no login, no form submission, no CAPTCHA handling.

## Initial Result

- AI knowledge: 2/3 tasks correct-complete.
- Product info: 2/3 tasks correct-complete.
- Repeat content hashes: recorded per task; inconsistent repeats remain diagnostic failures, not silently accepted.
- External cost: unknown for all local runs.
- Manual correction time: not recorded yet.

This is an A4 diagnostic slice, not the A4/A5/A6 completion gate. The next iteration must fix assertion semantics and expand the sample before claiming general real-task quality.

## Required Next Evidence

- 24–30 diagnostic pages with field-level assertions.
- 100–200 pages across 10–20 domains for A6.
- Human correction minutes per run.
- Repeated task consistency after content updates.
- Explicit A5 before/after evidence for quality and efficiency fixes.
