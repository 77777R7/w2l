# 产品方案 V2：核查修正后的落地计划

更新日期：2026-08-17
前置文档：[PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md)、[research/market_validation_root_branch_model.md](research/market_validation_root_branch_model.md)
本文档基于对上一轮评审中六项质疑的逐条事实核查，给出修正后的战略与可执行计划。

---

## 1. 六项质疑的核查结论

| # | 质疑 | 结论 | 关键证据 |
| --- | --- | --- | --- |
| 1 | "开源爬虫无法商业化"（以 Crawl4AI 为反例） | **被反驳** | Crawl4AI 已获 Peak XV 投资，正在推出 Crawl4AI Cloud 企业版；月下载量 100 万+。原反例不成立 |
| 2 | "独立开发者 LTV 低、不付费" | **被反驳（有条件）** | Plausible 自举做到 $3.1M ARR、1.2 万付费订阅（$9-14/月）；Fathom 估计 $5-10M ARR。indie dev 会付费，但付费的是**固定低价、消除麻烦**的订阅，不是 usage credits |
| 3 | "批量目录提交对 SEO 无效" | **成立** | 2025-2026 共识：批量自动提交低价值且有风险，有效的是少数高质量利基目录和 Launch 平台；ListingBott 定价 $499+，卖点已转向 DR 保证而非流量，目标客户是有融资的团队而非 indie |
| 4 | "自建 Session 池成本被低估" | **成立** | Browserbase 2025 年 $40M B 轮、$300M 估值、$3M+ 收入——托管浏览器已是资本化的专业市场，自建等于和融资 $67.5M 的公司比拼基础设施 |
| 5 | "Context Budget 空位已被补上" | **大部分成立** | Firecrawl 有 token-saving 模式（宣称比原始 HTML 少 93% token）；Crawl4AI 有 fit_markdown、BM25 过滤、pruning。单点能力已不稀缺 |
| 6 | "Firecrawl 自托管与云版差距" | **成立且是结构性的** | 独立评测确认：anti-bot 层（fire-engine）、代理轮换、dashboard、Agent 均不在开源版中。且这个差距是 Firecrawl 商业模式的必然——云版必须比自托管强，否则收入崩塌 |

### 核查改变了什么

**坏消息：** 赛道比原评审假设的更拥挤且资本化更快。Firecrawl 2025 年 8 月完成 $14.5M A 轮（Nexus 领投，YC、Tobias Lütke 跟投，35 万开发者）；Crawl4AI 拿了 Peak XV 的钱在做 Cloud；Browserbase 拿了 $67.5M。"轻量做一个开源爬虫慢慢长"的窗口正在关闭。

**好消息：** 两个原来判断为弱点的方向被证据强化了——

1. **indie dev 付费模式已被 Plausible 验证**：不是按量计费的基础设施定价，而是"固定低价 + 消除一类麻烦"的订阅。这直接指导我们的定价设计。
2. **Firecrawl 的自托管差距是它不能修的**。它的收入依赖云版强于开源版，所以 anti-bot、代理、可观测永远不会完整下放到自托管。一个**商业模式不依赖阉割自托管版**的挑战者，拥有对方无法跟进的结构性位置。这是唯一一个"对手加几个参数也抄不走"的差异化。

---

## 2. 修正后的核心定位

> **自托管版拥有完整的引擎、可观测性和控制面——没有阉割版功能门。**
> 反爬能力是可插拔的：接任意 provider，或用你自己的登录态和出口，成本与成功率全程可见。
> 收费的是省心（托管、调度、控制面板），不是能力。

一句话对比：Firecrawl 的 fire-engine 是绑死的黑盒、只在云上、你看不到成本也搬不走；我们这层是开放可换的。

> 注：反爬的能力边界和执行阶梯见 [PHASE1_ENGINEERING_NOTES.md §2.5](PHASE1_ENGINEERING_NOTES.md)。核心结论——阶梯在架构上完整开源、无付费闸门，但最硬的档位（Cloudflare Enterprise 级）必然依赖用户自带凭据或出口，这是物理限制而非工程投入问题。对外不得claim"解决反爬"。

### 为什么这个位置可防御

- Firecrawl / Crawl4AI Cloud **跟进即自杀**：把 anti-bot 和完整可观测下放开源版，等于摧毁自己的云收入。
- Apify 不会跟进：它的整个体系是围绕托管执行计费的。
- 该位置直接命中已核实的用户痛点：自托管 "zero visibility"、云版与自托管结果不一致、credits 过期、突发用量。
- 类比先例：Plausible 对 Google Analytics 的打法——不是功能更多，而是模式更干净（隐私 vs 监控）；我们对 Firecrawl——不是功能更多，而是模式更干净（全功能自托管 vs 阉割版引流）。

### 放弃的定位

- ~~"完全免费的 Firecrawl 平替"~~ —— 免费不是差异化（原文档已承认）。
- ~~"Context Budget 一等能力"作为主打~~ —— 竞品已有单点能力，降级为工程质量项而非营销主张。
- ~~永久 Firecrawl 兼容层~~ —— 降级为一次性"迁移垫片"（见 §4.6）。

---

## 3. Phase 1 收窄：12 周可交付范围

原 Phase 1 清单约等于 6-12 个月的完整产品。以下按"1-2 人、12 周、每一项都可验收"重新切分。

### 做（In）

| 模块 | 范围 | 明确边界 |
| --- | --- | --- |
| 抓取 | `scrape` + `crawl` | `map` 推迟到 1b |
| 执行通道 | **两条**：HTTP（默认）+ Playwright/Chromium | 本地 CDP 连接属于 Playwright 通道的配置项，不算独立通道 |
| Session | **不自建 Session 池**。提供 Provider Adapter 接口，首发适配 Browserbase 和 Steel（各 $20/月起，让专业公司解决专业问题） | 持久 Session 池永久移出自研范围 |
| 输出 | Markdown、JSON、links、metadata | HTML 原文作为 artifact 保留，不做格式承诺 |
| Context | `maxTokens` 截断（主内容优先策略）+ include/exclude selectors + heading 切块 | **不做语义压缩**（那是研究问题，见 §4.4） |
| 可观测 | **这是产品身份，不是功能**：每请求 lane trace、失败四分类（blocked / empty / timeout / error）、每成功页成本、token 计数 | 从第一个 commit 开始就有，不是后补 |
| 恢复 | 单机 checkpoint，URL 粒度，SQLite 存储 | 分布式恢复不做；架构决策见 §4.3 |
| 接口 | REST API + CLI + TypeScript SDK + MCP server | Python SDK 推迟到 1b（MCP 保留：REST 之上的薄封装，成本低、分发价值高） |
| 迁移 | Firecrawl `/scrape` `/crawl` 请求/响应兼容垫片，**钉死在当前 API 快照** | 见 §4.6 |

### 不做（Out，写下来防止范围回流）

- 多个垂直分支（不变）
- `map`、Python SDK、可视化 Workflow（1b/2）
- 自建代理池、自建 anti-bot（永久 BYO / Adapter）
- 语义级 Context 压缩
- Marketplace、团队权限、白标
- **SEO 分支的任何代码**（原因见 §5）

### 1b（第 13-20 周，视 Phase 1 验证结果启动）

`map`、Python SDK、定时调度、托管版 alpha（Plausible 式定价：固定月费 + 不过期用量池）。

---

## 4. 技术架构决策记录（回答评审提出的全部硬问题）

### 4.1 通道升级逻辑（HTTP → Browser 什么时候升）

- **默认静态规则起步**：HTTP 抓取后做三个廉价检测——正文 token 数低于阈值、`<noscript>`/skeleton 标记、已知 SPA 框架指纹。命中任一则升级 Browser 并**记录升级原因**。
- **每一次升级决策都落库**（URL 模式、触发规则、升级后是否真的改善了结果）。这份"升级决策语料"随使用量增长，是少数真正随时间加深的护城河——Firecrawl 的规则是它踩坑攒的，我们的语料公开积累。
- 用户可显式指定 `lane: http | browser | auto`，`auto` 是默认。

### 4.2 重试语义

- 只对 GET 语义的抓取自动重试；任何带副作用的操作（Phase 2 的表单提交等）默认不自动重放，必须显式 opt-in 且带幂等键。
- 重试策略按失败分类区分：`timeout` 指数退避重试、`blocked` 换通道/换 Provider 重试一次、`empty` 升级通道重试一次、`error(4xx)` 不重试。

### 4.3 Checkpoint 架构（现在决定，避免日后重写）

- **状态存储**：SQLite 单文件，随任务目录走。零部署依赖，符合 local-first。需要远程持久化的用户用 Litestream 同步，不是我们的问题。
- **数据模型从第一天就是 `task → attempt → step`** 三层（这是 research 文档 §4 空位五的 Workflow Contract 的最小实现），即使 Phase 1 只用到其中一部分。分支复用的是这个 schema，不是具体代码。
- **粒度**：URL 级。页面内部分块解析失败就整页重来——块级 checkpoint 的复杂度收益比在 Phase 1 为负。
- **恢复时内容已变化**：checkpoint 记录内容 hash；resume 默认重新抓取，`--use-cached` 显式选择用旧数据。默认行为偏向正确性而非省钱，并在输出里标注哪些页面来自缓存。

### 4.4 Context 处理的三档拆分

| 档 | 做法 | Phase |
| --- | --- | --- |
| Token 预算 | 主内容优先截断：正文 > headings 结构 > 导航/页脚永远最先丢；截断处输出 `truncated_at` 标记 | 1 |
| Chunking | heading 边界切块 + token 上限 + 可选 overlap；每块带源 URL 和 DOM 路径（evidence map 的最小形态） | 1 |
| 语义压缩 | 需要 LLM call，延迟和成本形态完全不同 | 不做，除非付费用户明确要求，届时作为托管版功能 |

### 4.5 BYO Provider 的支持边界

BYO 是承诺，但支持责任要划清：benchmark 和成功率承诺**只针对官方适配的 Provider 组合**（首发：本地 Playwright、Browserbase、Steel）。用户接入其他 Provider 时，trace 会标注 "unverified provider"，issue 模板区分"runtime bug"和"provider 行为差异"。这把"是你的问题还是 Provider 的问题"的支持黑洞在机制上封住。

### 4.6 Firecrawl 兼容垫片（不是兼容层）

- 钉死在写代码当天的 Firecrawl API 快照，只覆盖 `/scrape` 和 `/crawl` 的请求/响应主路径。
- 定位为**一次性迁移工具**：帮用户把现有代码指过来跑通，之后引导迁移到原生 API。文档明确维护一份"已知行为差异清单"，不承诺永久追平。
- 不追 Firecrawl 的新 endpoint（Search/Interact/Agent/Monitor）。它 A 轮后功能迭代只会更快，追赶是给对方免费打工。

### 4.7 成本透明 vs 托管毛利的矛盾（原评审指出的内在冲突）

正面接受这个矛盾，用 Plausible 的答案解决：**托管版不按底层成本加价卖，按"你不用运维"定固定价**。用户当然知道 $19/月的托管版底层成本可能只要 $4——Plausible 用户也知道自托管一台 VPS 只要 $5，照样 1.2 万人付钱。买的是不操心，不是算力差价。托管版展示成本明细反而强化信任："你随时可以搬走自己跑，我们不锁你。"

---

## 5. SEO 分支：从"承诺"降级为"待验证假设"

核查结论是明确的：**批量自动目录提交这条价值链在 2025-2026 的 Google 算法下不成立**。ListingBott 活着，但它 (a) 定价 $499+ 服务的是有融资的团队，(b) 卖点已经从流量退到 DR 数字保证。把整个 Phase 2 押在这条链上，等于卖一个用户复购时会发现没效果的东西。

修正：

1. **从计划中删除"SEO 是第二阶段"的承诺**。Phase 2 的内容由 Phase 1 开源用户的真实行为决定（research 文档阶段 2 本来就是这么写的——这次真的执行，不预设答案）。
2. 保留有效的部分作为假设：核查显示**利基 Launch 平台匹配**（indie B2B → Smol Launch/Indie Hackers，AI 产品 → There's An AI For That）和 **Pain Mining**（从真实用户讨论提炼定位）仍有价值。若数据支持，分支形态应是"渠道情报 + 内容生成 + 人工确认提交到少数高价值渠道 + 结果追踪"，卖洞察和结果验证，**不卖提交数量**。
3. 结果追踪的三个外部依赖（GSC OAuth、GA4 集成、转化埋点）各是独立集成工程，进入分支排期时单独列项估工，不再隐藏在一行 feature 里。

---

## 6. 里程碑与终止条件

### 第 1-4 周
统一 runtime 骨架（task/attempt/step schema + SQLite checkpoint）、HTTP lane、Markdown 管线、失败四分类、CLI。
**验收**：100 页公开测试集上 `scrape` 成功率与失败解释率可量化。

### 第 5-8 周
Playwright lane + 升级规则、Browserbase/Steel Adapter、`crawl` + resume、REST API + TS SDK。
**验收**：一次 1000 页 crawl 断电后能续跑；每页成本和 lane 决策在 trace 里可查。

### 第 9-12 周
MCP server、Firecrawl 迁移垫片、benchmark 报告（对比 Firecrawl 自托管版和 Crawl4AI：成功率/噪声/token/延迟/每成功页成本/假成功率）、迁移型落地页、找 20 名真实用户（沿用 research 文档第 3-4 周方案）。

### 继续/终止门槛（沿用 research 文档 §7 并加两条）

原有六条不变（10/20 完成首抓、5 人两周内复跑、5 人迁移真实任务、3 人明确付费意愿、benchmark 至少一项明显领先、失败可分类解释），新增：

- **benchmark 必须包含"自托管 Firecrawl"作为对照组**，而不是只比云版——我们的定位打的就是这个差距，赢不了它就没有故事；
- 付费意愿访谈必须区分"愿意为托管付固定月费"和"愿意为用量付费"两类回答，验证 Plausible 式定价假设。

任一门槛不过：不进任何分支，回到更窄场景重找切口。

---

## 7. 本轮核查来源

| 主题 | 来源 |
| --- | --- |
| Crawl4AI 商业化 | [Crawl4AI GitHub](https://github.com/unclecode/crawl4AI)、[MISSION.md](https://github.com/unclecode/crawl4ai/blob/main/MISSION.md)、[unclecode.com](https://www.unclecode.com/)（Peak XV backing、Crawl4AI Cloud） |
| Firecrawl 融资/收入 | [Series A 公告 (GlobeNewswire, 2025-08-19)](https://www.globenewswire.com/news-release/2025/08/19/3135573/0/en/firecrawl-announces-14-5-million-in-series-a-funding-to-put-web-data-on-tap-for-ai-agents.html)、[Latka ARR 估计](https://getlatka.com/companies/firecrawl.dev) |
| Firecrawl 自托管差距 | [官方 self-host 文档](https://docs.firecrawl.dev/contributing/self-host)、[Thunderbit 独立评测](https://thunderbit.com/blog/firecrawl-review) |
| 目录提交有效性 | [Mottek Group: Directory Submission in 2026](https://mottekgroup.com/blogs/directory-submission/)、[vawebseo: 提交软件利弊](https://www.vawebseo.com/seo-directory-submission-software-in-2025-pros-and-cons/)、[ListingBott 评测 (ColdIQ)](https://coldiq.com/tools/listingbott)、[startupa.ge 目录榜单](https://startupa.ge/blog/best-startup-directories-launch) |
| 浏览器基础设施市场 | [Sacra: Browserbase](https://sacra.com/c/browserbase/)（$40M B 轮、$300M 估值、$3M+ 收入）、[Respan: Browserbase vs Steel](https://www.respan.ai/market-map/compare/browserbase-vs-steel) |
| indie dev 付费能力 | [Plausible: $1M ARR 复盘](https://plausible.io/blog/open-source-saas)、[Latka: Plausible $3.1M ARR](https://getlatka.com/companies/plausible-analytics)、[Founder Ventures: 自举 vs 融资分析](https://founderventures.io/analysis/analytics) |
| Context 能力现状 | [Capsolver: Crawl4AI vs Firecrawl 2026](https://www.capsolver.com/blog/AI/crawl4ai-vs-firecrawl)、[ScrapingBee: Crawl4AI 指南](https://www.scrapingbee.com/blog/crawl4ai/) |
