# Local HTTPS Monitor delivery — 2026-09-23

Source freeze: `15c63f83c786d000d193846e063c8ec040ddac5d` on
`codex/c2-c3-remote-mcp`. Node `v26.8.1`, npm `11.19.0`.
Typecheck passed; the full suite passed **88 files, 987 tests**.

This experiment used the already persisted `firecrawl-introduction` Monitor
and its first `initialized` event, not a replacement fixture. The main MCP
service and an independent receiver ran as macOS LaunchAgents. The receiver
listened at `https://127.0.0.1:8788/webhook` with a local certificate whose
SAN is `127.0.0.1`. The worker trusted that certificate through an explicit
CA file and opted into loopback-only private egress. Signing keys, TLS keys,
SQLite files and logs remain in ignored `.w2l/` paths; none are committed.

| Check | Observed result |
| --- | --- |
| Sender event | `19a94a15-140d-4b8e-a9cd-b92f09a24775` |
| Delivery | `8c594346-6f71-4115-85f3-52025d6f690b`; registered HTTPS destination backfilled the existing event |
| ACK-loss retry | First signed POST was durably accepted by the receiver, then deliberately answered 503 with `Retry-After: 1`; the worker retried after **1003 ms** and got 200 |
| Stable identity | Both attempts used the same delivery ID and event ID; sender ended `delivered` |
| Idempotency | Receiver retained **one** receipt and **one** projection; an additional correctly signed POST returned `duplicate` without adding a record |
| Client disconnect | With the MCP client closed, the enabled Monitor completed run `167522cd-e9c2-47f1-ae06-3058dd2a2a8d` as `unchanged` |
| Main-service restart | Run `78bc8bf2-ad06-47ec-b2b6-d237b9f0f9ad` was confirmed `queued` before restart and completed as `unchanged` afterward |
| Receiver restart | The receiver restarted independently and retained the same one receipt and projection |
| Final state | Both health checks returned 200; Monitor enabled and fresh, delivery `delivered`; next scheduled run **2026-09-24 15:38:04 Asia/Shanghai** |

After the retry check, the ACK-loss flag was removed from the receiver
LaunchAgent. Both services were reinstalled from the frozen source and the
final state was queried through MCP. This proves a **same-Mac HTTPS** first-use
flow and persisted local recovery. The loopback receiver is not reachable
from another computer; no Render deployment, WorkOS login, public webhook,
friend trial, or two-week uptime is claimed.
