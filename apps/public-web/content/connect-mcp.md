# Connect W2L MCP

Choose your MCP client below. W2L currently connects through a [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) endpoint on the same computer as your client; hosted browser login is not available yet.

{{MCP_CLIENT_PICKER}}

## Start W2L on your computer

On macOS, from a W2L repository checkout, use Node.js 22.12+ or 24+:

```bash
npm ci
npm run first-use:local
npm run local:mcp:status
```

The setup prepares Chromium and starts the managed local service. It also attempts to register W2L with **Codex**. Keep the service running while you use MCP. The local endpoint is `http://127.0.0.1:8791/mcp`; it is only reachable from this computer and does not require browser login. On another system, build the repository and run `npm run local:mcp` in a terminal; the managed macOS receiver setup is unavailable there.

Registration alone does not prove a task works. After adding the server, check that `w2l-local` is connected, that `preview_monitor` appears, and then send the sample task below. If the server is missing, check `npm run local:mcp:status` and restart or reload the client. The Codex path has been verified locally; the other client snippets follow their documented configuration formats and still need a W2L task-level check.

## Send your first task

```text
Use W2L's preview_monitor with preset firecrawl-introduction. Show the sample quality, source URL, field evidence, and any missing reasons. Do not create a persistent Monitor yet.
```

Expected output is a **nonpersistent** sample assessment. It does not create a baseline, scheduled run, or webhook delivery. If the connection is absent, check `npm run local:mcp:status`, the saved entry with `codex mcp list`, and then open a new Codex task. If the sample is blocked or incomplete, inspect the reported reason before creating a Monitor.

Then continue with [Monitor → HTTPS Webhook](/docs/guides/monitor-webhook/) or [Amazon.sg product JSON](/docs/guides/amazon-product/).

## Hosted connection

**Coming soon.** There is no validated permanent HTTPS MCP URL, hosted login, or copyable remote command yet. A public connection, real task, and monitoring after a server restart must pass separately before this becomes a hosted setup guide.
