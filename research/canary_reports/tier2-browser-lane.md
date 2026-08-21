# Tier-2 browser-lane value — merged canary analysis

- Run date: **2026-08-21** (fresh live run, `run-1787242149326`; replaces the previous 2026-08-20 snapshot)
- Suite: `canary-open-web-v1`, curated 2026-08-20 — 17 cases (9 tier-1 http-clearable, 8 tier-2 bot-gated / JS-shell)
- All numbers are live-web snapshots and are subject to drift; nothing here is a stable benchmark.

## Tier-2 browser-lane value

Per-case results for the 8 tier-2 sites across the four http arms and browser-local. `ok (n tok)` = contentful; `failed` = non-contentful (reason in parentheses).

| Site | failure mode | bare-http | golden-converter | extract-tf | resilient-http | browser-local |
|---|---|---|---|---|---|---|
| etsy | bot gate (403) | failed (http_error) | failed (http_error) | failed (http_error) | failed (http_error) | failed (http_error) |
| glassdoor | bot gate / challenge (403) | failed (http_error) | failed (http_error) | failed (http_error) | failed (http_error) | **ok (2425 tok)** |
| yc-companies | JS shell (39-char static) | ok (7439 tok) | ok (727 tok) | failed (empty_unverified) | failed (empty_unverified) | **ok (11886 tok)** |
| amazon-home | bot gate (202 empty body) | ok (214025 tok) | failed (http_error) | failed (http_error) | failed (http_error) | failed (http_error) |
| tiktok | JS shell (0 server-rendered text) | ok (366 tok) | ok (90646 tok) | failed (empty_unverified) | failed (empty_unverified) | failed (empty_unverified) |
| quora | soft bot wall (challenge markers) | failed (http_error) | failed (http_error) | failed (http_error) | failed (http_error) | **ok (133 tok)** |
| indeed | bot gate / challenge (403) | failed (http_error) | failed (http_error) | failed (http_error) | failed (http_error) | **ok (3494 tok)** |
| producthunt | mixed (challenge markers + 12k chars) | failed (http_error) | ok (699 tok) | ok (155 tok) | ok (155 tok) | **ok (25185 tok)** |

> The `bare-http` and `golden-converter` "ok" cells on amazon-home / tiktok / yc-companies are *not* evidence those arms clear the gates — bare-http has no polite UA or extraction and golden-converter does no challenge-check, so they pass through shell/challenge HTML that extract-tf correctly rejects as `empty_unverified`. The arms that share W2L's real extraction policy (extract-tf, resilient-http, browser-local) are the comparable trio.

## Bottom line: the browser lane's marginal value on tier-2

Tier-2 contentful rate by arm (contentful / 8):

| Arm | contentful |
|---|---|
| bare-http | 3/8 |
| golden-converter | 3/8 |
| extract-tf | 1/8 |
| resilient-http | 1/8 |
| **browser-local** | **5/8** |

Against the comparable http baseline (**resilient-http: 1/8**), the browser lane flips **4 of 8** tier-2 sites from non-contentful to contentful:

| Site | resilient-http | browser-local |
|---|---|---|
| glassdoor | failed (http_error) | ok (2425 tok) |
| yc-companies | failed (empty_unverified) | ok (11886 tok) |
| quora | failed (http_error) | ok (133 tok) |
| indeed | failed (http_error) | ok (3494 tok) |

**Yield amplification** (tokens, the one site already contentful on resilient-http):

| Site | resilient-http | browser-local |
|---|---|---|
| producthunt | ok (155 tok) | ok (25185 tok) |

So the browser lane's measured value on tier-2 is: **+4 sites contentful (1/8 → 5/8)** and **~162× token yield on the one site the http lane only superficially reached** (producthunt, 155 → 25 185 tokens). Two of the flips are full JS-shell renders (yc-companies at 11 886 tokens, producthunt at 25 185 tokens) — content the http lane structurally cannot obtain because it only exists after client-side execution.

## Honest limits

The browser lane still does **not** clear three tier-2 sites, and all three failures are consistent with **headless-detection**, not with any extractor defect:

- **etsy** — `http_error` under Chromium: a bot gate that drops the request before a page renders.
- **amazon-home** — `http_error` under Chromium: the same gate that already serves `202` with an empty body to the http arms.
- **tiktok** — `empty_unverified` under Chromium: the SPA shell renders no server-rendered text and its client-rendered content is gated for headless clients.

Additionally, **quora**'s browser-local "ok" is only **133 tokens** — contentful by the runner's bar, but plausibly a soft-wall partial rather than real Q&A corpus content, so treat it as the weakest of the four flips.

A headless Chromium fingerprint (missing WebGL/GPU, `navigator.webdriver`, automation flags) is what etsy, amazon, and tiktok are keying on. That is the next addressable gap: a **stealth layer** (real GPU/WebGL context, navigator/webdriver spoofing, CDP anti-detection patching) is the natural escalation on top of browser-local for the 3 sites it still cannot reach. It is not an extraction problem — it is an identity problem.

## Anomalies noted this run

- **glassdoor regressed on golden-converter**: previous snapshot was `ok (132938 tok)`, this run `failed (http_error)` — its bot gate is drifting run-to-run (intermittent wall).
- **tiktok served golden-converter 90 646 tokens this run** (previous snapshot: 113 tokens) — the gate's response changed shape; again drift, not a W2L change.
- **amazon-home bare-http `ok (214025 tok)`** is a naive pass: bare-http applies no challenge check and counts the anti-bot/consent shell as content. Not comparable to the extraction arms.
- No tier-1 regressions: resilient-http and browser-local both hold 9/9; extract-tf and golden-converter hold 8/9 with the same single MDN 301 miss.
