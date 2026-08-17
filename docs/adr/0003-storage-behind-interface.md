# ADR 0003：Storage 置于 interface 之后

- 状态：已接受
- 日期：2026-08-17

## 决定

所有持久化通过 `TaskStore` 接口访问。SQLite（`better-sqlite3`）是第一个实现，但调用方不得依赖 SQLite 特有语义。

## 理由

1. 自托管单机场景以 SQLite 为最佳默认（零部署依赖）；托管场景将需要 Postgres。
2. `task/attempt/step` 模型需在两种后端下保持相同语义，否则"分支复用树根 schema"的承诺无法成立。
3. benchmark harness 需要一个内存实现以避免磁盘 I/O 污染延迟指标。

## 约束

- 接口不暴露 SQL、事务隔离级别或 SQLite 的 `lastInsertRowid` 等实现细节。
- 主键由调用方生成（UUID），不依赖数据库自增。
- 写入必须是幂等的：同一 `(taskId, attemptId, stepId)` 重复写入不产生重复行。

## 后果

- 首个实现之外需同时维护一个内存实现，供测试与 benchmark 使用。
- Postgres 实现在 Phase 1 不交付，但接口设计需保证其可实现。
