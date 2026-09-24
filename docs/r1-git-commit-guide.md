# R1 review and release checklist

Status: review guidance, not evidence of a commit, PR, merge, or deployment.

Before opening a PR, review the extractor, product contract, adapter validation, public preview mapping, meaningful runtime tests, frozen replay script, and documentation together. Keep private .w2l HTML and credentials out of the PR. Confirm typecheck, targeted tests, full suite, and 49-witness offline replay; record any environmental or network-dependent test failures separately.

After a PR passes review, merge and deploy only the reviewed commit to the existing technical preview. Record the image commit, Cloud Run revision, traffic, and public smoke-test outputs for a known complete quote, an unavailable or buying-option page, and a subject mismatch. Restore the prior revision if a public regression appears.

Do not call R1 deployed from a local test run. Do not change the frozen 100/100 R4 gate or count correct rejection of an incomplete page as a completed product.
