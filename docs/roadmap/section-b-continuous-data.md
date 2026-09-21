# Section B · Continuous Updates And Authorized Access

状态核对：2026-09-22，`main@e29dc6b`。**B1–B4 均为 in_progress；已合入切片不等于整个阶段 accepted。**

设计原文：[Section B technical design v1](section-b-technical-design-v1.md)。
当前事实：[阶段复盘](stage-review-2026-09-22.md)。
运行入口：[handoff](section-b-handoff.md)。
下一段：[Section C 完整路线](section-c-delivery.md)。

## B1 · 持续任务与数据版本

已有：固定 Firecrawl monitor、SQLite revision/run/attempt、observation/assessment、有效 baseline、原子 event/outbox、手动触发和 nextRunAt 轮询。

剩余：有限通用 Monitor 配置；真实并行领取；capture 中断到提交完成；回执重放；取消/期限传递；跨日期调度与备份恢复。保留最后有效值，分别显示 lastCheckedAt、lastVerifiedAt 和 stale。

验收：重复、竞争、异常、重启不能污染有效数据。受控时钟测试和跨日期实跑分别出证据。

## B2 · 可信差分与增量

已有：五个字符串字段比较，initialized/changed/unchanged/cannot_verify，本地 outbox。

剩余：生产提取路径受控变化实验；FieldValue 与类型化上下文；规则版本归因；完整性/删除；传输缓存与可信基线分离；事件身份及幂等消费。

验收：导航噪声不误报；同长度字段变化不漏报；规则更新不冒充来源变化；不完整页面不删对象。条件请求需实测收益后实施，不能提前承诺成本百分比。

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

B1/B2 closeout adds generic monitor registration/view APIs, typed field states,
identity keys, rule/schema attribution, and transport-representation records.
Full multi-monitor and conditional-cache live evidence is still pending.

## B→C 准入

- 明确一个使用者、重复任务、目标字段及接收端。
- 对该任务通过 B1/B2 数据有效性与事件测试；公开 Firecrawl 文档可作为首个内部候选，使用者仍须确认。
- A 的独立安装/证据开放项保持可见。
- C1 可先交付公开文档事件；授权后台交付另受 B3/B4 验收约束。
