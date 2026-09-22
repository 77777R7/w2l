# Section B · Continuous Updates And Authorized Access

状态核对：2026-09-22，冻结提交 `99894bd636ecafd254a7c7bc79d26e9a97fa9199` 已由 PR #50 合并并发布为源码预发布版 `v0.4.0-rc.1`。**B1–B4 均为 in_progress；核心切片验收和源码发布不等于整个阶段 accepted。**

设计原文：[Section B technical design v1](section-b-technical-design-v1.md)。
当前事实：[Gate 2–4 验收](gate-2-4-acceptance.md)；历史发现及后续解决情况：[阶段复盘](stage-review-2026-09-22.md)。
运行入口：[handoff](section-b-handoff.md)。
下一段：[Section C 完整路线](section-c-delivery.md)。

## B1 · 持续任务与数据版本

已有并通过本轮核心验收：通用公开文档 Monitor 配置、SQLite revision/run/attempt、observation/assessment、有效 baseline、原子 event/outbox/delivery、手动触发和 nextRunAt 轮询；明确 captureMode、贯穿执行的取消/期限、持久同源冷却、双进程竞争领取、fencing 和实际 SIGKILL 恢复。

剩余：跨日期持续调度、统一运行管理、备份恢复和长期运行证据。保留最后有效值，分别显示 lastCheckedAt、lastVerifiedAt 和 stale；真实进程崩溃验收不等于主机掉电或备份恢复验收。

验收：重复、竞争、异常、重启不能污染有效数据。受控时钟测试和跨日期实跑分别出证据。

## B2 · 可信差分与增量

已有并通过本轮核心验收：typed FieldValue、资源/对象/视图身份、规则/schema attribution、生产提取路径 A/B/A/B 变化、真实 HTTP 304 与匹配缓存正文重验、多 Monitor/workspace 的基线/缓存/事件隔离。initialized/changed 产生事件；unchanged/cannot_verify 不推进有效基线。

剩余：更广泛的列表完整性/删除语义、真实长期任务中的差分质量和增量收益。事件身份及幂等消费已有 C1 工程验收，真实用户长期消费仍未验证。

验收：导航噪声不误报；同长度字段变化不漏报；规则更新不冒充来源变化；不完整页面不删对象。条件请求已实现并通过正文验证；实际任务的收益仍需测量，不能提前承诺成本百分比。

## B3 · 授权会话、CDP 与人工接管

已有：managed session API、origin/workspace/account 声明、grantEpoch、renew/revoke/handoff，以及库级 Existing Chrome/CDP adapter。

剩余：真实账户核验；统一控制入口；撤销进行中；Run/Step 绑定 handoff；状态脱敏；profile 凭据保护；CDP 产品入口与浏览器存活测试。

验收：同域账户不混用；旧授权不可提交；用户 Chrome 原 tab 不被关闭；点击继续后重新核验账户/范围。需要一个授权后台试点，不能用 example.com 公共页冒充登录验证。

## B4 · 有限后台 Recipe

已有：版本化 Recipe contract、库级执行器与 SQLite 记录、查询后置条件、下载预算、effect_unknown、保守恢复拒绝。

剩余：产品入口；一个真实查询/分页/导出 Recipe；专项集成与崩溃测试；旧 attempt 隔离；本次查询完成证据；效果核对与人工恢复协议。

验收：完成条件正确，执行可追溯，不确定效果不盲目重放。跨客户复用由第二个真实账户/模板验证，不靠一个示例宣称通用化。

## 可选模型层

未实现：EvidenceCollector、ModelAdapter、ProposalValidator、已验证配置库。先 shadow 模式，固定模型/提示词/验证规则，与同预处理确定性方案对照。只有净救回正确任务、引入错误、人工分钟、完整成本均可核对时才允许 assist。模型不改变验收标准。

B1/B2 的变化、304 正文和隔离验收使用受控 HTTP 源与生产采集/验证路径；公开 Firecrawl 文档到真实 HTTPS 接收端另有实测。二者范围不能混同为全网覆盖或多周运行。见[验收记录及原始证据](gate-2-4-acceptance.md)。

## B→C 准入

- 明确一个使用者、重复任务、目标字段及接收端。
- B1/B2 数据有效性与事件工程切片已验收；公开 Firecrawl 文档已完成真实 HTTPS 投递演示，真实使用者及其长期消费仍待验证。
- A 的独立安装/证据开放项保持可见。
- C1 公开文档投递工程切片已验收；下一入口与运行交付属 C2/C3。授权后台交付仍受 B3/B4 验收约束。
