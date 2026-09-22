import { createApiEngine } from '../../packages/api/src/engine.js'
import { abortableSleep } from '@w2l/http-core'
import { hostedNetworkPolicy, localNetworkPolicy } from '@w2l/contracts'
const pollMs = Number(process.env.W2L_MONITOR_POLL_MS ?? 1000)
if (!Number.isSafeInteger(pollMs) || pollMs < 10) throw new Error('W2L_MONITOR_POLL_MS must be at least 10')
const mode = process.env.W2L_MONITOR_NETWORK_MODE ?? 'public'
if (!['public', 'local'].includes(mode)) throw new Error('W2L_MONITOR_NETWORK_MODE must be public or local')
const engine = createApiEngine({taskRoot: process.env.W2L_TASK_ROOT ?? '.w2l/api', networkPolicy: mode === 'local' ? localNetworkPolicy() : hostedNetworkPolicy()})
const controller = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => controller.abort(new DOMException('service shutdown', 'ShutdownError')))
try {
  do {
    const due = engine.listMonitors().filter(view => view.enabled && (view.nextRunAt <= Date.now() || view.runs.some(run => run.state === 'running' && (run.leaseUntil ?? Infinity) <= Date.now())))
    // Bounded worker pool: one slow source must not block every monitor.
    let index = 0
    await Promise.all(Array.from({length: Math.min(4, due.length)}, async () => {
      while (index < due.length && !controller.signal.aborted) {
        const view = due[index++]!
        try {
          const result = await engine.runMonitor(view.revision.monitorId, undefined, {signal: controller.signal})
          console.log(JSON.stringify({monitorId: view.revision.monitorId, run: result.runs[0], nextRunAt: result.nextRunAt}))
        } catch (error) { console.error(JSON.stringify({monitorId:view.revision.monitorId,error:String(error)})) }
      }
    }))
    if (process.argv.includes('--once')) break
    await abortableSleep(pollMs, controller.signal)
  } while (!controller.signal.aborted)
} catch (error) { if (!controller.signal.aborted) throw error }
finally { await engine.close() }
