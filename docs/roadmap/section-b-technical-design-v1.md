# W2L Section B 技术架构与可行性研究报告

**版本：** 技术设计草案 v1.0
**研究日期：** 2026 年 9 月 21 日
**仓库基线：** `main@fdc6559f06fdf5af5c926d3798071d9f7a4f64b5`，PR #39 合并后的版本。

**交付与验证说明：**本次完成了仓库接口核对、官方技术资料研究和关键执行协议的设计分析。但代码执行与文件生成环境持续超时，**没有成功运行原型，也没有生成可下载的** **`.md`** **附件**。下面提供完整的 Markdown 报告正文，建议文件名为 `W2L_Section_B_Technical_Design_v1.0.md`。文中的接口、SQL 和配置均为拟议设计，不冒充已经合入仓库或通过测试的实现。

---

## 执行摘要

**Section B 在技术上可行，也适合沿用 W2L 现有基础建设；但正确的实现对象应该是“持续维护可信数据的任务引擎”，而不是“一个定时运行的浏览器 Agent”。**

我推荐采用：

> **模块化单体架构＋单一持久化控制库＋现有采集引擎＋独立会话管理器＋可选多模态建议层。**

核心设计有四个重点。

**第一，区分“这次看到了什么”和“目前相信什么”。**每次抓取都可以产生观察记录，但只有经过验证的结果才能成为有效数据版本。登录页、加载失败、模型猜测和不完整分页，不能覆盖上一次正确结果。

**第二，持续任务的可靠性要由明确协议保证。**定时、恢复、取消、重试、人工接管和结果提交，必须有一致的状态机。数据库租约、浏览器控制权和下游事件去重是三个不同问题，不能用一个任务锁替代全部处理。

**第三，将增量能力建立在对象与字段之上。**网页字节变化、正文变化、提取规则变化与业务数据变化必须分开。哈希是辅助工具，不是内容正确性的证明。

**第四，模型只处理有明确价值的疑难部分。**确定性代码优先完成采集、提取和验证；模型按需识别页面状态、字段归属或提出有限修复。模型不能自行扩大权限、修改验收标准或直接提交数据。

建议的实施顺序仍然是：

```text
A→B 接口与验收交接
       ↓
B1：持续任务与数据版本
       ↓
B2：可信变化识别与增量更新
       ↓
B3：授权会话与人工接管
       ↓
B4：有限后台自动化
```

**首个可交付版本应只完成 B1＋B2 的一条真实任务链。**B3、B4 和多模态增强均不应成为这个版本的强制依赖。

---

# 1. 研究依据、目标与范围

## 1.1 本报告如何使用已有材料

你提供的早期评审确立了四条产品原则：**抓取正确、失败可解释、任务可恢复、成本可计算**。本报告延续这些原则，但不把早期评审中的历史缺陷当作当前版本仍然存在的问题。

本次重新读取了当前仓库的 Section B 文档，以及采集接口、API 引擎、结果契约和会话存储。仓库的 B1–B4 定义与此前讨论一致，仍将其列为未来产品方向，而不是已经交付的能力。

本文区分四类内容：

| 类型含义       |                              |
| ---------- | ---------------------------- |
| **仓库事实**   | 当前提交中可以直接确认的接口和实现            |
| **外部技术依据** | 官方文档、标准或项目维护者资料支持的能力与限制      |
| **设计建议**   | 为 W2L 选择的实现方式，需要编码和验证        |
| **待实测项**   | 必须经过原型、故障注入、真实任务或负载测试才能确定的结果 |

**官方 API 存在，只能证明某个实现路径有依据，不能证明整个 W2L 集成已经可靠。**

## 1.2 Section B 的产品目标

Section B 应当使用户能够定义这样的任务：

> 在指定权限、预算和频率下，持续获取某类数据；识别可信变化；保留来源；发生异常时不破坏已有结果；必要时让用户接管，然后继续。

它需要交付的不是一个“成功”布尔值，而是：

```text
当前有效数据
当前数据是否过期
本轮获取与验证结果
相对于有效旧版本的变化
变化所依据的证据
执行、恢复和人工处理记录
完整资源消耗
```

## 1.3 明确不做什么

Section B 首版不承担通用代理池、通用 CAPTCHA 突破、任意后台全自动操作、分布式浏览器集群或通用工作流画布。

同时，不承诺：

- 任何网站都能抓取；
- 登录一次后永久有效；
- 模型能证明任意字段一定正确；
- 任意浏览器操作或外部通知“绝对只执行一次”。

这些边界不是降低目标，而是防止把不同问题混成一个无法验收的大系统。

---

# 2. 当前基础如何延续

## 2.1 可以复用的部分

| 当前模块已确认情况Section B 中的用途  |                                               |                 |
| ------------------------ | --------------------------------------------- | --------------- |
| `LadderScrapeAtom`       | 封装 `LadderRunner`，返回结果、链接、完整审计汇总和 robots 延迟信息 | 继续作为一次采集的基础实现   |
| `ApiEngine`              | REST 复用现有采集和 crawl 引擎；返回 `LadderRunAudit`     | 保留对外入口，不另建抓取系统  |
| `ScrapeOutcome`          | 已能携带 `result`、`audit` 和抓取延迟                   | 作为新的采集结果封装的兼容基础 |
| `LadderExecutionSummary` | 已包含全部尝试、用量和费用未知状态                             | 作为持续任务计量的主来源    |
| `SessionStore`           | 已有 Cookie、`storageState` 和授权说明等快照概念           | 升级为明确隔离的会话管理    |
| SQLite runtime           | 当前使用 `better-sqlite3`                         | 继续支撑单机持久化       |

这些能力分别可以在当前采集实现、API、契约和依赖文件中确认。

## 2.2 必须补充的接口能力

当前 `ScrapeAtom` 仍然只有：

```ts
scrape(url: string): Promise<ScrapeOutcome>
```

它没有在这个接口上接收取消信号、任务期限、明确会话引用或证据采集策略。

Section B 不能仅在外层加一个超时计时器，就认为采集已经可取消。**取消必须传到实际 HTTP 请求、浏览器操作、Provider 调用和模型请求。**

同样，当前 `Evidence` 主要记录最终 URL、状态、哈希和 artifact 路径，尚不足以完整表达 HTTP 缓存验证、截图与 DOM 对应关系，以及字段级证据。

建议采用兼容扩展，而不是直接破坏现有 API：

```text
旧 scrape/crawl API 保持行为兼容
                  ↓
新增内部 Capture 接口与运行上下文
                  ↓
旧接口通过适配器调用新实现
                  ↓
Section B 使用完整上下文
```

## 2.3 不要直接把评估器当作生产验证器

测试用的 `mustContain`、预先标注答案，与生产环境的质量契约是两种东西。

生产验证器可以检查：

**对象身份、字段类型、单位、来源、证据、完整性和业务约束。**

但它不能因为没有预先知道正确价格，就自动宣布任意提取结果正确。无法核实的关系必须保留未知状态。

因此，A→B 交接应包含一个可复用的 `QualityAssessment` 契约，而不是让 B 直接依赖 benchmark 的评分函数。

---

# 3. 技术路线选择

## 3.1 推荐：模块化单体，而不是提前微服务化

首版建议只有一个逻辑控制服务，负责：

**任务状态、调度、策略、版本提交和事件记录。**

HTTP、浏览器和模型可以使用独立工作进程，以隔离崩溃和资源消耗，但不必因此拆成多个独立部署产品。

这个取舍的目的是：**保持单一状态来源，同时避免浏览器或模型计算阻塞调度。**

## 3.2 编排方案比较

| 方案适用位置本阶段判断      |                     |                                |
| ---------------- | ------------------- | ------------------------------ |
| **SQLite＋明确状态机** | 单机、本地部署、有限任务类型      | **首版推荐**，但必须认真实现租约、恢复和事务       |
| **Temporal**     | 更复杂的长期编排、多工作节点和运维体系 | 后续候选；不应仅为了定时任务立即引入             |
| **BullMQ**       | 队列、并发与后台任务执行        | 可以作为未来队列实现，但不能代替业务基线和事件语义      |
| **LangGraph**    | 多步模型规划和人工中断的智能子流程   | 可选规划组件，不作为第二套全局任务真相            |
| **Stagehand**    | 浏览器观察、提取、动作辅助       | 可替换的 B4 适配器候选，不接管 W2L 的权限和数据提交 |

Temporal 官方建议 Activity 具备幂等性；BullMQ 也需要处理失去续租后的任务重排。**采用成熟框架，并不会自动解决浏览器副作用或重复提交问题。**([Temporal](https://docs.temporal.io/activities "What is a Temporal Activity? | Temporal Platform Documentation"))

LangGraph 提供线程检查点和长期存储；Stagehand 提供确定性代码与 AI 浏览器操作的混合能力。这些能力可以使用，但本报告选择让它们处在 W2L 的可替换边界之内。([Docs by LangChain](https://docs.langchain.com/oss/javascript/langgraph/durable-execution "Persistence - Docs by LangChain"))

### 未来什么时候考虑迁移编排框架？

不是按某个随意的页面数量决定，而是看是否出现：

**多机高可用成为明确要求、单机控制库成为实测瓶颈、长期复杂流程维护成本持续增加，或者团队无法可靠维护自有状态机。**

届时可以替换调度实现，但不应改写业务层的 Observation、Snapshot、QualityAssessment 和 ChangeEvent 语义。

---

# 4. 总体架构与必须保持的约束

## 4.1 逻辑结构

```text
用户程序 / CLI / MCP / 未来 n8n 与任务界面
                        │
                API 与配置验证
                        │
          Monitor、Revision、Policy
                        │
             持久化调度与 Run 管理
                        │
           本轮预算 / 授权 / 执行代号
                        │
       ┌────────────────┴────────────────┐
       │                                 │
   普通页面采集                     授权浏览器任务
 HTTP / Browser                    Session / Recipe
       │                                 │
       └────────────────┬────────────────┘
                        │
               现有 Section A 引擎
                        │
          提取 → 质量验证 → Observation
                        │
          有效 Snapshot 与 Baseline 更新
                        │
           ChangeEvent 与本地 Outbox
                        │
               Section C 数据交付

可选旁路：
EvidenceCollector → ModelAdapter → ProposalValidator
                         │
                    受限补救建议
                         │
                  回到原执行与验证路径
```

## 4.2 八条关键约束

| 编号约束 |                                 |
| ---- | ------------------------------- |
| I1   | 无效、部分完成或证据未知的结果，不推进对应对象的有效基线    |
| I2   | 同一个 Monitor 默认只有一个未结束的逻辑 Run    |
| I3   | 过期 worker 不得提交有效版本，也不得恢复已经撤销的授权 |
| I4   | 有效版本、基线指针、变化事件和待投递记录必须原子提交      |
| I5   | 传输缓存与业务有效基线分别管理                 |
| I6   | 未确认采集完整性时，不把缺失对象判为删除            |
| I7   | 模型可以建议提取或修复方式，不能自行修改权限与正确性要求    |
| I8   | 旧数据可以继续展示，但必须保留其真实验证时间和过期状态     |

这些是建议写入代码和测试的产品契约，不是口号。后文的状态机、事务和测试都围绕它们设计。

---

# 5. 数据模型与接口契约

## 5.1 先区分四种身份

同一个 URL，不一定代表同一个业务结果。

建议分别定义：

**资源身份** **`resourceKey`**：实际获取的文档或响应。

**视图身份** **`viewKey`**：账户、筛选、地区、语言、币种和必要的浏览器状态。

**业务对象身份** **`entityKey`**：产品、规格、套餐、文档章节或其他稳定对象。

**任务身份** **`monitorId`**：用户希望持续维护的数据任务。

例如，同一个商品页可能显示多个规格；同一后台 URL 可以在不同账户下返回完全不同的数据。**不能只以 URL 作为缓存、快照和授权的统一键。**

URL 锚点也不能一律删除：HTTP 传输资源可以不包含 fragment，但文档章节目标或单页应用视图可能依赖它。

## 5.2 建议的核心对象

| 对象主要内容是否允许原地覆盖      |                        |             |
| ------------------- | ---------------------- | ----------- |
| `Monitor`           | 当前启停状态、控制代号、当前配置版本     | 允许受控更新      |
| `MonitorRevision`   | 来源、字段、频率、规则、权限、预算      | 不允许；修改产生新版本 |
| `Run`               | 一次计划执行或手动执行            | 按状态机更新      |
| `RunAttempt`        | 一次实际尝试、租约、worker、失败原因  | 按状态机更新      |
| `Observation`       | 本次看到的响应、DOM、截图、状态和证据引用 | 内容不覆盖       |
| `QualityAssessment` | 哪套规则对哪个观察作出什么判断        | 新判断产生新记录    |
| `Snapshot`          | 通过验证的业务数据版本            | 不覆盖         |
| `Baseline`          | 当前有效版本及验证时间            | 通过事务推进      |
| `ChangeEvent`       | 前后版本、字段变化、原因和证据        | 不覆盖         |
| `OutboxDelivery`    | 事件对某个订阅者的投递状态          | 按重试协议更新     |

“不可覆盖”不等于无限期保存。保留期限和删除政策仍应实施，但不能把修改历史与删除历史混为一谈。

## 5.3 字段不能只有 `value: null`

下面这些情况含义完全不同：

“价格确实不适用”“页面没有价格”“这次没有取到价格”“价格被脱敏”“两个来源冲突”。

建议采用带状态的字段值：

```ts
type FieldValue<T> =
  | {
      state: "present";
      value: T;
      evidenceRefs: readonly string[];
    }
  | {
      state: "explicit_null";
      reason: string;
      evidenceRefs: readonly string[];
    }
  | {
      state: "unobserved";
      reason: string;
    }
  | {
      state: "conflicting";
      candidates: readonly {
        value: T;
        evidenceRefs: readonly string[];
      }[];
    }
  | {
      state: "redacted";
      reason: string;
    };
```

这样，下游就不会把“这次没取到”误写成“这个字段被删除”。

首版建议以**单个业务记录整体通过**作为有效版本条件。暂时不要默认将新旧字段混合成一份看似全新的完整记录；需要字段级更新时，应额外设计每个字段的验证时间和来源。

## 5.4 采集接口的建议扩展

以下是接口设计示意，不是当前已存在的实现：

```ts
interface CaptureRequest {
  url: string;
  targetSpecRef: string;
  scopeRef: string;
  policyRevision: string;
  sessionRef?: string;
  evidencePolicyRef: string;
  cachePolicyRef?: string;
}

interface RuntimeContext {
  runId: string;
  attemptId: string;
  controlEpoch: number;
  fencingToken: number;
  deadlineAt: number;
  signal: AbortSignal;
  budgetRef: string;
}

type CaptureOutcome =
  | {
      kind: "fetched";
      observationRef: string;
      executionAuditRef: string;
    }
  | {
      kind: "not_modified";
      representationRef: string;
      validationEvidenceRef: string;
      executionAuditRef: string;
    }
  | {
      kind: "access_required";
      reason: string;
      handoffRef?: string;
      executionAuditRef: string;
    }
  | {
      kind: "failed";
      failureClass: string;
      retryability: "yes" | "no" | "unknown";
      executionAuditRef: string;
    };
```

`AbortSignal` 是进程内能力，不能直接序列化到 REST 请求里。跨进程执行时，需要通过取消消息、任务 ID 和期限转换成本地信号。

当前 `LadderRunAudit` 已有完整尝试信息，新的执行记录应利用它，而不是只累计最终成功通道的用量。

---

# 6. Phase B1：持续任务、状态与可靠提交

## 6.1 B1 的最小交付

第一版只需要证明：

> 一个已配置的任务能够定期运行；服务重启后可以继续；失败不会破坏有效数据；同一结果不会被重复提交。

自然语言配置、智能调度、复杂 cron 和 UI 都不是这个最小版本的必要条件。

首版可以先支持“每 N 分钟”与手动触发，再增加带时区的日历式调度。

## 6.2 状态设计

建议分开维护：

```text
Run：
queued / running / waiting_retry / waiting_user / committing
completed / failed / cancelled / expired

Attempt：
running / succeeded / failed / interrupted / cancelled

Quality：
valid / partial / invalid / unknown

Change：
initialized / changed / unchanged / cannot_verify

Freshness：
fresh / stale
```

`completed` 仅表示本轮执行协议结束，不自动代表数据有效。

例如：

```text
execution = completed
quality = invalid
change = cannot_verify
freshness = stale
```

可以准确表达“本轮流程完成，但没有取得可信新数据”。

## 6.3 调度与领取

定时器不是真实任务状态，数据库才是。

调度器应在短事务内完成：

```text
检查 Monitor 启用状态与计划时间
→ 检查是否已有未结束 Run
→ 创建具有唯一 triggerKey 的 Run
→ 推进 nextRunAt
→ 提交
```

这样，即使进程在触发后立即崩溃，也不会只修改下次时间而丢掉本次任务。

建议为计划执行建立稳定键：

```text
monitorId + scheduleRevision + scheduledSlotUtc
```

手动请求使用调用方提供或服务端产生的幂等键。**重试同一个请求不能创建多个逻辑 Run。**

下面是拟议索引片段，完整表结构需在实现时补齐：

```sql
CREATE UNIQUE INDEX uq_run_trigger
ON monitor_runs (
  workspace_id,
  monitor_id,
  trigger_key
);

CREATE UNIQUE INDEX uq_active_monitor
ON monitor_runs (
  workspace_id,
  monitor_id
)
WHERE state IN (
  'queued',
  'running',
  'waiting_retry',
  'waiting_user',
  'committing'
);
```

其中 `waiting_user` 仍占用该 Monitor 的逻辑执行位置，防止每个调度周期又创建一个等待登录的任务。

## 6.4 租约与 fencing token

**租约**表示 worker 在一段时间内拥有执行权。

**Fencing token**是递增执行代号，用来阻止过期 worker 提交结果。

领取时：

```text
Run 可执行
→ 创建新 Attempt
→ fencingToken 增加
→ 写入 ownerId 与 leaseUntil
→ 返回执行上下文
```

续租必须同时匹配 owner、Attempt、执行代号和未过期状态。已经失去租约的 worker 不能自行续回来。

恢复时：

```text
旧 Attempt 标记 interrupted
→ 新建 Attempt
→ 新执行代号
→ 保留恢复关系和旧证据
```

不要让旧 Attempt 永远停在 `running`。

SQLite 的 `BEGIN IMMEDIATE` 可以用于需要提前取得写入权的短事务；如果已有写事务，则需要处理 `SQLITE_BUSY`。网络请求、浏览器等待和模型调用都不应放进这个事务。([SQLite](https://sqlite.org/lang_transaction.html "https://sqlite.org/lang_transaction.html"))

## 6.5 提交结果必须校验多种版本

最终提交时，不能只检查“任务还存在”。

至少同时核对：

**Run 状态、Attempt、fencing token、租约、Monitor 控制版本、授权版本和预期 Baseline 版本。**

建议的提交协议如下：

```text
开始短事务

1. 校验调用身份与工作空间
2. 如果该提交已有回执，返回原回执
3. 校验当前执行权、租约和控制版本
4. 校验授权未撤销
5. 校验目标范围及规则版本
6. 校验当前 Baseline 仍是比较时的版本
7. 校验 QualityAssessment 符合提交要求
8. 登记 Observation 与有效 Snapshot
9. 推进 Baseline
10. 写 ChangeEvent 与 Outbox
11. 写提交回执并结束 Run

提交事务
```

如果第 6 步失败，应该重新比较或重新采集，而不是用旧结果覆盖新版本。

“已经完成提交但响应丢失”时，第二次调用通过提交回执返回原结果，不再生成新事件。

## 6.6 不能混淆数据库租约与浏览器控制权

这是本设计的重要修正。

**租约过期可以阻止数据库提交，但不能撤销已经发出的点击、下载或网络请求。**

因此，B3、B4 必须额外管理浏览器环境的独占控制权。旧执行失联后，不能仅凭数据库租约到期，就立即把同一可变浏览器环境交给新执行。

对于 W2L 自己管理的环境，可以确认旧页面或上下文已关闭后恢复；对于用户自己的浏览器，如果无法确认旧操作停止，应暂停并交还用户。

## 6.7 时间、休眠与漏跑

首版建议：

**计划时间保存 UTC；用户日历配置保存 IANA 时区；任务内耗时使用单调计时。**

电脑休眠后默认执行一次合并检查，并记录遗漏区间，不瞬间补跑所有过期时点。

采用日历式调度时，应明确夏令时产生的重复或缺失时点如何处理。系统检测到明显时钟跳变时，应重新核对租约与调度，而不是假设墙上时间永远单调递增。

---

# 7. 存储与持久性设计

## 7.1 控制库与现有 TaskStore 的关系

建议新增一个 Section B 控制库，例如：

```text
.w2l/
  control.sqlite
  tasks/
  evidence/
  profiles/
  secrets/
```

现有 TaskStore 继续保存单轮执行细节。

**控制库负责 B 层的唯一权威状态：Run、有效版本、基线、事件和提交回执。**

不要试图依靠两个独立 SQLite 文件分别提交，来实现“任务完成”和“基线更新”的原子性。WAL 模式下，多个 `ATTACH` 数据库的修改并不作为整体保证原子提交。([SQLite](https://sqlite.org/wal.html "https://sqlite.org/wal.html"))

设计上应让 TaskStore 先产生可引用的执行结果，再由控制库进行最终业务提交；中途崩溃通过 Run ID 和提交回执协调恢复。

## 7.2 SQLite 的采用条件

首版采用 SQLite 的前提是单机控制面、短事务、可控写入量和真实备份恢复测试。

建议对业务控制库采用较保守的持久性配置，并明确区分“进程被杀”和“主机断电”。WAL 的 `synchronous=NORMAL` 与 `FULL` 在断电持久性上不同，进程中断测试不能替代断电语义验证。([SQLite](https://sqlite.org/wal.html "https://sqlite.org/wal.html"))

另外，本次官方资料核查发现：SQLite 在 **3.51.3** 及后续版本中修复了罕见的 WAL-reset 并发问题，另有 **3.44.6、3.50.7** 回补版本。**这不证明 W2L 当前一定受影响**，但发布前必须查询实际嵌入的 SQLite 版本，不能仅凭 `better-sqlite3` 包名推断。([SQLite](https://sqlite.org/wal.html "https://sqlite.org/wal.html"))

建议在环境证据中记录：

```sql
SELECT sqlite_version(), sqlite_source_id();
```

## 7.3 证据文件提交

推荐顺序：

```text
写入临时文件
→ 完成写入并校验哈希
→ 必要的持久化操作
→ 原子移动到最终位置
→ 在控制库登记引用
```

文件与数据库不能获得天然的跨介质原子性。因此优先允许“未被引用的孤立文件”，而不是允许“数据库引用了不存在的证据”。

孤立文件在宽限期后清理。被有效版本引用的证据，按保留政策处理。

备份使用一致性备份机制，并测试数据库、证据引用与待投递事件的恢复；不能只复制正在运行的 `.sqlite` 文件而忽略 WAL。SQLite 提供在线 Backup API 作为一致性备份途径。([SQLite](https://sqlite.org/backup.html "https://sqlite.org/backup.html"))

---

# 8. Phase B2：可信变化识别与增量处理

## 8.1 三层比较，不是一种哈希

| 层次比较对象主要用途 |                    |             |
| ---------- | ------------------ | ----------- |
| **原始证据层**  | HTTP 响应、渲染后 DOM、截图 | 追溯和诊断       |
| **目标内容层**  | 正文、指定区块、表格或卡片      | 降低无关布局与导航噪声 |
| **业务数据层**  | 类型化字段与对象关系         | 生成真正的业务变化   |

原始响应哈希和 DOM 哈希应标明不同采集类型。不能将它们都称作“原始页面哈希”，再直接比较。

归一化也要按内容类型设计：

**普通正文**可以做有限空白整理；**代码**需要保留有意义的缩进；**表格**需要保留行列关系；**金额**需要精确数值和币种；**列表**需要明确顺序是否有意义。

## 8.2 先验证，再比较

推荐流程：

```text
确认本次来源、账户和页面状态
→ 提取目标对象
→ 校验字段及关系
→ 确认采集完整性
→ 比较有效旧版本
→ 判断变化类别
→ 提交版本与事件
```

不能先比较两段文本，再让模型决定“这次变化是否可信”。

如果提取器错误地把推荐商品识别为主商品，那么再准确的差分算法也会得到错误业务事件。

## 8.3 传输缓存与有效基线必须分开

这是持续监控中最容易被忽略的状态问题。

假设：

```text
第一次：HTTP 200，ETag=E1，正文正确，建立有效基线。
第二次：HTTP 200，ETag=E2，内容是登录页，验证失败。
第三次：服务器返回 304，表示 E2 对应的表示没有变化。
```

**第三次的 304 不能证明 E1 的业务数据仍然是最新。**

建议分别保存：

```text
TransportRepresentation：
最近可按 HTTP 语义复用的表示、验证器和响应元数据

TrustedBaseline：
最近通过业务质量验证的数据版本
```

收到 304 后，复用的是对应的缓存表示，再判断它是否已经通过当前规则验证。若缓存表示无效、丢失或与当前账户范围不一致，不能直接更新业务验证时间。

HTTP 缓存标准定义了验证、`Vary` 和存储限制；它们没有替应用完成业务正确性判断。([IETF HTTP Working Group](https://httpwg.org/specs/rfc9111.html "https://httpwg.org/specs/rfc9111.html"))

## 8.4 缓存键与重新处理条件

建议缓存键至少考虑：

```text
工作空间与授权范围
+ 请求方法与资源身份
+ 内容变体
+ Vary 对应请求字段
+ 必要的视图上下文
```

业务提取缓存另加：

```text
目标 Schema 版本
+ 归一化规则版本
+ 提取规则版本
+ 验证规则版本
+ 模型和 Prompt 版本（使用模型时）
```

具体规则：

**不同账户默认不共享缓存。**

**`Vary: *`** **不走普通匹配复用。**

**`no-store` 不被当作可以忽略的建议。**HTTP 缓存与用户明确授权的审计归档是不同机制，不能把“保存证据”当作绕过数据保留限制的默认理由。([IETF HTTP Working Group](https://httpwg.org/specs/rfc9111.html "https://httpwg.org/specs/rfc9111.html"))

**没有有效缓存正文，就不能仅凭 304 构造完整数据。**

**HTML 未变化，不等于其动态接口数据未变化。**来源适配器需要说明目标数据由哪些请求或页面状态决定。

## 8.5 对象与价格关系

推荐的价格结构不是一个裸数字：

```json
{
  "entityKey": "supplier-a:product-123:variant-500g",
  "price": {
    "amount": "29.99",
    "currency": "CAD",
    "basis": "per_package",
    "billingPeriod": null,
    "taxTreatment": "unknown"
  }
}
```

金额使用精确十进制表示，不依靠二进制浮点直接比较。

规格、币种、计费周期和适用条件属于比较上下文。由月付变成年付折算价，不能仅报“价格下降”。

页面提供 JSON-LD 等结构化信息时，可以优先读取，但仍要核对主体和可见内容；声明数据与页面冲突时，应记录冲突，而不是默认任一来源永远正确。

## 8.6 删除必须以完整性为前提

对于列表和后台查询，必须记录：

```text
筛选条件
账户和权限范围
分页游标
目标总量或结束证据
已读取页数
重复游标与无进展情况
是否触发预算或错误
```

只有确认采集完整，才能考虑删除语义。

首版可以采用保守策略：

> 没有明确完整性证据时，只更新本次确认存在的对象；缺失对象标记待确认，不自动删除。

大列表可以先写入一个暂存批次，全部完成后再切换数据集版本指针，避免消费者看到半份新数据集。

## 8.7 提取规则变化不能冒充来源变化

规则升级后出现不同结果，至少有两种可能：

**网站真的变了。**

**网站没变，只是新规则修正了旧提取。**

建议将原因分开：

```text
source_changed
extraction_reprocessed
schema_migrated
manual_corrected
```

有旧原始证据时，可以用新规则重新处理前后证据，比较可比结果；没有时，应明确无法完全归因。

不能用新规则提取的新值直接与旧规则值比较，再给客户发送“刚刚发生变化”的通知。

## 8.8 变化事件与 Outbox

变化事件建议包括：

```text
eventId
monitorId
entityKey
entityVersion
fromSnapshotId
toSnapshotId
changeKind
changedFields
observationRef
assessmentRef
observedAt
previousVerifiedAt
```

事件 ID 不应只由旧值、新值构成。

例如 `A → B → A → B`，最后一次 A→B 是一次新的真实变化，不能因为以前出现过同样的值对就被去重掉。

业务提交与 Outbox 记录同事务；网络发送在事务外。Outbox 模式能够解决本地数据写入与通知记录之间的双写问题，但投递仍可能重复，需要接收方幂等处理。([AWS Documentation](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html "https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html"))

对下游要区分：

**状态同步**：按对象版本更新，拒绝旧版本覆盖新版本。

**事件消费**：按事件 ID 去重，保留每次真实变化。

如果交付的是增量 patch，下游发现前置版本缺失，应补拉历史或请求完整快照，而不是直接应用。

---

# 9. Phase B3：授权会话复用与人工接管

## 9.1 推荐三种会话后端

| 后端主要用途默认策略                     |                 |               |
| ------------------------------ | --------------- | ------------- |
| **Managed Persistent Profile** | W2L 专用环境，持续执行任务 | 首版默认          |
| **Storage State Snapshot**     | 兼容站点的认证状态复用     | 可选            |
| **Existing Chrome Session**    | 使用用户当前已登录环境     | 后续、有明确授权的可选路径 |

Playwright 支持持久化上下文和 CDP 连接，但官方说明：默认个人 Chrome 目录不应直接用作自动化持久化目录；CDP 连接的完整兼容能力也低于 Playwright 自身协议。([Playwright](https://playwright.dev/docs/api/class-browsertype "https://playwright.dev/docs/api/class-browsertype"))

因此，不能把三种方式伪装成完全等价的 `Page` 对象。

建议由 BrowserAdapter 声明能力：

```text
能否创建隔离环境
能否暂停和重新连接
能否可靠取得响应元数据
能否采集 DOM 与截图
能否拦截指定请求
谁拥有浏览器生命周期
取消时可以关闭什么
```

不具备所需能力的后端，应拒绝对应任务，而不是悄悄降级。

## 9.2 会话身份设计

当前按域名加载的 SessionStore 不足以支持多账户隔离。

建议键空间包括：

```text
workspaceId
accountRef
originScope
profileId
sessionRef
grantEpoch
```

其中：

**`accountRef`** 表示任务期待的账户，不保存密码。

**`grantEpoch`** 表示授权版本。撤销或重新授权时变化，旧任务不得继续使用旧授权。

**`sessionRef`** 指向受控凭据和浏览器环境，不应暴露调试端口或秘密材料。

## 9.3 SessionBroker：浏览器控制的唯一入口

建议由 SessionBroker 持有浏览器连接，并串行执行同一 profile 的有状态命令。

普通 worker 不直接持有可随意使用的用户浏览器端点，而是提交受限命令：

```text
在指定会话和执行代号下：
观察页面
进入允许的 URL
填写已批准查询字段
执行已批准查询
读取指定结果
暂停或释放控制
```

每条命令都检查授权、控制权、期限和作用范围。

如果旧命令已经发出，撤销只能阻止后续命令并尝试终止进行中的操作，**不能承诺撤回网站已经处理的请求**。

## 9.4 连接用户正在使用的 Chrome

Chrome 官方提供 Chrome 144+ 的自动连接方式，要求用户启用 Remote Debugging，并在连接时批准。连接会继承现有会话的账户和数据，因此不能宣传为天然的单标签页隔离。([Chrome for Developers](https://developer.chrome.com/docs/devtools/agents/get-started/configuration "https://developer.chrome.com/docs/devtools/agents/get-started/configuration"))

当前官方文档还列出部分更细粒度配置，例如 Chrome 149+ 的允许 URL 模式。这类能力应放进版本能力表，而不是假设所有用户 Chrome 都支持。([Chrome for Developers](https://developer.chrome.com/docs/devtools/agents/get-started/configuration "https://developer.chrome.com/docs/devtools/agents/get-started/configuration"))

建议严格区分：

**W2L 拥有的浏览器**：可以按任务生命周期关闭。

**用户拥有的浏览器**：任务结束只释放连接；不随意关闭整个实例、注销账户或修改默认 profile。

用户主动操作同一页面时，自动化应暂停或重新验证，而不是与用户争抢控制。

## 9.5 认证快照与凭据保护

认证状态文件可能包含能用于冒用账户的材料；某些存储机制也不是一次保存 `storageState` 就全部覆盖。应按实际站点验证，不假设快照等同完整登录环境。([Playwright](https://playwright.dev/docs/auth "https://playwright.dev/docs/auth"))

建议：

**密钥与加密内容分离保存。**本地可使用操作系统密钥存储或明确配置的秘密管理方案。

**浏览器 profile 本身也视为敏感资产。**只加密一个 Cookie JSON，不代表整个 profile 已受保护。

**撤销 W2L 授权不等于注销网站会话。**是否对网站执行 logout，应由用户明确决定。

**恢复材料不能因为被称作 continuation token，就自动当作非敏感信息。**

## 9.6 人工接管协议

建议流程：

```text
检测认证要求
→ 保存 waiting_user
→ 生成绑定任务的 handoff 记录
→ 普通计算 worker 退出等待
→ 用户取得会话控制权并完成认证
→ 验证当前账户与业务范围
→ 新建执行尝试或恢复安全步骤
```

handoff 应绑定：

```text
runId
recipeRevision
stepId
sessionRef
grantEpoch
expiresAt
```

“用户点击了继续”只是恢复请求，不是认证成功证明。恢复前仍要核对账户、页面和筛选条件。

同一 Monitor 在等待期间保持逻辑未结束，避免产生一串相互竞争的登录任务。

---

# 10. Phase B4：有限后台流程与受控修复

## 10.1 用 Recipe 描述流程，而不是大段自由 Prompt

建议的 Recipe 是可验证、可版本化的配置。

```yaml
id: supplier-price-reader
revision: 1

sessionRef: supplier-account-a

scope:
  businessOrigins:
    - https://supplier.example
  allowedEffects:
    - read
    - query
    - download

steps:
  - op: assertAccount
    accountRef: supplier-account-a

  - op: navigate
    targetRef: product-search-page

  - op: fill
    target:
      role: textbox
      name: Product search
    valueFrom: parameters.productCode

  - op: click
    target:
      role: button
      name: Search
    effect: query

  - op: waitForResult
    conditionRef: results-or-confirmed-empty

  - op: extract
    schemaRef: supplier-price-v1

  - op: validate
    policyRef: supplier-price-quality-v1

limits:
  maxSteps: 30
  maxRepairAttempts: 2
  onAuthenticationRequired: pause
```

这是格式示例，数值是可配置初始限制，不是已证明的最佳设置。

## 10.2 每一步都有前置条件和完成条件

点击按钮没有报错，不代表查询完成。

建议至少核对：

**执行前**：账户正确、筛选范围正确、目标唯一、动作被允许。

**执行后**：查询状态变化、结果区域出现、加载结束或存在可信空结果提示。

Playwright 的语义 Locator 可以作为基础；其定位会在动作时重新解析 DOM。业务对象是否仍然一致，仍需额外判断。([Playwright](https://playwright.dev/docs/locators "https://playwright.dev/docs/locators"))

遇到多个匹配，不默认选择第一个。应缩小区域、补充上下文，或请求人工确认。

## 10.3 重试按业务效果分类

建议分为：

```text
read
query
download
write_requires_approval
```

不能把 GET 一律当作无副作用，也不能把 POST 一律当作不可重试。应由已审查的步骤语义决定。

对于提交后连接断开的写入：

```text
effect_unknown
```

是必要状态。系统应查询回执或交给用户，不能直接再提交一次。

B4 首版仍以读取、筛选、分页和导出为主。

## 10.4 修复机制

建议采用：

```text
失败现场
→ 模型提出候选修复
→ 权限与作用范围检查
→ 前置条件验证
→ 受控试运行
→ 后置条件与任务质量检查
→ 新 Recipe 版本
→ 小范围验证
→ 批准推广或回滚
```

禁止模型自行：

**扩大域名、切换账户、取消预算、删除必需字段、修改质量规则或执行任意脚本。**

预先编写的 DOM 读取函数仍然可以使用；禁止的是把模型生成的任意代码直接当作可信执行代码。

---

# 11. 多模态智能层

## 11.1 定位：受约束的诊断与建议系统

多模态能力不是 B1 的控制中心，也不是 Section B 的默认取数方式。

建议优先顺序：

```text
明确结构化数据
→ 确定性 DOM 提取
→ 文本/DOM 模型判断
→ 必要的局部图像判断
→ 人工复核或明确退出
```

获取路径与推理路径分别升级。HTTP 已获得完整内容但字段关系不清时，不一定需要浏览器；页面根本没有取得时，模型也不能补出事实。

## 11.2 三个模块与两个辅助机制

| 模块职责                |                        |
| ------------------- | ---------------------- |
| `EvidenceCollector` | 收集候选 DOM、文本、字段上下文与必要截图 |
| `ModelAdapter`      | 调用模型并返回固定结构            |
| `ProposalValidator` | 校验候选引用、权限、预算、前置条件和证据   |

辅助机制为：

**InvocationPolicy**：什么时候值得调用模型。

**VerifiedRecipeStore**：保存已经验证过的提取配置或修复版本。

这些可以先是同一代码库中的模块，不必立即拆成独立 npm 包或服务。

## 11.3 触发条件

不能只在“缺字段”时调用模型，因为错误数据可能看起来完整。

建议触发依据包括：

**对象归属冲突、关键字段异常跳变、模板失效、正文与结构化数据冲突、页面状态可疑。**

同时，对一小部分看似成功的结果做独立抽查，以发现静默错误。

触发规则、抽样比例和阈值应在实际任务上调整，并记录版本。模型自报的 confidence 不应直接作为正确率。

## 11.4 截图与 DOM 的一致性

证据包建议包含：

```text
observationId
captureStartedAt / captureFinishedAt
URL 与页面导航代号
sessionScopeRef
viewport 与 deviceScaleFactor
scrollOffset
截图区域
DOM 候选及其临时 ID
采集前后页面变化信号
```

截图与 DOM 通常不是完全原子取得的。采集期间页面变化时，应标记不一致并有限重试，而不是声称二者一定来自完全相同瞬间。

Playwright 已提供页面和元素截图能力，但这些证据如何绑定到一次观察，需要 W2L 自己实现。([Playwright](https://playwright.dev/docs/screenshots "https://playwright.dev/docs/screenshots"))

临时节点 ID 仅在当前 Observation 内有效。后续任务复用的是定位方法和验证条件，不是某次的 `n42`。

## 11.5 模型输出

建议限制模型返回：

```json
{
  "observationId": "obs-123",
  "pageState": "target_content",
  "proposal": {
    "action": "extract_candidate",
    "candidateId": "card-7"
  },
  "fieldBindings": [
    {
      "field": "monthly_price",
      "candidateId": "card-7",
      "evidenceIds": ["text-12", "text-14"]
    }
  ],
  "uncertainties": []
}
```

允许的动作可以是重新提取候选区块、补充观察、等待已定义条件、请求人工授权或停止。

模型不能直接返回“请执行这段 SQL/JavaScript”作为普通控制协议。

## 11.6 模型选择与本地部署

Qwen3.5-4B 有官方图文模型依据，可以作为试验候选；但不能仅凭模型卡判断其在 W2L 上的字段正确率和视觉修复效果。([Hugging Face](https://huggingface.co/Qwen/Qwen3.5-4B "https://huggingface.co/Qwen/Qwen3.5-4B"))

Ollama 支持结构化输出，可以用于约束结果格式。**Schema 验证通过，只证明格式符合要求，不证明内容真实。**([Ollama](https://docs.ollama.com/capabilities/structured-outputs "https://docs.ollama.com/capabilities/structured-outputs"))

建议先固定一个候选模型与版本，再依次比较：

**同一模型不看图、按需看图，以及更小模型。**

不要同时变更模型、截图策略、候选生成和验证标准，否则无法解释收益来源。

部署模式建议：

```text
off：不调用模型
shadow：旁路判断，不影响正式结果
assist：允许执行经过验证的有限建议
```

数据策略另设 `local_only` 或 `approved_cloud`。本地推理失败，不得静默切换到云端。

---

# 12. 安全与隐私架构

## 12.1 威胁与控制点

| 风险建议控制            |                                     |
| ----------------- | ----------------------------------- |
| 网页诱导模型泄露数据或越权     | 页面只作数据；固定工具协议；执行器再次检查权限             |
| SSRF、重定向或 DNS 变化  | 初始地址与每次跳转验证；实际连接出口限制；不只校验字符串        |
| 同域多账户混用           | 会话、缓存、基线与证据均包含账户范围                  |
| 过期 worker 继续操作    | 数据库 fencing＋SessionBroker 控制代号＋取消确认 |
| 截图、日志泄露敏感内容       | 最小采集、脱敏、访问控制、期限和磁盘限制                |
| 下游 Webhook 访问内部地址 | 输出目的地单独授权，不复用抓取来源权限                 |
| 模型生成任意代码          | 禁止自由执行；只接收受限动作与候选引用                 |
| 本地 API 被其他网页调用    | 本地认证、Host/Origin 检查、敏感动作不通过无保护 GET  |

OWASP 对 SSRF 强调应用与网络层联合防护；对 Prompt Injection 强调不可信输入、最小权限和受控工具调用。这里的控制需要在代码和部署层实施，不应只依靠提示词。([OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html "https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html"))

## 12.2 浏览器网络钩子不是完整安全边界

Playwright 网络处理能力可以辅助观察和控制请求，但 Service Worker 等路径会影响拦截行为。官方文档也讨论了相关限制。([Playwright](https://playwright.dev/docs/network "https://playwright.dev/docs/network"))

因此，公开不受信任 URL 的执行，仍需要部署层出口策略和独立安全验收。

对于客户授权内网，使用明确的服务范围；不要因为是“企业内部任务”，就允许访问全部私网和云元数据地址。

## 12.3 Local-first 的可验证定义

建议将严格本地模式定义为：

> 抓取正文、截图、认证材料和模型输入不发送给 W2L 运营方或未获准第三方；仅访问客户批准的来源、模型端点和输出目的地。

Ollama 提供关闭云功能的配置，例如 `OLLAMA_NO_CLOUD=1`。Chrome DevTools MCP 也有使用统计和性能 URL 外发选项，需要显式核对与关闭。([Ollama](https://docs.ollama.com/faq "https://docs.ollama.com/faq"))

还应检查更新检查、错误上报、依赖遥测和调试日志。**关闭一个模型的云功能，不代表整条链路没有外发。**

本地部署也不等于自动满足全部隐私或数据使用要求；授权范围、保留期限和输出策略仍要明确。

---

# 13. API、SDK 与对外契约

以下是建议的新增接口，不代表当前 API 已支持。

| 接口作用                              |             |
| --------------------------------- | ----------- |
| `POST /v1/monitors`               | 创建长期任务      |
| `POST /v1/monitors/:id/revisions` | 创建不可变配置版本   |
| `POST /v1/monitors/:id/runs`      | 手动触发，支持幂等键  |
| `POST /v1/monitors/:id/pause`     | 暂停后续调度      |
| `POST /v1/runs/:id/cancel`        | 取消当前执行      |
| `GET /v1/runs/:id`                | 执行、质量和变化状态  |
| `GET /v1/monitors/:id/snapshots`  | 查询有效版本      |
| `GET /v1/monitors/:id/events`     | 查询变化事件      |
| `POST /v1/handoffs/:id/resume`    | 提交人工接管恢复请求  |
| `POST /v1/sessions/:id/revoke`    | 撤销 W2L 使用授权 |

API 应返回结构化状态，不只返回自然语言错误。

读取当前数据时，至少同时返回：

```json
{
  "dataVersion": 17,
  "lastValidData": {},
  "lastCheckedAt": "2026-09-21T02:00:00Z",
  "lastVerifiedAt": "2026-09-20T02:00:00Z",
  "freshness": "stale",
  "latestRun": {
    "execution": "completed",
    "quality": "unknown",
    "change": "cannot_verify",
    "reason": "authentication_required"
  }
}
```

这样调用方不会将旧数据当成刚刚验证的新数据。

原有 scrape/crawl 入口保持兼容。不要让 UI、MCP 和 API 各维护一套任务状态。

---

# 14. 成本、性能与容量设计

## 14.1 不只统计最后一次成功

建议执行计量至少分为：

**采集成本**：全部 HTTP、浏览器、Provider 尝试。

**模型成本**：输入文本、图像、输出、等待和推理时间。

**存储成本**：原始证据、有效版本、事件历史。

**维护成本**：人工认证、修复规则、复核字段和处理异常。

输出 Markdown Token 与模型输入 Token 必须分开，不能混成“Token 成本”。

对于未知项，保留：

```text
knownSubtotal
unknownCount
notApplicableCount
measurementSource
```

不要使用 `null ?? 0` 把未知流量或费用合计成零。

## 14.2 并发需要分池

建议独立限制：

```text
HTTP 并发
浏览器上下文并发
每站点并发
每账户/profile 并发
模型推理并发
证据写入并发
```

同一 profile 的有状态任务通常需要更严格串行，不应随全局 browser 并发一起提高。

模型和长时间 CPU 工作不能阻塞续租与控制循环。BullMQ 文档中的 stalled 机制也体现了事件循环长期阻塞对任务活性判断的影响。([BullMQ](https://docs.bullmq.io/guide/jobs/stalled "Stalled | BullMQ"))

## 14.3 容量估算

在实测前，可以使用一个规划公式：

```math
\text{平均浏览器占用} \approx \text{任务到达率} \times \text{浏览器使用比例} \times \text{平均浏览器占用时间}
```

它只能帮助确定试验配置，不是性能保证。实际还要考虑站点限速、任务集中到期、内存、模型争用和尾部延迟。

首版应通过错峰和有限队列平滑任务，不能用无限并发掩盖排队。

---

# 15. 技术可行性结论

## 15.1 分模块判断

| 模块可行性判断已有依据尚未证明     |                  |                          |                    |
| ------------------- | ---------------- | ------------------------ | ------------------ |
| **B1 持久化持续任务**      | 可行，主要难点是状态正确性    | SQLite 事务能力、现有任务契约       | W2L 新状态机的故障恢复与负载表现 |
| **B2 类型化增量处理**      | 可行，但依赖可靠提取与完整性判断 | HTTP 缓存标准、数据库与 Outbox 模式 | 真实任务的误报、漏报、节省比例    |
| **B3 专用环境会话复用**     | 可行，需逐站验证         | Playwright 认证与持久化能力      | 各站点失效、跨重启和人工恢复行为   |
| **B3 现有 Chrome 接入** | 有条件可行            | Chrome 官方授权连接路径          | 版本兼容、权限边界、用户干预行为   |
| **B4 有限后台流程**       | 可行，必须限制任务范围      | 浏览器定位与自动化能力              | 跨客户复用率和维护成本        |
| **多模态字段与修复建议**      | 接口层可行，效果待实测      | 图文模型和结构化输出能力             | W2L 上的准确率、净收益与硬件开销 |
| **任意网站全自动修复**       | 不作为本方案承诺         | 现有证据不足                   | 无统一、可验收的普遍保证       |

## 15.2 本次实际完成了哪种验证？

本次完成的是：

**官方能力核验、仓库接口对照，以及关键协议的逻辑分析。**

本次没有完成：

**完整编译、数据库并发原型、Chromium 交互原型、模型推理试验、故障注入和负载测试。**

因此，当前结论是：

> **设计具备清晰的实现路径，但不能标记为“生产验证通过”。**

---

# 16. 关键协议的故障推演

下面是设计推演，不是本次已经执行的测试结果。

## 16.1 两个 worker 同时领取任务

**风险：**相同计划执行两次。

**设计处理：**唯一 triggerKey 防止重复 Run；领取通过短事务和新 Attempt 执行代号完成。

**预期结果：**最多一个有效持有者，另一方无任务可领或收到竞争失败。

**必须实测：**多连接竞争、进程重启和重复 API 请求。

## 16.2 旧 worker 过期后返回

**风险：**旧结果覆盖新结果。

**设计处理：**提交检查 Attempt、fencing token、Monitor 控制版本和预期 Baseline。

**预期结果：**旧结果可以保留为失败审计，但不得成为有效版本。

**剩余边界：**此前已经发送的浏览器请求不能靠数据库检查撤销，需要 SessionBroker 单独处理。

## 16.3 数据已提交，通知确认丢失

**风险：**要么漏通知，要么重复更新。

**设计处理：**数据与 Outbox 同事务；发送器重试；接收方依据 eventId 或 entityVersion 幂等处理。

**预期结果：**可能重复投递，但不重复产生业务状态更新。

**剩余边界：**任意接收方不支持幂等时，不能宣称端到端只执行一次。

## 16.4 登录页进入缓存后收到 304

**风险：**旧有效数据被错误刷新为“已验证”。

**设计处理：**304 绑定 TransportRepresentation；该表示仍是无效页面，不能推进 TrustedBaseline。

**预期结果：**保持旧数据与过期状态，请求认证。

## 16.5 页面未变，规则升级

**风险：**把修复后的提取值当作网站新变化。

**设计处理：**规则版本进入比较上下文；必要时重处理前后证据；事件标记为 `extraction_reprocessed`。

**预期结果：**来源变化和规则修订可以区分。

## 16.6 用户人工操作浏览器

**风险：**自动化继续使用过期元素或错误账户。

**设计处理：**用户接管改变控制权；恢复时重新验证账户、页面和业务范围。

**预期结果：**不会盲目从旧的下一条点击继续。

---

# 17. 验证计划与验收标准

## 17.1 测试层次

| 层次验证内容      |                          |
| ----------- | ------------------------ |
| **纯逻辑测试**   | 字段状态、对象键、差分、规则版本、事件去重    |
| **数据库测试**   | 领取竞争、租约、提交回执、事务回滚、恢复     |
| **受控网页测试**  | 动态加载、登录页、错误页、分页、单位与价格关系  |
| **浏览器集成测试** | 会话隔离、取消、人工接管、重连和资源回收     |
| **真实任务测试**  | 跨日期重复运行、页面改版、维护成本        |
| **负载与恢复测试** | 长时间运行、队列积压、磁盘满、服务重启、备份恢复 |

## 17.2 必须覆盖的测试矩阵

| 场景正确结果          |                  |
| --------------- | ---------------- |
| 页面导航噪声变化，目标字段不变 | 不发业务变化           |
| 价格变化但文本长度相同     | 识别变化             |
| 月付价格换成年付折算价     | 识别上下文差异，不错误直接替换  |
| 主商品与推荐商品同时有价格   | 绑定正确主体或明确未知      |
| 页面变为登录页         | 不覆盖基线            |
| 只完成部分分页         | 不批量删除缺失对象        |
| 缓存正文丢失但返回 304   | 不凭空返回有效数据        |
| 相同值对再次出现        | 新变化不被历史事件吞掉      |
| 旧 worker 在恢复后提交 | 拒绝               |
| 授权在执行期间撤销       | 停止后续操作，拒绝有效提交    |
| 提交后响应丢失         | 返回原回执，不生成新事件     |
| Webhook 确认丢失    | 安全重试             |
| 模型建议扩大域名或删字段    | 拒绝               |
| 模型服务不可用         | 正常确定性任务不受影响      |
| 原始内容变化但关键字段不变   | 记录观察差异，不误报业务变化   |
| 备份恢复后存在待投递事件    | 保留事件身份，不盲目重复业务写入 |

**这些已知测试场景中不允许出现关键数据污染，不等于已经证明真实互联网中错误率为零。**

## 17.3 模型试验设计

保留三组：

| 组别配置 |                 |
| ---- | --------------- |
| D0   | 确定性方案           |
| D1   | 相同预处理＋文本/DOM 模型 |
| D2   | 相同模型与策略＋按需图像    |

所有组应获得相同的确定性候选整理，避免把更好的预处理误算成模型收益。

指标需要同时记录：

**额外恢复的正确任务、模型引入的新错误、变化误报和漏报、拒绝判断比例、人工修正、完整延迟和资源成本。**

保留集应按站点或模板隔离。已经用于调规则的页面，不再作为独立泛化样本。

不能只在模型愿意作答的任务上计算准确率；拒绝或无法判断的任务也要反映在整体覆盖率和变化漏报评估中。

---

# 18. 分阶段实施方案

## 18.1 A→B 交接

先完成与 B 正确性直接相关的接口工作：

**生产质量契约、完整执行计量、明确中断终态、取消传递和证据版本。**

不要求先重构全部 Section A，也不要求先让任意网站全部通过。

## 18.2 B1 实施单元

| 单元交付物验收重点 |                                          |                  |
| --------- | ---------------------------------------- | ---------------- |
| B1.1      | Monitor、Revision、Run、Attempt 契约与迁移       | 配置版本不可变，旧 API 兼容 |
| B1.2      | 持久化调度、唯一触发、租约                            | 不重复创建，不接受过期提交    |
| B1.3      | Observation、Assessment、Snapshot、Baseline | 无效结果不污染有效数据      |
| B1.4      | 原子提交、回执、恢复与备份                            | 各崩溃点可恢复，状态收敛     |

## 18.3 B2 实施单元

| 单元交付物验收重点 |                          |                   |
| --------- | ------------------------ | ----------------- |
| B2.1      | 对象身份、类型化字段、归一化与比较        | 数值、单位、主体和空值语义正确   |
| B2.2      | 独立传输缓存与条件请求              | 304、账户变体和无效缓存不误更新 |
| B2.3      | 初始化、变化、过期、完整性与删除规则       | 失败不当变化，部分采集不删数据   |
| B2.4      | ChangeEvent、Outbox 与消费协议 | 重复投递与顺序可处理        |
| B2.5，可选   | 文本/视觉旁路诊断                | 有独立证据证明净收益        |

## 18.4 B3 实施单元

先实现专用持久化环境，再接现有 Chrome：

```text
会话引用与秘密存储
→ 多账户隔离
→ SessionBroker
→ 过期与撤销
→ 人工接管与恢复
→ Existing Chrome 能力适配与验证
```

这比从“无感接管用户当前 Chrome”开始更容易建立可靠边界。

## 18.5 B4 实施单元

```text
固定 Recipe 执行器
→ 前置/后置条件
→ 查询、分页和下载
→ 中断恢复
→ 模型提出候选修复
→ 受控验证与版本推广
```

第一条 Recipe 必须对应真实、重复的后台任务。不要先做自由画布，再寻找任务填进去。

---

# 19. 建议的首个完整试点

建议选一个现有能力较匹配的公开资料持续更新任务，例如：

> 持续检查一组技术文档或软件产品资料，维护明确字段和正文区块，只对经过验证的变化生成事件。

第一版只需要完成：

```text
定义任务
→ 定时执行
→ 正确采集
→ 质量验证
→ 保存有效版本
→ 识别变化
→ 写入本地事件
→ 查询运行与历史
```

不用同时引入登录、复杂点击、模型规划和多个下游连接器。

试点通过后，再增加一个授权后台任务，用相同版本、验证和事件层承接会话与流程能力。

**判断试点成功，不是看跑了多少页面，而是看使用者是否持续依赖这份更新结果，以及系统是否减少了人工检查和维护。**

---

# 20. 最终技术建议

## 20.1 建议采用的架构

**继续使用 TypeScript、Node.js、现有采集引擎和 SQLite。**

新增能力集中在：

```text
ContinuousTaskRuntime
QualityAssessment
Observation / Snapshot / Baseline
TypedDiff
SessionBroker
RecipeExecutor
OptionalModelAssistance
```

这些首先是清晰的逻辑边界，不需要同时变成七个独立服务。

## 20.2 最重要的实现优先级

**第一优先级：**把任务执行、数据有效性和基线提交做对。

**第二优先级：**把对象、字段、变化和缓存语义做对。

**第三优先级：**把授权会话、人工接管和恢复做对。

**第四优先级：**用模型减少疑难任务和页面改版的维护成本。

这个顺序不能反过来。模型可以增强理解，但不能替代持久化、事务、权限和正确性协议。

## 20.3 当前可行性结论

**Section B 的核心实现路径具备充分的技术依据，适合进入小范围工程原型。**

但现阶段仍不能宣称：

- 已验证全部状态机制；
- 已证明小模型能显著提高 W2L 准确率；
- 已证明节省某个固定比例成本；
- 已证明所有已登录 Chrome 场景都可稳定接入。

下一步最合适的工程交付是：

> **B1 的最小持久化运行时，加上一个不使用模型、不依赖登录的 B2 字段变化任务，并为失败、重试、取消和恢复建立可重复测试。**

这条链路完成后，再增加复杂能力，才能判断每项增强真正带来的收益。

**最终，W2L 的差异化应当是“持续更新的数据更可信、异常更容易处理、维护更少”，而不是“每次抓取都调用更聪明的模型”。**
