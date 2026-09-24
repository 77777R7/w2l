# R1 Amazon identity and quote work

Status: local implementation and offline replay complete; public deployment and fresh online validation pending.

R0 baseline: the fixed 100 produced 85 complete results; the candidate 100 produced 86. The 29 incomplete results comprise 2 selected-subject mismatches, 4 pages showing unavailability in the captured delivery context, and 23 pages showing buying options without a selected quote. The R0 ledger remains the historical source of truth.

R1 implementation scope:
- Bind the subject to an observed selected-product ASIN. The request URL and parent ASIN are context, not independent proof.
- Return no product fields or quote when selected-product witnesses disagree, are absent, or name another ASIN.
- Classify the selected quote as present, absent_observed, unobserved, or conflicting. An alternate seller offer or JSON-LD declaration alone does not prove a selected quote.
- Preserve whether currency was explicit in the captured price or inferred from the marketplace. Public Amazon results require an explicit SGD quote.
- Replay frozen same-capture HTML and hashes before live testing. Keep raw HTML private.

Local verification: 29 failures and 20 preselected success controls replayed with 49/49 hashes matching. The 2 mismatches remain rejected; 4 unavailable pages are absent_observed; 23 buying-option pages remain unobserved; 20 controls remain matched with selected quotes. These are diagnostic classifications, not recovered completed products.

Remaining before claiming R1 end-to-end: review and merge a PR, deploy to the technical preview, run public smoke tests on known cases, and record the deployment revision and observed outputs. Any bounded buying-option expansion needs a separate identity- and context-preserving design and validation. R4 retains the original frozen 100/100 correctness gate; R1 does not change its denominator or threshold.

Private replay command after building: npm run replay:amazon:r1 -- /absolute/path/to/.w2l/public-preview
