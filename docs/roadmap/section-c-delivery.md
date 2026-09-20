# Section C · Workflow Productization And Delivery

Section C packages the validated data task for adoption. It does not replace the API or create a second scraping engine.

## Candidate Phases

### C1 · Reliable Data Delivery

API and Webhook remain foundational. Add one proven table/database destination first. Use stable keys, idempotency, update semantics, retry without duplicates, and last-valid-value preservation.

### C2 · n8n And Narrow Task UI

Integrate with n8n before building a general workflow canvas. The first UI should cover source, fields, schedule, output, sample validation, history, failure reason, and login handoff.

### C3 · Deployment Modes

Self-hosted delivery covers installation, upgrades, secrets, storage, backups, logs, and allowed egress. Public hosted delivery is gated separately by browser subresource controls, DNS/connection binding, quotas, tenant isolation, cancellation, and resource limits.

### C4 · Paid Validation

Measure repeat usage, migration, support load, and willingness to pay. Separate fixed monthly hosting value from usage pricing. Do not add a vertical branch only because it appears in a roadmap.

## Entry Conditions

- A4/A5 demonstrate a repeatable task.
- A6 establishes supported scope and installation reliability.
- B1/B2 or a concrete customer delivery need identifies the right downstream workflow.
