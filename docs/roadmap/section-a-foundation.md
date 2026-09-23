# Section A · Reliable Data Collection

Section A turns a URL or permitted task into data that can be checked, explained, repeated, and recovered.

## Current status · 2026-09-23

Section A remains a scoped developer alpha. The [isolated Amazon A4/B2 ten-product slice](../evidence/amazon-adapter-integration-2026-09-23.md) passed with signed core-field review and limited-concurrency speed evidence at source SHA `04ce581`; it has not been merged or released. It does not close A4 across sources, the independent developer install, or the later Amazon 100/1000 gates. B1/B2 are now in progress, while B3/B4 remain bounded prototypes.

## Historical A→B handoff calibration

The original handoff did not treat PR #39 `accepted_with_unknown_external_usd` as an unconditional A6 pass and deferred B2–B4 until the following list was made honest:

- pair-level repeat scoring
- field-level quality subset, separate from scale nonempty checks
- independent holdout vs labeled holdout
- interrupted attempt terminal state
- second-developer install deferred as an explicit exception (`research/phase4_deferred_exceptions.json`)
- billed USD unknown, resource meters comparable; `0` is not an invoice

Anti-blocking reliability is limited to robots compliance, safe URL checks,
per-host pacing, server-directed retry delays, bounded backoff, and cooldown
after rate-limit responses. Stealth, CAPTCHA bypass, identity rotation, and
proxy evasion remain outside the supported scope.

The field-level A5 manifest lives at `research/phase4_real_tasks.json` (20 tasks). The A6 scale manifest lives at `research/phase4_a6_real_tasks.json` (100 tasks).

## A4 Review Questions

- Did the requested source produce the correct subject, not a recommendation or unrelated page?
- Which requested fields are present, missing, or unknown?
- Was the page obtained by HTTP or browser, and was escalation justified?
- Did the second run produce the same valid content hash?
- Did a failure preserve the last valid result rather than overwrite it?
- Is the cost known, unknown, or merely modeled from local wall time?
- Can a human review the raw source evidence and the field assertion result?

## A4 Output Categories

- `correct_complete`
- `partial_missing_fields`
- `false_success`
- `reasonable_rejection`
- `retryable_failure`
- `non_retryable_failure`

An absent assertion is not a pass. An unobserved cost is not zero. A missing artifact is not evidence that an artifact should exist.

## Original A4 Exit Criteria

Do not move to A5 until two task families have repeatable runs, holdout pages, field-level assertions, and a useful failure taxonomy. Do not move to A6 until common fixes are measured and the same task can be repeated without agent intervention.
