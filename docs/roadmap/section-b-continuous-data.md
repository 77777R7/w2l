# Section B · Continuous Updates And Authorized Access

Section B is now approved for a controlled B1+B2 prototype only. It is not approval to implement B3, B4, multi-modal assistance, or a general workflow product.

The detailed design is [`section-b-technical-design-v1.md`](./section-b-technical-design-v1.md). The bounded handoff and highest-ROI slice are in [`section-b-handoff.md`](./section-b-handoff.md).

## Product Hypothesis

W2L should eventually turn validated page acquisition into a continuously maintained data source. Incremental updates are the reason to return; authorized session reuse is an access path; Local-first is the trust boundary; downstream delivery is the customer-facing output.

## Candidate Phases

### B1 · Stateful Recurring Tasks

Stable object identity, extraction-rule versions, last valid data, last successful check, and stale state.

### B2 · Trusted Change Detection

Separate `changed`, `unchanged`, `cannot_verify`, and `stale`. Never interpret a login page, challenge page, or failed refresh as business data deletion.

### B3 · Authorized Session Reuse

User-approved sessions, isolated contexts, expiry detection, revocation, and human handoff. No permanent-login or CAPTCHA-bypass promise.

### B4 · Narrow Backend Automation

Only build fixed workflows after multiple customers share the same backend and data shape. Prefer deterministic steps, pause for authentication, and record every side effect.

## Entry Conditions

- A4 identifies a repeated task with meaningful updates.
- A5 shows the task can be refreshed without unacceptable false success.
- At least one customer or internal workflow benefits from the data staying current.
- A6 remaining handoff is recorded honestly: second-developer install deferred, billed USD unknown, quality subset separate from scale.

B1 may start as a controlled prototype after that record exists. B2, B3, and B4 stay gated until a real recurring task needs them.

The first controlled task is `https://docs.firecrawl.dev/introduction`; its B1/B2 evidence is `research/section-b-firecrawl-monitor-evidence.json`.
