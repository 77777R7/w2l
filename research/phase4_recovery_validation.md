# Phase 4 Recovery Validation

Status: `not_run`.

Required protocol for A6:

1. Start an expanded crawl against the permitted task manifest.
2. Interrupt after a recorded checkpoint boundary.
3. Restart from the same task directory.
4. Verify no completed URL is lost, duplicate work is accounted for, and the final field-level report remains valid.
5. Save task, attempt, step, cost, and evidence records.

The existing 1k crawl experiment proves the earlier crawl path, but this A6 gate must be rerun against the current expanded validation manifest and current `main`.
