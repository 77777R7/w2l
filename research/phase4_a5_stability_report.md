# Phase 4 / A5 Stability Fix

## Change

The first diagnostic run compared raw response/body hashes. Product pages can change harmless whitespace, rendered representation, or HTTP/browser path while delivering the same normalized Markdown. A5 now compares a normalized Markdown hash for repeat consistency, counts every run in a repeat pair, and treats assertion `unknown` as incomplete rather than complete.

Documentation pages with leftover breadcrumbs were misrouted as listings. The router now prefers article extraction when `<main>` holds several prose paragraphs, and the list strategy falls back to the article region when a breadcrumb list is much smaller than the recovered article. Browserbase's `Monthly Browser Sessions` counter is task-scoped dynamic noise. The WebSocket assertion was updated to a phrase that is still on the live MDN page.

## Before / After

| Family | Metric | Before | After | Runs |
| --- | --- | ---: | ---: | ---: |
| AI knowledge | correct-complete | 18 | 22 | 22 |
| AI knowledge | repeat-consistent | 11 | 22 | 22 |
| Product info | correct-complete | 16 | 18 | 18 |
| Product info | repeat-consistent | 5 | 18 | 18 |

Evidence: `output/phase4/real-task-report-a5-v4.json`.

## Cost Boundary

All local runs still report unknown external cost. No zero-cost claim is made. Human correction time remains unrecorded and is still required for the full A4/A5 gate.

## Remaining A5 Work

Quality and repeat-consistency scores on this 20-task slice are complete. A5 is not fully accepted until human correction minutes and a comparable cost meter are recorded.
