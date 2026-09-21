# Phase 4 Installation Validation

Status: `passed_clean_clone`; second-developer install `deferred`.

This is a clean clone of `main@6d98982` on the author machine. It proves install + first-task reproducibility. It is not a second independent developer and must not be scored as one.

## Protocol Run

1. `git clone` of the current repository commit into a temp directory.
2. `npm ci`
3. `npx playwright install chromium`
4. `npm run api -- --port 8791`
5. One task from `research/phase4_real_tasks.json`: `ai-mdn-abortcontroller`.
6. Recorded commit, OS, Node, elapsed time, and first-task outcome.

## Result

| Field | Value |
| --- | --- |
| Commit | `6d9898280d97f6779e8704802f50153d4d3747b3` |
| Node | v26.8.1 |
| Platform | darwin arm64 |
| Elapsed | 6185 ms (npm cache present; Chromium already installed) |
| First task | `ai-mdn-abortcontroller` |
| Outcome | `correct_complete` |
| Lane | `http` |
| Operator independence | same machine, clean clone, not a second human |
| A6 gate treatment | clean clone required; second-developer install deferred exception |

## Deferred Exception

A6 original text asked another developer to install and complete a first task. That evidence does not exist. Conditional alpha may proceed with the clean-clone record. Unconditional A6 pass still requires a second human.

Decision record: `research/phase4_deferred_exceptions.json`.

Machine-readable evidence: `output/phase4/install-smoke.json` and `research/phase4_install_smoke.json`.
