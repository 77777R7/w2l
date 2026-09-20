# Phase 4 Support Boundary

## Supported In This Gate

- Public HTTP(S) GET sources that permit the requested access.
- Headless local browser escalation when the source requires rendered content.
- Explicitly configured public/official source fields.
- Field assertions, raw `FetchResult` evidence, content hashes, repeat comparison, and known/unknown cost state.
- User-authorized sessions only when the task explicitly provides them.

## Not Yet An SLA

- Universal success across arbitrary websites.
- CAPTCHA or anti-bot bypass.
- Public hosted arbitrary-URL browser execution.
- Guaranteed external-provider cost visibility.
- Recovery semantics for tools that do not expose equivalent checkpoint APIs.
- Automatic correctness of fields without task assertions or human review.

## Escalation Rules

- `reasonable_rejection`: preserve the last valid result and explain the access/content boundary.
- `retryable_failure`: retry only when the failure class and operation semantics permit it.
- `partial_missing_fields`: keep the page evidence, identify missing fields, and do not silently overwrite a prior valid field.
- `false_success`: stop downstream publication and retain the raw evidence for review.

This document is the support boundary for A6 validation; it is not a public hosted-service SLA.
