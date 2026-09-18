# Anti-bot redesign evidence — 2026-09-18

Live reads via ego-browser TaskSpace 5 + primary arXiv HTML/PDF abstracts. Complements, does not replace, `anti_bot_wall_final_synthesis.md`.

## Papers (primary)

**On the Internet, Nobody Knows You're an LLM Bot** — Fayolle et al., arXiv:2606.30119, 2026-06-29, cs.CR.
https://arxiv.org/abs/2606.30119
Nine honeysites (robots, CAPTCHA, PoW, Cloudflare free). Six LLM web agents (local + cloud), plus cURL/Playwright baselines.
Findings: (i) some agents bypassed every evaluated gate; (ii) **all** agents remain separable from humans and from each other with network + HTTP + browser fingerprints; (iii) **stealth often increases detectability**.
Product: do not ship playwright-stealth as default. Multi-layer identity is the durable signal.

**What Does It Take to Detect an AI Agent?** — Choudhary et al. (TUM), arXiv:2607.26935, 2026-07-29. NE Agents Day workshop.
https://arxiv.org/abs/2607.26935
Binary human/bot detectors misroute 30–39% of real Playwright agents as human. Three-class formulation → agent F1 = 1.000. Five-level evasion including GAN trajectories and **replay of real human cursor data** (n=2299): **0 agent misses**. Signal is missing raw pointer-move / wheel-delta streams — Playwright never emits a physical device stream. Two features (`mouse_event_rate`, `teleport_click_ratio`) give 100% agent recall, precision 0.994.
Product: humanizer / mouse GAN is a dead end inside Playwright.

**FP-Inconsistent** — Venugopalan et al., arXiv:2406.07647v3, IMC 2025 (rev 2025-09-21).
https://arxiv.org/abs/2406.07647
Honey site + DataDome/BotD + 20 “undetectable traffic” vendors, ~500k requests. Evasion ~53% / ~45%. Escaping bots **alter fingerprints but leave spatial/temporal inconsistencies**. Inconsistency rules cut remaining evasion ~45–48%.
Product: refuse self-contradicting UA / Client Hints / locale / timezone / viewport. That is anti-bot work we can own.

## Vendor docs (live)

Firecrawl self-host (`v2.11.162`): fetch + Playwright included; **“Fire-engine or its advanced anti-bot… is not included.”** Screenshots/actions also need fire-engine.
https://docs.firecrawl.dev/contributing/self-host
https://docs.firecrawl.dev/contributing/open-source-or-cloud

Crawl4AI: stealth = playwright-stealth; undetected = patched adapter; docs say not 100%, headless still detected, escalate progressively.
https://docs.crawl4ai.com/advanced/undetected-browser/

## Architecture takeaway

Anti-bot for a 1–2 person Firecrawl-class tree is **coverage we can measure**, not a private unlocker we cannot OSS. Own L0–L2. Rent L3–L4. Classify the rest. Markdown after extract is the other half of the product (fetch success ≠ LLM-ready content).
