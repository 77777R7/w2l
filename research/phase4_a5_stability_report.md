# Phase 4 / A5 Stability Fix

## Change

The first diagnostic run compared raw response/body hashes. Product pages can change harmless whitespace, rendered representation, or HTTP/browser path while delivering the same normalized Markdown. A5 now compares a normalized Markdown hash for repeat consistency and treats assertion `unknown` as incomplete rather than complete.

## Before / After

| Family | Repeat-consistent before | Repeat-consistent after | Runs |
| --- | ---: | ---: | ---: |
| AI knowledge | 11 | 11 | 22 |
| Product info | 5 | 9 | 18 |

The change improved product-page stability evidence but did not close A5. Four product repeats remain inconsistent and require diagnosis of dynamic content, route changes, or subject/product identity before more optimization.

## Cost Boundary

All local runs still report unknown external cost. No zero-cost claim is made. Human correction time remains unrecorded and is still required for the full A4/A5 gate.

## Next A5 Work

- Compare inconsistent pairs' final URL, lane, raw body hash, normalized content hash, and trace.
- Separate expected page drift from extraction instability.
- Add field-level structured product facts instead of relying only on Markdown substring assertions.
- Re-run the same manifest after each fix.
