import { createApiEngine } from '../../packages/api/src/engine.ts'

const root = process.env.W2L_B1_ROOT ?? '.w2l/section-b'
const intervalMs = Number(process.env.W2L_B1_POLL_MS ?? 60_000)
const once = process.argv.includes('--once')
const engine = createApiEngine({ taskRoot: root })
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true })

try {
  do {
    const view = await engine.runFirecrawlMonitor()
    console.log(JSON.stringify({ at: new Date().toISOString(), run: view.runs[0] ?? null, baselineVersion: view.baseline?.version ?? null, nextRunAt: view.nextRunAt, events: view.events.length }))
    if (once || stopping) break
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  } while (!stopping)
} finally {
  await engine.close()
}
