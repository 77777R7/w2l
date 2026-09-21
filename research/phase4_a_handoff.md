# Section A Handoff After PR #39

Review source: `W2L_PR39_Stage_Assessment_and_Section_B_Roadmap.md`.
Baseline: `main@fdc6559`.

## Current Status

Section A is a scoped developer alpha. PR #39 `accepted_with_unknown_external_usd` recorded evidence files. It is not an unconditional A6 pass.

Do not start B2, B3, or B4. Do not add another 100-page sample for its own sake. B1 prototype design may follow this calibrated record; a real recurring task is still required before B1 is a product commitment.

## Scoring Calibration

| Metric | Honest unit | Note |
| --- | --- | --- |
| A5 AI repeat | 11/11 pairs | Old 11/22 counted r1 as null |
| A5 product repeat | 9/9 pairs after later fixes | Old 5/18 mixed scoring, normalization, and real drift |
| A5 AI correct-complete | 22/22 runs | Field assertions on the 20-task slice |
| A6 scale | 100 pages × 2 runs | `source_url` + nonempty Markdown |
| A6 labeled holdout | 20 every-fifth-task labels | Not independent |
| A6 independent holdout | pages absent from A5 | Relabeled in A6 v0.2 |
| A6 quality subset | 8 field-level pages, 7/8 on the stored A6 run | AbortController still fails that older report because it predates the listing-misroute fix; live A5 v4 is correct_complete |

## Remaining Open Conditions

- Second-developer install: deferred exception, recorded in `research/phase4_deferred_exceptions.json`. Clean clone on the author machine is recorded and is not scored as a second human.
- Interrupted attempt terminal state: fresh recovery run marks the killed attempt `interrupted` and stores `recoveredFromAttemptId`.
- Billed USD: unknown by design. Resource meters are comparable. Gate fails if billed USD is filled with `0`.
- Quality subset live rescoring of AbortController still uses the older stored A6 report (7/8).

## What This Handoff Changed In Code

- `AttemptStatus` includes `interrupted`; resume marks the previous running attempt and stores `recoveredFromAttemptId`.
- Real-task outcomes can return `false_success` on identity mismatch; source matching uses origin, not string prefix.
- Summary counts task pairs, quality-subset runs, and unknown resource meters without coercing null bytes/tokens to zero.
- Gate scripts check named conditions instead of treating recovery/install/minutes as a full pass.
