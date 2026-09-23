# Managed loopback MCP evidence — 2026-09-23

Source freeze: `501fb580c1cc727bc56b23add94bb2c2e890042b` on
`codex/c2-c3-remote-mcp`. The first-use experiment completed at
`2026-09-23T06:14:59.527Z` using Node `v26.8.1` and npm `11.19.0`.
`npm run typecheck` passed; the full suite passed **88 files, 986 tests**.
The detailed database and receiver log are ignored local files under
`.w2l/c2-first-use-1790144078510/`.

The official MCP SDK Streamable HTTP client connected to the loopback-only
unified service. It previewed the live public Firecrawl Introduction page
as `valid`, created a paused Monitor, configured an independent HTTPS
receiver through a temporary tunnel, resumed the Monitor and delivered
event `b80b2a8e-8f30-40e7-952f-c07728b38434`. The receiver stored one
receipt and one projection for that event. The tunnel was stopped afterward.

The test killed the service with a pending delivery, restarted it, and
confirmed delivery `31b2ba6c-a924-44d0-ad28-b7d7d8cfda2b` completed
with the same event ID. It killed the service again with a queued run;
run `6523e333-1a05-4047-b33f-9516fa257f1d` completed after restart
as `unchanged`. The Monitor ended paused.

Separately, the macOS LaunchAgent `dev.w2l.local-mcp` was installed for
the same checkout. Its health endpoint returned 200, the MCP client listed
27 tools, and a live preview was `valid`. A paused `firecrawl-introduction`
Monitor remained queryable after the client reconnected. The LaunchAgent
was then killed with `SIGKILL`: PID 36547 was replaced by PID 36671,
health returned 200, and the persisted Monitor was still queryable. Codex
CLI configuration lists `w2l-local` as an enabled Streamable HTTP MCP at
`http://127.0.0.1:8791/mcp`.

This establishes the local service and official SDK client flow. The
current Codex desktop task has not dynamically reloaded its MCP registry;
actual use inside a **new** Codex task is a separate check. No permanent
HTTPS receiver, Render deployment, WorkOS browser login, hosted restart
drill, independent human onboarding, or two-week external trial is claimed.
