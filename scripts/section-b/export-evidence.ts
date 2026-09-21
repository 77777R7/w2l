import { mkdir, writeFile } from 'node:fs/promises'
import { MonitorStore } from '../../packages/runtime/src/monitorStore.ts'
import { FIRECRAWL_MONITOR_ID } from '../../packages/contracts/src/index.ts'

const root = process.env.W2L_B1_ROOT ?? '.w2l/section-b'
const store = MonitorStore.open(`${root}/section-b-control.sqlite`)
try {
  const evidence = store.exportEvidence(FIRECRAWL_MONITOR_ID)
  await mkdir('research', { recursive: true })
  await writeFile('research/section-b-firecrawl-monitor-evidence.generated.json', JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ monitorId: FIRECRAWL_MONITOR_ID, runs: evidence.runs.length, attempts: evidence.attempts.length, observations: evidence.observations.length, events: evidence.events.length, outbox: evidence.outbox.length }, null, 2))
} finally { store.close() }
