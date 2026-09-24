# Limits and result states

W2L reports whether it captured a page and whether a requested structured record was verified. These are different questions. Check both before using fields in an alert, export, or downstream workflow.

## Availability and quotas

The anonymous page allows three previews per browser visitor per UTC day and 100 previews site-wide per UTC day. On a local review address, quota and Amazon coordination live in memory and reset on process restart; do not expose that launcher publicly. On the hosted Cloud Run service, Firestore counters and Amazon coordination survive instance restarts. The local MCP service is separate and runs on loopback.

The browser preview accepts one public HTTP(S) URL per request. It does not accept visitor-supplied model prompts, browser sessions, arbitrary capture settings, private network targets, or raw HTML downloads. Generic pages use restricted HTTP capture; the public Amazon.sg `/dp/{ASIN}` route uses a configured anonymous browser context.

Typing a URL on the [Try W2L page](/) shows its **planned route**. This hint comes from the same static rules used by the server; it does not contact the target site or spend a preview. Known private or reserved addresses are marked unsupported before capture; DNS results and redirects are checked by the guarded transport during extraction. The hint cannot predict whether a public site will allow access, return useful content, or select the requested product. Developers can read it with `GET /api/capability?url=<encoded-public-url>` on the preview host. Invalid input returns HTTP 400 without starting a capture.

## Interpret the status

| Result | Meaning | Next action |
| --- | --- | --- |
| `success` | Readable page content was captured. | Inspect final URL and any separate product status. |
| `incomplete` | Content or subject/field checks could not be finished. | Read the issue; leave uncertain fields missing. |
| `blocked` | Site policy, login, or a verification page prevented a valid capture. | Respect the reason; try an eligible public source. |
| `timeout` | The preview deadline expired. | Check source availability and the network path before retrying. |
| `quota_exceeded` | This visitor or the whole preview has reached its configured limit. | Wait for the applicable quota period. |
| `invalid_url` / `failed` | The URL was rejected or the capture failed for another reason. | Correct the input or inspect the returned reason. |

The response may include a machine-readable `diagnostic` with `code`, `stage`, and `evidence`. Codes include `subject_mismatch`, `subject_unverified`, `quote_unverified`, `region_unverified`, `currency_unverified`, `robots_disallowed`, `login_required`, `challenge`, `policy_denied`, `timeout`, `quota_exceeded`, `service_unavailable`, and `capture_failed`. `observed` means the request itself identified that condition; `unobserved` means the expected evidence was missing or the service could not complete the check. Older clients can continue using `status` and `reason`.

For Amazon product JSON, `complete`, `incomplete`, and `invalid` describe the **structured record**, not the page transport. A missing price can be correct when the visible page does not provide a verifiable offer in the selected region. `product.issues` explains unverified subject, region, currency, or fields. W2L does not substitute prices from recommendations.

## Supported source boundary

| Source | Current boundary |
| --- | --- |
| Public documentation pages | Generic extraction and the checked Firecrawl Introduction Monitor preset. Individual sites may still block access. |
| Amazon.sg `/dp/{ASIN}` | Beta product adapter with main-ASIN, Singapore region, and SGD checks. Strict 100/100 holdout and 1000-page reliability gates remain open. |
| Reddit and X | Local Beta adapters do not establish hosted capture support. The Cloud Run preview plans restricted HTTP only; site policy, login, rendering, or challenges may prevent an anonymous result. |
| Logged-in or challenged pages | No general login-wall or CAPTCHA bypass promise. |

This is a support boundary, not a list of sites guaranteed to return content. See [Amazon.sg product JSON](/docs/guides/amazon-product/) for the exact verification flow.

## Task and environment matrix

| Source and task | Access and environment | Planned channel | Fields and support | Evidence and limit |
| --- | --- | --- | --- | --- |
| Public HTML page → readable text | Anonymous, Cloud Run preview | Restricted HTTP | Markdown, final URL, status, elapsed time; conditional | Public documentation smoke tested on `bb32cbf`; sites can block or require rendering. |
| Amazon.sg `/dp/{ASIN}` → product JSON | Anonymous Singapore context, Cloud Run preview | Domain-limited browser | Main ASIN, region, currency, selected quote when verified; Beta | Public 200-page audit on `bb32cbf`: 171 complete, 29 incomplete, including two subject substitutions. Strict correctness gate remains open. |
| X status / Reddit post → public post | Anonymous, Cloud Run preview | Restricted HTTP | Only a verified requested post if captured; conditional | Hosted success is not validated. Local proxy and adapter experiments are separate. |
| Persistent Monitor or Batch | Local service and configured storage | Local MCP workflow | Durable task results; local only | Not deployed to the anonymous Cloud Run preview. |

The 200-page Amazon audit includes a fixed regression set and a separately frozen candidate set; neither cohort passed the 100/100 gate. The repository's R0 failure ledger records same-capture hashes and missing-evidence boundaries. Original HTML remains private on the operator's machine.
