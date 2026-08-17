# 批量提交与市场验证研究（增量来源）

检索日期：2026-08-17（Asia/Shanghai）  
研究范围：批量提交、目录收录、SEO backlink、listings 管理、表单自动化与竞品定价。  
旧源边界：已逐条用 rg -F 与 research/evidence_ledger.csv 的 S01–S40 URL 比对；下列核心 10 个 URL 均不在旧 40 源中。

## 方法与证据边界

- 使用用户指定的 Chrome 连接读取公开页面；通过页面 DOM 读取正文，并用 CDP 的只读 Runtime.evaluate 校验当前页面标题、URL 和链接数量（Browse AI 定价页：Pricing - Browse AI、107 个链接）。
- 没有登录、输入邮箱/密码、上传文件、提交表单、购买服务、发布评论、接受 CAPTCHA 或绕过安全拦截；本研究只观察产品承诺、定价、社区原话和公开页面状态。
- 官方产品页/定价页能证明“供应商声称提供什么、如何收费”，不能单独证明成功率、真实索引率、真实流量或客户留存；这些信号在表中标为“供应商自宣”。
- Reddit、Indie Hackers 的用户和评论能验证痛点语言，但社区样本偏向技术/创业者，且有些帖子可能是竞品获客或“build in public”营销；涉及效果的数字全部保留来源归因，不当作独立审计。
- 与反爬相关的结论只做产品风险和合规设计判断：不把 CAPTCHA、代理、登录态当成可以无条件绕过的手段。应优先使用目标站允许的 API/提交入口、用户授权的登录态、限速、人工接管和可审计的失败队列。

## 核心 10 个新增来源

| ID | 来源与日期 | 类型 | 定量信号 | 主要证据/置信度 |
|---|---|---|---|---|
| B01 | [SubmitSaaS pricing](https://submitsaas.com/pricing)；2026-08-17 读取 | 官方定价/服务页 | $60/60+、$100/100+、$140/140+；48 小时；宣传节省 12/20/28 小时 | 价格、套餐内容、交付承诺为高置信；节省时长、backlink/traffic 效果为供应商自宣 |
| B02 | [SubmitSaaS FAQs](https://submitsaas.com/faqs)；2026-08-17 读取 | 官方 FAQ/运营流程 | 140+ 目录/48 小时；审批可能即时到数月；报告是 Google Sheet + 截图 | 运营约束为高置信；“DR guaranteed/效果”仍是供应商承诺 |
| B03 | [ListingBott](https://listingbott.com/)；2026-08-17 读取 | 官方产品/定价页 | 10,000+ 目录库；100 个 hand-picked listings；$299/$399/$499/$999；交付 1 个月；自报 1,000+ founders | 定价、流程和产品能力为高置信；DR/traffic/用户数为供应商自宣 |
| B04 | [Reddit：How I killed listingbott](https://www.reddit.com/r/SaaS/comments/1lc5yck/how_i_killed_listingbott_by_johnrushx_in_6_months/)；Reddit 显示约 1 年前 | 社区批评帖/竞品对比 | 发帖人称 17 个 listing 中 9 个未索引、2 个论坛标记域名；评论称质量站点通常登录且字段 schema 不同 | 独立评论中的“登录、schema、安全、透明度”痛点为中置信；发帖人自身 $187/200+、$720 MRR、870 founders 等数字疑似竞争营销 |
| B05 | [Indie Hackers：300+ Software submission directories](https://www.indiehackers.com/post/i-made-a-list-of-300-software-submission-directories-to-submit-your-saas-38b080943a)；2024-08-04 | 社区资源帖/服务销售页 | 1,743+ places；300+ 目录；自称 DA 40+、13m 月流量；案例称 21k/mo、44.018% referral、3.6k backlinks/405 referring domains、19.5k/mo traffic growth、12% organic growth | 10 likes/12 comments 和真实需求可作中置信市场信号；所有效果数字是作者自报，不能当作验证 |
| B06 | [Indie Hackers：93 directories/catalogues/newsletters](https://www.indiehackers.com/post/where-to-submit-your-saas-or-ai-tool-the-list-of-93-directories-catalogues-and-newsletter-websites-9a86fd8fef)；2024-10-22 | 社区目录清单/评论 | 93 个目录，按 SEMrush 排名和价格排序；17 likes/40 comments；评论认为约 30%+ 目录有 bot protection，且每个表单字段略有不同 | “字段异构 + bot protection + 需按权威/价格筛选”有多条评论支撑，中高置信；SEO 价值仍有争议 |
| B07 | [Indie Hackers：Most directories forget you exist](https://www.indiehackers.com/post/most-directories-forget-you-exist-after-you-list-were-trying-something-different-1471d96402)；2026-08-14 | 最新社区/目录运营实验 | 运营者自报 8 个月、1,000+ products、22 likes/31 comments、首批 Slack <50 人；评论称多数目录只给一次流量、随后 listing 被埋 | “一次性 listing 后失联/无流量、需要更新与反馈闭环”由多个评论重复，中置信；1,000+ 产品数是运营者自报 |
| B08 | [BacklinkBot homepage](https://backlinkbot.ai/)；2026-08-17 读取 | 官方产品/定价页 | Agent $99/月、7 天试用；done-for-you $99 一次起（另有 $167/$357）；1,287 目录；自报 28,650 links、平均 +19 DR、73% followed、150+ startups | 定价、人工/agent 双路线和验证设计为高置信；客户结果和 link 数为供应商自宣 |
| B09 | [BacklinkBot directory submission service](https://backlinkbot.ai/directory-submission-service)；2026-08-17 读取 | 官方手工服务页 | 100/200/300+ 目录；$99/$167/$357；宣传节省 15–20 小时；1,287+ 数据库；85+ directories/29 at DR50+/45 dofollow 的报告示例 | 价格与“人工逐表单 + live proof”高置信；DR/traffic 增长案例属于供应商自宣 |
| B10 | [Bardeen pricing](https://www.bardeen.ai/pricing)；2026-08-17 读取 | 官方自动化/抓取定价页 | Basic $10/月 +100 credits；Premium $50/月 +1,000 credits；每行 scraper/search/AI action 通常 1 credit，enrichment 3；企业可定制并维护 customer scrapers | 价格、credit 规则和维护服务为高置信；客户故事的 60h/周、15h/周等为供应商自报 |

## 逐源证据与产品启示

### B01 — SubmitSaaS：付费需求已经被“省时间 + 交付报告”包装

页面给出三档一次性服务：$60 提交 60+ 目录、$100 提交 100+、$140 提交 140+；每档都包含 complete submission report，明确说 paid directories 不包含，并承诺 48-hour turnaround。页面还把“Save over 12/20/28 hours”作为卖点，并展示“DR 从 3.2 到 17”“50–100 visits/day”等客户/社交证明。

这证明至少存在可支付的“代做批量提交”需求，而且市场购买的不是一个裸的 autofill 脚本，而是：

1. 按目录数分档的明确价格；
2. 有交付时间；
3. 有报告/截图；
4. 用户不用自己处理几十到上百个异构表单。

但页面没有给出分母：例如 140 个中多少实际 approved/live、多少在 7/30 天后仍可访问、多少产生 referral traffic。因此产品不应复制“目录数量 = 结果”的话术，而应把 approved/live/indexed 分开计数。

### B02 — SubmitSaaS FAQ：真正的运营难点是身份、审批状态和可追溯性

FAQ 展开后出现一组很重要的细节：

- 用专门邮箱处理目录注册和 confirmation loops，交付时把该邮箱凭据交给客户；客户也可提供自己的账号凭据。
- listing 通常归客户所有，可后续编辑；但只支持 Google Sign-In 的少数目录会使用服务商自己的 Google 账号，这是明确的所有权/可迁移性例外。
- 服务商声称使用“smart automation + human review”，140+ 提交在 48 小时内完成。
- 报告记录在 Google Sheet，附 detailed reports 和 verification screenshots。
- FAQ 明确说“不提供 approved submissions list”；原因是不同目录审核时间从几天、几周到几个月，追踪困难。
- 结果可能需要约 3 周才出现，审批时间甚至可能到数月。

这组证据直接指出一个可切入的“非常痛”的缺口：付费用户最怕的不是第一遍把字段填进去，而是提交后不知道“到底活了没有、谁拥有账号、什么时候要补确认、哪个目录永久丢失”。因此应优先做身份隔离、站点级授权、审批状态、live-link 检查和提醒，而不是先追求更高的并发。

### B03 — ListingBott：高价路线出售“精选 + 人工节奏 + 可控目标”

ListingBott 的产品页把自身与简单 bulk blast 区分开：

- 数据库超过 10,000 个 sites/directories/forums，并声称每天更新；
- 根据客户 onboarding form 和主要目标，在“DR boost”和“potential click traffic”之间选择，再 handpick 100 个相关目录；
- 套餐价格显示从 beta 用户 $299/$399/$499，之后 $999；
- 服务交付写成 1 month、human pace、full report、客户拥有 listings，客户可以 moderate（approve/decline）候选目录；
- 产品页自报“1,000+ startup founders used ListingBott”，并列出 Capterra、Product Hunt、SaaSworthy、GetApp、Software Advice、Futurepedia 等目录的 DR/traffic 示例。

市场启示是：较高客单价并不只卖“提交 100 个”，而是在卖筛选、节奏、人工审核和目标函数。可以把产品拆成“目录质量评分 + 目标选择（authority / qualified traffic / category coverage）+ 人工确认队列”，让客户拒绝明显低质站点。

### B04 — Reddit：不索引、错误表单、隐私和透明度会摧毁信任

发帖人自称支付 ListingBott 后得到 17 个 listing，其中 9 个没有索引，2 个论坛把域名标记为 spam；这些数字属于单一竞争性帖子，不能作为总体失败率。

更值得保留的是评论中的具体机制性痛点：

- 质量站点（评论者以 DR>30 为例）往往藏在登录后；
- 没有两个表单共享同一 data schema，自动填充需要维护每个站点的字段映射；
- 代表他人提交时涉及共享邮箱/密码的安全问题；
- 服务商隐藏完整目录清单会让客户怀疑“100+ links”是否只是低质量站；
- 另一个评论明确说支持/售后无响应，且 backlink 没有正确完成。

这比“AI 能自动填表”更接近真实产品需求：要有站点 schema 版本、凭据边界、可复核目录清单、失败原因、索引监测和人工升级，而不是只给一个 success toast。

### B05 — Indie Hackers 300+ 清单：有需求，但效果数字需要独立验证

作者同时发布免费资源和付费提交服务，声称：

- 1,743+ promotion places；
- 300+ AI/SaaS sites；
- DA 40+、13m+ monthly traffic；
- 报告包含 screenshots + live links。

作者列出三个成功故事：Stunning 21k visitors/month 且 44.018% traffic 来自被提交的网站；Dubverse 3.6k+ backlinks、405 referring domains、6.3k keywords、近 6 个月 traffic growth 19.5k+/month；Bonjoro 在约一个月后 organic traffic +12%。页面为 2024-08-04，只有 10 likes/12 comments，且这些数字没有 GSC/GA/Ahrefs 原始证据。

可用的验证结论不是“300 个目录能带来 200 个付费用户”，而是市场确实反复要求“目录清单 + 价格/权威筛选 + submission report + live links”。如果做产品，应把每个 case 的数据源和时间窗做成可复核字段，避免把 referral、organic、backlink、indexed 混为一谈。

### B06 — Indie Hackers 93 清单：表单异构和 bot protection 是可量化的工程假设

作者维护 93 个 free/freemium/paid 目录，并按 SEMrush ranking 和 pricing 排序；帖子有 17 likes、40 comments。评论中出现三个关键原话/信号：

- 有人希望一个统一提交入口；
- 作者回复估计约 30% 或更多目录受到 bot protection；
- 每个目录有略有不同的字段，需要“wise”填充；
- 作者自己说明制作清单用了 ChatGPT、screenshot API 和 manual labour；
- 另一条评论指出很多 listing sites 只是互相链接，目录的真实价值值得怀疑。

这个来源把“批量提交”拆成两个不同问题：第一是表单执行，第二是目录选择。单纯增加 robot 并不能解决第二个问题；产品应先用质量/相关性/索引/审批速度做筛选，再对少量高价值站点进行可审计提交。

### B07 — Indie Hackers 2026：listing 的后续维护比第一次上架更有机会

2026-08-14 的帖子来自 SoftRankings 运营者：产品运行约 8 个月，已有 1,000+ products listed；作者坦承“listing 后几乎没有关系”，因此准备邀请已上架 founder 进入一个少于 50 人的 Slack group。帖子有 22 likes、31 comments。

多个评论重复同一痛点：

- 目录往往只在首日给一个小流量 spike，之后 listing 被埋；
- 小众目录带来的 qualified traffic 可能比十个通用 startup list 更好；
- 目录页面需要 last verified、变更记录和 founder 回访；
- 运营者应按 Search Console 拆分 1,000 个 listing，检查是否真的有 organic entrances；
- 价值指标应从“加入多少人”转向 week-one 后 qualified visit、referral clicks、listing updates 和 buying recommendations。

这是对 listings management 的直接市场验证：机会不只在“帮我提交一次”，还在持续验证、更新、重排和按真实流量反馈修正目录组合。一个有 re-verification、变化检测、流量归因和提醒的产品，会比一次性 backlink service 更容易形成订阅价值。

### B08 — BacklinkBot：agent 与人工服务的双路线

主页把两条路线并列：

- Agent：7 天试用，$99/月；读取站点、找已排名页面、找编辑/负责人、写 page-specific pitch、等待客户 approve，再发送和 follow-up；
- Done-for-you：一次性 $99 起，另有 $167/$357，按 100/200/300 个目录由人工提交。

目录数据库页称有 1,287 个目录；主页自报 28,650 backlinks earned、平均 +19 DR、73% followed、150+ startups。更有产品价值的细节是：每个目标页有评分理由，联系人先做 deliverability check，Reddit/Quora 只起草不自动发布，live link 会按计划重新抓取；“无法确定存在的 link 不计入”。

这说明竞争点已从“自动发出去”升级为“选择 + 审批 + 验证”。即使数字是供应商自宣，产品结构本身值得借鉴：把 outbound editorial link 与 directory listing 分开计量，把“draft / approved / sent / replied / live / removed”分成状态，而不是一条 submitted=true。

### B09 — BacklinkBot 手工服务：价格买的是“人工通过异构表单”

该服务页把核心承诺写成“100% manual — submitted by a human”，并宣传：

- 跳过 15–20 小时表单填写；
- 人工阅读每个目录规则、选择 category、写 description；
- 从 1,287+ 数据库按 niche handpick，而不是对所有客户发送同一列表；
- 100/200/300+ 目录，价格 $99/$167/$357；
- 每次提交附 URL、status 和 live proof；
- 页面示例显示 85+ directories、29 个 DR50+、45 个 dofollow opportunities。

页面还写到“real person fills out every form — gradually”，说明其真正的 anti-bot 设计不是更激进的绕过，而是降低自动化模式、控制节奏、人工处理规则和失败。对我们的产品启示是：自动化应放在数据准备、字段映射、队列和验证；在登录、验证码、站点规则或高风险发布动作处进入用户授权的人工 checkpoint。

### B10 — Bardeen：横向自动化的计量单位是 credits，维护本身可售

Bardeen 的官网把 GTM 自动化和 customer scrapers 结合起来：

- Basic $10/月，+100 credits；
- Premium $50/月，+1,000 credits；
- Enterprise 按年定制 bulk credits，并明确写“we build customer scrapers / we maintain customer scrapers”；
- scraper/search/AI tools 通常按行或动作消耗 1 credit，enrichment 每行 3 credits；导入、导出和 utilities 免费；
- 页面案例自报每周省 60 小时、15 小时、每个 web-scraping task 省 5 小时等。

这个价格结构适合作为横向竞品参照：用户愿意为额度、集成和维护买单，但 credits 也会制造计量焦虑。批量提交产品应该在运行前给出预计站点数、每站点会话/人工接管成本、失败重跑成本和剩余额度，而不是在跑完后才告知“超额”。

## 交叉验证：真实痛点 vs 供应商自宣

| 主题 | 供应商自宣 | 社区/用户证据 | 当前判断 |
|---|---|---|---|
| 时间痛苦 | SubmitSaaS 宣传节省 12–28 小时；BacklinkBot 宣传 15–20 小时；ListingBott 宣传 60 小时 | Reddit 质疑帖直接讨论 100+ 表单、登录、schema；IH 讨论统一提交入口和 30%+ bot protection | **高置信痛点，中置信具体耗时**；需要用真实 dry-run/canary 记录中位数和尾部 |
| 批量成功率 | SubmitSaaS 48 小时；BacklinkBot 100% hand / 100+ reports | Reddit 单帖 17 中 9 未索引、2 被标记；评论称支持不响应 | **失败不是提交按钮问题，而是 approval/index/support 闭环问题**；总体失败率未知 |
| 质量而非数量 | ListingBott handpick 100；BacklinkBot 按 niche、DR、dofollow 选择 | IH 评论称小众目录比通用目录更能带来 qualified traffic；很多站只是互相 backlink | **高价值目录筛选是核心**，不能用 directory count 代替 outcome |
| 审计和归属 | SubmitSaaS Google Sheet/截图；BacklinkBot live proof；ListingBott full report/ownership | Reddit 质疑隐藏目录清单、共享账号和“链接到底活不活” | **高置信产品要求**：证据、所有权、站点列表、状态机必须是一等对象 |
| 长期价值 | 大多数服务销售一次性提交和 backlink | IH 2026 帖子有多条评论说 listing 首日后被埋，需要 re-verify、更新和 qualified traffic | **listing management 有订阅机会**；应持续监控而非一次性导出 |
| 付款意愿 | 一次性约 $60–$499、agent $99/月、横向自动化 $10–$50/月起 | 社区有持续目录清单、代提交服务和替代品讨论 | **市场已被教育**；新产品要以更高透明度/质量/维护切入，而不是只以“更多目录”切入 |

## 竞品定位矩阵（本批新增）

| 竞品 | 主要单位 | 公开价格 | 处理方式 | 证据/维护 | 明显缺口 |
|---|---|---|---|---|---|
| SubmitSaaS | 60/100/140+ directories | $60/$100/$140 一次性 | smart automation + human review；专门邮箱 | Google Sheet、截图；FAQ 明说不提供 approved list | 审批/索引状态和长期维护弱；Google SSO listing 归属有例外 |
| ListingBott | 100 hand-picked listings；10k+ 数据库 | $299–$999（页面按 beta/after beta） | human pace，客户可 moderate | full report；客户拥有 listings | 一个月交付、结果依赖供应商选择；公开效果主要是自报 |
| BacklinkBot | agent + 100/200/300+ hand submissions | $99/月 agent；$99/$167/$357 一次性 | agent 负责发现/草拟；人工逐表单 | live proof、scheduled re-check、report | 仍偏 SEO/link-building；目录审批/traffic outcome 需要独立验证 |
| Bardeen | credits/rows/actions | $10/100 credits；$50/1,000；Enterprise custom | no-code/AI scrapers + integrations | 维护 customer scrapers；CSV/export | 横向 GTM 工具，不提供目录质量/审批语义；用户需自己搭建每个 workflow |

共享区 research/subagent_competitors.md 已单独记录 Axiom.ai 与 Browse AI 的完整定价和反爬/浏览器自动化能力（C06/C07），本文件不重复计数。两者可作为底层执行引擎参照，但都不是“目录质量、审批、索引和 listing 维护”的完整产品。

## 最痛的用户问题：不是“填表”，而是“填完之后仍不知道有没有价值”

综合 B01–B10，最有支付意愿、也最容易造成信任崩塌的 JTBD 是：

> 我想把产品放到少量真正相关、可索引、能产生合格流量的目录里；我不想花一周维护不同字段、登录和确认邮件；提交后我要知道每一个 listing 是否 live、是否被索引、谁拥有它、何时需要更新，以及哪些目录应该停止投入。

问题的强度来自四个叠加损失：

1. **时间损失**：几十到几百个表单，每个字段不同；失败后还要重试。
2. **身份损失**：登录、邮箱验证、Google SSO、共享密码和 listing 归属不清。
3. **证据损失**：提交按钮点了不等于 approved，更不等于 indexed、followed 或 referral。
4. **机会成本**：低质目录带来的 10–20 个无转化点击，可能挤占 founder 与真实 ICP 对话的整整一周。

## 对产品/核心竞争力的明确要求

### 1. 目录数据库必须是“可验证的站点图”，不能是静态 URL 表

每个目录至少保存：

- 最后检查日期、HTTP/可访问状态、是否需要登录、是否支持官方 API；
- 字段 schema 版本、必填字段、logo/screenshot 要求、类别路径；
- 是否允许编辑、是否允许删除、listing owner/登录方式；
- 审批时间分布、是否索引、是否 dofollow、是否有付费墙；
- niche relevance、DR/流量（标明数据源和时间）；
- 最近一次 live-link 检查、最近一次变化和失败原因。

### 2. 批量提交要采用“站点适配器 + 队列 + 人工 checkpoint”

- 先生成一份 canonical product profile，再按站点 schema 映射，不要对 100 个站点粘贴同一段描述。
- 队列状态至少包含 queued、ready、needs_login、needs_user_review、submitted、awaiting_approval、approved、live、indexed、failed、retry。
- 默认 dry-run：先展示即将填入的字段和目标目录，客户批准后才进入外部提交。
- 对登录、验证码、Google SSO、付费目录和站点规则不确定的情况，进入用户授权的人工 checkpoint；不要把“绕过”当作正常路径。
- 限制并发和节奏，按域名设置 cooldown；提供断点、幂等键和单站点重跑。

### 3. 提交后的 post-condition 验证必须强于“按钮被点击”

每次任务都应记录：

- 请求/会话时间、目标 URL、表单关键字段摘要；
- 是否出现 success/confirmation 页面；
- 返回的 listing URL、可访问状态、截图或页面证据；
- approval/live/indexed 的分层状态；
- 7/30 天后是否仍可访问、是否被移除、是否产生 referral；
- 失败类别：登录失败、字段映射失败、验证码/人工等待、站点拒绝、提交成功但未发布、已发布但未索引。

### 4. 质量分数要优化“每个成功 listing 的价值”，不是总目录数

建议先做相关性和可验证性过滤，再把目录分成：

- Tier A：目标用户确实浏览、可索引、可编辑、可追踪；
- Tier B：有 SEO/authority 价值但需人工审核或付费；
- Tier C：只做低成本实验，默认不提交；
- Blocked/retired：保留历史记录但不再排队。

核心结果指标应是 live-listing rate、indexed-at-30d rate、qualified referral rate、cost per live listing 和 manual-takeover rate，而不是“提交了多少个”。

### 5. listings management 是持续付费层

一次性提交可以作为 acquisition，但持续价值来自：

- listing 变化检测、描述/价格/截图更新提醒；
- 失效链接、被删除、未索引和目录改版检测；
- owner credentials/编辑权限审计；
- 目录来源带来的 referral、Search Console entrances 和转化归因；
- 按 niche/ICP/阶段重新排序目录组合。

这正好回应 B07 的“listing 被埋”问题，并避免产品退化成一次性 backlink 供应商。

## 建议的市场验证实验（只读/干跑优先）

不要先提交 100 个真实表单。先做一个可复核的 20-site canary：

1. 选 20 个有公开提交入口、不同 schema 和不同登录要求的目录；记录选择理由。
2. 用同一 canonical profile 做 dry-run 字段映射，人工抽查 100% 的必填字段，不触发提交。
3. 只在获明确授权且可回滚的测试站点上实测；每站点保存状态、失败分类和证据，不填写真实敏感账号。
4. 用 7/30 天回访验证 live/indexed/referral，比较 Tier A/B/C，不把 backlink 数当作流量结果。
5. 以以下门槛判断是否继续扩大：字段映射准确率 ≥95%；post-condition false positive ≤2%；每个 live listing 的成本和人工接管率可解释；至少有一批目录产生可确认的 qualified referral。

这个实验能验证真正的市场承诺：节省的是“从选择到可验证结果”的时间，而不是只把失败更快地批量化。

## 研究缺口与下一轮

- 本批没有实际提交，因此没有真实 approval rate、CAPTCHA rate、indexation 率或每站点中位耗时；后续需要在明确授权、低风险 canary 上测量。
- Reddit B04 的具体 17/9/2 数字来自可能带竞品动机的单帖；应与至少 5 个非供应商用户、GSC/GA 或第三方 backlink index 交叉验证。
- B01/B03/B05/B08/B09/B10 的效果数字是供应商/作者自报，不能作为市场规模或 ROI 结论。
- 目录的 DR、traffic、dofollow 和 indexed 状态会漂移；产品应把数据源和观测日期一起保存。
- Axiom/Browse AI/其他浏览器基础设施适合作为执行层竞品，但要单独测试其登录态、队列、人工接管、合规边界和长期维护成本；不应直接等同于目录提交产品。

