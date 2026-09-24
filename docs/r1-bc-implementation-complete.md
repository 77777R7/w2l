# R1 identity and quote implementation review

Status: locally verified, merged in PR #58 as a287902, and deployed to the Cloud Run technical preview as revision w2l-public-preview-00007-bux. This file supersedes the interrupted agent's earlier completion claim. See docs/evidence/r1-amazon-deployment-2026-09-25.md for observed release checks.

The extractor now requires a selected-product ASIN observed in the main product context. It rejects a parent/child substitution, missing witness, or conflicting selected controls before extracting a quote. For a matched subject, it records the selected quote state and preserves inferred currency as inferred throughout the product entity.

The anonymous preview remains fail-closed: an inferred SGD value or a quote not marked present cannot yield a complete public product. An unavailable captured page produces quote_absent_observed; conflicting quote evidence produces quote_conflicting. These states describe the captured context, not all possible sellers or regions.

Evidence: the R0 ledger's 29 incomplete pages plus 20 success controls were replayed from private, SHA-256-verified HTML. All 49 hashes matched and the expected classifications held. Synthetic runtime tests cover parent/child substitution, no witness, conflicting controls, numeric ASIN, explicit versus inferred currency, and absent/unknown quotes. Full-suite results and deployment status must be reported from the current run, not copied from an earlier agent summary.

Limits: no formerly incomplete product became a complete quote in offline replay. The 23 buying-option pages remain unobserved. Public smoke tests verified one complete quote and one observed-unavailability result, but do not replace the R4 independent cohort. The roadmap's R4 frozen 100/100 correctness gate remains unchanged.
