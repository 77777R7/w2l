# A5 Repeat-Consistency Root Causes

Input: Phase 4 v0.2 report, 20 tasks / 40 runs.

## Remaining Product Pairs

| Task | Run difference | Classification | Evidence |
| --- | --- | --- | --- |
| Browserbase browsers | HTTP on repeat 1, browser on repeat 2 | execution-path difference plus dynamic marketing content | same final URL, same Markdown length/tokens/links; lane changed `http -> browser_local`; first diff is a live `Monthly Browser Sessions` counter (`36,925,870` vs `00,000,00036,925,870`) |
| Browserbase search | browser on both repeats | normal dynamic/rendered content drift | same final URL, same Markdown length/tokens/links; content differs only at the end of the serialized output; no assertion failure |
| Browserbase pricing | browser on both repeats | normal dynamic/rendered content drift | same final URL, same Markdown length/tokens/links; no assertion failure; extraction route stayed collection/article |
| Firecrawl pricing | HTTP on both repeats | dynamic page drift, not route drift | same final URL, same Markdown length/tokens/links and extraction route; hash differs while all field assertions pass |

The earlier raw-hash inconsistency was over-sensitive to representation noise. Normalized Markdown hashing improved product repeat confirmations from `5/18` to `9/18`.

## Separate Assertion Issue

`product-steel-sessions` remains `partial_missing_fields` on both repeats because the page does not contain the literal `Steel` marker required by the task assertion. The hash is stable and the final URL/lane are stable. This is an assertion/task-contract issue, not extraction instability. It must be corrected in the task manifest or retained as a deliberate missing-field case; it must not be fixed by weakening the runtime extractor.

## A5 Decision

1. Keep normalized content hashing. It removes representation-only drift without hiding meaningful content changes.
2. Add dynamic-noise metadata/normalization only for known volatile patterns, with a before/after evidence test. The task manifest now scopes this to Browserbase's `Monthly Browser Sessions` counter; raw Markdown and evidence remain unchanged. Do not strip arbitrary numbers or page content globally.
3. Preserve lane changes as an execution fact. A browser retry after HTTP is not equivalent to a stable HTTP repeat.
4. Repair task assertions when the expected source fact is not actually present. Steel sessions/profiles no longer assert a literal product-name marker that is absent from the documentation page. Assertion corrections are manifest changes, not crawler quality wins.
5. Add a field-level product extractor only after the remaining assertions identify a repeated missing field; current data does not yet prove that a new extractor is the highest-ROI fix.

## Status

- A5 first stability fix: implemented and measured.
- Four residual product pairs: diagnosed as drift/path or assertion semantics.
- A5 gate: not closed. Manual correction minutes and external cost remain unknown.
