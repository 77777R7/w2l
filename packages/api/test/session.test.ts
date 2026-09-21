import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.js'
import { createApiEngine } from '../src/engine.js'

describe('B3 managed session API', () => {
  let root: string | undefined
  let engine: ReturnType<typeof createApiEngine> | undefined
  afterEach(async () => { await engine?.close(); if (root) await rm(root, { recursive: true, force: true }) })

  it('creates, waits for, authorizes, captures with, and revokes a managed session', async () => {
    root = await mkdtemp(join(tmpdir(), 'w2l-b3-api-'))
    engine = createApiEngine({ taskRoot: root })
    const app = createApp(engine)
    const created = await app.request('/v1/sessions/managed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'w1', accountRef: 'acct-a', originScope: 'https://example.com' }) })
    expect(created.status).toBe(201)
    const session = await created.json() as { sessionRef: string; state: string; grantEpoch: number }
    expect(session.state).toBe('waiting_user')

    const waiting = await app.request(`/v1/sessions/${session.sessionRef}/capture`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'w1', accountRef: 'acct-a', url: 'https://example.com/' }) })
    expect((await waiting.json() as { kind: string }).kind).toBe('waiting_user')

    const authorized = await app.request(`/v1/sessions/${session.sessionRef}/authorize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountRef: 'acct-a' }) })
    expect((await authorized.json() as { state: string }).state).toBe('active')
    const captured = await app.request(`/v1/sessions/${session.sessionRef}/capture`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'w1', accountRef: 'acct-a', url: 'https://example.com/' }) })
    expect((await captured.json() as { status: string }).status).toBe('success')

    const revoked = await app.request(`/v1/sessions/${session.sessionRef}/revoke`, { method: 'POST' })
    expect(revoked.status).toBe(200)
    const denied = await app.request(`/v1/sessions/${session.sessionRef}/capture`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'w1', accountRef: 'acct-a', url: 'https://example.com/' }) })
    expect((await denied.json() as { kind: string }).kind).toBe('revoked')
  }, 120000)
})
