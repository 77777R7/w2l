# ADR 0001：直接使用 Playwright，不基于 Crawlee

- 状态：已接受（可被 benchmark 推翻）
- 日期：2026-08-17

## 背景

`research/market_validation_root_branch_model.md` 阶段 0 建议以 Crawlee 为底层，避免被浏览器和站点兼容消耗。

## 决定

直接使用 **Playwright 的浏览器自动化库**驱动 Chromium，不引入 Crawlee 作为框架层。

术语更正：Playwright 是浏览器**自动化库**，Chromium 才是浏览器引擎。本项目既不实现也不修改浏览器引擎。

## 理由

1. Crawlee 的队列、存储和 autoscaling 抽象与 `task/attempt/step` + SQLite checkpoint 模型职责重叠。
2. 执行循环（trace、成本归因、失败分类、lane 升级）正是产品差异化所在的层，必须自己拥有。
3. Crawlee 由 Apify 维护，是其云平台的获客入口。深度依赖会把架构绑定到最直接竞争者的路线图。

## 可推翻条件

以下任一条成立，重新评估并允许改为基于 Crawlee：

- 在 fixture 或 canary 套件上，我们的 lane 实现成功率显著低于以 Crawlee 为底的等价实现；
- 维护 Playwright 生命周期管理和并发控制的成本，明显超过实现 trace/成本/失败分类的收益；
- Crawlee 提供了可直接复用且不与 checkpoint 模型冲突的 trace 与成本归因接口。

推翻需以 benchmark 数据为依据，不接受偏好性论证。

## 后果

- 浏览器进程生命周期、并发限制、重试与 session 复用需自行实现（对应 P01/P03/P04 痛点）。
- Chromium 的 SSRF 约束需单独方案（CDP 请求拦截或网络隔离容器），见 PHASE1_ENGINEERING_NOTES §2.6。
