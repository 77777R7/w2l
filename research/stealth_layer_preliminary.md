# Stealth / Fingerprint Layer — Preliminary Research

- 日期：2026-08-21
- 方法：WebSearch + WebFetch（开源仓库、2026 年第三方评测、判例摘要）
- 目的：为「浏览器 lane 残余缺口」（amazon.com 202 empty、tiktok.com "Please wait" shell、etsy.com 403）评估一个可能的 stealth / 指纹层
- 范围：只读预研。不修改源码，不承诺实现。

---

## 一、Signals（bot 厂商依赖的检测信号）

检测是**概率性**的，不是二进制开关：Cloudflare / Akamai / DataDome 维护一个「bot score」，每个异常累加分数，叠加 JS 指纹、IP 信誉、时区/语言匹配、行为信号一起打分（[Dev.to 2026 guide](https://dev.to/vhub_systems_ed5641f65d59/how-sites-detect-headless-browsers-and-how-to-evade-each-signal-2026-guide-2jj0)）。核心信号如下：

1. **`navigator.webdriver = true`** — 最便宜的检查。W3C WebDriver 规范要求自动化浏览器置 true，Playwright/Puppeteer/Selenium 默认都是 true（[AlterLab 2026](https://alterlab.io/blog/playwright-bot-detection-what-actually-works-in-2026)）。
2. **UA / header 一致性** — 默认 UA 含 `HeadlessChrome` 子串；以及 UA 与 `Accept-Language`、`Sec-CH-UA` client hints、`navigator.platform`、`navigator.userAgent` 之间的不一致。**不一致是 bug，不是伪装**（本项目 PHASE1 §2.5 Tier 0 已认同此点）。
3. **WebGL / canvas 指纹** — headless Chrome 报 `SwiftShader` / `llvmpipe` 而非真实 GPU（`ANGLE (NVIDIA…)`）；Linux 上的 canvas 指纹聚类；AudioContext hash（[Scrappey](https://scrappey.com/qa/anti-bot/what-is-headless-browser-detection)、[AlterLab](https://alterlab.io/blog/playwright-bot-detection-what-actually-works-in-2026)）。
4. **`navigator.plugins` / `mimeTypes` / `languages`** — 真 Chrome 有 3–7 个插件（PDF viewer 等），headless 报空；languages/locale 需与 timezone、IP 一致。
5. **CDP 层泄漏** — 三类无法用页内 JS 掩盖的：`Runtime.enable`（Puppeteer/Playwright 每个 frame 自动调用，页内 JS 可探测该调用）；`pptr:evaluate` sourceURL 出现在 stack trace；`__puppeteer_utility_world__` 工具世界名（[rebrowser-patches](https://github.com/rebrowser/rebrowser-patches)、[rebrowser DeepWiki](https://deepwiki.com/rebrowser/rebrowser-patches/3-detection-protection-mechanisms)）。
6. **自动化启动标志** — `--enable-automation`、`--disable-blink-features=AutomationControlled`、ChromeDriver 的 `cdc_` 变量（Playwright 因协议不同不注入 `cdc_`，但自动化标志仍在）。
7. **TLS 指纹（JA3/JA4）+ HTTP/2 settings** — 握手 cipher-suite/扩展顺序暴露，headless Chromium 的 JA3 与任何真 Chrome 发布版都不匹配；发生在任何 JS 之前，**JS 层不可修复**，需 C++ 层改并重编译（[AlterLab](https://alterlab.io/blog/playwright-bot-detection-what-actually-works-in-2026)）。
8. **行为信号** — 无鼠标移动/滚动、直接跳转 URL、`requestAnimationFrame` 节奏；ML 模型在数十亿真实会话上训练，每月都在进化。这是最难 patch 的一层（[browser-use](https://browser-use.com/posts/bot-detection)、[AlterLab](https://alterlab.io/blog/playwright-bot-detection-what-actually-works-in-2026)）。
9. **IP 信誉** — datacenter-IP 启发式（Cloudflare Bot Fight Mode 直接据此拦 vanilla Playwright）；住宅 IP 是独立于指纹的信号。
10. **元检测（meta-detection）** — 对 patch 本身做 `Function.prototype.toString()` 检查：真原生函数打印 `[native code]`，被 JS monkey-patch 的会暴露替换源码；Kasada 专门给 patch 签名建目录（[Scrappey](https://scrappey.com/qa/anti-bot/what-is-headless-browser-detection)、[apiserpent](https://apiserpent.com/blog/puppeteer-stealth-still-works-2026)）。

---

## 二、Playwright countermeasures（及维护状态）

| 工具 | 层 | patch 什么 | 不 patch 什么 | 2026 维护状态 |
|---|---|---|---|---|
| `playwright-stealth`（Python fork）/ `playwright-extra` | JS 注入 | `navigator.webdriver`、`window.chrome`、plugins/mimeTypes、languages、permissions、WebGL 字符串、UA 一致性、`outerWidth/Height`、`iframe.contentWindow`、去 `--enable-automation`、sourceURL | TLS/JA3、IP 信誉、CDP `Runtime.enable`、行为信号；且被 `Function.toString()` 暴露 | 半活跃：Python fork 2025 年中重写 2.0（`Stealth()` 类）；Node 侧 `playwright-extra` 标 "maintained"（[decodo](https://decodo.com/blog/playwright-stealth)、[scrapewise](https://scrapewise.ai/blogs/playwright-vs-puppeteer-ecommerce-scraping-2026)） |
| `puppeteer-extra-plugin-stealth` | JS 注入 | 同上 ~15–20 模块 | 同上 | **实质死亡**：2025-02 起标 deprecated，多年未实质维护，活跃工作迁往 rebrowser（[apiserpent](https://apiserpent.com/blog/puppeteer-stealth-still-works-2026)） |
| `rebrowser-patches` | 驱动层（patch `playwright-core`/`puppeteer-core` 源码） | `Runtime.enable` 泄漏（3 模式：addBinding/alwaysIsolated/enableDisable）、sourceURL→`app.js`、utility world→`util`、`browser._connection()` | TLS/JA3、IP 信誉、行为；仍需代理+指纹配套 | 活跃但脆弱：1.4k★、27 commits；源码 patch「as the libraries' source code changes over time」会碎；`npm install` 后需重 patch；测至 Puppeteer 24.8.1 / Playwright 1.52.0（2025-04）；`page.pause()` 失效（[rebrowser-patches](https://github.com/rebrowser/rebrowser-patches)） |
| `patchright` | 二进制级（patch Chromium） | 移除 `navigator.webdriver`、canvas/WebGL 指纹修正 | 同上，行为/IP 仍不解决 | 活跃（Python 优先）（[dataresearchtools](https://dataresearchtools.com/patchright-vs-rebrowser-patches-stealth-playwright-patches-compared-2026)） |

**关键结论**：JS 层 stealth 对「软目标」（只查 `navigator.webdriver` / 缺 `window.chrome` / headless UA）足够；对 Cloudflare bot management、Kasada、DataDome 这类硬目标，2026 年共识是**不够**——需驱动层（rebrowser）或二进制层（patchright/Camoufox）patch，且**没有一个解决 TLS/JA3 或 IP 信誉**。维护是跑步机：Chrome 更新或厂商发布即碎（[scrapewise](https://scrapewise.ai/blogs/playwright-vs-puppeteer-ecommerce-scraping-2026)、[apiserpent](https://apiserpent.com/blog/puppeteer-stealth-still-works-2026)）。

---

## 三、Legal / ethical 边界

**判例主线**（美国，逐年收窄 CFAA）：

- **Van Buren v. United States（2021，最高院）**：CFAA 的「exceeds authorized access」只覆盖**取得你本不该有的访问**，不覆盖「已有访问权但用途/方式违规」。单纯违反 ToS 不再自动构成 CFAA（[Rapid7](https://www.rapid7.com/blog/post/2021/06/03/supreme-court-narrows-cfaa/)）。
- **hiQ v. LinkedIn（9th Cir., 2022）**：访问**公开、免登录**的数据，强质疑其不属于 CFAA「without authorization」——公开网站缺少法条预设的「gate」。
- **Meta v. Bright Data（N.D. Cal., 2024）**：登出状态抓公开 Facebook/Instagram 不违约 Meta ToS（判 Bright Data 胜）——但**绑定 Meta 具体条款**，非「抓取一律合法」。
- **对照案例 Facebook v. Power Ventures（9th Cir., 2016）**：收到 C&D + IP 封禁后，**继续通过规避技术措施访问**，支持了 CFAA 责任。

**边界锚点**：危险的不是「抓公开数据」，而是**绕过技术访问控制**（登录墙、验证码、IP 封禁、反爬 gate）。多个来源一致把 stealth/反检测工具刻画为「deliberate circumvention of access controls」，在美国落入 CFAA 风险、在欧盟落入 Directive 2013/40/EU 的规避技术措施条款（[GitHub issue 引用](https://github.com/BigBodyCobain/Shadowbroker/issues/229)、[octobrowser](https://blog.octobrowser.net/zh/is-web-scraping-legal)）。决策树：公开数据 + 无登录 = 低风险；**绕过 CAPTCHA/IP 封禁/限速/paywall = 风险抬升**；点击同意 clickwrap ToS = 合同风险（[octobrowser](https://blog.octobrowser.net/zh/is-web-scraping-legal)）。

**对 W2L 的落点**：区分「**看起来像一个正常浏览器，避免误分类**」与「**主动击败访问控制机制**」。前者 = UA/header 一致性、viewport/locale/timezone 对齐、headed 模式——是修 bug，不是伪装。后者 = stealth 插件、CDP patch、CAPTCHA 绕过、指纹伪造——把产品从「抓公开数据」推入「规避技术措施」的高风险区，同时留下法律敞口并阻断企业采用（PHASE1 §2.5「为什么不自研 stealth」已论证）。尊重 robots.txt + 不绕 auth 墙的既有立场，正好把 W2L 锚在低风险一侧。

---

## 四、Alternatives（非规避型替代路径）

按性价比/合法性排序：

1. **headed 模式 + 诚实指纹（Tier 0）** — 不改代码层，headless 本身是最大单一信号。UA/Accept-Language/client hints/viewport/locale/timezone/geolocation 对齐成一个自洽指纹，配按域并发上限、指数退避、遵守 `Retry-After`。这是 PHASE1 已有 Tier 0，收益最大成本最低。
2. **BYO 住宅代理（Tier 2）** — 解决 IP 信誉信号（任何指纹 patch 都不解决）。按 GB 计费，比买 Browserbase 便宜得多，w2l 支持成本近零（PHASE1 §2.5）。
3. **storageState + human handoff 登录（Tier 1b）** — 对有登录墙的高价值站点，用户自己有访问权，让用户在自己浏览器登录、过验证码、复用 session。完全正当，且覆盖面比直觉大（B04/B06 调研）。
4. **Browserless / Puppeteer 云（Browserbase、Steel、Zyte、ScrapingBee）** — 把指纹+代理+验证码解决能力外包，能力与合规责任由 provider 承担，w2l 只提供 adapter + 成本归因（PHASE1 §2.5 已核定价）。
5. **（规避型，仅记录不推荐）** rebrowser-patches / patchright / Camoufox — 驱动/二进制层 patch，仍属「击败访问控制」，且是维护跑步机。

---

## 五、Recommendation

**一个 stealth 层「应该做」的（= Tier 0 诚实加固，非规避）**：

- 把 UA/Accept-Language/`Sec-CH-UA`/`navigator.platform` 与真实 Chromium 版本对齐（现状是 bug）。
- 设置真实 viewport、`screen` 尺寸、locale/timezone/geolocation 自洽（headless 默认 800×600、零值 screen 是可修复的 tell）。
- **默认 headed 优先**，headless 作为明确的降级/成本档，而非默认。
- 保留 Tier 0 限速 + robots.txt + 空结果三分类（`empty_suspicious` 已能捕获 amazon/tiktok/etsy 这类 bot gate，无需 stealth 来「解决」）。

**一个 stealth 层「不做」的（明确排除）**：

- 不引入 stealth 插件 / CDP patch / 指纹伪造 / CAPTCHA 破解。这些是「击败访问控制」而非「避免误分类」，且维护负担不可持续（Chrome + 厂商每更新即碎）。
- 不把 amazon/tiktok/etsy 的 202/403/"Please wait" 当作 stealth 要解决的 bug——它们是被保护站点的**预期结果**，正确产品行为是分类 + 上报（`bot_gate`）+ 引导升级到 BYO proxy / 登录态，而非绕过。

**Go / no-go 框架（供产品评审）**：

- **Go**：Tier 0 诚实加固 + headed 默认（预算小、无法律敞口、符合既定架构）。
- **No-go**：任何 stealth / 指纹伪造 / CDP patch 层。理由三条：(1) 打不赢（全职基础设施生意，Cloudflare/Kasada 每次更新都要追）；(2) 法律敞口（规避技术措施 = CFAA/欧盟风险，且阻断企业采用）；(3) 与产品定位冲突（PHASE1 已写明「不自研 stealth」，差异化在可观测/成本/升级阶梯，不在 stealth 强度）。

**单一最清晰的 go/no-go**：stealth 规避层 **No-go**；Tier 0 诚实加固 + headed 默认 **Go**。残余缺口（amazon/tiktok/etsy）应通过「分类 + 上报 + 升级到 BYO proxy / 用户登录态」处理，而非 stealth。
