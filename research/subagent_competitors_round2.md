# 竞品第三方/用户侧反证扫描（2026-08-17）

## 研究边界

- 本轮只收集公开用户/社区/第三方页面，不重复上一轮官方定价；通过 Chrome 只读读取，未登录、未提交表单、未绕过 CAPTCHA 或付费墙。
- “可支持”只代表该页面能支持的窄事实（某个用户/评论者的报告），不把单帖体验外推成全行业成功率。
- 引用均为短引文；其余内容为页面事实的压缩转述。Reddit 的 old.reddit 页面可直接读取正文，Product Hunt 页面可读取评论摘要与原文。

## 高信号来源

### R01 — Browserbase 10K+ sessions 使用复盘（Reddit）

- **URL**：https://old.reddit.com/r/automation/comments/1sl1um7/browserbase_review_after_running_10k_sessions/
- **日期**：2026-04-14（页面显示 submitted on 14 Apr 2026）
- **来源类型**：community_post / Reddit r/automation
- **短引用**：作者称 Browserbase “bill minimum 1 minute per session even if your task finishes in 8 seconds”。
- **主题**：计费下限、批量经济性、stealth/指纹、登录态稳定性。
- **置信度**：中（用户声称已运行 10K+ sessions，但没有账单、日志或可重复 benchmark）。
- **可支持的结论**：
  - 至少有一名高频用户报告短任务按每会话至少 1 分钟计费，短 scrape 在高数量下会放大成本；其实际应对是把短任务批量塞进同一 session。
  - 该用户主观评价 stealth/fingerprinting 对“多数目标”有效；评论中另有用户报告某个 fintech 站点约 20% 被拦，说明成功率会随目标与指纹检测变化。
  - 用户把 auth、凭据过期、MFA 和 session drop 视为 10K+ sessions 后仍会暴露的运维问题。
- **不能支持的结论**：
  - 不能证明 Browserbase 对所有客户/目标都收取同样的 1 分钟下限、也不能证明 20% 是平台平均拦截率；两者都是用户/评论者的个体报告。
  - 不能由此推导 Browserbase 的整体成功率、SLA、单位成本或相对 Browser Use/Steel 的普遍优势。

### R02 — Browserbase vs Browserless 生产对比（Reddit）

- **URL**：https://old.reddit.com/r/automation/comments/1sfoaf4/browserbase_vs_browserless_which_one_actually/
- **日期**：2026-04-08（页面显示 submitted on 08 Apr 2026）
- **来源类型**：community_post / Reddit r/automation
- **短引用**：作者说长流程 auth “would randomly crap out. DOM changes, timeouts”。
- **主题**：自托管浏览器维护、CDP 断线、长任务可靠性、文档边界。
- **置信度**：中（作者描述约 4 个月 Browserless 与后续 Browserbase 迁移，但没有外部可观测数据）。
- **可支持的结论**：
  - 该用户报告自托管 Browserless 容器会静默退出，需要在夜间处理 CDP 断线；长时间、带 auth 的流程还遇到 DOM 变化和 timeout。
  - 用户迁移后主观上认为 Browserbase 的 Playwright 流程不再“mysteriously die”，但也指出边缘场景文档示例不足，仍需要和支持团队来回沟通。
  - 真实痛点不是“能否启动浏览器”，而是长任务、登录态、资源限制和夜间故障的 on-call 成本。
- **不能支持的结论**：
  - 不能证明 Browserbase 在所有工作负载上优于 Browserless，也不能把一个用户的迁移结果当作 SLA 或故障率 benchmark。
  - 不能据此断言自托管必然不适合生产；缺少资源配置、目标网站、并发和运行时长的控制变量。

### R03 — Browser Use 多站点生产迁移经验（Reddit）

- **URL**：https://old.reddit.com/r/LocalLLaMA/comments/1rm5mkv/anyone_moved_off_browseruse_for_production_web/
- **日期**：2026-03-06（页面显示 submitted on 06 Mar 2026）
- **来源类型**：community_post / Reddit r/LocalLLaMA
- **短引用**：作者报告 “Each site takes 3-5 minutes because the agent does like 25-30 steps”。
- **主题**：agent loop 延迟、token burn、站点特定维护、确定性流程与 AI 定位的混合架构。
- **置信度**：中（用户描述使用数月、覆盖 100+ sites；没有统一脚本或运行日志）。
- **可支持的结论**：
  - 一名用户在 100+ 个网站上使用 Browser Use，报告每站 3–5 分钟、约 25–30 个步骤/LLM 调用，并称每步发送完整 DOM/截图导致 token 消耗高。
  - 用户还报告为各站点维护 behavior config、JS snippets 和导航模式，agent 会随机走偏、卡在免责声明、PDF 页面 timeout。
  - 该用户明确提出的替代方向是“代码控制流程、AI 只处理模糊元素选择”，验证了确定性批处理/重试层是强需求。
- **不能支持的结论**：
  - 不能把 3–5 分钟、25–30 步当成 Browser Use 的平均延迟或固定调用数；模型、网络、站点复杂度和 prompt 均未控制。
  - 不能据此证明 Stagehand、Skyvern 或 Playwright 在同一任务上的成本/成功率更高；评论只是经验建议。

### R04 — Skyvern vs Browser Use 动态表单讨论（Reddit）

- **URL**：https://old.reddit.com/r/AI_Agents/comments/1j8jc38/skyvern_vs_browseruse/
- **日期**：2025-03-11（页面显示 submitted on 11 Mar 2025；页面标记 archived）
- **来源类型**：community_comparison / Reddit r/AI_Agents
- **短引用**：一位用户评价 Skyvern “costs A LOT in term of api use, even with the cheapest models”。
- **主题**：云端 vs 开源能力切分、CAPTCHA/代理、API 成本、工作流颗粒度。
- **置信度**：中（有多位参与者和创始人回复，但不是独立 benchmark；时间较旧）。
- **可支持的结论**：
  - 讨论中一名用户称 Skyvern 灵活且强大，云端版本带 CAPTCHA 支持和代理；另一名用户报告即便使用便宜模型，API 使用成本仍很高。
  - Skyvern 创始人公开说明开源版缺少 CAPTCHA solver 和“human-like” browser，而 2FA 可在开源版使用；这与云端/开源功能分层相吻合。
  - 创始人还解释长 prompt 会降低 agent 可靠性，因此用 workflow engine 把复杂任务拆成更细的 blocks；这是对“单一大 agent loop”痛点的产品侧回应。
- **不能支持的结论**：
  - 不能从单个成本抱怨得出 Skyvern 的实际每任务价格或 API 成本排名；没有 token、模型和任务样本。
  - 创始人对开源/云端边界的说明属于供应商陈述，不能独立证明 CAPTCHA 通过率或“更 robust”的效果。

### R05 — Steel 开源浏览器 API 社区帖（含厂商回复）

- **URL**：https://old.reddit.com/r/opensource/comments/1h1i122/steeldev_an_open_source_browser_api_for_your_ai/
- **日期**：2024-11-27（页面显示 submitted on 27 Nov 2024）
- **来源类型**：community_post / vendor_reply / Reddit r/opensource
- **短引用**：Steel 发帖者回复其测试 “passing about ~93% of the time”。
- **主题**：CAPTCHA 通过率自报、开源/托管差异、session viewer、上下文创建摩擦。
- **置信度**：中低（93% 是疑似厂商发帖者的自报测试值；没有测试集、时间窗口或独立复现）。
- **可支持的结论**：
  - Steel 发帖者称托管版会根据 blocker 路由多个 provider，当前测试 CAPTCHA 约 93% 通过，并列出 ReCAPTCHA v2/v3、HCaptcha、ImageToText 和 AWS WAF。
  - 社区用户认可 session viewer 和可 self-host，但提出 context 必须在 Steel 内部预先设置，相比 Browserbase 的 Live View URL 体验更繁琐。
  - 该帖支持两类痛点同时存在：anti-bot 需要路由/供应商组合，登录态/上下文创建需要更低摩擦的复用界面。
- **不能支持的结论**：
  - 93% 不能视为独立 benchmark 或生产成功率；帖子没有说明 CAPTCHA 样本数、目标分布、重试策略、时间点或成本。
  - 不能由该帖证明 Steel 对所有 CAPTCHA 类型均有同等表现，也不能与 Browserbase/Zyte 的成功率直接比较。

### R06 — Browse AI Product Hunt 用户评价页

- **URL**：https://www.producthunt.com/products/browse-ai/reviews
- **日期**：页面读取 2026-08-17；评论时间在页面显示为约 1 年前和 3 年前
- **来源类型**：third_party_reviews / Product Hunt
- **短引用**：一位用户给出简短判断：“Not really usable”。
- **主题**：复杂流程可靠性、支持响应、易用性与价格/能力权衡。
- **置信度**：中低（页面只有 5 条评论，时间跨度大，且 Product Hunt 评论自选样本偏差明显）。
- **可支持的结论**：
  - Product Hunt 页面显示 Browse AI 评分为 3.0/5、5 reviews；摘要同时提到易用性正向反馈，以及对 customer support 慢、复杂 workflow 可靠性和价格的负面反馈。
  - 一条评论称复杂任务需要较多 customer-service 介入；另一条评论称工具对简单重复任务有效，但步骤遗漏时会出现部分执行；还有评论称支持响应慢但解决问题时有帮助。
  - 这组用户侧信号验证“简单任务易用 ≠ 复杂批量流程可独立维护”的分化痛点。
- **不能支持的结论**：
  - 不能把 3.0/5 或评论中的支持/可靠性抱怨外推为 Browse AI 全体客户满意度、失败率或当前版本表现；评论时间并不统一且样本只有 5 条。
  - 不能据此证明任何具体价格、代理、CAPTCHA 或监测配额；这些需要回到官方当前页面或可审计账单。

## 未纳入样本的访问限制

- Browser Use 的 GitHub Issue 结果可在 Google 索引页看到标题/日期，但直接打开 GitHub 时返回暂时无服务器响应；没有把搜索摘要当成完整 issue 正文证据。
- Browse AI 的 G2 页面正文为空、Trustpilot 触发连接验证；Axiom 的 Capterra 页面进入 Cloudflare challenge，Axiom Product Hunt 仅显示 2 条评分而没有评论正文。为保持“高信号”门槛，本轮不把这些页面写成事实来源，也没有尝试绕过验证。

## 反证总结（推论）

1. **“稳定”不等于“单次成功”**（高置信推论）：用户反复抱怨的是长任务、auth/MFA、DOM 变化、CDP 断线、PDF/免责声明和夜间 on-call；产品需要会话恢复、步骤级日志、失败重跑和人工接管，而不只是一次性抓取成功。
2. **短任务的批量成本会被会话计费放大**（中高置信推论）：Browserbase 用户明确报告 1 分钟计费下限并自行批处理；Browser Use 用户则报告 agent steps/LLM calls 与 token burn。两者共同指向“按任务拆分”会产生隐性成本，需要 batch planner、预算预估和确定性执行层。
3. **成功率数字必须带测试边界**（高置信推论）：Steel 的约 93% 和 Reddit 对某 fintech 站点约 20% 被拦都是单点自报，说明任何竞品对比都应同时记录目标站点、挑战类型、会话数、重试和时间窗口，不能只展示一个百分比。
