# W2L 阶段复盘与下一步

复盘日期：2026-09-22。代码基线：`main@e29dc6b`（PR46）。

本次依据：当前主干源码、测试文件、已提交研究记录和 GitHub 合并记录。未重新执行线上 200 次采集、全部测试或客户安装；历史测试通过不能代替新增功能专项验收。此文覆盖此前对阶段完成度过于宽泛的描述。

## 1. 总体判断

方向不变：A 可靠采集 → B 持续维护可信数据 → C 交付、采用与商业验证。

- **A：有条件开发者 Alpha**。核心抓取与恢复有积累；不能视为所有真实网站或独立用户安装都通过。
- **B：B1/B2 单任务原型已跑通，B3 会话原型已接 API，CDP/B4 库级代码已合入。全 Section B 尚未验收完成。**
- **C：本轮完成详细规划，产品实现未开始**。已有 REST/SDK/MCP 和本地 outbox 是可复用基础，不等于交付系统已完成。

## 2. 已有成果及证据边界

| 阶段 | 已有事实 | 不应扩大解释为 |
| --- | --- | --- |
| A1–A3 | 采集引擎、fixture、CI、既有比较报告 | 通用互联网成功率、实际账单成本优势 |
| A4–A6 | 20 任务诊断、100 项扩样、恢复记录、同机 clean clone | 强字段准确率、真正独立 holdout、另一开发者安装 |
| B1/B2 / PR42 | Firecrawl Introduction 固定配置；Run/Attempt、Observation/Assessment、Snapshot/Baseline、字段 diff、event/outbox；初始化与无变化实跑 | 通用 Monitor、常驻生产调度、跨日期稳定性、已交付下游 |
| B3 / PR43–45 | managed profile 路径、sessionRef、作用域、grantEpoch、handoff/renew/revoke/status API；撤销终态后来得到修正 | 已验证真实登录、账户身份、完整人工接管、所有执行路径即时撤销 |
| CDP/B4 / PR45 | BrowserControl、RecipeExecutor、RecipeStore、限制动作/预算、effect_unknown | 用户 Chrome 实测通过、真实后台任务交付、通用后台 Agent |
| 可靠性 / PR46 | HTTP-date 解析、503 backoff/jitter、实例内 429/503 冷却 | 不提前重试、并发串行化、跨 lane 冷却、刻意反爬成功率提升 |

合并记录：PR42 `181c23e`；PR43 `ab796bd`；PR44 `829a017`；PR45 `b4b35cd`；PR46 `e29dc6b`。

## 3. 本次发现的完成度缺口

### A 证据与重试正确性

1. `packages/http-core/src/resilient.ts` 和 BrowserLocal 仍使用 `Math.min(serverDelay, cap)`：服务端要求等更久时会提前重试。应改成预算不足就延期/退出，而非缩短服务端等待时间。
2. `ResilientHttpSubject.cooldownUntilByHost` 为实例内 Map；等待使用普通 timer，冷却上限 30 秒；没有同源请求队列。原有测试是顺序请求，不能证明并发串行。
3. 历史 `18 minutes` 来自代理写入的 JSON；未发现可核验的人类计时/确认，不能作为已测人工维护成本。本轮不改写历史证据文件，要求补人类确认或改为未验证。
4. A6 `quality_subset_field_assertions` 仅判断样本数大于零，7/8 仍为 ok；holdout 仅按是否出现在 A5 判定独立，缺冻结与模板隔离证据。不得据此宣布质量门已全过。
5. 真实零账单也可有数值 0；当前本地没有账单应保持 null。不能把“禁止伪造零”扩展成“任何供应商报告零均非法”。

### B1 可靠运行

- 固定 `FIRECRAWL_MONITOR_ID` 和五个字符串字段，通用配置尚未交付。
- `scripts/section-b/monitor-recovery-smoke.ts` 子进程只创建 Run 后等待，未实际进行 capture；恢复使用 `Date.now()+300001`，不是实等租约过期，也未验证恢复后完成提交。
- MonitorStore 的双连接测试是先后领取，并非并行进程竞争；回执重放、旧 worker 提交及完整崩溃点矩阵仍需独立测试。
- scheduler 是轮询脚本；未发现已安装常驻服务或跨日期运行证据。取消信号未贯穿 monitor capture。
- generated evidence 比手写摘要好，但尚需快照一致性、版本/源码绑定和证据完整性核验；不再删除生产试点库来制造初始化证据。

### B2 差分完整性

- `changed` 由手工构造 Assessment 的单测验证；“真实采集内容 → 隔离库受控变体 → 生产验证器 → changed”尚未形成可审计证据包。
- 缺 FieldValue 状态、金额/单位等类型、资源/视图/对象身份分离、规则变更归因、列表完整性/删除语义。
- 没有 ETag/Last-Modified 与 TransportRepresentation 层。不能把 304 直接当业务基线验证成功。
- 本地 outbox 只有 pending/acknowledged；无投递 worker、订阅者、重试、回执或目标适配器。

### B3 会话与 CDP

- `/authorize` 只核对传入 accountRef 和状态，不证明浏览器实际登录到该账户；handoff 未绑定 run/step/recipe revision。
- `captureManagedSession` 用 BrowserLocal 直接抓取；未统一经过 BrowserControl 的锁与逐步授权检查。已有 `publicSession()` 未接状态返回路径，profileDir 仍可被 API 返回。
- `grant()` 能返回 expired，但 GET 状态不一定反映动态过期；日期输入校验及过期/续授权并发需要补齐。
- `createExistingSession`/BrowserControl 存在于库，未提供 Existing Chrome REST/CLI 完整入口；没有真实 CDP detach 后浏览器和用户 tab 存活测试。
- 专用 profile/注册文件权限不等于全部凭据加密；共享 CDP context 不等于账户/网络隔离。

### B4 Recipe

- `RecipeExecutor` / `RecipeStore` 未连接 API/CLI，也无正式后台示例及专项测试。不能用此前 837/840 总测试数推断这些类已经验证。
- query 的 postcondition 可能执行前已经成立；应证明本次查询触发并产出对应结果。GET/POST 本身不能证明业务是否只读。
- `RecipeStore.step()` 未核对 attempt 代号，finish 读取与更新也未构成 CAS；应验证旧执行不能写入新尝试。
- 浏览器锁不会自动抢占是谨慎选择，但崩溃后需要可审计解锁协议。BrowserControl 打开失败后的 timer/poll 清理仍需故障测试。
- effect_unknown 是正确起点；后续需要回执核对/人工处理，而非仅换 trigger 重试。
- 仍缺真实授权后台的使用者、成功字段、查询范围、分页结束证据和维护成本记录。

## 4. 最高 ROI 的执行顺序

| 顺序 | 交付 | 通过标准 |
| --- | --- | --- |
| P0 | 修正 Retry-After 提前重试和完成度报告 | 大 delay 不提前请求；并发/取消/不同 origin 有测试；未验证证据不自动通过 |
| B1 收尾 | 同一 Firecrawl URL 持续运行与故障包 | 真正 capture 中 kill→恢复完成；过期提交拒绝；回执幂等；跨日记录保留 |
| B2 收尾 | 隔离库受控变化实验、有限通用配置 | 明确 synthetic 标签和原始哈希；A→B→A→B 均正确；不同 monitor 不串 trigger/基线 |
| B3 收尾 | 一个统一 broker 入口及登录 fixture | 同域多账户隔离；撤销进行中；handoff 重新核验账户；CDP disconnect 后原 tab 存活 |
| B4 收尾 | 一个批准的后台查询/导出 Recipe | 产品入口可运行；后置条件可验证；中断不重放不明效果；参数/账户边界测试 |
| C1 | Firecrawl 变化事件 → 一个真实接收端 | 不漏记录；投递可重复而业务不重复；ACK 丢失恢复；失败不会抹掉旧值 |
| C2–C4 | 见 Section C 完整计划 | 每阶段以用户结果和验收记录推进 |

公开文档 C1 试点只依赖 B1/B2，不必等待所有 B3/B4 场景；登录后台的 C 交付必须先过其 B3/B4 门槛。C4 需求访谈可以提前，付费/续费不能靠模拟证据。

## 5. 本轮结论

继续原路线，不另造抓取引擎，也不靠无目的扩样证明能力。优先完成“同一个任务长期可靠地更新并交给使用者”。第二开发者安装仍未完成；账单 unknown 可透明保留；模型辅助仍是后续按收益验证的可选项。

下一次复盘必须同时列出：源码版本、所跑命令、样本范围、实际输出、未跑项，以及谁在用结果。合并、CI、演示、验收、生产采用分别记录。
