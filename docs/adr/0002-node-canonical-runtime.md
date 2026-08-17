# ADR 0002：Node.js 为唯一 canonical runtime

- 状态：已接受
- 日期：2026-08-17

## 决定

Node.js（>=20.11）是唯一受支持的运行时。不承诺 Bun 或 Deno 兼容。

## 理由

1. Playwright 的一等支持目标是 Node.js。
2. 单一运行时使 benchmark 结果可比——运行时差异会污染延迟和内存指标。
3. `better-sqlite3` 等原生模块在多运行时下的行为差异会增加不可见的故障面。

## 后果

- HTTP server 选型不再以"跨运行时"为约束条件。
- `RunEnvironment` 记录 `nodeVersion`；跨运行时的结果不作比较。
- 若将来支持其他运行时，需作为独立 ADR，并要求 benchmark 在两个运行时上分别记录基线。
