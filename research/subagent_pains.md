# 新增 VOC / 用户痛点研究（Chrome/CDP 只读）

采集日期：2026-08-17（Asia/Shanghai）  
任务范围：Browser Use / 浏览器自动化、批量抓取与提交、登录态、空结果、长任务中断、CAPTCHA/Cloudflare、代理可靠性与成本、文件上传/表单、上下文与 token 爆炸。  
来源数量：10 条（6 个 GitHub Issue、3 个 Reddit 帖子、1 个 X 文章）。  

## 去重与证据边界

- 先与 `research/evidence_ledger.csv` 的旧 S01–S40 URL 比对，以下 10 条均不在旧 40 条中。
- 又与当前工作区已有的 `research/evidence_additions_v3.csv` 交叉检查；该文件已经覆盖 Browser Use #356（Cloudflare CAPTCHA）和 #3046（文件上传），故本文件不重复录入这两条。
- 通过用户指定的 Chrome 连接读取公开页面；使用 CDP/Runtime 只读检查 URL、标题、日期和 DOM。没有登录、输入凭据、上传文件、提交表单、购买服务、接受 CAPTCHA、绕过安全拦截或访问私有数据。
- Reddit 与 X 为页面 DOM 直读，置信度反映“页面证据 + 是否能外推到更广用户群”；单个社区帖子不等于总体成功率。GitHub 页面在本轮 Chrome 访问时间歇性返回 GitHub 的服务错误，因此 GitHub 条目使用 Chrome 可见的 Google 索引标题/摘要，统一标为中置信度，不把摘要当完整 issue 正文。
- 每条“用户/作者原话”均为短摘录，单条不超过 25 个英文词。涉及 CAPTCHA、Cloudflare、代理和批量提交的内容只用于识别痛点与设计合规的人工接管/失败队列，不构成绕过安全控制的操作指南。

## 高信号来源

### P01 — 多任务复用同一个浏览器在第二个任务失败

- **来源类型**：GitHub Issue（Browser Use）
- **日期**：2025-03-19
- **页面标题**：Agent failed if we execute several tasks · Issue #1073
- **URL**：[github.com/browser-use/browser-use/issues/1073](https://github.com/browser-use/browser-use/issues/1073)
- **用户原话短摘录**：`send several tasks one by one using the same browser`（10 words；Chrome 索引摘要）
- **场景**：用户想让同一个浏览器按顺序执行多个任务，但报告称代理在第二个任务就失败。这里的痛点不是“能否打开网页”，而是批处理中的浏览器生命周期、状态污染和失败后如何继续。
- **情绪强度**：4/5（明确阻断批处理，尚未到安全/资金损失级别）
- **主题**：批量/顺序任务、会话生命周期、状态隔离与恢复
- **置信度**：中（标题与摘要可核验；完整正文本轮未能稳定打开）
- **对应产品能力**：持久任务队列；每任务的 session contract（复用或隔离必须显式）；幂等键；任务级 checkpoint/resume；第二任务失败时保留首任务证据并自动隔离污染状态。

### P02 — 截图与窗口调整后出现空结果文件

- **来源类型**：GitHub Issue（Browser Use）
- **日期**：2025-06-26
- **页面标题**：Browser viewport doesn't get restored after screenshot and doesn't readjust when resizing window · Issue #2132
- **URL**：[github.com/browser-use/browser-use/issues/2132](https://github.com/browser-use/browser-use/issues/2132)
- **用户原话短摘录**：`The file system is initialized with an empty results.md file`（10 words；Chrome 索引摘要）
- **场景**：用户看到 `results.md` / `todo.md` 为空，同时 viewport 在截图、滚动或窗口调整后没有恢复；最终无法判断“没有数据”还是“代理没有真正读到页面”。空结果在数据产品里等同于静默失败。
- **情绪强度**：3/5（返工与不确定性高，但摘要未显示直接损失）
- **主题**：空结果、页面可见性、输出契约与可观测性
- **置信度**：中（Chrome 索引摘要可核验；完整正文本轮未能稳定打开）
- **对应产品能力**：非空输出契约；行数/字段完整性校验；截图与 DOM 双证据；viewport/遮挡诊断；空结果自动告警、有限重试和人工复核队列；明确区分“合法零结果”和“执行失败”。

### P03 — 远程浏览器的 CDP 调用可以无限挂起

- **来源类型**：GitHub Issue（Browser Use）
- **日期**：2026-03-31
- **页面标题**：Bug: CDP connection instability causing indefinite hangs with remote browsers · Issue #4579
- **URL**：[github.com/browser-use/browser-use/issues/4579](https://github.com/browser-use/browser-use/issues/4579)
- **用户原话短摘录**：`Individual CDP calls within handlers lack timeouts, causing indefinite hangs with remote browsers`（13 words；Chrome 索引摘要）
- **场景**：远程浏览器的单个 CDP 调用缺少超时，长任务不返回成功、失败或取消状态，只能一直占用 worker 和付费浏览器资源。
- **情绪强度**：4/5（任务挂死、资源持续计费、无人值守流程无法收敛）
- **主题**：长任务中断、CDP 稳定性、超时、取消与资源泄漏
- **置信度**：中（Chrome 索引摘要可核验；完整正文本轮未能稳定打开）
- **对应产品能力**：action/handler 级 deadline；连接 heartbeat；watchdog；可取消的明确状态机；超时后保留 trace 并重连/重启；指数退避；按任务预算硬停止，避免“无限重试”把代理成本变成隐性损失。

### P04 — 多标签切换丢失 CDP session / SSO 登录态

- **来源类型**：GitHub Issue（Browser Use）
- **日期**：2025-09-04
- **页面标题**：Lose CDP Session Id after switching tab · Issue #2955
- **URL**：[github.com/browser-use/browser-use/issues/2955](https://github.com/browser-use/browser-use/issues/2955)
- **用户原话短摘录**：`Lose CDP Session Id after switching tab`（8 words；issue 标题）
- **场景**：用户在多标签操作后丢失 CDP session；Chrome 索引摘要还显示，排查 SSO 时曾花近一天才发现登录标签没有正确设置 cookies。跨标签认证不是一次性的“填用户名密码”，而是 session 传播与复连问题。
- **情绪强度**：5/5（接近一天的排查时间，且登录失败会让整个自动化链路归零）
- **主题**：登录/session、SSO、跨标签状态、CDP 重连
- **置信度**：中（标题和相关摘要可核验；完整正文本轮未能稳定打开）
- **对应产品能力**：session health probe；授权用户的 profile/session 复用；跨标签 auth checkpoint；CDP session reattach；session 失效的原因分类；严禁把明文 cookies/凭据写入普通日志。

### P05 — 20 个任务串行运行时 token 消耗翻倍

- **来源类型**：GitHub Issue（Browser Use）
- **日期**：2025-12-15
- **页面标题**：Bug: Token consumption is 2 times higher! · Issue #3768
- **URL**：[github.com/browser-use/browser-use/issues/3768](https://github.com/browser-use/browser-use/issues/3768)
- **用户原话短摘录**：`Token consumption is 2 times higher!`（6 words；issue 标题）
- **场景**：Chrome 索引摘要提到用户连续运行一组约 20 个任务，并观察到版本间 token 消耗明显上升；相关摘要还把原始/轻解析 DOM 与 token limit 的冲突描述为核心问题。批量抓取的单位成本可能被上下文重复带大，而不是被目标站数量带大。
- **情绪强度**：4/5（成本冲击、上下文压力，可能导致任务中途失败）
- **主题**：上下文/token 爆炸、批量成本、DOM 压缩与任务隔离
- **置信度**：中（标题与摘要可核验；完整正文本轮未能稳定打开）
- **对应产品能力**：DOM/文本结构化压缩；字段优先于整页上下文；每任务 context reset；滚动摘要与去重；token budget/cost meter；模型路由（先用确定性提取，只有歧义才调用更贵模型）；在预算耗尽前安全暂停并可恢复。

### P06 — 代理配置回归导致需要代理的页面无法稳定访问

- **来源类型**：GitHub Issue（Browser Use）
- **日期**：2025-07-14
- **页面标题**：proxy config doesn't work · Issue #2445 · browser-use/browser-use
- **URL**：[github.com/browser-use/browser-use/issues/2445](https://github.com/browser-use/browser-use/issues/2445)
- **用户原话短摘录**：`I am using the browser-use library to operate a web page that needs to be accessed through a proxy.`（19 words；Chrome 索引摘要）
- **场景**：用户的目标页面必须通过代理访问；摘要指出旧版本的 `ProxySettings` 可用，升级后代理配置出现回归。代理费用因此不是单独的采购问题，而是“花钱买了出口却无法完成任务”的成功率问题。
- **情绪强度**：4/5（付费网络资源与任务成功率同时受影响）
- **主题**：代理可靠性、版本回归、出口健康度、单位经济性
- **置信度**：中（标题与摘要可核验；完整正文本轮未能稳定打开）
- **对应产品能力**：proxy preflight（出口、延迟、TLS/目标可达性）；版本 canary；代理池健康分；失败时 failover；按成功任务而不是按请求记录成本；把代理策略、目标站条款和限速放入可审计 policy，不承诺绕过封锁。

### P07 — 300 个不同机构的表单，字段还不一样

- **来源类型**：Reddit（r/automation，公开帖子）
- **日期**：2024-12-02
- **页面标题**：automatically fill out a web forms : r/automation
- **URL**：[reddit.com/r/automation/comments/1h4trhf/automatically_fill_out_a_web_forms](https://www.reddit.com/r/automation/comments/1h4trhf/automatically_fill_out_a_web_forms/)
- **用户原话短摘录**：`I need to submit 300 web forms for 300 different authorities; each authority requests different fields`（16 words）
- **场景**：发帖人要向 300 个不同机构报告 abusive incidents，每个机构字段不同，且都把用户导向站内 ticket。这里的痛点是规模、字段 schema 异构和提交责任同时存在，单纯“批量点击”很容易填错或重复提交。
- **情绪强度**：4/5（数量极大、手工重复且涉及敏感报告）
- **主题**：批量表单、字段映射、敏感提交、审计与幂等
- **置信度**：高（Chrome 直读 Reddit 页面正文与发布时间；仍是单个发帖人的需求）
- **对应产品能力**：表格/JSON 到站点字段 schema 映射；每站点字段 discovery 后人工确认；dry-run/preview；队列与限速；幂等键和重复检测；提交前人审；提交回执、截图、ticket ID 与可追溯 audit log；对 abuse/举报场景默认 human-in-the-loop。

### P08 — 本地 Playwright/Selenium 一扩容或定时运行就开始坏

- **来源类型**：Reddit（r/automation，公开帖子）
- **日期**：2025-11-17
- **页面标题**：Has anyone here automated browser-heavy workflows with cloud tools? : r/automation
- **URL**：[reddit.com/r/automation/comments/1ozoqnq/has_anyone_here_automated_browserheavy_workflows](https://www.reddit.com/r/automation/comments/1ozoqnq/has_anyone_here_automated_browserheavy_workflows/)
- **用户原话短摘录**：`Local scripts with Playwright and Selenium work fine at first, but they start breaking once you scale or try to run them on a schedule.`（25 words）
- **场景**：发帖人询问 Browserless、Browserbase、Hyperbrowser 等云工具，是因为本地脚本初期能用，一旦扩容或按计划运行就开始失效。这个信号直接验证“生产化浏览器基础设施”是付费需求，而不是只缺一个 selector。
- **情绪强度**：4/5（从 demo 到定时生产的迁移失败）
- **主题**：规模化、定时任务、运行时一致性、可观测性
- **置信度**：高（Chrome 直读 Reddit 页面正文与发布时间；市场方案比较带有提问者主观性）
- **对应产品能力**：固定浏览器镜像/版本；队列和 worker；schedule-safe checkpoint；重试与退避；trace/video/console/network 观测；故障按 selector、登录、网络、反爬、资源耗尽分类；提供成功任务率和成本/任务，而不只报“脚本已运行”。

### P09 — 两次点击被拖成 40 分钟，购物车还过期两次

- **来源类型**：Reddit（r/AI_Agents，公开帖子）
- **日期**：2026-08-14
- **页面标题**：my agent spent 40 minutes on a task that takes me 2 clicks.. browser automation is still broken : r/AI_Agents
- **URL**：[reddit.com/r/AI_Agents/comments/1vnydav/my_agent_spent_40_minutes_on_a_task_that_takes_me](https://www.reddit.com/r/AI_Agents/comments/1vnydav/my_agent_spent_40_minutes_on_a_task_that_takes_me/)
- **用户原话短摘录**：`40 minutes later its still stabbing at the seating map like a drunk tourist and the cart expired twice.`（19 words）
- **场景**：发帖人描述一个人类只需两次点击的购票流程，代理在座位图上循环 40 分钟，购物车过期两次；正文还说 CAPTCHA/奇怪 modal 会让代理重复打开同一弹窗 11 次，并提到一次登录流程吃掉大量上下文。它把“长任务、时效性、挑战、循环、token”几个痛点压在同一条用户旅程里。
- **情绪强度**：5/5（时间损失、任务失效、购物车时限与强烈挫败感）
- **置信度**：中高（Chrome 直读正文；单一轶事，不外推为全站成功率）
- **主题**：长任务循环、CAPTCHA/modal、时效性状态、token/context、人工接管
- **对应产品能力**：任务总时限与步骤预算；循环检测（相同 DOM/modal/action fingerprint）；modal/challenge 分类器；cart/session TTL 监控；达到重试预算后硬停；保留上下文和 screenshot 交给人工；挑战页只走站点允许的 API/人工流程，绝不自动破解 CAPTCHA。

### P10 — 生产级 web agent 需要 warm pools、隔离、身份与观测

- **来源类型**：X 文章（公开页面；Browserbase 竞争性观点）
- **日期**：2026-07-21（Chrome 搜索结果显示；X 页面显示 Jul 21）
- **页面标题**：What it actually takes to build agent infrastructure yourself
- **URL**：[x.com/harsehaj/article/2079593790814527998](https://x.com/harsehaj/article/2079593790814527998)
- **作者原话短摘录**：`A web agent needs more than a browser. At scale it needs warm pools, isolation, an identity sites accept.`（19 words）
- **场景**：作者从 Browserbase 的 build-vs-buy 角度强调：规模化不只是启动 Chromium，还需要 warm browser pools、隔离、可被站点接受的身份、session 管理、反爬挑战处理、录制/观测和模型路由。文章还把 idle capacity、录制成本和身份/代理成本放到基础设施经济性里讨论。
- **情绪强度**：3/5（行业级技术与成本压力，非单一用户求助）
- **主题**：竞品/市场验证、浏览器基础设施、身份与代理、观测、单位经济性
- **置信度**：中高（X 页面直读且文章作者身份可见；结论有明显竞品营销偏差）
- **对应产品能力**：session pool 与隔离；合规 identity/profile policy；proxy/egress health；录制和可复现 trace；模型路由；warm-pool 利用率；每成功任务成本、idle 成本和 challenge/失败率仪表盘。它可作为“我们卖的是可收敛的任务执行和失败解释，不是裸浏览器”的竞品定位证据。

## 交叉结论：真正的“痛点”不是抓到页面，而是任务能否收敛

| 重复出现的痛点 | 直接来源 | 产品含义 |
|---|---|---|
| 任务挂死、第二任务失败、循环重开 modal | P01、P03、P08、P09 | 必须有 deadline、watchdog、loop detector、checkpoint 和硬停止；“一直跑”不能被当作成功 |
| 登录态和多标签 session 不可靠 | P04、P08 | 把授权 session 当一等对象管理：健康探针、复连、TTL、原因分类和安全日志 |
| 空结果无法区分“合法零行”与“静默失败” | P02 | 输出必须有非空/完整性契约、证据与告警；不能只返回一个空 Markdown/CSV |
| 批量表单字段异构且提交有责任 | P07 | schema mapper + preview + 人审 + 幂等 + 回执；越敏感的提交越不能默认为无人值守 |
| 代理、warm pool、录制与 token 都会吞单位经济性 | P05、P06、P08、P10 | 用“成功任务成本”管理代理、浏览器和模型预算，并按失败原因路由，而非单纯追求请求量 |
| CAPTCHA/Cloudflare/modal 是状态分支，不是一个可承诺的“绕过按钮” | P09、P10（另见工作区已有 S41） | 产品竞争力应是合规挑战识别、站点允许入口、人工接管、失败解释和可恢复队列；不提供破解或绕过安全机制 |

## 给产品设计的最小闭环

1. **任务契约**：输入 schema、授权范围、目标站 policy、成功条件、最大时长、最大重试和预算先固定。
2. **浏览器执行**：每一步产生可审计事件；session、tab、proxy、DOM snapshot 和输出版本绑定到任务，不把敏感凭据写入普通 trace。
3. **状态判断**：用 post-condition、非空/完整性校验、TTL、循环指纹和 challenge 分类来判断成功/失败/需人工，而不是看最后一个 click 是否返回。
4. **可恢复交付**：成功给结果与证据；失败给原因、最后 checkpoint 和重试建议；需人工时把浏览器状态安全地交给人，而不是继续烧 token、代理和浏览器分钟数。

