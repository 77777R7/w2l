# A6 Expanded Validation

## Scope

- Manifest: `phase4-a6-v0.1-2026-09-20`
- 100 pages across 10 official domains.
- 20 holdout pages; holdout pages are not used for tuning.
- Two independent runs of the same 100-page manifest.
- GET-only, public official sources, no login/form/CAPTCHA actions.

## Repeat Evidence

- First run: 100 pages.
- Second run: 100 pages.
- Outcome consistency: `100/100`.
- Normalized content-hash consistency: `99/100`.
- External cost: unknown for all runs.
- Manual correction time: not recorded.

The one normalized-hash difference must be inspected as normal page drift versus extraction instability before it is treated as a product defect.

## Gate Status

The scale and holdout portion of A6 is complete for this slice. A6 is not fully closed yet because the remaining gate requires:

- interruption/recovery evidence on the expanded task set;
- another developer installation and first-task validation;
- recorded human correction time;
- explicit supported-scope and support-boundary documentation.

## A5 Relationship

A5 quality work improved real-task assertion and normalized repeat evidence. Cost remains unknown, and dynamic page drift remains a separate diagnostic category rather than a reason to globally strip changing content.
