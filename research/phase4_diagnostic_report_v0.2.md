# Phase 4 Diagnostic Expansion

Run manifest: `phase4-v0.2-2026-09-20`

## Scope

- 20 tasks across 11 domains.
- 40 scrape runs, two repeats per task.
- 11 holdout tasks/runs are present in the manifest.
- Sources are public official documentation and product pages; GET only, no login, form submission, or CAPTCHA handling.

## Result

| Task family | Tasks | Runs | Correct-complete runs | Repeat-consistent repeats | Unknown cost runs |
| --- | ---: | ---: | ---: | ---: | ---: |
| AI knowledge | 11 | 22 | 18 | 11 | 22 |
| Product info | 9 | 18 | 16 | 5 | 18 |

## Diagnosis

- AI knowledge pages are mostly repeatable in this slice, but every local run has unknown external cost.
- Product-info pages have materially weaker repeat consistency (`5/18` repeat confirmations). This is the first A5 candidate: distinguish dynamic/pricing drift from extraction instability and make the result classification explain which one occurred.
- Product assertions remain Markdown-level proxies, not structured product-field extraction. This is sufficient for a diagnostic harness but not for a product-data quality claim.
- Manual correction minutes are still `null`; human correction must be recorded before A4 can pass its cost/maintenance gate.

## Gate Status

This is expanded A4 diagnosis, not A6 completion.

- A4: diagnostic evidence is now broad enough to select A5 work, but the full A4 gate is not closed.
- A5: begin with product-page repeat consistency, subject/recommendation identity, and field-level evidence.
- A6: not started; the current 20 tasks/11 domains are below the 100–200 page and 10–20 domain target.
