import { mkdir, readFile, writeFile, chmod, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ManagedSessionRef, SessionAccessResult, SessionGrant } from '@w2l/contracts'

export interface SessionBrokerStore {
  get(sessionRef: string): Promise<ManagedSessionRef | null>
  put(session: ManagedSessionRef): Promise<void>
}

export class MemorySessionBrokerStore implements SessionBrokerStore {
  private readonly values = new Map<string, ManagedSessionRef>()
  async get(sessionRef: string): Promise<ManagedSessionRef | null> { return this.values.get(sessionRef) ?? null }
  async put(session: ManagedSessionRef): Promise<void> { this.values.set(session.sessionRef, session) }
}

export class FileSessionBrokerStore implements SessionBrokerStore {
  constructor(private readonly file: string) {}
  async get(sessionRef: string): Promise<ManagedSessionRef | null> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as { sessions?: ManagedSessionRef[] }
      return parsed.sessions?.find((session) => session.sessionRef === sessionRef) ?? null
    } catch { return null }
  }
  async put(session: ManagedSessionRef): Promise<void> {
    let sessions: ManagedSessionRef[] = []
    try { sessions = (JSON.parse(await readFile(this.file, 'utf8')) as { sessions?: ManagedSessionRef[] }).sessions ?? [] } catch {}
    const next = [...sessions.filter((value) => value.sessionRef !== session.sessionRef), session]
    const temp = `${this.file}.tmp`
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(temp, JSON.stringify({ sessions: next }, null, 2), { mode: 0o600 })
    await chmod(temp, 0o600)
    await rename(temp, this.file)
  }
}

export class SessionBroker {
  constructor(private readonly store: SessionBrokerStore) {}

  async createManagedSession(input: { workspaceId: string; accountRef: string; originScope: string; profileDir: string; expiresAt?: string | null }): Promise<ManagedSessionRef> {
    const now = new Date().toISOString()
    const session: ManagedSessionRef = {
      sessionRef: crypto.randomUUID(), profileId: crypto.randomUUID(), workspaceId: input.workspaceId,
      accountRef: input.accountRef, originScope: normalizeOrigin(input.originScope), profileDir: input.profileDir,
      grantEpoch: 1, state: 'waiting_user', createdAt: now, updatedAt: now, revokedAt: null, expiresAt: input.expiresAt ?? null,
    }
    await this.store.put(session)
    return session
  }

  async markAuthorized(sessionRef: string, accountRef: string): Promise<ManagedSessionRef> {
    const session = await this.require(sessionRef)
    if (session.accountRef !== accountRef) throw new Error('accountRef mismatch')
    const next = { ...session, state: 'active' as const, updatedAt: new Date().toISOString() }
    await this.store.put(next)
    return next
  }

  async revoke(sessionRef: string): Promise<void> {
    const session = await this.require(sessionRef)
    await this.store.put({ ...session, state: 'revoked', grantEpoch: session.grantEpoch + 1, revokedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  }

  async getSession(sessionRef: string): Promise<ManagedSessionRef> {
    return this.require(sessionRef)
  }

  async grant(input: { sessionRef: string; workspaceId: string; accountRef: string; origin: string; now?: Date }): Promise<SessionAccessResult> {
    const session = await this.store.get(input.sessionRef)
    if (!session) return { kind: 'revoked', sessionRef: input.sessionRef, reason: 'session_not_found' }
    if (session.workspaceId !== input.workspaceId || session.accountRef !== input.accountRef || !originAllowed(session.originScope, input.origin)) return { kind: 'revoked', sessionRef: input.sessionRef, reason: 'scope_mismatch' }
    const now = input.now ?? new Date()
    if (session.state === 'revoked') return { kind: 'revoked', sessionRef: session.sessionRef, reason: 'grant_revoked' }
    if (session.expiresAt !== null && new Date(session.expiresAt).getTime() <= now.getTime()) return { kind: 'expired', sessionRef: session.sessionRef, reason: 'grant_expired' }
    if (session.state === 'waiting_user') return { kind: 'waiting_user', sessionRef: session.sessionRef, reason: 'user_authorization_required' }
    const grant: SessionGrant = { sessionRef: session.sessionRef, workspaceId: session.workspaceId, accountRef: session.accountRef, originScope: session.originScope, grantEpoch: session.grantEpoch, expiresAt: session.expiresAt }
    return { kind: 'granted', grant }
  }

  async release(sessionRef: string): Promise<void> {
    const session = await this.require(sessionRef)
    if (session.state === 'active') await this.store.put({ ...session, state: 'waiting_user', updatedAt: new Date().toISOString() })
  }

  private async require(sessionRef: string): Promise<ManagedSessionRef> {
    const session = await this.store.get(sessionRef)
    if (!session) throw new Error(`session not found: ${sessionRef}`)
    return session
  }
}

function normalizeOrigin(value: string): string {
  const url = new URL(value)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('originScope must be an origin')
  return url.origin
}
function originAllowed(scope: string, target: string): boolean { try { return new URL(target).origin === scope } catch { return false } }
