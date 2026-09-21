import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MonitorStore } from '../../packages/runtime/src/monitorStore.ts'
import { DOCUMENT_RULE_VERSION, FIRECRAWL_INTRO_URL, FIRECRAWL_MONITOR_ID } from '../../packages/contracts/src/index.ts'

const mode = process.argv[2]
const dbPath = process.argv[3]
if (mode === 'worker') {
  const store = MonitorStore.open(dbPath)
  const now = Date.now()
  const run = store.startRun(FIRECRAWL_MONITOR_ID, `recovery-worker:${now}`, now)
  console.log(JSON.stringify({ runId: run.id, attemptId: run.attemptId }))
  setInterval(() => {}, 1 << 30)
} else {
  const dir = await mkdtemp(join(tmpdir(), 'w2l-monitor-recovery-'))
  const dbPathForRun = join(dir, 'control.sqlite')
  const seed = MonitorStore.open(dbPathForRun)
  const now = Date.now()
  seed.createOrGetRevision({ monitorId: FIRECRAWL_MONITOR_ID, revision: 1, url: FIRECRAWL_INTRO_URL, ruleVersion: DOCUMENT_RULE_VERSION, intervalMs: 1000, staleAfterMs: 2000, createdAt: now })
  seed.close()
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/section-b/monitor-recovery-smoke.ts', 'worker', dbPathForRun], { stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise<void>((resolve, reject) => {
    child.stdout.once('data', () => resolve())
    child.once('error', reject)
  })
  child.kill('SIGKILL')
  await new Promise((resolve) => child.once('close', resolve))
  const resumed = MonitorStore.open(dbPathForRun)
  const recovered = resumed.startRun(FIRECRAWL_MONITOR_ID, `recovery-resume:${Date.now()}`, Date.now() + 300_001)
  const attempts = resumed.attempts(recovered.id)
  const evidence = { task: recovered.id, resumedAttempt: recovered.attemptId, attempts, oldInterrupted: attempts.some((attempt) => attempt.state === 'interrupted'), recoveredFromAttemptId: attempts.find((attempt) => attempt.state === 'running')?.recoveredFromAttemptId ?? null }
  console.log(JSON.stringify(evidence, null, 2))
  resumed.close()
  await rm(dir, { recursive: true, force: true })
}
