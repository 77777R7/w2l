# Stealth Mode as a Product Toggle — Market Research Report (DRAFT — agents pending)

Date: 2026-08-21. Question: should a self-hosted crawling product add a user-selectable "stealth mode" that actively evades bot detection?

Status: DRAFT. Sections Q1, Q3, Q4, Q5 pending agent results. Q2 partially complete.

---

## Q2 (PARTIAL) — How commoditized is anti-bot bypass?

### Price compression in the raw-IP layer (the input to all unblocking)

- Residential proxy rates "contracted by up to 75%" between 2023 and 2025; stabilized/partially reverted in early 2026. [VERIFIED — Proxyway 2026 market research: https://proxyway.com/research/proxy-market-research-2026]
- Median 2026 entry point $4; median 5GB tier $3.75/GB; 50GB tier $3.00/GB; 500GB tier $2.25/GB. Grey-market residential: "$0.15–$0.50/GB". [VERIFIED — Proxyway 2026]
- Vendors "halved their rates compared to last March" (ProxyEmpire, Webshare, 2025); Decodo and Oxylabs made permanent plans "~25% cheaper than the original price". [VERIFIED — Proxyway 2026]
- Corroborating: Proxyway 2025 report found residential "up to 70% cheaper than two years ago". [VERIFIED — https://proxyway.com/research/proxy-market-research-2025]
- Note on the "$15/GB → $3/GB" framing: both figures exist in today's market as volume-tier endpoints rather than a clean 2020→2026 average; independent 2026 comparison sites show $1–$15/GB with budget ~$1/GB. [VERIFIED — https://aimultiple.com/proxy-pricing, https://dataimpulse.com/blog/cheapest-proxies/]
- Vendor-reported moat pessimism: "The interchangeability of proxy networks makes it nearly impossible to build a moat." [VERIFIED — Proxyway 2026]

### Vendors moving up the value chain (away from raw IP)

- Zyte's own position: "The proxy era is ending as web scraping shifts from managing IP pools to smarter, API-driven solutions"; Smart Proxy Manager "being retired for new customers" in favor of Zyte API. [VERIFIED — https://www.zyte.com/blog/topic/proxies/]
- Proxyway's counter-verdict: Zyte's claim "wildly exaggerated", but concedes "it may become easier to just get an API than wrestle with anti-bot systems". [VERIFIED — Proxyway 2026]
- Scraper-API/dataset share climbing: Rayobyte scraper API went "from 2% to nearly a quarter of revenue in one year"; NetNut scraper & dataset revenue "grew from nothing to $10M in 2025". [VERIFIED — Proxyway 2026]
- Bright Data: "annualized revenue of $300M", "growing by 50% year-over-year thanks to AI", targeting "$400M by mid-2026"; discontinued its mobile proxy product April 2026. [VERIFIED — Proxyway 2026; mobile proxy discontinuation double-confirmed in prior deep research]
- Vendor headcount growth (not contraction): Decodo +15%, Oxylabs +20% headcount; "space is becoming crowded, with many new and well-funded players" (Oxylabs, quoted in Proxyway). [VERIFIED — Proxyway 2026]

### Supply explosion / entry barriers

- "Over 250 active proxy server providers"; "nearly a quarter of them started in 2024"; "at least 56 companies that emerged between 2025 and March 2026"; 60% of new providers offer residential. But: "the residential market supports only 10 to 15 companies with their own networks" (i.e., most are resellers). [VERIFIED — Proxyway 2026]
- Google shut down "a dozen Chinese brands" (922Proxy, LunaProxy — all storefronts of IPidea); market still holds "over a dozen China-related brands". Botnets (BADBOX 10M devices, Aisuru, Kimwolf) as a supply-side force. [VERIFIED — Proxyway 2026]

### Open-source erosion (GitHub-verified 2026-08-21)

| Project | Stars | Last push | Activity verdict |
|---|---|---|---|
| puppeteer-extra (plugin-stealth) | 7,394 | 2024-07-18 | DEAD (~2y) |
| rebrowser-patches | 1,417 | 2025-05-09 | STALE (>15mo) — previously recommended in repo research |
| undetected-chromedriver | 12,803 | 2025-07-05 | STALE (>13mo) |
| nodriver | 4,675 | 2026-05-13 | SLOW (3mo) |
| FlareSolverr | 15,245 | 2026-07-16 | ALIVE but limited (captcha solvers "none work" per README; ~45 open issues mentioning detection) |
| patchright | 4,140 | 2026-08-19 | ACTIVE |
| camoufox | 11,305 | 2026-08-21 | ACTIVE |
| Scrapling | 75,605 | 2026-08-21 | ACTIVE |
| curl_cffi | 6,357 | 2026-08-21 | ACTIVE |

[All VERIFIED via gh api GitHub, 2026-08-21]

Reading: the JS-injection generation (puppeteer-extra, rebrowser-patches) is dying; the surviving OSS is binary-level (camoufox, patchright) or adaptive frameworks (Scrapling). OSS is free but NOT free of maintenance — and the maintained projects are forks-of-Chromium maintenance obligations.

### Self-hosted reality: the IP layer is the actual moat, and it is not free

- Cloudflare/defenders score IP reputation as first signal: datacenter ASNs (AWS, DO, Hetzner) are "automatically flagged as non-human"; Cloudflare error 1005 = ASN/proxy-range block. [VERIFIED — https://alterlab.io/blog/scrape-cloudflare-protected-sites, https://www.zenrows.com/blog/bypass-cloudflare]
- "A correctly rotated residential IP with wrong browser headers is still blocked; a correct browser header set with a datacenter IP is still blocked" — all six layers needed. [VERIFIED — alterlab/zenrows + prior repo research]
- Therefore a self-hosted stealth toggle ships only ~2 of 6 layers (fingerprint + TLS at best); the IP layer (residential supply, $2.25–$3.75/GB mid-volume) is exactly what self-hosting forfeits. Prior repo research: residential alone is insufficient; proxy + browser must be consistent.
- Crawl4AI (the canonical self-hosted scraper) docs themselves admit: "against advanced anti-bot systems, stealth mode plus a datacenter proxy is often not enough." [VERIFIED — https://docs.crawl4ai.com/advanced/undetected-browser/]

### Partial verdict (Q2)

Anti-bot *fingerprint* evasion is commoditized/free (OSS) — but the binding constraint for self-hosted users is NOT the fingerprint layer, it is IP reputation + defender-tier fingerprinting, and there the paid vendors' edge (residential/mobile IP supply + dedicated engineering) has NOT eroded. The market's margin is moving up the stack into API/dataset products. This is consistent with "bypass is a commodity input, not a differentiator" for a NEW entrant.

PENDING from agents: archived pricing snapshots (Wayback), vendor exits beyond mobile-proxy discontinuation, headcount of maintenance teams, Chrome cadence data.
