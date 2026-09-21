import { describe, expect, it } from 'vitest'
import { MemorySessionBrokerStore, SessionBroker } from '../src/routing/sessionBroker.js'

describe('B3 managed SessionBroker', () => {
  it('creates an isolated waiting_user session and grants only after authorization', async () => {
    const broker = new SessionBroker(new MemorySessionBrokerStore())
    const session = await broker.createManagedSession({ workspaceId: 'w1', accountRef: 'acct-a', originScope: 'https://example.com', profileDir: '/tmp/profile-a' })
    expect(session.state).toBe('waiting_user')
    const waiting = await broker.grant({ sessionRef: session.sessionRef, workspaceId: 'w1', accountRef: 'acct-a', origin: 'https://example.com/products/1' })
    expect(waiting.kind).toBe('waiting_user')
    await broker.markAuthorized(session.sessionRef, 'acct-a')
    const granted = await broker.grant({ sessionRef: session.sessionRef, workspaceId: 'w1', accountRef: 'acct-a', origin: 'https://example.com/products/1' })
    expect(granted.kind).toBe('granted')
    if (granted.kind === 'granted') expect(granted.grant.grantEpoch).toBe(1)
  })

  it('rejects cross-account, cross-workspace, and cross-origin access', async () => {
    const broker = new SessionBroker(new MemorySessionBrokerStore())
    const session = await broker.createManagedSession({ workspaceId: 'w1', accountRef: 'acct-a', originScope: 'https://example.com', profileDir: '/tmp/profile-a' })
    await broker.markAuthorized(session.sessionRef, 'acct-a')
    expect((await broker.grant({ sessionRef: session.sessionRef, workspaceId: 'w2', accountRef: 'acct-a', origin: 'https://example.com' })).kind).toBe('revoked')
    expect((await broker.grant({ sessionRef: session.sessionRef, workspaceId: 'w1', accountRef: 'acct-b', origin: 'https://example.com' })).kind).toBe('revoked')
    expect((await broker.grant({ sessionRef: session.sessionRef, workspaceId: 'w1', accountRef: 'acct-a', origin: 'https://other.example.com' })).kind).toBe('revoked')
  })

  it('increments grantEpoch and rejects a revoked session', async () => {
    const broker = new SessionBroker(new MemorySessionBrokerStore())
    const session = await broker.createManagedSession({ workspaceId: 'w1', accountRef: 'acct-a', originScope: 'https://example.com', profileDir: '/tmp/profile-a' })
    await broker.markAuthorized(session.sessionRef, 'acct-a')
    await broker.revoke(session.sessionRef)
    expect((await broker.grant({ sessionRef: session.sessionRef, workspaceId: 'w1', accountRef: 'acct-a', origin: 'https://example.com' })).kind).toBe('revoked')
  })

  it('returns expired instead of granting an old session', async () => {
    const broker = new SessionBroker(new MemorySessionBrokerStore())
    const session = await broker.createManagedSession({ workspaceId: 'w1', accountRef: 'acct-a', originScope: 'https://example.com', profileDir: '/tmp/profile-a', expiresAt: '2026-01-01T00:00:00.000Z' })
    await broker.markAuthorized(session.sessionRef, 'acct-a')
    const result = await broker.grant({ sessionRef: session.sessionRef, workspaceId: 'w1', accountRef: 'acct-a', origin: 'https://example.com', now: new Date('2026-01-02T00:00:00.000Z') })
    expect(result.kind).toBe('expired')
  })
})
