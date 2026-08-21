# Legal Verification — Anti-Bot Bypass as a Product Feature (2026-08-21)

Scope: a commercial crawler that scrapes public, non-login data, respects robots.txt, and is weighing whether "gets through anti-bot protection" can be a product feature. Read-only legal research; no code touched. This file replaces the unverified propositions P1–P4 in `anti_bot_wall_final_synthesis.md` §三.

Tag legend: **[VERIFIED]** = primary source or two independent authoritative secondaries. **[PLAUSIBLE]** = one credible secondary. **[UNRESOLVED]** = conflicting or nothing solid.

---

## A. Reddit, Inc. v. SerpApi LLC — the §1201 anti-circumvention theory

### A.1 Procedural posture and the July 2026 ruling

**[VERIFIED]** Reddit, Inc. v. SerpApi LLC, No. 1:25-cv-08736 (S.D.N.Y.), Judge Paul A. Engelmayer. Complaint filed Oct 22, 2025; first amended complaint Feb 2026; co-defendants Perplexity AI, Inc. and proxy providers Oxylabs UAB and AWMProxy. On **July 31, 2026** the court **largely denied the motions to dismiss** and let the core DMCA theory proceed into discovery ([Loeb & Loeb case summary](https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc); [CourtListener docket 1:25-cv-08736](https://www.courtlistener.com/docket/71720563/reddit-inc-v-serpapi-llc/)).

**[VERIFIED]** What survived the motion to dismiss:
- **§1201(a)(1)(A)** (circumvention of an access-control measure) — against **both** SerpApi and Perplexity. The court treats SerpApi as the technology provider and Perplexity as a direct circumventor that "conduct[ed] the actual queries itself" ([Loeb & Loeb](https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc)).
- **§1201(a)(2)** (trafficking in circumvention technology) — against **SerpApi** as the manufacturer; the "designed or marketed for circumvention" element was undisputed ([Loeb & Loeb](https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc)).
- New York **civil conspiracy** (the DMCA violation is the underlying tort; the agreement to circumvent is an "extra element") ([Loeb & Loeb](https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc); [AI Weekly](https://aiweekly.co/alerts/reddits-dmca-scraping-case-advances-against-perplexity-serpapi)).

**[VERIFIED]** What was dismissed: the **§1201(b)** trafficking claim against SerpApi (SearchGuard is an "access control" measure, not a "rights protection" measure; collapsing the two would be "contrary to the DMCA's text and structure"), plus state-law **unjust enrichment** and **unfair competition** as preempted by the Copyright Act ([Loeb & Loeb](https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc)).

**[VERIFIED]** This is a **motion-to-dismiss ruling, not a merits verdict** — no liability has been upheld yet. The §1201(a) liability question is "left to trial"/discovery, not decided. The procedural split "is likely to attract appellate review" ([Review of AI Law](https://www.reviewofailaw.com/Tool/Evidenza/Single/view_html?id_evidenza=6210)).

### A.2 What the "technological measure" is — and whether the court accepted it

**[VERIFIED]** The measure is **Google's "SearchGuard"** — JavaScript challenges and CAPTCHAs blocking automated systems from Google SERPs — **not** any barrier on Reddit's own servers. Reddit alleges SerpApi never touched Reddit's servers at all; it scraped Reddit content off Google ([Loeb & Loeb](https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc); [Kaufman & Kahn](https://kaufmankahn.com/reddit-sued-to-protect-its-users-but-it-also-wants-to-get-paid/)).

**[VERIFIED]** The court **accepted** that a CAPTCHA/bot-detection system "effectively controls access" under **§1201(a)(3)(B)**, rejecting the argument that a measure cannot control access if the same content stays readable to humans. The court's analogy: a "facial-recognition technology programmed to open the door of a home for residents but not for other visitors." Differentiating automated vs. human users is a valid form of access control ([Loeb & Loeb](https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc); [MLex](https://www.mlex.com/mlex/intellectual-property/articles/2508237/us-judge-allows-reddit-anti-circumvention-claims-vs-perplexity-ai-serpapi)).

### A.3 The controlling contrast — Google LLC v. SerpApi (N.D. Cal.)

**[VERIFIED]** Eleven days earlier, on **July 20, 2026**, Judge Yvonne Gonzalez Rogers (N.D. Cal., No. 4:25-cv-10826) **dismissed** Google's near-identical DMCA suit against the same SerpApi over the same SearchGuard bypass ([Search Engine Land](https://searchengineland.com/google-loses-key-dmca-claims-against-serpapi-in-scraping-lawsuit-483185); [Search Engine Journal](https://www.searchenginejournal.com/court-dismisses-googles-dmca-claims-against-serpapi/583033/)).

**[VERIFIED]** The decisive difference was **not** the circumvention technique — the court accepted that browser-fingerprint spoofing, IP rotation, and CAPTCHA solving are technically circumvention — but **what sat behind the barrier**: (a) Google never claimed its SERP results (URLs, snippets, factual index data) were copyrighted works; and (b) Google failed to allege SearchGuard was implemented "with the authority of the copyright owner" as §1201(a)(3)(B) requires. "The DMCA protects copyright, not revenue" ([ppc.land](https://ppc.land/google-loses-dmca-bid-to-treat-search-scraping-like-dvd-piracy/); [SerpApi blog](https://serpapi.com/blog/google-v-serpapi-the-court-granted-our-motion-to-dismiss/)).

**[VERIFIED]** Reddit's case survives because Reddit alleges **copyrightable user posts** behind the barrier plus **licensing restrictions** that authorize Google to run SearchGuard. Engelmayer distinguished the cases on that ground ([Loeb & Loeb](https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc); [Ars Technica](https://arstechnica.com/tech-policy/2026/07/reddit-keeps-weird-dmca-lawsuit-against-web-scraper-alive-despite-googles-loss/)).

**[VERIFIED]** **August 2026 development (separate case):** Google filed an **amended complaint Aug 10, 2026** in N.D. Cal., attaching content-licensing terms (including its Reddit partnership) to try to show copyright-owner authorization for SearchGuard ([Search Engine Journal](https://www.searchenginejournal.com/google-amends-serpapi-suit-with-content-licensing-terms/585505/)).

**[UNRESOLVED]** Whether any further August 2026 order exists **in Reddit v. SerpApi** itself. The Loeb article is dated Aug 2026 but describes only the July 31 ruling; no August ruling in the SDNY case surfaced ([Loeb & Loeb](https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc)).

### A.4 Section A takeaway

The §1201(a)(2) "tool vendor" theory has **survived** against SerpApi, and §1201(a)(1)(A) survives against the end user (Perplexity) — but the whole claim is gated on **copyrightable content behind the bot-detection barrier, and the barrier being authorized by a copyright owner**. Google's loss on the same facts shows CAPTCHA/bot-detection circumvention alone, without copyrighted works behind the gate, is **not** a §1201 violation.

---

## B. CFAA exposure for a robots-respecting, public-data crawler that advertises anti-bot bypass

### B.1 The three access questions

**[VERIFIED]** **(i) Public no-login pages.** hiQ II — *hiQ Labs v. LinkedIn*, 31 F.4th 1180 (9th Cir. Apr 18, 2022) — held on remand from *Van Buren* that scraping publicly available pages is not "without authorization" under the CFAA; *Van Buren v. United States*, 593 U.S. 374 (2021), narrowed "exceeds authorized access" so that violating a policy/ToS term "without more" is not a CFAA violation ([hiQ II on Justia](https://law.justia.com/cases/federal/appellate-courts/ca9/17-16783/17-16783-2022-04-18.html); [FBM commentary](https://www.fbm.com/publications/what-recent-rulings-in-hiq-v-linkedin-and-other-cases-say-about-the-legality-of-data-scraping/)).

**[VERIFIED]** **(ii) After a C&D + IP block + evasion.** *Facebook v. Power Ventures*, 844 F.3d 1058 (9th Cir. 2016), remains the controlling pattern: once permission is "expressly rescinded" and the defendant keeps accessing via IP switching or third-party aid, that is unauthorized access. The court's line: "Once permission has been revoked, technological gamesmanship or the enlisting of a third party to aid in access will not excuse liability." Craigslist v. 3Taps (N.D. Cal. 2013) reached the same result on C&D + IP block + proxy evasion ([Apify on Power Ventures](https://blog.apify.com/facebook-v-power-ventures/); [RCFP amicus brief, Ryanair v. Booking.com (July 2025)](https://s3.documentcloud.org/documents/26026049/2025-07-18-rcfp-amicus-brief-in-ryanair-dac-v-bookingcom.pdf)).

**[PLAUSIBLE]** Post-*Van Buren*, a **boilerplate C&D alone** is weakening as a CFAA trigger — the RCFP argues a typical C&D "simply restates the same terms-of-service violation that Van Buren held cannot support liability," and *Power Ventures* itself flagged this "tension" (844 F.3d at 1067 n.1). Courts are "split" on whether IP-block circumvention is a specific revocation of authorization or a mere use restriction ([RCFP amicus brief](https://s3.documentcloud.org/documents/26026049/2025-07-18-rcfp-amicus-brief-in-ryanair-dac-v-bookingcom.pdf); [Octo Browser legal guide](https://blog.octobrowser.net/is-web-scraping-legal)).

**[VERIFIED]** **(iii) Tool vendor vs. end user.** Building/selling a scraper is not itself a CFAA violation (EFF-backed appellate holding that developing a browser is not unauthorized access). But outsourcing does not shift liability off the end user — the vendor/end-user distinction matters less than **conduct** (bypassing authentication, ignoring an express revocation, harvesting PII) ([EFF/appeals court on browser building](https://ai-research.news/en/articles/appeals-court-agrees-with-eff-that-building-a-web-browser-doesnt-violate-the-cfaa); [ScrapeHero vendor-liability note](https://www.scrapehero.com/data-notes/is-it-legal-to-use-a-web-scraping-service/)).

**[VERIFIED]** The practical CFAA bar is the **loss element**: *Ryanair DAC v. Booking Holdings* (D. Del., No. 1:20-cv-01191) — a jury found $5,000 liability, and Judge Bryson granted **JMOL in Jan 2025** because Ryanair could prove only $2,457.72 in anti-bot "Shield" costs, below §1030's $5,000 threshold. Civil CFAA claims over scraping frequently die on damages, not on the access question ([Techdirt via tagteam](https://tagteam.harvard.edu/hub_feeds/3629/feed_items/13252325/content); [CourtListener JMOL order](https://www.courtlistener.com/docket/18414221/465/ryanair-dac-v-booking-holdings-inc/)).

### B.2 Does "respects robots.txt" change CFAA analysis?

**[VERIFIED]** Under **§1201** (the DMCA, not CFAA): **no.** *Ziff Davis v. OpenAI* / *In re OpenAI Copyright Litigation* (S.D.N.Y., No. 1:25-cv-04315, Judge Sidney Stein, **Dec 15, 2025**) held robots.txt directives "do not 'effectively control' access to that content any more than a sign requesting that visitors 'keep off the grass' effectively controls access to a lawn," and that ignoring them is not "circumvention" — circumvention requires affirmatively disabling a technological control, "breaking and entering (or hacking)." A Dec 18, 2025 amendment to salvage the §1201 claim was denied as futile ([Barry Sookman](https://barrysookman.com/2025/12/22/ziff-davis-v-openai-key-copyright-litigation-ruling/); [Courthouse News](https://www.courthousenews.com/judge-advances-digital-publisher-ziff-davis-chatgpt-copyright-infringement-claims/); [MLex](https://www.law360.com/mlex/articles/2422639/us-judge-rules-for-openai-says-robots-txt-files-don-t-control-access-to-web-content)).

**[VERIFIED]** Under **CFAA**, robots.txt is likewise a **policy signal, not a technological measure**. CFAA's gate is authorization to the computer/system; a robots.txt file is a machine-readable preference, not an authentication or access-control barrier (consistent with *hiQ II* and *Van Buren*'s "gates-up-or-down" logic) ([hiQ II](https://law.justia.com/cases/federal/appellate-courts/ca9/17-16783/17-16783-2022-04-18.html); [Ziff Davis ruling](https://barrysookman.com/2025/12/22/ziff-davis-v-openai-key-copyright-litigation-ruling/)).

### B.3 Exposure difference: polite browser identity vs. active CAPTCHA-solving / IP-ban evasion

**[VERIFIED]** **Polite identity only** (correct UA/header/viewport/locale consistency, headed browser, rate limiting — the project's "Tier 0") does not circumvent any technical measure and does not evidence unauthorized access; it is the low-risk posture. **Actively solving CAPTCHAs or rotating IPs to evade a block** is exactly the conduct courts describe as circumvention/evasion — it converts a policy question into an access-control question and is the *Power Ventures* / *3Taps* / *SerpApi* pattern ([Octo Browser](https://blog.octobrowser.net/is-web-scraping-legal); [Loeb & Loeb on SerpApi's "ludicrous speed"/proxy/fake-UA allegations](https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc)).

**[PLAUSIBLE]** The gap is "one-time CAPTCHA solve" vs. "continuous rotation to defeat a ban": a single solve is weaker evidence of intent to evade than a standing proxy/CAPTCHA infrastructure, but both fall on the high-risk side once the target has affirmatively signaled (via CAPTCHA or an IP block) that automated access is not authorized ([Octo Browser](https://blog.octobrowser.net/is-web-scraping-legal); [dataimpulse 2026 guide](https://dataimpulse.com/blog/is-web-scraping-legal/)).

---

## C. EU positioning — Directive 2013/40, GDPR, database/copyright angles

### C.1 Directive 2013/40/EU (cybercrime)

**[VERIFIED]** Directive 2013/40/EU criminalises (Art 3) intentional access **"without right"** to an information system, and (Art 7) the production/sale/import/distribution of tools "designed or adapted primarily" for those offences, "without right" and with intent to use them ([legislation.gov.uk full text](https://www.legislation.gov.uk/eudr/2013/40/contents/adopted/data.pdf)). **CAPTCHA or bot-detection bypass is not separately criminalised** — it becomes legally relevant only as evidence that access was unauthorized ([Law.SE on CAPTCHA](https://law.stackexchange.com/questions/94577/is-avoiding-captcha-illegal)).

**[VERIFIED]** The Directive requires **intent** (Art 2(d) "without right"; Recitals 16–17: no liability "without criminal intent," and tools are not criminalised if produced for legitimate purposes such as security testing) ([legislation.gov.uk](https://www.legislation.gov.uk/eudr/2013/40/contents/adopted/data.pdf)).

**[VERIFIED]** Whether scraping public pages qualifies depends on **national transposition**: the Commission's 2017 report notes several Member States (BE, BG, FR, HR, LU, MT, PT, RO, SI, UK) have broader "illegal access" offences that do **not** require circumventing a security measure, while others (CY, EL, SK) require infringing a security measure ([Commission transposition report COM(2017) 474](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:52017DC0474&from=EN)).

**[PLAUSIBLE]** Net effect: for a commercial crawler, bypassing a CAPTCHA/bot-wall is **not** a stand-alone EU cybercrime, but it materially weakens a "with right / authorised" defence where the target's terms or technical measures restrict automated access — the risk is real only where the member state criminalises access without a security measure, or where the target has expressly barred the crawler ([Law.SE](https://law.stackexchange.com/questions/94577/is-avoiding-captcha-illegal); [proxiesapi EU/US guide](https://guides.proxiesapi.com/posts/is-web-scraping-legal)).

### C.2 CJEU / member-state case law on scraping + anti-bot bypass (2020–2026)

**[UNRESOLVED]** **No direct CJEU ruling** on anti-bot bypass or CAPTCHA circumvention surfaced in this window. The closest relevant CJEU/EDPB authority is *Meta v Bundeskartellamt*, C-252/21 (4 July 2023), which is a GDPR/legitimate-interest ruling, not an access or circumvention ruling ([EDPB Opinion 28/2024 citing C-252/21](https://ppc.land/content/files/2024/12/edpb_opinion_202428_ai-models_en.pdf)).

**[VERIFIED]** **Germany (GDPR track):** BGH, 18 Nov 2024, No. VI ZR 10/24 (Facebook "scraping complex") — a brief **loss of control** over scraped personal data is non-material damage under Art 82 GDPR, valued at roughly **EUR 100** per affected individual; burden of proof and damages are compensatory, not punitive ([DLA Piper](https://privacymatters.dlapiper.com/2024/11/germany-judgment-on-non-material-damages-for-loss-of-control-over-personal-data/); [Clyde & Co critique](https://www.clydeco.com/fr/insights/2024/12/german-federal-court-of-justice-on-gdpr)).

**[VERIFIED]** **Ireland (database/track, relevant to database right):** Irish High Court (Nov 2023) held scraper Flightbox bound by Ryanair's terms and granted a permanent injunction against bot-scraping ([news.10jqka summarising the Irish ruling](http://news.10jqka.com.cn/field/sn/20260622/58612207.shtml)).

**[UNRESOLVED]** A reported **Paris Commercial Court (2024)** holding that a robots.txt opt-out satisfied the Article 4 DSM "machine-readable" opt-out could not be confirmed — one authoritative secondary (IFRRO/JURI) takes the **opposite** view ("robots.txt is not an effective opt-out tool"). Treat the French ruling as unconfirmed; the weight of EU-institutional commentary currently leans against robots.txt satisfying Art 4(3) ([IFRRO/JURI](https://ifrro.org/page/article-detail/european-parliaments-juri-committee-presents-its-report-on-generative-ai-and-copyright/)).

### C.3 GDPR: is "looking like a human to defeat bot-detection" a problem?

**[VERIFIED]** Scraping personal data is "processing" under GDPR, and for public-data scraping the **only** available lawful basis is **legitimate interest, Art 6(1)(f)** (ICO position; EDPB Guidelines 1/2024), which requires the three-step test (legitimate interest → necessity → balancing) ([EDPB Guidelines 1/2024](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202401_legitimateinterest_en.pdf); [ICO/legitimate-interest analysis](https://www.informationpolicycentre.com/uploads/5/7/1/0/57104281/cipl_legitimate_interests_for_data_ai_training_dpo_perspective_dec25.pdf)).

**[VERIFIED]** *Meta v Bundeskartellamt* (C-252/21) set the benchmark: a data subject's **reasonable expectations** can defeat a controller's commercial interest in the balancing test ([EDPB Opinion 28/2024 citing C-252/21](https://ppc.land/content/files/2024/12/edpb_opinion_202428_ai-models_en.pdf)).

**[PLAUSIBLE]** Deliberate "look human" evasion is not a separate GDPR violation, but it is **adverse** under Art 5(1)(a) fairness/transparency and it **undercuts the legitimate-interest balancing** — it shows the data subject did not reasonably expect the processing, and it signals intent in any Art 3 Directive 2013/40 analysis. Where the scraped pages contain personal data of EU individuals, GDPR is the more realistic exposure than the cybercrime directive, and the "look human" feature is a liability aggravator, not a neutral detail ([BGH VI ZR 10/24 via DLA Piper](https://privacymatters.dlapiper.com/2024/11/germany-judgment-on-non-material-damages-for-loss-of-control-over-personal-data/); [EDPB Guidelines 1/2024](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202401_legitimateinterest_en.pdf)).

---

## Bottom line for the product decision

Selling anti-bot bypass as a feature is **not** legally defensible as a blanket promise, but the bright line is precise and content-dependent. On the US side, the 2026 Reddit/Google SerpApi split draws the line at **circumvention of a technical measure (CAPTCHA / bot-detection) that actually gates copyrightable content** — §1201(a)(1)(A)/(a)(2) liability has survived against both the tool vendor and the end user there, while the identical technique failed against Google because only uncopyrightable facts and no copyright-owner authorization sat behind the gate. The CFAA line is separate and lower: scraping public no-login pages is defensible (*Van Buren*, *hiQ II*), but an affirmative cease-and-desist plus IP block plus continued evasion (the *Power Ventures* pattern) — or defeating authentication — crosses it, and robots.txt neither helps nor hurts because it is a policy signal, not a technological measure (*Ziff Davis v. OpenAI*). In the EU, bypassing a CAPTCHA/bot-wall is not a stand-alone cybercrime under Directive 2013/40 but is evidence of unauthorized access under national law, and GDPR Art 6(1)(f) is the real exposure once personal data is scraped, with the BGH holding even "loss of control" is compensable. **Concretely: a robots.txt-respecting crawler that fetches public pages with a polite, self-consistent browser identity and honest rate limiting is defensible; the defensibility collapses the moment the product actively solves CAPTCHAs, rotates IPs to defeat a ban, or otherwise disables a bot-detection gate — because that is circumvention of an access-control measure, and if copyrightable content or personal data sits behind it, both US §1201 and EU data-protection exposure are in play.** The project's existing posture ("Tier 0 honest hardening" as a feature, "classification + upgrade path" instead of bypass) is exactly the right side of that line.
