import { createApiEngine } from '../../packages/api/src/engine.ts'

// Run from cron to check persisted nextRunAt, or supply an idempotent manual key.
const engine = createApiEngine({ taskRoot: process.env.W2L_B1_ROOT ?? '.w2l/section-b' })
try {
  const view = process.argv.includes('--view') ? await engine.getFirecrawlMonitor()
    : await engine.runFirecrawlMonitor(process.env.W2L_B1_TRIGGER_KEY)
  console.log(JSON.stringify(view, null, 2))
} finally { await engine.close() }
