# Gate 4 independent developer acceptance

**Status: pending independent human execution.** This is a run sheet, not evidence of a completed installation. A non-author developer should follow [onboarding.md](onboarding.md) from a fresh clone or the supplied review archive without author intervention. Record where help was required; a fix can be rerun with a new result.

## Run identity

| Field | Record |
| --- | --- |
| Developer / independent of implementation | Pending |
| Date and timezone | Pending |
| Repository URL and commit / branch | Pending |
| OS, architecture, Node, npm | Pending |
| Fresh clone, review archive checksum, or existing checkout | Pending |
| Started / finished / active minutes | Pending |
| Instructions or assistance beyond the guide | Pending |

## Required outcomes

| Check | Pass criterion | Result / evidence |
| --- | --- | --- |
| Install | Fresh clone or review archive, dependencies, Chromium and typecheck complete using documented commands. | Pending |
| First Crawl | Create task via SDK, obtain terminal report, retrieve pages and errors. | Pending |
| Create Monitor | SDK creates revision 1 with explicit captureMode and correct source identity. | Pending |
| Result | First valid capture commits baseline and initialized event; record Monitor/Run/event IDs. | Pending |
| Cache | Second run observes 304, reassesses stored body, reports unchanged and creates no change event. | Pending |
| Change | Source price update commits new version with an explainable diff and new eventId. | Pending |
| HTTPS delivery | Real HTTPS URL receives the event; sender delivery is delivered and receiver receipt matches eventId. | Pending |
| Downstream example | Durable product projection reflects the received eventVersion and price. | Pending |
| Idempotency | Repeated receipt of one eventId produces one receipt/one effective projection update. | Pending |
| Delivery retry | Receiver failure schedules retry; attempt history and stable eventId remain visible. | Pending |
| Pending restart | Stop/restart API and worker while delivery is pending, using unchanged storage; same delivery/event reaches delivered. | Pending |
| Monitor restart | Persisted Monitor/baseline remains readable and scheduler resumes after restart. | Pending |
| Controls | Pause/resume and explicit cancellation can be found and used from the guide/SDK. | Pending |
| No author assistance | Any intervention is recorded and assessed before declaring independent completion. | Pending |

## Evidence and decision

Attach redacted terminal output or screenshots and stable artifact paths. Record sender delivery ID, eventId, eventVersion, attempt times, restart time and receiver receipt ID. Never attach the secret environment file, auth headers, tokens or raw credentials.

- Independent developer's decision: pending.
- Blocking failures / confusing steps: pending.
- Author assistance and elapsed time: pending.
- Fix revision and retest result, if any: pending.
- Gate 4 reviewer and date: pending.

Gate 4 passes only when the independent developer completes the full workflow and the evidence is reviewed. Gate 5 remains a separate record: at least two external trial users, two weeks of running, one repeat user, and one real downstream use case. The controlled sample projection demonstrates integration mechanics; it is not evidence of a customer's production use case.
