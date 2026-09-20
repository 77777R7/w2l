# Section A · Reliable Data Collection

Section A turns a URL or permitted task into data that can be checked, explained, repeated, and recovered.

## Current Focus: A4–A6 evidence closeout

A4 diagnosis, A5 quality on the 20-task slice, and A6 scale/recovery/install evidence are recorded. External billed USD remains unknown. Do not start Section B or C feature work as a substitute for that evidence.

The first manifest lives at `research/phase4_real_tasks.json`. It intentionally contains a small six-task slice so failures can be inspected manually before expanding to 100–200 pages.

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

## A4 Exit Gate

Do not move to A5 until two task families have repeatable runs, holdout pages, field-level assertions, and a useful failure taxonomy. Do not move to A6 until common fixes are measured and the same task can be repeated without agent intervention.
