import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.js'
import { createApiEngine } from '../src/engine.js'

describe('Section B Firecrawl monitor vertical slice', () => {
  let root: string | undefined
  let engine: ReturnType<typeof createApiEngine> | undefined
  afterEach(async () => { await engine?.close(); if (root) await rm(root, { recursive: true, force: true }) })

  it('exposes run, baseline, unchanged state, and one initialized event', async () => {
    root = await mkdtemp(join(tmpdir(), 'w2l-api-monitor-'))
    engine = createApiEngine({ taskRoot: root })
    const app = createApp(engine)
    const first = await app.request('/v1/monitors/firecrawl-introduction/run', { method: 'POST', body: JSON.stringify({ triggerKey: 'test:1' }), headers: { 'content-type': 'application/json' } })
    expect(first.status).toBe(200)
    const firstBody = await first.json() as { baseline: { version: number } | null; events: unknown[] }
    expect(firstBody.baseline?.version).toBe(1)
    expect(firstBody.events).toHaveLength(1)

    const second = await app.request('/v1/monitors/firecrawl-introduction/run', { method: 'POST', body: JSON.stringify({ triggerKey: 'test:2' }), headers: { 'content-type': 'application/json' } })
    expect(second.status).toBe(200)
    const secondBody = await second.json() as { baseline: { version: number } | null; events: unknown[]; runs: { change: string }[] }
    expect(secondBody.baseline?.version).toBe(1)
    expect(secondBody.events).toHaveLength(1)
    expect(secondBody.runs[0]?.change).toBe('unchanged')

    const view = await app.request('/v1/monitors/firecrawl-introduction')
    expect(view.status).toBe(200)

    const replay = await app.request('/v1/monitors/firecrawl-introduction/run', { method: 'POST', body: JSON.stringify({ triggerKey: 'test:2' }), headers: { 'content-type': 'application/json' } })
    expect(replay.status).toBe(200)
    const replayBody = await replay.json() as { runs: { triggerKey: string }[] }
    expect(replayBody.runs.filter((run) => run.triggerKey === 'test:2')).toHaveLength(1)
  }, 120000)
})
