import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.js'
import { createApiEngine } from '../src/engine.js'

describe('generic public document monitor API', () => {
  let root: string | undefined
  let engine: ReturnType<typeof createApiEngine> | undefined
  afterEach(async () => { await engine?.close(); if (root) await rm(root, { recursive: true, force: true }) })

  it('registers a versioned public monitor and exposes it through one API path', async () => {
    root = await mkdtemp(join(tmpdir(), 'w2l-generic-monitor-'))
    engine = createApiEngine({ taskRoot: root })
    const app = createApp(engine)
    const config = {
      monitorId: 'example-home', revision: 1, url: 'https://example.com/', ruleVersion: 'example/v1',
      intervalMs: 86_400_000, staleAfterMs: 172_800_000,
      config: { adapter: 'markdown-sections/v1', workspaceId: 'w1', entityKey: 'example:home', viewKey: 'public', expectedTitle: 'Example Domain', schemaVersion: 'example/v1', conditionalRequests: true, fields: [{ name: 'body', heading: 'Example Domain', type: 'text', required: true }] },
    }
    const created = await app.request('/v1/monitors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) })
    expect(created.status).toBe(201)
    expect((await created.json() as { monitorId: string; config: { entityKey: string } }).config.entityKey).toBe('example:home')
    const view = await app.request('/v1/monitors/example-home')
    expect(view.status).toBe(200)
    expect((await view.json() as { revision: { ruleVersion: string } }).revision.ruleVersion).toBe('example/v1')
  })
})
