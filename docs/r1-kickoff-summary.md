# R1 test inventory

Status: historical kickoff note, updated after runtime review.

The interrupted implementation added 29 failure metadata records and 21 tests. Those tests primarily validate frozen ledger classifications; they do not execute Amazon extraction. Runtime coverage was added in amazon-r1-runtime.test.ts and preview.test.ts.

The private HTML witnesses are not committed. The replay script verifies each SHA-256 before running the current extractor against 29 incomplete pages and 20 preselected success controls. The historical R0 outcomes and classifications remain untouched.

Known observations: 2 selected-subject mismatches, 4 unavailable captures, 23 captures with buying options but no selected quote. These categories do not establish the root cause of every failure or imply that another public entry point has no offer.
