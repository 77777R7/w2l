# 自动升级系统:HTTP → 本地浏览器 → 云浏览器厂商 → 用户授权会话 → 人工接管

状态:**已实现,随 PR #6 待合并**。本文档记录 PR #6 相对「接入两个厂商」目标之间的差距分析,以及逐条差距的改造方式。

## 差距分析与改造清单

### 差距 1:厂商 Transport、厂商 Capability、产品 Policy 未分离

**现状**:`browserbase.ts` / `steel.ts` 的 session body 是硬编码的(`solveCaptchas: false` 等),产品政策(哪些能力被拒绝)永久写死在厂商适配器里。`ProviderDeclaration.capabilities` 在 `connect.ts` 里写死为 `['headless_browser', 'datacenter_proxy']`。

**改造**:
- `packages/http-core/src/vendor.ts`(新):`VendorCapability` 类型、`CapabilityOffer`(厂商声称的每个能力 + 默认开关 + 是否可被策略启用)、`REFUSED_CAPABILITIES`(已迁移)。策略是纯函数 `evaluateVendorPolicy(offers, policy)`,输入厂商的能力清单和一份 `VendorPolicy`(哪些能力允许启用、哪些永久拒绝),输出 `PolicyDecision`(启用的能力、声明、session body 参数)。**没有任何厂商名字出现在策略层。**
- 每个厂商适配器只做两件事:声明自己的 `CapabilityOffer` 清单,以及把 `PolicyDecision` 翻译成自己的 API wire 格式。适配器不再决定政策。
- `connectVendor` 的 `ProviderDeclaration` 由策略决定(`honoursCallerUserAgent` 由厂商事实决定:两个 CDP 厂商都是 false)。

### 差距 2:HTTP 与本地浏览器没有经过统一升级通道

**现状**:`resilientHttp` 与 `browserLocal` 是独立 subject,升级只存在于 `escalationForBlock` 的返回值里(建议性的),没有任何组件真的「先试 http,再试浏览器」。

**改造**:`packages/bench/src/routing/ladder.ts`(新):`LadderRunner`,按顺序尝试通道(HTTP → 本地浏览器 → 厂商 → 授权会话),直到获得 contentful 结果或升级可能性耗尽。HTTP 和本地浏览器仍然可以直接独立使用(`w2l-bench`、各 subject 的构造函数不变)——升级是新增的协调层,不是替代。

### 差距 3:没有多厂商自动路由

**现状**:`connectVendor` 一次只连一个厂商,由调用者写死选择。没有按域名选择、没有历史记录、没有失败后切换。

**改造**:`packages/bench/src/routing/vendorRouter.ts`(新):
- `RoutingHistory`:按域名记录每个厂商的尝试数、内容成功率、中位延迟、累计成本、最近失败类型。
- 排序:成功率高优先,成功率相同时低延迟优先,两者都接近时低成本优先;给没有数据的厂商一个小的探索分(诚实版本:探索分是显式常数,不是黑盒模型)。
- 失败切换:同一域名的下一次请求从历史排序中的下一个厂商开始;`provider_error` / `identity_mismatch` 把该厂商在此域名的分数记负。
- 持久化:历史 JSON 文件,重启不丢。写入的是聚合统计,不是凭证。

### 差距 4:没有用户授权的持久 Session

**现状**:`AccessConfig.session` 支持一次性的 cookies/storageState,但没有任何组件在两次运行之间保存和恢复登录状态、Cookie、地区或浏览器环境。

**改造**:
- `packages/bench/src/routing/sessionStore.ts`(新):按域名持久化 `SessionSnapshot`(cookies、storageState、保存时间、来源)。
- 厂商端:Browserbase 用 `browserSettings.context: { id, persist: true }` 跨会话复用 Cookie/localStorage;Steel 用 `profileId` + `persistProfile: true` + `sessionContext` 注入。session body 由策略层决定是否启用。
- 安全边界延续既有纪律:cookie 值和 storageState 以 SHA-256 哈希形式出现在记录里,明文只落在一个 0600 权限的文件中,且该文件路径明确记录在文档里。

### 差距 5:失败分类没有统一为七类

**现状**:契约已有 `BlockReason`(cloudflare_challenge / captcha / rate_limit / login_wall / geo_restricted / bot_detected_generic)与 `FailureReason`(含 provider_error),但身份不一致只存在于 trace 事件里,没有一个跨通道的统一分类函数,路由层无法用它做决策。

**改造**:`packages/http-core/src/failureClass.ts`(新):`RoutingFailureClass = bot_gate | captcha_required | login_required | rate_limited | geo_blocked | provider_error | identity_mismatch` + `classifyFetchFailure(result)`,把所有通道的结果(包括 trace 里的 `identity_mismatch` 事件)映射到这七个类。契约里已有的细粒度原因保留(它们是记录的一部分);七类分类是**路由维度的标准**,`BlockReason` 的细分不影响升级决策。

### 差距 6:没有 Human Handoff 机制

**现状**:遇到 `captcha` / `login_wall` 时,`escalationForBlock` 只是建议 `browser_local_authed`,没有暂停任务、请真人介入、保存会话后继续的机制。

**改造**:
- `FetchResult` 增加可选 `handoff?: { reason, url }` 字段(contracts)。当厂商或本地浏览器遇到 captcha/login 且策略允许 `live_view_handoff` 时,subject 在结果里带上 handoff 请求,而不是把挑战页当作成功。
- `LadderRunner` 把 `handoff` 结果作为「暂停点」向上返回,并触发 `HandoffHandler`(注入的回调;CLI 版本打印 live-view URL 并等待真人完成后提供新的 `SessionSnapshot`)。
- 真人完成后,`sessionStore` 保存新会话,`LadderRunner` 用同一个会话重试,任务继续。

### 差距 7:没有默认治理(公开页面 + 域名白名单 + 审计)

**现状**:授权只存在于 `AccessAttestation`(声明)层面,没有域名白名单,没有按请求的授权检查。

**改造**:`packages/http-core/src/governance.ts`(新):`CrawlPolicy`(mode + 允许的域名列表 + 哪些通道可用 + 哪些能力可启用)。`LadderRunner` 在每次请求前检查:
- 默认 mode:只允许 http 与 browser_local,域名必须在白名单里(或明确为 public-only)。
- authed / provider / handoff 通道只在策略显式授权后可用。
- 每次通道升级、每次人工接管都追加一条 `ladder_step` 审计事件(渠道、vendorId、升级原因、该步结果),由 `LadderRunner` 产出,CLI 打印并随最终结果返回;合规链签名覆盖的是 subject 自产记录,梯子的审计是与结果并行的证据。

### 差距 8:没有真实 E2E 对比,只有 fake tests

**现状**:所有 vendor 测试都是注入的 fake。真实 API Key 不存在于本环境。

**改造**:
- `packages/bench/src/liveCompareCli.ts` + CLI `w2l-live-compare`:对同一批 URL 跑 HTTP → 本地浏览器 → (Browserbase,若有 key) → (Steel,若有 key)四个通道,输出每通道的**内容成功率、假成功率、成本、速度、人工介入率**,以及各通道相对 HTTP 基线的增量。每个厂商 arm **复用一个 Subject**(懒创建,首次 fetch 时才建会话),所有成功/失败/超时路径都走 `finally` teardown,arm 超时是真实的 `Promise.race` 截止。
- 没有 key 的通道诚实输出 `SKIPPED: no API key`,而不是跳过报告。
- 该 CLI 已用真实网络运行(HTTP 与本地浏览器通道),结果见「实测」一节。厂商通道待 key。

## 通道增量(实测)

> 厂商通道的「真实 E2E」需要真实 API Key(本环境没有,`env` 和 `.env` 均检查过)。两条本地通道用真实网络实测;厂商通道诚实标记为 SKIPPED,拿到 key 后运行
> `w2l-live-compare <url>...` 即可补齐同一张表。

**实测方法**:`w2l-live-compare` 对同一批 URL 逐条跑 http → browser_local → browserbase → steel,统计内容成功率(成功且非挑战页)、假成功率(挑战页被当成成功)、成本(厂商自报,绝不估算)、速度(墙钟中位数)、人工介入率。实测目标选了 canary 套件 tier-2 的五个已知有 bot gate 的站点(etsy / amazon / indeed / producthunt / glassdoor),三次运行取合并计数——这类站点每次请求的 gate 行为有抖动,只跑一次的数不值得写进文档。

**实测结果(2026-08-22,3 次运行合并)**:

| 通道 | 内容成功率 | 假成功率 | 成本 | 中位墙钟 | 人工介入 |
|---|---|---|---|---|---|
| http (resilient) | 4/14 (29%) | 0 | 0 | ~230ms | 0 |
| browser_local | 7/14 (50%) | 0 | 0 | ~2.6s | 0 |
| browserbase | SKIPPED(无 key) | — | — | — | — |
| steel | SKIPPED(无 key) | — | — | — | — |

**本地浏览器相对 HTTP 的真实增量**:+3 页 (+21pp)。三处胜利可点名:

- **indeed.com** — http 每次 `bot_gate`,浏览器 2/2 成功(3.0s、2647 tokens)。jobs 列表是 W2L 的核心垂直,这条增量是浏览器通道存在的理由。
- **producthunt.com** — http 也「成功」但只拿到 105–155 tokens(JS 壳),浏览器拿到 23,796–24,621 tokens。**相同成功率下,浏览器通道的 token 产出约为 HTTP 的 150 倍**——速度慢 2s,内容多两个数量级。
- **glassdoor.com** — 抖动最诚实的一例:第一次运行两条通道都成功(经 307 跳到 glassdoor.com.hk),后两次都被 gate 挡住(http=bot_gate,browser=login_required)。gate 行为本身会随时间抖动,这也正是需要一个能自动升级、而不是赌单次的梯子的原因。

**仍然失败的原因(每一条都查过,不是猜)**:

- **etsy.com** — 两条通道都 `bot_gate`(403 挑战页)。robots.txt 允许,但站方的 bot 检测拦所有非真人流量。爬过它的唯一方式是解验证码或伪造指纹——两者都是结构性拒绝的能力,所以这是梯子的诚实终点,不是缺失。
- **amazon.com** — http 和浏览器都是 `bot_gate`。诊断抓到了具体信号:浏览器拿回 **202 + 空/近空文档**(Amazon 吞掉请求而不承认)。`classifyGate` 的多信号规则:202 只有在**空/近空内容,或同时出现其他 gate 信号**时才判 bot_gate;带实质页面的 202 保持普通 http_error(有负向测试钉住)。这个失败现在被正确地叫 bot_gate,而不是伪装成 http_error。
- **glassdoor.com** — 后两次被 `login_required`(浏览器通道)。这不是验证码,是登录墙——梯子的正确答案是 `browser_local_authed` 或真人接管,而不是更强的伪装。

这些失败类型全部映射进七类路由分类(bot_gate / captcha_required / login_required / rate_limited / geo_blocked / provider_error / identity_mismatch),挑战页 0 次被算作成功。

## 依然拒绝的东西(设计红线,不是缺失)

- `captcha_solving`、`fingerprint_spoofing`、`cdp_patching`、`identity_rotation` 在任何策略下都不可启用 —— 策略层没有对应开关。
- 绕过 robots.txt 的通道不存在;每个通道(包括厂商)都在发送前用自己的 robots 实现评估目标 UA。
- 挑战页不算成功:提取器输出为空时返回 `empty_unverified`,挑战页标记命中时 false-success 检查失败;升级链不会把挑战页内容当作内容成功。

## 第二轮门禁返修(组合级缺陷,8 项)

### 1. best-so-far 保底内容

梯子不再用「最后一个结果」覆盖之前的成功。`quality_low_yield` 触发升级后,如果更高通道失败、超时或拿回**更少**内容,最终返回最初的 HTTP 成功;只有新结果确实更优(主内容 token 数,markdown 长度作平局裁决)才替换。`escalation.improved` 在最终结果上盖章:`true` = 该跳换来了被采纳的内容,`false` = 该跳没换来更好的东西。回归测试覆盖「HTTP success → browser timeout → 返回 HTTP fallback」。

### 2. authed_session 独立 rung

- `standard`/`research` 模式**不加载、不使用**任何登录态;handoff 只在 `authed` 模式执行(否则 `denied: mode is not authed`)。
- 明确新增 `authed_session` rung(通道 id 为 `authed_session`,对应 lane `browser_local_authed`),与公共 `browser_local` 分开。
- `SessionSnapshot` 携带完整 attestation(principal/statement/attestedBy/attestedAt),由 rung 构建 `AccessConfig`。
- `browser_local` 的 `newContext` 真正恢复 Playwright `storageState`(解析 JSON blob 直传);cookies 走 `addCookies` 保持原路径。真实 `BrowserLocalSubject` 的构造测试验证两种 cookie 都上了线。
- 快照域名校验:snapshot.domain 必须等于目标 URL host;vendor 必须匹配 rung(Steel 的 resume 交给 browser_local_authed 会被拒,反之亦然)。

### 3. Browserbase 首次持久化顺序

`ensurePersistence()` 现在在 `connectVendor` **之前**执行,产出的 contextId 通过 `connectVendor(ops, connector, resume)` 注入 transport,再触发 UA 探针——第一个 `createSession` 拿到的就是带 context 的会话。组合测试(`buildChannels` + fake `VendorOps`)断言第一次 `createSession` 的 resume 参数与 `result.resumeContext` 都是该 contextId。

### 4. Human Handoff 真正闭合

- 阻断结果里的 `resumeContext` 在提示真人**之前**写入 session store(真人在 live view 解开的正是这个会话)。
- 重试走**同一个存活会话**,不再新建。
- 空 store 的首跑也能完成:阻断 → 真人 → 保存 → 同通道重试(有测试)。
- 真人完成后重试失败:报告失败重试(`ladder_handoff_retry_failed`),`handoffRequested=false`——不再打印「仍需要真人」。
- `w2l-provider` 的 `--persist-session`/`--live-view` 已删除:单次 fetch 的 CLI 实现不了这个闭环,留着就是误导性参数;现在传这两个 flag 直接报错并指向 `w2l-fetch`。

### 5. liveCompare 超时资源泄漏

- 每个 arm 建立 `AbortSignal.timeout`;signal 贯穿 `VendorApiRequest` → `fetchVendorApi` → `navigateOnce`(映射成 `page.goto` 的 timeout)→ `ProviderSubject.fetch`。
- pending subject 创建被跟踪:截止时间到了、factory 还没完成,`close()` 等它完成后立即 teardown,绝不产生一次迟到 fetch。
- 回归测试:慢 factory 返回后 fetch 次数 = 0、teardown 恰好 1 次;挂起的 fetch 被 signal 中止且 teardown 恰好 1 次。

### 6. identity 事件不能算成功

`identity_mismatch` / `identity_unobserved` 出现在 contentful 结果上时,该结果**不进 best-so-far 的候选**,梯子继续尝试下一个 vendor。组合测试:HTTP 200 + 正文 + identity_mismatch → 下一家成功,返回结果不含 mismatch。

### 7. RoutingHistory

- 旧 JSON schema(没有 `latencySamplesMs`)读取时归一化:按 `latencyTotalMs/attempts` 重建样本,不崩溃,可继续 record。
- 偶数样本取中位 = 两个中间值的平均(有测试)。
- 样本上限 200(只留最近窗口)。
- `startingVendor`:正常请求一律从真实 `ranked[0]` 开始;仅当上一家失败类别是 vendor 级(`provider_error`/`identity_mismatch`)才轮换到下一家;bot_gate 等站点级失败不轮换。

### 8. 文档与 PR 元数据

- 代码注释与文档已按上述语义同步(202 多信号、真中位数、authed rung、fallback)。
- PR #6 的 base 是 `fix/robots-redos`,**不是 main**;GitHub 仓库当前没有配置 CI checks——合并前的一切验证都是本地跑出来的,PR 页面上不会有绿色对勾可看。
