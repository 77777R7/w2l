# R1 Amazon technical-preview release evidence

Observed on 2026-09-25 (Asia/Shanghai). This is a technical preview rollout, not an MVP or R4 gate pass.

| Item | Observed value |
| --- | --- |
| Code PR | [#58](https://github.com/77777R7/w2l/pull/58), two GitHub CI checks passed |
| Merged source commit | `a287902d35f55532f1222bf3efef36888c6ccb39` |
| Cloud Build | `e0455387-62c0-44f9-a5a1-fa5736a3b662`, SUCCESS |
| Image digest | `sha256:142661eadde2cada42a041cba2cc55e6d06f4607c1b6161de4c4923780bdab0b` |
| Cloud Run revision | `w2l-public-preview-00007-bux`, 100% default traffic |
| Previous revision | `w2l-public-preview-00005-rag`, 0% default traffic, retained as `r0preview` |
| Public endpoint | `https://w2l-public-preview-307354954747.asia-southeast1.run.app/` |

On the candidate revision before traffic changed, `/api/health`, `/docs/`, `/docs/connect-mcp/`, `/docs/limits/`, and the Amazon capability query all returned HTTP 200. A real request for `https://docs.firecrawl.dev/introduction` returned `success`, its final URL, and 11,761 characters of Markdown; the owner evaluation response identified the merged source commit. The same documentation extraction succeeded through the default public endpoint after the traffic switch, again identifying the merged source commit.

Anonymous Amazon smoke requests on the candidate revision returned:

| Requested ASIN | Observed result |
| --- | --- |
| `B0CS81Q6Z7` | `success`, complete product, same ASIN, Singapore 238823, SGD, price 33.48, no issues |
| `B0D4DHBFFH` | `incomplete`, `quote_absent_observed` with observed evidence, same ASIN, no price |
| `B0BDXSK2K7` | `success`, complete product for the requested ASIN, price 275.35 in this new capture. Its frozen R0 capture selected a different subject; this live observation does not change that historical result. |

The private frozen-witness replay verified all 49 hashes: 2 subject mismatches rejected, 4 captured-context unavailability cases, 23 buying-option pages without a selected quote, and 20 matched successful controls. These are 29 historical failures plus 20 preselected controls, not 49 new online attempts. No historical failure was relabeled complete.

Local typecheck and public build passed. R1-focused tests passed. The 96-file suite excluding two live-network API tests passed; the two excluded tests passed when run together in isolation but failed on repeated local full-suite runs. Both repository CI checks passed on PR #58. An owner evaluation download for the Amazon success sample timed out on the client while the server logged `success`; the smaller anonymous request for the same URL completed successfully. No raw HTML from the release smoke is included here.

The original R4 frozen 100/100 correctness requirement and separate 1,000-page reliability gate remain open. The existing R0 revision is available for traffic rollback if later monitoring finds a regression.
