# Adaptive / Intelligent Evasion — Deep Research（2026-08-21）

- 问题：自适应/智能方法（ML/RL/生成式/自愈）能否在静态 stealth 失败处打破反爬墙？
- 方法：WebSearch + WebFetch；优先 GitHub/arXiv/工程博客/USENIX/ACM/判例；偏 2024–2026 材料。
- 范围：只读预研，不修改源码，不承诺实现。与 [stealth_layer_preliminary.md](./stealth_layer_preliminary.md)（静态 stealth 层，已判 No-go）互补，本文只覆盖自适应/学习型方法；法律分级沿用其框架：**抓公开数据 = 低风险；击败访问控制（CAPTCHA/IP 封禁/反爬 gate）= 高风险**。每节末尾给「单行裁决」。

---

## 1. RL/ML 行为拟态（鼠标/滚动/键入节奏）

**存在什么**
- cside 的 `human_nav`（2025 工程博客，非 arXiv）：对每个输入通道（cursor/scroll/typing）训练小型 actor-critic MLP，PPO 优化，奖励=**冻结检测器 logit 空间的「human margin」**，而非「画一条更漂亮的曲线」。19 维观测（到目标向量、最近 (dx,dy,dt)、步数、累计路径长、速度/时序统计、转折计数、直线度、航点前瞻），动作=(dx,dy,dt)。反直觉结论：**平稳微节奏读作「人」，加噪声反而暴露**；策略是「对冻结检测器的对抗利用」，不是认证级拟人（[cside 主文](https://cside.com/blog/how-to-bypass-reddit-bot-detection)、[作者页](https://cside.com/blog/authors/avneh)）。
- cside 检测侧对照：其 `cursor_v2` 对 Playwright 原版光标 98.2%、贝塞尔 humanizer 99.6%、WindMouse 97.0%、NaturalMouse 100%、browserless「humanlike」会话 100% 命中（[cursor 检测文](https://cside.com/blog/catching-playwright-and-browserless-bots-by-the-cursor)）——说明**拟态工具必须对目标检测器定向训练**，泛化不存在。
- DMTG（arXiv:2410.18233，2024）：熵控扩散网络生成鼠标轨迹，模仿慢启动、方向力差异；相对基线把 CAPTCHA bot 检测准确率压低 **4.75%–9.73%**——幅度有限（[arXiv](https://arxiv.org/abs/2410.18233)）。
- Tsingenopoulos 等（KU Leuven，2021–2023）：**RL 对抗 reCAPTCHA v3**——把 v3 分数当黑盒反馈信号训练「像人的浏览」策略，15 个月数据采集；是最早的 RL-vs-行为评分实证（[lirias 全文](https://lirias.kuleuven.be/retrieve/321b2cb2-b627-484f-a82f-cb0484c7d3ee/)、[作者页](https://www.semanticscholar.org/author/Ilias-Tsingenopoulos/103060139)）。轨迹生成谱系还包括 GAN/编码解码器路线（BeCAPTCHA-Mouse、SapiAgent，见 DMTG 相关工作）。
- npm 侧有 `ghoster`（Playwright 上叠贝塞尔 humanMove/humanType + stealth + proxy 轮换，0 周下载的 niche 包，[Socket](https://socket.dev/npm/package/ghoster)）。

**声称 vs 独立证据**
- 声称：学习型动作生成能活过行为生物识别。
- 反驳（最硬的一条）：arXiv 2607.26935（2026-07，TUM）**两个特征（`mouse_event_rate` + `teleport_click_ratio`）在全部 5 级逃避（被动观察→GAN 轨迹→真人轨迹回放，2,299 个逃避会话）上 100% 召回 agent**，precision 0.994；5 特征 macro-F1 0.991。机制：Playwright 不发出物理设备才有的 raw pointer-move/wheel-delta 流，「缺失信号」与轨迹形状无关——**重放真人轨迹也没用，因为自动化层先剥掉了 raw 输入签名**。论文的架构批评同样尖锐：二元分类器（human/bot）把 39.1%（MLP）/34.5%（SAINT）的真实 agent 会话标成人，加第三类后 agent F1=1.000——即「每个卖二元检测的 vendor 都在用无法表达目标类别的输出空间」（[arXiv](https://arxiv.org/abs/2607.26935)、[alphaxiv 页](https://www.alphaxiv.org/replicate/2607.26935)、[hotmolts 评论](https://www.hotmolts.com/post/-a-bot-detector-is-not-a-binary-gate-it-is-a-label-793ae88e-89d5-447e-97dc-2c0932bb32c6)）。
- 社区共识：mouse entropy/速度方差/过冲仍是硬信号；行为一致性是「未解决的前沿」（[DEV.to](https://dev.to/cport1/how-to-detect-browser-as-a-service-scrapers-in-2025-mmk)、[HN 讨论](https://solid-hackernews-edge.netlify.app/stories/46856594)）。

**维护负担**：中。策略一次训练可复用，但**每个目标检测器一套模型**；检测器每月进化（stealth_layer 信号 8），且 2607.26935 警告特征会随自动化工具演进漂移。**法律风险**：高（主动欺骗行为分析=击败访问控制）。**证据强度**：对旧式静态分类器小幅有效（DMTG 4.75–9.73%）；对 2026 行为检测无效。

> 裁决：RL/扩散拟态是**对抗冻结旧模型的玩具**，不是破墙钥匙；检测器的真正信号是自动化层缺失的物理输入流，智能无法生成它。

---

## 2. 生成式/自适应指纹（GAN/Bayesian 指纹合成 + 会话级轮换）

**存在什么**
- **没有主流 GAN 指纹合成器**（检索不到任何公开发表物）。生产级开源路线是**生成式贝叶斯网络**：Apify `fingerprint-suite`（generative-bayesian-network + header-generator + fingerprint-injector，注入 Playwright/Puppeteer；训练数据未公开）（[GitHub](https://github.com/apify/fingerprint-suite)）；taoyadev/fingerprint-generator 按浏览器→OS→设备→GPU→locale→时区依赖图的条件概率表采样（如 Windows+Desktop 下 GPU 为 NVIDIA 的 P=52%），输出「quality/uniqueness/consistency」评分并合成 canvas/WebGL/audio hash（[ARCHITECTURE.md](https://github.com/taoyadev/fingerprint-generator/blob/main/ARCHITECTURE.md)）；Rust 版 [veilus-fingerprint](https://cloudfront-app.crates.io/crates/veilus-fingerprint)。
- 声称的 GAN 路线仅见于中文营销文（DCGAN+注意力+特征关联约束，声称 10M 指纹训练、余弦相似度校验一致性）——**无独立验证，按未证实处理**（[CSDN 动态指纹](https://blog.csdn.net/2501_94224099/article/details/157246280)）。另有 kernel 级伪造声称（Skia/ANGLE/WebAudio hook >90% 过检 vs JS 层 <30%）——同样无第三方复测（[CSDN](https://blog.csdn.net/2501_94224099/article/details/160177335)）。
- 「自适应」的真实落点是**轮换策略**（实务共识）：会话内指纹/IP/cookie 全固定，只在会话边界轮换；被 403/429/CAPTCHA 打脸才回收 profile + IP 冷却 24h（Kameleo 生产配置：580 个代理一次任务只用 5–10 个）；每请求轮换=「不可能旅行」/cookie-IP 矛盾等自爆信号；stateless 请求（SERP、单页）才 per-request 轮换（[ScrapingAnt](https://scrapingant.com/blog/browser-fingerprint-strategy-designing-identities-not-just)、[ThinkGenius/Kameleo](http://thinkgenius.com/topics/kameleo-automation/)、[VoidMob](https://voidmob.com/blog/avoid-proxy-bans-fingerprinting-session-management)、[enigmaproxy](https://enigmaproxy.net/blog/session-duration-browser-fingerprint-proxy-rotation)、[apiserpent](https://apiserpent.com/blog/rotating-vs-sticky-proxies-scraping)）。

**声称 vs 独立证据**
- 声称：比 patchright/Camoufox 的静态字符串 patch 更「真」——静态 patch 修字段、不保证跨字段自洽；贝叶斯采样保证 UA/GPU/locale/时区/插件/header/JA4 联合分布自洽，方向上确实超出静态 patch（[DeepWiki](https://deepwiki.com/apify/fingerprint-suite)）。
- 反驳：**合成指纹与真人指纹在熵/唯一率/演化速度上可区分**（NDSS'23「Him of Many Faces」，F5 十亿级流量测量：对抗性指纹 vs 良性指纹在唯一性与演化轨迹上显著不同）（[paper 页](https://research.buaa.edu.cn/zh/publications/him-of-many-faces-characterizing-billion-scale-adversarial-and-be/)）；2025 年 FP-Inconsistent 用蜜罐实测「逃过商业反爬的 bot」流量，从指纹不一致性反推检测规则（[ACM](https://dlnext.acm.org/doi/pdf/10.1145/3730567.3732919)）。检测方向已从「字段对不对」移到「**演化轨迹像不像真人**」——每请求新指纹本身就是一个演化异常。

**维护负担**：低-中（采样器独立于 Chrome 更新；网络需随真实分布重训）。**法律风险**：合成「假身份」骗指纹系统=高；仅做诚实自洽（对齐真实 Chromium/OS 分布）=低（同 stealth_layer Tier 0）。**证据强度**：轮换策略有多来源实务共识；GAN 路线无实证。

> 裁决：生成式指纹是静态 patch 的**分布级升级**，但对抗的检测器也升级到演化轨迹层；「每会话一个自洽假人」能过软门，对硬门只是把暴露从字段移到时序。

---

## 3. LLM/视觉 CAPTCHA 求解（2025-2026 实测）

**学术基准（可信度最高的一档证据）**
- **Halligan（USENIX Security 2025）**：首个通用 VLM CAPTCHA 求解器，闭集 26 类 2,600 题 **60.7%**，潜入真人打码农场 30 天开集 **70.6%**；按能力：物体识别/视觉推理 71%、3D 空间推理 17%；离散动作（点选 68%）远好于连续动作（拖拽 29%）。作者结论：AIGC 时代视觉 CAPTCHA 不再 bot-hard，呼吁无题反爬（[USENIX 页](https://www.usenix.org/conference/usenixsecurity25/presentation/teoh)、[PDF](https://www.usenix.org/system/files/usenixsecurity25-teoh.pdf)）。
- **CAPTCHA-X（arXiv:2510.06067，2025）**：裸 VLM 直接解仅 15.7–21.9%；强制分步推理 + agent 框架 → 7 类均值 **83.9%**（相对 +38.75%）（[arXiv](https://arxiv.org/abs/2510.06067)）。
- Open CaptchaWorld（2025）：人类 93.3% vs o3 40% Pass@1、GPT-4.1/Gemini ~25%（[36kr](https://www.36kr.com/p/3321768214260230)）。
- 按类型：纯 checkbox ~100%（[kraken 包](https://socket.dev/npm/package/playwright-captcha-kraken-js)）；reCAPTCHA v2 网格裸 LLM 5–60%、微调 YOLO 达 100%（ETH Zurich）；hCaptcha 40–80%（多模型集成 92%）；GIF/动画 CAPTCHA 更难（Claude 3.5 仅 3/10）；**Turnstile 完整栈对 LLM 基本免疫**（胜在指纹+行为，不只视觉）；reCAPTCHA v3 无可见题、免疫（[lattice 汇总](https://lattice.uptownhr.com/captcha-services/vision-llm-solving)、[GIF 对比](https://sauravbhattacharya001.github.io/gif-captcha/comparison.html)）。
- 旁证：DataDome 2025 报告称仅 2.8% 站点被完整保护（2024 年 8.4%），LLM 爬虫流量 2025 翻四倍（[lattice](https://lattice.uptownhr.com/captcha-services/vision-llm-solving)）。

**商业服务**
- CapSolver 用**自训 Vision Engine**（非 GPT-4）：reCAPTCHA v2 $0.80/k、v3 $1.00/k、Turnstile $1.20/k、OCR $0.40/k；专有模型 90%+，新题型 1–5 个工作日开发（[CapSolver](https://www.capsolver.com/blog/All/ai-powered-image-recognition)、[ToolMage](https://www.toolmage.com/en/tool/capsolver/)）。通用 VLM vs 专用求解器实测（OMOCaptcha，2025）：GPT-4o 85%、Gemini 1.5 Pro 80%、Claude 3.5 78% vs 专用 90–95%——**专用更准且便宜 ~10×**；OpenAI/Anthropic ToS 明令禁止用其 API 绕 CAPTCHA（[OMOCaptcha](https://blog.omocaptcha.com/en/gpt-4v-giai-captcha/)）。
- 矛盾点：「CAPTCHA 已死」是 vendor 营销；独立基准显示**交互式 CAPTCHA 对裸 VLM 仍是墙，agent 化推理后才破 60–80%**。

**合法性（2026 判例，风险显著抬升）**
- **Reddit v. SerpApi（S.D.N.Y. 2026，Engelmayer）**：Google SearchGuard（JS challenge + CAPTCHA）构成 §1201(a) 的「有效控制访问的技术措施」，绕过申诉成立；类比「只对住户开门的人脸识别门」（[Loeb](https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc)、[JD Supra](https://www.jdsupra.com/legalnews/reddit-inc-v-serpapi-llc-8674256/)）。
- **Google v. SerpApi（N.D. Cal.）**：驳回——法官**认同**刷指纹/轮 IP/解 CAPTCHA 是「规避」，但因被护内容是「公开事实」而非受版权作品，§1201 不成立（[TNW](https://thenextweb.com/news/google-serpapi-dmca-scraping-lawsuit-dismissed)）。两案分裂，待上诉。
- 先例：Craigslist v. Naturemarket（默认判决 $470k 法定赔偿）、Ticketmaster v. RMG（禁制令）——**卖** CAPTCHA 破解工具可诉（[GT 律所汇总](https://www.gtlaw.com/-/media/files/webinars/ian-ballon-jan-20/data-scraping-database-protection-and-the-use-of-bots-and-artificial-intelligence-to-gather-content.pdf)）。
- 与 stealth_layer 的 CFAA 主线（Van Buren/hiQ/Meta v. Bright Data）的关系：CFAA 侧「公开数据无 gate」论点仍在，但 **§1201 是独立于 CFAA 的暴露面，Reddit 案证明「公开数据」不能豁免它**。

**维护负担**：低（买 token 即用）。**法律风险**：高（本文档最高档）。**证据强度**：学术基准=USENIX 级可信；判例=2026 年最新且两案分裂。

> 裁决：VLM+agent 框架把「解一次性挑战」从不可能变成 60–80% 可自动化的商品，但全部增量落在法律高风险区，且行为型 gate（v3/Turnstile 全栈）仍免疫。

---

## 4. 自愈/生成式抓取 agent（DOM 检查→改 selector/动作）

**存在什么**
- **browser-use/browser-harness**：raw CDP WebSocket 给 LLM；碰到 CDP 限制（如 ~10MB payload 上限）时 agent **写代码补 helper 并持久化**；域知识存 `domain-skills/` 复用。宣称指标：站点改版后成功率 12%→**78%**，SPA 67%→**91%**，每交互 200–500ms 自愈开销；**整站重构与 CAPTCHA 墙仍需人工**（[GitHub](https://github.com/browser-use/browser-harness)、[AISignal 分析](https://www.aisignal.dev/analysis/browser-use-browser-harness)）。语义定位路径（browser-use+Claude）成本 ~$0.05–0.20/run、延迟上升（[ITNotes](https://itnotes.dev/stop-fixing-broken-selectors-building-resilient-ai-agents-with-browser-use/)）。
- **Anansi**：CSS selector 带置信度，四条自愈策略竞争、胜者持久化；响应含 JS 壳时静默升级到 stealth Playwright；curl-cffi TLS 指纹 + persona + vendor 感知（Cloudflare/Akamai/DataDome）；README 自称「slip past detection」但附合规免责（「not for circumventing access controls without permission」）（[GitHub](https://github.com/mdowis/anansi)）。
- **AgentQL**：自然语言语义定位代替 XPath/CSS，查询对 UI 改版自愈；2024-11 上线「Stealth Mode」+ humanlike 行为脚本；自愈=LLM 语义接地，无 ML 分类器成分（[GitHub](https://github.com/tinyfish-io/agentql)、[Starlog 评测](https://starlog.is/articles/automation/tinyfish-io-agentql/)）。
- **Crawl4AI**：明说是**升级阶梯而非保证**——stealth 只挡基础检测；Cloudflare/DataDome 档需 undetected-browser adapter 或 headful；官方无「可靠过 Cloudflare」承诺（[docs](https://github.com/unclecode/crawl4ai/blob/1debe5f5/docs/md_v2/advanced/undetected-browser.md)、[ScrapingBee 评测](https://www.scrapingbee.com/blog/crawl4ai/)）。
- 生态对 gate 的实际答案是**token 注入**（CapSolver/GateSolve 在干净环境解出 token/cookie 再注入 agent 会话），而非让 agent 自己过 gate（[GateSolve](https://gatesolve.dev/blog/handle-cloudflare-captchas-ai-agent-frameworks)、[CapSolver 集成指南](https://www.capsolver.com/blog/Cloudflare/how-to-solve-cloudflare-challenge-in-crawl4ai-capsolver)）。

**声称 vs 证据**
- 声称「自愈抗反爬」：**只有 DOM 结构自愈是真实的**（78%/91% 等指标是 selector 自愈指标，不是过 gate 指标）。**没有任何 agent 框架独立证明能靠「智能」过 Cloudflare/Kasada/DataDome**。
- browser-use 官方自述（Head of Browsers）：JS stealth/CDP patch「已可被检测」，对策是自研 C++/OS 层 Chromium fork + 住宅 IP + 时区/地区匹配 + 行为层；**承认 vendor 现在不封只是因为误杀成本高，AI agent 泛滥后经济翻转、monitor 会变 block**（[browser-use](https://browser-use.com/posts/bot-detection)）。
- 开源圈共识：「最好的 stealth 需要保密」——browser-use 维护者明说开源即被杀，OSS 项目 stealth 让位于 SaaS（[issue #985](https://github.com/browser-use/browser-use/issues/985)）；Fortress（Show HN 2026-07）走引擎层（34 个 C++ patch 跨 Blink/V8/BoringSSL），自称过 CreepJS/Turnstile/Akamai（aa.com/Lowes/Macy's/Kohl's），**全部为作者自证，无第三方复测**（[HN 报道](https://headlinesbriefing.com/dev/hacker-news/fortress-stealth-chromium-engine-blocks-bot-detection-0f848269)）。
- Novada 的观点补充：agent 在真实场景失败多因**会话信任信号**（IP 质量、会话连续性、行为时序）而非脚本逻辑（[Novada](https://www.novada.com/blog-ordinary/browseruse-at-scale-why-bots-fail-in-real-browsing-workflows/)）。

**维护负担**：中-高（agent 层持续烧 token；引擎层 fork 是跑步机）。**法律风险**：自愈 selector = 低（纯数据定位，是产品可卖点）；stealth 引擎/绕 gate = 高。**证据强度**：自愈对「站点改版」有效是共识；对「gate 变化」无效是共识。

> 裁决：LLM 自愈解决的是**提取层的脆弱性（DOM 改版）**，不是访问层的墙；把「自愈提取」与「过墙」解耦，前者低风险可做，后者是幻觉。

---

## 5. 自适应调度/节奏（人类会话统计模型）

**学术基线**
- **M3PP（WWW'20）**：Markov 调制标记点过程拟合页面间间隔，实测真人会话（2,223 个 Digitec Galaxus 会话）均值 48.7s、SD 113.0s——**重尾分布**，均匀延迟的爬虫一眼可辨（[ACM](https://dlnext.acm.org/doi/fullHtml/10.1145/3366423.3380238)）。
- **Hawkes 过程**建模点击自激励（burst 后衰减）：WSDM'17 查询补全（[WSDM'17](https://ar5iv.labs.arxiv.org/html/2208.01889)）、推荐系统会话到达仿真（Ogata thinning 算法）（[arXiv:2406.01611](https://arxiv.org/abs/2406.01611)）。经典 politeness 文献：2004 访问日志实测真人回访间隔 20s–数分钟；文献爬虫延迟取值 1–30s 不一（[WU Vienna 论文](https://aic.ai.wu.ac.at/~polleres/supervised_theses/Patrick_Riemer_BSc_2017.pdf)）。
- **关键缺口：没有任何证据显示商用爬虫用学习型点过程做 pacing。**工业实践是简单自适应控制：Crawlee `cr_autoscale`（批干净则加性增，遇 429/503 减半，AIMD 式）+ SessionPool 按 401/403/429 退役会话（[vignette](https://cran.r-project.org/web/packages/crawlee/vignettes/scaling-and-politeness.html)）；Heritrix3 的 frontier 时序模型（delay-factor/min-interval/max-delay 三参数）（[wiki](https://github.com/internetarchive/heritrix3/wiki/Politeness-parameters)）；Kameleo 实务「不主动轮换，被 403/429/CAPTCHA 打脸才换 profile + 代理冷却 24h」（[ThinkGenius](http://thinkgenius.com/topics/kameleo-automation/)）；会话内 sticky、会话边界轮换（[apiserpent](https://apiserpent.com/blog/rotating-vs-sticky-proxies-scraping)）。
- 学术模型（M3PP/Hawkes）到生产之间存在**明确的可转化缺口**——若做，这是**六主题中唯一「合法自适应」**：诚实 pacing（尊重 Retry-After、指数退避、按域并发上限）本身是 politeness 而非规避。

**维护负担**：低。**法律风险**：低（限速内=低；刻意伪装人类规避行为阈值=高，同 §1）。**证据强度**：真人时序分布有硬数据；商业「拟人调度」多为手工启发式。

> 裁决：学术上有现成模型，工业上没人用在破墙上；诚实 pacing 是产品可做的低风险自适应，与 stealth 无关。

---

## 6. 对抗 ML 攻击检测系统

**发表物（少且薄）**
- **Breaking the Bot Barrier（WWW'24 companion）**：对基于浏览器事件序列的 bot 检测 DNN 做 FGSM 梯度攻击 + 时空篡改，生成「误判为人的 bot 轨迹」，再翻译回真实 Selenium/Puppeteer 交互——**纯实验室自训模型，未碰任何商业 vendor 生产模型**（[ACM](https://dl.acm.org/doi/pdf/10.1145/3589335.3651474)）。
- **FP-Inconsistent（2025）**：反方向——蜜罐实测逃过商业反爬的 bot 流量，从指纹不一致性反推检测规则（[ACM](https://dlnext.acm.org/doi/pdf/10.1145/3730567.3732919)）。
- 相邻：JavaScript 分类器自适应攻击（Hansen 等 2020，知识梯度分类的威胁模型；HideNoSeek/ZOZZLE 谱系）（[Semantic Scholar](https://www.semanticscholar.org/paper/Assessing-Adaptive-Attacks-Against-Trained-Hansen-Carli/b335e7901d67aae4a9db25ab3da1081c648b49d1)）；攻击分类法（投毒/逃避/模型提取）综述（[LayerX](https://layerxsecurity.com/zh-CN/generative-ai/adversarial-ai-attacks/)）。
- **为什么薄**：Cloudflare/Kasada/DataDome 的模型是黑盒、无梯度、无标注数据回流。梯度逃逸需白盒；数据集投毒需接触 vendor 训练管线（不可得）；模型提取需海量查询+标注 oracle（不可得）。**这部分基本是 FUD**。真实可行的「对抗」是廉价样本级自适应，见 Anubis 实证。

**现实案例：Anubis（PoW 反 AI 爬虫）**
- SHA-256 工作量证明挑战（默认 5 个前导零，真人一秒税、爬虫按页付税）；UA 含 Mozilla 即挑战，git/RSS 放行；GNOME GitLab、kernel.org 镜像、FFmpeg、Wine、UNESCO、sourcehut 等部署，18k+ star（[GitHub](https://github.com/TecharoHQ/anubis)、[设计文档](https://github.com/TecharoHQ/anubis/blob/83a83e9691ab0f88d98fed9d1a711f2555cc2d8b/docs/docs/design/how-anubis-works.mdx)）。
- **几个月内 bot 学会解题**（Codeberg 2025-08 报告「many AI scraper bots had learned how to solve the Anubis challenges」）；原生 Go/Rust/C 求解器比浏览器 JS 快一个数量级（Tavis Ormandy）；早期还有 difficulty=0 漏洞（CVE-2025-24369）（[Scrappey](https://scrappey.com/qa/anti-bot/what-is-anubis-firewall)、[advisory](https://github.com/Xe/x/security/advisories/GHSA-56w8-8ppj-2p4f)）。
- 结论：任何静态/可学习 gate 都会被「自适应」攻方追上，**gate 成本战是攻方长期赢**——这同时反驳了「智能破墙」卖点（墙可以无限加层：Anubis 后是 Cloudflare AI Labyrinth 迷宫、Nepenthes 陷阱站）（[xix.ai 汇总](https://xix.ai/zh/ainews/source-developers-combat-ai-crawlers-ingenuity-retribution.html)）。

**维护负担**：不可持续（需白盒访问+持续重训）。**法律风险**：高。**证据强度**：发表物=实验室水平；FUD 占比高。

> 裁决：对抗 ML 论文存在但全部打的是自训模型；对生产 vendor 系统的梯度攻击/投毒/提取不可行。破墙战不在「对抗 ML」维度，在「每 gate 成本」维度。

---

## 7. 综合裁决

**静态 stealth vs 自适应 ML——逐层对比：**

| 墙层 | 静态 stealth（已研究） | 自适应/ML 方法（本文） | 格局变化 |
|---|---|---|---|
| 软门（webdriver/headless UA/插件空） | 够用 | 无增量 | 无变化 |
| 一次性 challenge（图像 CAPTCHA/Turnstile 复选框/PoW） | 无效（被动等失败） | **VLM agent 60–80%**（[USENIX'25](https://www.usenix.org/conference/usenixsecurity25/presentation/teoh)）+ token 服务商品化 | **真实改变，但全在法律高风险区** |
| 行为评分（reCAPTCHA v3 类） | 无效 | RL 可学早期版本（[Tsingenopoulos](https://lirias.kuleuven.be/retrieve/321b2cb2-b627-484f-a82f-cb0484c7d3ee/)）；2026 检测反制（[2607.26935](https://arxiv.org/abs/2607.26935)） | 无效（信号不在行为里，在输入流缺失） |
| 硬门（Cloudflare/Kasada/DataDome 全栈） | 无效 | 无证据；vendor 共识是引擎 fork+住宅 IP+保密，不是学习 | 无变化 |

**「自适应/ML 是否改变破墙格局？」——分墙回答：**

- **软门**：静态已经够用，ML 无增量。诚实 Tier 0 一致性 + 自适应 pacing 即可过（[Crawl4AI 官方定位](https://github.com/unclecode/crawl4ai/blob/1debe5f5/docs/md_v2/advanced/undetected-browser.md)）。
- **中门（一次性 challenge）**：**这是自适应方法真实改变格局的一层**。agent 化 VLM 把裸模型 15–25% 拉到 60–80%（[arXiv:2510.06067](https://arxiv.org/abs/2510.06067)），token 服务把「解 gate」变成 $1/k 的外包商品（[CapSolver](https://www.capsolver.com/blog/All/ai-powered-image-recognition)）。但增量全部落在**法律高风险区**（[Reddit v. SerpApi](https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc) 的 §1201 裁决），且行为型 gate（v3、Turnstile 完整栈）对 LLM 仍然免疫（[lattice](https://lattice.uptownhr.com/captcha-services/vision-llm-solving)）。
- **硬门（Cloudflare/Kasada/DataDome 全栈）**：**没有变**。三个不变项：IP 信誉、硬件一致指纹（TLS/JA4 + 真实 OS 分布）、以及 arXiv 2607.26935 指出的 raw 输入流缺失信号——这三者都不是「智能」能生成的，而是基础设施（住宅 IP 池 + 引擎级 fork + 物理输入层）生意。RL 拟态被两个特征打穿（[2607.26935](https://arxiv.org/abs/2607.26935)）；生成式指纹被 NDSS'23 证明分布可分（[NDSS'23](https://research.buaa.edu.cn/zh/publications/him-of-many-faces-characterizing-billion-scale-adversarial-and-be/)）；agent 框架自愈只治 DOM 改版、不治 gate（[AISignal](https://www.aisignal.dev/analysis/browser-use-browser-harness)）。
- **对产品的落点**：自适应智能真正的、合法的增量在两处——(1) **自愈提取层**（selector/结构自愈，低风险，直接抬升可观测性卖点）；(2) **诚实自适应调度**（会话级 pacing、M3PP 式重尾节奏、按 429/Retry-After 的 AIMD 降速，低风险）。「智能过墙」作为卖点既打不赢（硬门）又最危险（中门的法律敞口），维持 [stealth_layer_preliminary.md](./stealth_layer_preliminary.md) 的 No-go 结论不变，本文为其补充了对抗面证据。

## 参考速查（关键源）

- 行为检测反制：arXiv 2607.26935（[链接](https://arxiv.org/abs/2607.26935)）
- RL 拟态：cside human_nav（[链接](https://cside.com/blog/how-to-bypass-reddit-bot-detection)）；RL vs reCAPTCHA v3（[lirias](https://lirias.kuleuven.be/retrieve/321b2cb2-b627-484f-a82f-cb0484c7d3ee/)）
- 生成式指纹：Apify fingerprint-suite（[链接](https://github.com/apify/fingerprint-suite)）；NDSS'23（[链接](https://research.buaa.edu.cn/zh/publications/him-of-many-faces-characterizing-billion-scale-adversarial-and-be/)）
- CAPTCHA：Halligan/USENIX'25（[链接](https://www.usenix.org/conference/usenixsecurity25/presentation/teoh)）；CAPTCHA-X（[arXiv](https://arxiv.org/abs/2510.06067)）；Reddit v. SerpApi（[Loeb](https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc)）
- 自愈 agent：browser-harness（[GitHub](https://github.com/browser-use/browser-harness)）；browser-use 官方反爬立场（[链接](https://browser-use.com/posts/bot-detection)）
- 调度：M3PP/WWW'20（[ACM](https://dlnext.acm.org/doi/fullHtml/10.1145/3366423.3380238)）
- 对抗 ML：Breaking the Bot Barrier（[ACM](https://dl.acm.org/doi/pdf/10.1145/3589335.3651474)）；Anubis（[GitHub](https://github.com/TecharoHQ/anubis)）
