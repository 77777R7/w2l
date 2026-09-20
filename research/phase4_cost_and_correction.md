# Phase 4 Cost And Human Correction

## Comparable Cost

`externalCostUsd` remains null on every local A5/A6 run. That is the correct billed-cost value: no vendor invoice was present.

Comparable resource meters from the recorded reports:

| Slice | Runs | wallMs | browserMs | requests | contentTokens | bytesWire | billed USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| A5 v4 | 40 | 21880 | 12520 | 40 | 118430 | 9719623 | unknown |
| A6 run 1 | 100 | 65452 | 14859 | 104 | 539364 | 35032491 | unknown |
| A6 run 2 | 100 | 46886 | 18731 | 104 | 539364 | 34664436 | unknown |

These meters are the comparable cost. They are not converted into USD. `usdPerHour: 0` is still not a real zero.

## Human Correction

Timed operator review of the remaining A5/A6 defects: **18 minutes**.

| Item | Minutes | Action |
| --- | ---: | --- |
| MDN AbortController listing misroute | 8 | extractor routing fix |
| MDN WebSocket stale assertion | 4 | manifest phrase updated to live copy |
| A6 Browserbase hash drift | 6 | classified as session-counter noise; no field rewrite |

Other tasks needed no correction and stay untimed. Unobserved time is not recorded as zero.

Source: `research/phase4_human_correction.json`.
