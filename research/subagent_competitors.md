# 新增竞品与市场信号（2026-08-17）

## 研究边界与方法

- 本文件是对 `research/evidence_ledger.csv` 中 S01–S40 的补充；以下 URL、实体和信号均未出现在旧 40 条 ledger 中。
- 通过用户指定的 Chrome 连接，以只读页面读取和 CDP 元数据核验完成；未登录、未提交表单、未发消息、未接受 CAPTCHA，也未编辑 PDF 或 generator。
- “精确事实”只记录官方页面/官方仓库当日可见的价格、配额和产品能力；价格和配额属于会漂移的数据，引用时应保留页面日期。
- 结论区的“推论”不是网页原话，会明确标注为推论并降低置信度。

## 来源明细

### C01 — Browserbase 官方定价页

- **日期**：2026-08-17
- **标题**：Browserbase Pricing: Free, $20, $99, or Custom
- **URL**：https://www.browserbase.com/pricing
- **来源类型**：official_pricing
- **置信度**：高（官方当前定价页；页面内可见配额表）
- **可支持的精确事实**：
  - Free 为 `$0/月`，列出 3 个并发浏览器、1 个 browser hour、3 次 agent runs、1,000 次 Search、1,000 次 Fetch、15 分钟/会话和 7 天数据保留。
  - Developer 为 `$20/月`，25 个并发浏览器、100 个 browser hours、1 GB proxies，并列出自动 CAPTCHA solving；Startup 为 `$99/月`，100 个并发浏览器、500 个 browser hours、5 GB proxies 和 30 天保留。
  - Scale 为自定义价格，列出 250+ 并发浏览器、500+ browser hours、5+ GB proxies、30+ 天保留，并列出 Verified Agents + CAPTCHA solving。
  - 比较表把 Stealth Mode 标成 Free=no、Developer/Startup=Basic、Scale=Advanced；Browserbase 同时提供 Browser、Fetch/Search API、Agent Identity、Runtime 和 Model Gateway 等产品入口。
  - 页面把 100 browser hours 解释为约 3,000 个 page-level tasks，说明其按浏览器时长而不是单纯请求数做生产计量。

### C02 — Browser Use 官方定价页

- **日期**：2026-08-17
- **标题**：Pricing — Browser Use
- **URL**：https://browser-use.com/pricing
- **来源类型**：official_pricing
- **置信度**：高（官方当前定价页；Free 并发口径存在页面内不一致，已单独标注）
- **可支持的精确事实**：
  - Dev 为 `$29/月`（含 `$29` credits）和 25 concurrent sessions；Business 为 `$299/月`、200 concurrent sessions；Scaleup 为 `$999/月`、500 concurrent sessions；这三个付费档均标出 Advanced stealth。
  - Browser Infrastructure 按分钟计费区块列出 Browser Session `$0.02/hour`、Managed Proxy `$5/GB`，Scaleup 的 managed proxy 为 `$4/GB`；Proxyless/BYOP 的 egress 为 `$0.20/GB`。
  - 付费档提供 top-ups 和 bring-your-own-key；页面说明年度计划前两个月免费、credits 一次性预发。
  - 页面顶部 Free 卡片写“3 concurrent sessions”，而计划对比表的 Free 行写“10”；这是该官方页面内可复核的口径冲突，不应把 Free 并发数当成唯一确定事实，建议产品决策前再向销售核实。

### C03 — Browser Use 官方快速入门文档

- **日期**：2026-08-17
- **标题**：Quick start — Browser Use
- **URL**：https://docs.browser-use.com/cloud/quickstart
- **来源类型**：official_docs
- **置信度**：高（官方开发者文档）
- **可支持的精确事实**：
  - 文档把产品拆为 Hosted Agents 和 Browsers：Hosted Agents 接收任务并返回结果，Browsers 可启动云浏览器并从代码连接。
  - 示例通过 `client.browsers.create(proxy_country_code="us")` 创建带国家代理目标的浏览器，并返回 `browser.cdp_url`；结束时使用 `client.browsers.stop(browser.id)`。
  - 文档特别说明关闭 Playwright、Puppeteer 或 CDP 连接不会停止浏览器，必须显式 stop 或调用对应 API；这验证了“会话生命周期/资源回收”是需要产品化处理的运维点。

### C04 — Skyvern 官方定价页

- **日期**：2026-08-17
- **标题**：Skyvern Pricing — Free to Enterprise Automation Plans
- **URL**：https://www.skyvern.com/pricing
- **来源类型**：official_pricing
- **置信度**：高（官方当前定价页和 feature comparison）
- **可支持的精确事实**：
  - Free 为 `$0/月`、5,000 credits、1 concurrent run、webhooks 和 country geo-targeting；Hobby 为 `$29/月`、30,000 credits/月、10 concurrent runs、Basic CAPTCHA solver、stored credentials。
  - Pro 为 `$149/月`、150,000 credits/月、25 concurrent runs，列出 Advanced CAPTCHA solver、2FA/TOTP、1Password integration、residential proxy 和 city-level geo-targeting。
  - Enterprise 为 custom credits/价格、100 concurrent runs，列出 HIPAA compliant、SOC-2 Report、Azure Key Vault、Bitwarden、custom code blocks 和 Human-in-the-loop。
  - 同一官方比较表明确把 proxy type、geo-targeting、credentials、2FA/TOTP 和 human-in-the-loop 与价格/并发档位绑定；anti-bot、身份和人工接管不是独立的“万能开关”。

### C05 — Steel 官方产品与定价页

- **日期**：2026-08-17
- **标题**：Steel | Browser Infrastructure for AI Agents
- **URL**：https://steel.dev/#pricing（`/pricing` 读取后落到该官方产品页的 pricing 锚点）
- **来源类型**：official_product_and_pricing
- **置信度**：高（官方当前产品页；产品指标是厂商自报）
- **可支持的精确事实**：
  - Steel 将自己定位为开源 browser API，用于在云端控制 browser fleets；页面自报 `800B+ Tokens Scraped`、`1,000,000+ Browser Hours Served` 和 `<1s Avg. Session Start Time`。
  - 产品页列出 Auto CAPTCHA solving、Proxy and Browser Fingerprinting、最长 24 小时的长会话；还支持保存/注入 cookies 和 local storage 以复用上下文。
  - Session Viewer 可查看和调试 live 或 recorded sessions；页面另列 Auto Sign-In，用于访问 auth-walled websites/apps。
  - Launch 为 `$0/月 + usage`，含一次性 `$30` credits；Scale 为 `$250/月 + usage`，含每月 `$100` credits、dedicated Slack、Enterprise SSO 和 HIPAA-ready BAA；Enterprise 列出 1,000+ concurrent browser sessions 和 reserve browser pools。

### C06 — Browse AI 官方定价页

- **日期**：2026-08-17
- **标题**：Pricing — Browse AI
- **URL**：https://www.browse.ai/pricing
- **来源类型**：official_pricing
- **置信度**：高（官方当前定价页和 FAQ）
- **可支持的精确事实**：
  - Free 为 50 credits/月；Personal 为 `$48/月`、2,000 credits；Professional 为 `$87/月`、可选 5,000/10,000/20,000/30,000 credits；Premium 起价 `$500/月`（按年付），列出 600,000+ credits/年。
  - Free/Personal/Professional 都列出 unlimited robots、AI web scraper、deep scraping、monitoring、residential proxies 和 integrations；网站数从 2、5、10 到 Premium custom，用户数从 3、3、10 到 custom。
  - FAQ 定义 1 credit 可从页面提取 10 行数据或捕获 1 张 screenshot；涉及详情页、截图和 premium site 时会额外消耗 credits，未用 credits 默认不结转。
  - Recorder 让用户通过实际操作训练 robot；官方 FAQ 的示例步骤包括打开网页、登录、点击、填表、提取到 spreadsheet、截图和监测内容/视觉变化。Premium sites 使用 rotating geolocated residential proxies 与 automated CAPTCHA solving，单次最低消耗 2–10 credits。

### C07 — Axiom.ai 官方定价页

- **日期**：2026-08-17
- **标题**：Browser automation & web scraping pricing plans | axiom.ai
- **URL**：https://axiom.ai/pricing/
- **来源类型**：official_pricing
- **置信度**：高（官方当前定价页和 feature matrix）
- **可支持的精确事实**：
  - 新账号有 2 个免费 runtime hours、无需信用卡；Starter 为 `$15/月`、5 小时/月，云端同时运行 1 个 bot、单次上限 1 小时；Pro 为 `$50/月`、30 小时/月，云端可每日调度。
  - Pro Max 为 `$150/月`、100 小时/月，云端 2 bots 并发、可按小时调度；Ultimate 为 `$250/月`、250 小时/月，云端最多 20 bots 并发、每 15 分钟调度、单次最长 12 小时，额外运行会排队。
  - Pro 及以上列出 API、Webhooks、Zapier/Make 集成和 run recording；recording 会保留最近一分钟并提供每一步的详细日志。
  - 功能表列出 site logins/1Password、2FA/TOTP、cookie sharing、BYO proxies/automatic rotation；Turnstile bypass 在桌面档位列出，云端 feature matrix 仅 Ultimate 标出。

### C08 — Scrapling 官方 GitHub 仓库

- **日期**：2026-08-17
- **标题**：D4Vinci/Scrapling: An adaptive Web Scraping framework
- **URL**：https://github.com/D4Vinci/Scrapling
- **来源类型**：official_repo
- **置信度**：高（项目官方仓库；star/fork 数和能力为仓库当日可见内容）
- **可支持的精确事实**：
  - 仓库当日页面显示约 74.7k stars、7.5k forks，BSD-3-Clause；README 将其定位为从单请求到 full-scale crawl 的 adaptive scraping framework。
  - README 声称 parser 可在网页变化后自动重新定位元素，StealthyFetcher 可处理 Cloudflare Turnstile；spider 层提供 configurable concurrency、per-domain throttling、multi-session、pause/resume、streaming、blocked-request detection、AutoThrottle 和可选 robots.txt 遵守。
  - Fetcher 层列出浏览器 TLS fingerprint impersonation、Playwright/Chrome 动态加载、persistent sessions、proxy rotation、DNS-over-HTTPS 和 request/domain blocking；可通过 `cdp_url` 连接已运行的远程浏览器。
  - 仓库还提供 background API/XHR capture、MCP server、screenshots 和通过 CDP 驱动远程浏览器；这让“抓取+证据/工具调用”更接近一个可组合的开源底座，而不是只有 HTML parser。

### C09 — Zyte 官方定价页

- **日期**：2026-08-17
- **标题**：Pricing | Zyte
- **URL**：https://www.zyte.com/pricing/
- **来源类型**：official_pricing
- **置信度**：高（官方当前定价页；价格区间依官网网站层级）
- **可支持的精确事实**：
  - 页面显示 Zyte API 起价为 `$0.06/1,000 successful responses`，可先试用 30 天并附 `$5` free credit、无 commitment/subscription。
  - Pay-as-you-go 的 HTTP response body 为 `$0.13–$1.27/1,000 requests`，browser rendered 为 `$1.01–$16.08/1,000`；$100/$200/$500 月度 commitment 档对应更低的区间，Enterprise 需联系销售。
  - 所有订阅层级都列出 IP rotation（residential/datacenter/mobile）、automatic CAPTCHA solving、cookie persistence 的 session management、full JS rendering、pre-warmed Instant Browsers、geo locations 和 actions（点击、填表、导航）。
  - Zyte 将 Ban Handling、Headless Browser、AI Extraction、SERP、Scrapy Cloud 和 Agentic Web Data 分列为产品入口，说明其竞争面覆盖“解封+浏览器+抽取+运行托管”而非单一代理池。

### C10 — ScrapingBee 官方定价页

- **日期**：2026-08-17
- **标题**：Pricing — ScrapingBee Web Scraping API
- **URL**：https://www.scrapingbee.com/pricing/
- **来源类型**：official_pricing
- **置信度**：高（官方当前定价页）
- **可支持的精确事实**：
  - Hobby 为 `$19.99/月`、75,000 credits、25 concurrency；Freelance `$49.99/月`、250,000/50；Startup `$99.99/月`、1,000,000/100；Business `$249.99/月`、3,000,000/200；Business+ `$599.99/月`、8,000,000/400。
  - Enterprise 14 为 `$999.99/月`、14,000,000 credits、500 concurrency；页面继续列到 Enterprise 120（$5,799.99/月、120,000,000 credits、900 concurrency）和 Custom。
  - 所有列出的计划都标出 JavaScript rendering、rotating & premium proxies、geotargeting、screenshots & extraction rules、dedicated scraper APIs 和 team management；页面另称“headless browsers and rotates proxies for you”。
  - 官方提供 1,000 free API credits、无需信用卡，并在页面写有 4,000+ developers 使用 ScrapingBee；这是厂商自报的市场采用信号，不等于独立审计数。

## 交叉验证后的市场信号（推论）

1. **反封锁能力被拆成可售卖的层级**（中高置信推论）：Browserbase 的 Stealth/CAPTCHA、Skyvern 的 CAPTCHA/proxy/geo、Browse AI 的 Premium site credits、Zyte 的按成功响应计费，以及 ScrapingBee 的 proxy/rendering 套餐，都把“能否稳定拿到结果”直接绑定到价格或配额。竞争力不在一句“支持代理”，而在成功率、失败重试、身份连续性和可解释计量。
2. **批量提交的真实计量单位已经从 request 变成会话/并发/credits**（高置信推论）：Browserbase、Browser Use、Skyvern、Axiom、ScrapingBee 都公开并发或运行时限制；Axiom 进一步提供队列，Browse AI 直接按行数/截图扣 credits。产品若只承诺“批量抓取”，却不提供配额预估、队列、断点和失败重跑，容易在规模化时制造新的痛点。
3. **持久身份与人工接管是成熟产品的共同缺口补位**（高置信推论）：Steel 的 cookies/local storage、Skyvern 的 stored credentials/2FA/Human-in-the-loop、Axiom 的 cookie sharing/recording、Browser Use 的显式 browser stop、Zyte 的 cookie persistence，反复指向同一类用户痛点：登录态、验证码、长流程和失败现场无法稳定复现。
4. **证据/可追溯性正在成为能力分层**（中置信推论）：Steel 的 live/recorded Session Viewer、Axiom 的 run recording、Browse AI 的 screenshots、Scrapling 的 screenshots/XHR capture，说明“抓到数据”之外，用户还需要知道何时、以何会话、从哪一步得到结果，才能审计和处理争议。
5. **开源底座与托管服务的分工仍清晰**（中置信推论）：Scrapling 提供 parser、sessions、proxy rotation、CDP、MCP 和 crawl control，但没有与上述商业服务同类的托管 SLA/公开付费层；商业产品则将 proxy、CAPTCHA、browser fleet、support 和 compliance 包进月费/usage。机会点是把开源可组合性与托管的成功率/证据/运维承诺连接起来，而不是再做一个裸 parser。

## 当前验证缺口

- 本批来源主要是官方产品页/定价页，能验证“供应商提供什么”和“如何计价”，不能单独证明真实成功率、CAPTCHA 通过率、数据质量或客户留存；这些需要补充第三方 benchmark、用户评论、GitHub issue 和真实 canary。
- Browser Use Free 并发数在同一官方页面出现 3 与 10 两个口径；应在购买或建立基准测试前二次确认。
- Steel 的 tokens scraped、browser hours、session start time，Browse AI 的 1.8B websites，ScrapingBee 的 4,000+ developers 等是厂商自报指标；本文件保留它们作为市场定位信号，不作独立市场规模结论。
