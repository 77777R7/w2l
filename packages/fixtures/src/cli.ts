import { startFixtureServer } from './server.js'
import { FIXTURE_TRUTHS } from './suite.js'

const port = Number(process.env['FIXTURE_PORT'] ?? 8787)
const server = await startFixtureServer(port)

process.stdout.write(`fixture server listening on ${server.url}\n`)
process.stdout.write(`${FIXTURE_TRUTHS.length} cases\n`)
for (const t of FIXTURE_TRUTHS) {
  process.stdout.write(`  ${t.id.padEnd(22)} ${t.expectedStatus.padEnd(15)} ${t.target}\n`)
}

// Sockets are unref'd so hanging fixtures cannot block shutdown; keep the process
// alive explicitly instead.
const keepAlive = setInterval(() => {}, 1 << 30)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(keepAlive)
    void server.close().then(() => process.exit(0))
  })
}
