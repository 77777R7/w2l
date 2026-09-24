# W2L docs editorial brief (not a published page)

Reviewed 2026-09-24. Audience: a first-time visitor trying one public URL, then a developer connecting Codex or completing a durable Monitor/batch workflow. Primary intent is task completion, not a comparison article. Keep the value statement short, show a real result, and state what to do when a capture is incomplete or blocked.

Reference structure: [Firecrawl Introduction](https://docs.firecrawl.dev/introduction) places a quick request and alternate setup paths ahead of deeper reference. W2L follows that discoverability pattern while using its own verified contract and limitations.

Source-of-truth map:

- Anonymous preview contract and status wording: `packages/public-preview/src/preview.ts`, `server.ts`, and `apps/public-web/src/main.ts`.
- Recorded first-page and blocked examples: same capture path on `936fdf0`, observed 2026-09-24 08:52 UTC; the published excerpts are deliberately short and omit raw HTML.
- Codex setup and Monitor/Delivery sequence: `scripts/section-c/local-dual-flow.mjs`, `packages/mcp/src/tools.ts`, `docs/mcp-first-use.md`, `docs/dual-flow-first-use.md`.
- Selectable client setup: MCP [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [Codex](https://developers.openai.com/learn/docs-mcp), [Claude Code](https://code.claude.com/docs/en/mcp), [Cursor](https://prod.cursor.com/help/customization/mcp), and [OpenCode 1.x](https://opencode.ai/docs/mcp-servers). The four local CLI/config formats were checked on 2026-09-24; only Codex has a recorded W2L task-level verification. Do not promote the other snippets or hosted OAuth to verified until clients complete a task.
- Client icon sources: `https://docs.firecrawl.dev/images/agent-clients/{codex,claude-code,cursor,opencode}.svg`, retrieved 2026-09-24 and stored locally under `apps/public-web/public/docs-assets/agent-clients/`. The four SVGs contain vector paths and a local gradient only; no scripts, foreign objects, or remote references. The icon names are descriptive, not endorsements or connection evidence.
- Batch pagination: `packages/mcp/src/tools.ts`, `docs/batch-scrape.md`.
- Site boundaries and open gates: `docs/public-web-adapters.md`, `docs/roadmap/dual-flow-mvp-gates.md`, `docs/evidence/c2-c3-mcp-local-2026-09-23.md`.

Terms: page `success` is not structured product `complete`; `blocked` is a policy/login/challenge outcome and is not a generic network timeout. Local loopback service and future hosted MCP are distinct products states. The docs do not claim a permanent URL, working WorkOS login, Amazon price alerts, or a passed 1000-page Amazon gate.

Writing application: use the user-specified seo-blog-skill for evidence-grounded definitions, useful headings, natural language, and internal links. Its long-form article, fixed FAQ, comparison-table, and ego (lite)-specific requirements do not apply to concise W2L task docs. Titles and descriptions are unique; canonical URLs must wait for a verified public origin.
