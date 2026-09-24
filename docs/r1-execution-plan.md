# R1 Amazon identity and quote work

Status: R1 identity/quote implementation merged and deployed to the technical preview on 2026-09-25. The R4 correctness gate remains open. See the deployment evidence record.

R0 baseline: the fixed 100 produced 85 complete results; the candidate 100 produced 86. The 29 incomplete results comprise 2 selected-subject mismatches, 4 pages showing unavailability in the captured delivery context, and 23 pages showing buying options without a selected quote. The R0 ledger remains the historical source of truth.

R1 implementation scope:
- Bind the subject to an observed selected-product ASIN. The request URL and parent ASIN are context, not independent proof.
- Return no product fields or quote when selected-product witnesses disagree, are absent, or name another ASIN.
- Classify the selected quote as present, absent_observed, unobserved, or conflicting. An alternate seller offer or JSON-LD declaration alone does not prove a selected quote.
- Preserve whether currency was explicit in the captured price or inferred from the marketplace. Public Amazon results require an explicit SGD quote.
- Replay frozen same-capture HTML and hashes before live testing. Keep raw HTML private.

Local verification: 29 failures and 20 preselected success controls replayed with 49/49 hashes matching. The 2 mismatches remain rejected; 4 unavailable pages are absent_observed; 23 buying-option pages remain unobserved; 20 controls remain matched with selected quotes. These are diagnostic classifications, not recovered completed products.

Release verification: PR #58 passed both GitHub checks and merged as a287902. Cloud Build e0455387-62c0-44f9-a5a1-fa5736a3b662 built that commit; Cloud Run revision w2l-public-preview-00007-bux now serves 100% of default traffic. A public documentation page returned content, a known Amazon success control returned a complete product, and an unavailable capture returned an observed-unavailability diagnostic. A historical substitute-subject URL returned the requested subject in the new live capture; its old mismatch remains in the frozen R0 ledger. The full release evidence is in docs/evidence/r1-amazon-deployment-2026-09-25.md.

Remaining after R1: any bounded buying-option expansion needs a separate identity- and context-preserving design and validation. R4 retains the original frozen 100/100 correctness gate; R1 does not change its denominator or threshold.

Private replay command after building: npm run replay:amazon:r1 -- /absolute/path/to/.w2l/public-preview
