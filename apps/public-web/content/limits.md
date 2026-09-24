# Limits and result states

W2L reports whether it captured a page and whether a requested structured record was verified. These are different questions. Check both before using fields in an alert, export, or downstream workflow.

## Availability and quotas

The anonymous page allows three previews per browser visitor per UTC day and 100 previews site-wide per UTC day. On a local review address, quota and Amazon coordination live in memory and reset on process restart; do not expose that launcher publicly. On the hosted Cloud Run service, Firestore counters and Amazon coordination survive instance restarts. The local MCP service is separate and runs on loopback.

The browser preview accepts one public HTTP(S) URL per request. It does not accept visitor-supplied model prompts, browser sessions, arbitrary capture settings, private network targets, or raw HTML downloads. Generic pages use restricted HTTP capture; the public Amazon.sg `/dp/{ASIN}` route uses a configured anonymous browser context.

## Interpret the status

| Result | Meaning | Next action |
| --- | --- | --- |
| `success` | Readable page content was captured. | Inspect final URL and any separate product status. |
| `incomplete` | Content or subject/field checks could not be finished. | Read the issue; leave uncertain fields missing. |
| `blocked` | Site policy, login, or a verification page prevented a valid capture. | Respect the reason; try an eligible public source. |
| `timeout` | The preview deadline expired. | Check source availability and the network path before retrying. |
| `quota_exceeded` | This visitor or the whole preview has reached its configured limit. | Wait for the applicable quota period. |
| `invalid_url` / `failed` | The URL was rejected or the capture failed for another reason. | Correct the input or inspect the returned reason. |

For Amazon product JSON, `complete`, `incomplete`, and `invalid` describe the **structured record**, not the page transport. A missing price can be correct when the visible page does not provide a verifiable offer in the selected region. `product.issues` explains unverified subject, region, currency, or fields. W2L does not substitute prices from recommendations.

## Supported source boundary

| Source | Current boundary |
| --- | --- |
| Public documentation pages | Generic extraction and the checked Firecrawl Introduction Monitor preset. Individual sites may still block access. |
| Amazon.sg `/dp/{ASIN}` | Beta product adapter with main-ASIN, Singapore region, and SGD checks. Strict 100/100 holdout and 1000-page reliability gates remain open. |
| Reddit and X | Beta adapters in the local product, but site policy, access, and local network conditions can prevent a public preview. Do not promise a successful anonymous result. |
| Logged-in or challenged pages | No general login-wall or CAPTCHA bypass promise. |

This is a support boundary, not a list of sites guaranteed to return content. See [Amazon.sg product JSON](/docs/guides/amazon-product/) for the exact verification flow.
