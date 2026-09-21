import { mkdir, readFile, writeFile, chmod, rename, rmdir, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { ManagedSessionRef, SessionAccessResult, SessionGrant } from '@w2l/contracts'

export interface SessionBrokerStore {
  get(sessionRef: string): Promise<ManagedSessionRef | null>
  put(session: ManagedSessionRef): Promise<void>
  update(sessionRef: string, change: (session: ManagedSessionRef) => ManagedSessionRef): Promise<ManagedSessionRef>
}

export class MemorySessionBrokerStore implements SessionBrokerStore {
  private readonly values = new Map<string, ManagedSessionRef>()
  async get(sessionRef: string): Promise<ManagedSessionRef | null> { return structuredClone(this.values.get(sessionRef) ?? null) }
  async put(session: ManagedSessionRef): Promise<void> { this.values.set(session.sessionRef, structuredClone(session)) }
  async update(id: string, change: (session: ManagedSessionRef) => ManagedSessionRef) {
    const current = this.values.get(id)
    if (!current) throw new Error('session not found')
    const next = change(structuredClone(current))
    this.values.set(id, structuredClone(next))
    return structuredClone(next)
  }
}

export class FileSessionBrokerStore implements SessionBrokerStore {
  private readonly file: string
  constructor(file: string) { this.file = resolve(file) }
  private async read(): Promise<ManagedSessionRef[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as { sessions: ManagedSessionRef[] }
      if (!Array.isArray(parsed.sessions)) throw new Error('invalid session registry')
      return parsed.sessions
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error('session registry unreadable')
    }
  }
  private async change<T>(fn: (sessions: ManagedSessionRef[]) => T): Promise<T> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const lock = `${this.file}.lock`
    // Exclusive cross-process mutation. Never steal a stale lock automatically.
    for (let attempt = 0; ; attempt++) {
      try { await mkdir(lock, { mode: 0o700 }); break } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= 100) throw new Error('session registry busy')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
    const temp = `${this.file}.${crypto.randomUUID()}.tmp`
    try {
      const sessions = await this.read()
      const result = fn(sessions)
      await writeFile(temp, JSON.stringify({ sessions }, null, 2), { mode: 0o600 })
      await chmod(temp, 0o600)
      await rename(temp, this.file)
      return result
    } finally {
      await unlink(temp).catch(() => {})
      await rmdir(lock)
    }
  }
  async get(sessionRef: string): Promise<ManagedSessionRef | null> {
    return (await this.read()).find((session) => session.sessionRef === sessionRef) ?? null
  }
  async put(session: ManagedSessionRef): Promise<void> {
    await this.change((sessions) => {
      const index = sessions.findIndex((value) => value.sessionRef === session.sessionRef)
      if (index < 0) sessions.push(session)
      else sessions[index] = session
    })
  }
  async update(id: string, change: (session: ManagedSessionRef) => ManagedSessionRef): Promise<ManagedSessionRef> {
    return this.change((sessions) => {
      const index = sessions.findIndex((session) => session.sessionRef === id)
      if (index < 0) throw new Error('session not found')
      const next = change(sessions[index]!)
      sessions[index] = next
      return next
    })
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
      handoff: { handoffId: crypto.randomUUID(), reason: 'user_authorization_required', createdAt: now, expiresAt: input.expiresAt ?? new Date(Date.now() + 900_000).toISOString() },
    }
    await this.store.put(session)
    return session
  }

  async markAuthorized(sessionRef: string, accountRef: string): Promise<ManagedSessionRef> {
    return this.store.update(sessionRef, (session) => {
    if (session.state === 'revoked' || session.revokedAt) throw new Error('revoked sessions cannot be authorized')
    if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) throw new Error('expired session requires renewal')
    if (session.handoff && Date.parse(session.handoff.expiresAt) <= Date.now()) throw new Error('handoff expired')
    if (session.accountRef !== accountRef) throw new Error('accountRef mismatch')
    return { ...session, state: 'active' as const, updatedAt: new Date().toISOString(), handoff: null }
    })
  }

  async revoke(sessionRef: string): Promise<void> {
    await this.store.update(sessionRef, (session) => session.state === 'revoked' ? session : ({ ...session, state: 'revoked', handoff: null, grantEpoch: session.grantEpoch + 1, revokedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }))
  }

  async renewExpired(sessionRef: string, expiresAt: string | null = null): Promise<ManagedSessionRef> {
    return this.store.update(sessionRef, (session) => {
    if (session.state === 'revoked') throw new Error('revoked sessions cannot be renewed; create a new grant')
    const now = new Date().toISOString()
    const nextExpiresAt = expiresAt ?? new Date(Date.now() + 900_000).toISOString()
    if (!Number.isFinite(Date.parse(nextExpiresAt)) || Date.parse(nextExpiresAt) <= Date.now()) throw new Error('renewal expiry must be in the future')
    const next = { ...session, state: 'waiting_user' as const, grantEpoch: session.grantEpoch + (session.state === 'waiting_user' ? 0 : 1), revokedAt: null, updatedAt: now, expiresAt: nextExpiresAt, handoff: { handoffId: crypto.randomUUID(), reason: 'renewal_authorization_required', createdAt: now, expiresAt: nextExpiresAt } }
    return next
    })
  }

  async requestHandoff(sessionRef: string, reason: string, expiresAt: string | null = null): Promise<ManagedSessionRef> {
    return this.store.update(sessionRef, (session) => {
    if (session.state === 'revoked' || session.revokedAt) throw new Error('revoked session cannot request handoff')
    if (!reason.trim()) throw new Error('handoff reason is required')
    const now = new Date().toISOString()
    const deadline = expiresAt ?? new Date(Date.now() + 900_000).toISOString()
    if (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= Date.now()) throw new Error('handoff expiry must be in the future')
    const next = { ...session, grantEpoch: session.grantEpoch + 1, state: 'waiting_user' as const, updatedAt: now, handoff: { handoffId: crypto.randomUUID(), reason, createdAt: now, expiresAt: deadline } }
    return next
    })
  }

  async getSession(sessionRef: string): Promise<ManagedSessionRef> {
    return this.require(sessionRef)
  }

  async createExistingSession(input: { workspaceId: string; accountRef: string; originScope: string; cdpEndpoint: string; approved: boolean }): Promise<ManagedSessionRef> {
    if (input.approved !== true) throw new Error('explicit CDP connection approval required')
    const endpoint = validateCdpEndpoint(input.cdpEndpoint)
    const session = await this.createManagedSession({ ...input, profileDir: '' })
    const next: ManagedSessionRef = { ...session, backend: 'existing_chrome', cdpEndpoint: endpoint }
    await this.store.put(next)
    return next
  }

  async grant(input: { sessionRef: string; workspaceId: string; accountRef: string; origin: string; now?: Date }): Promise<SessionAccessResult> {
    const session = await this.store.get(input.sessionRef)
    if (!session) return { kind: 'revoked', sessionRef: input.sessionRef, reason: 'session_not_found' }
    if (session.workspaceId !== input.workspaceId || session.accountRef !== input.accountRef || !originAllowed(session.originScope, input.origin)) return { kind: 'revoked', sessionRef: input.sessionRef, reason: 'scope_mismatch' }
    const now = input.now ?? new Date()
    if (session.state === 'revoked') return { kind: 'revoked', sessionRef: session.sessionRef, reason: 'grant_revoked' }
    if (session.expiresAt !== null && new Date(session.expiresAt).getTime() <= now.getTime()) {
      return { kind: 'expired', sessionRef: session.sessionRef, reason: 'grant_expired' }
    }
    if (session.state !== 'active') return { kind: 'waiting_user', sessionRef: session.sessionRef, reason: 'user_authorization_required' }
    const grant: SessionGrant = { sessionRef: session.sessionRef, workspaceId: session.workspaceId, accountRef: session.accountRef, originScope: session.originScope, grantEpoch: session.grantEpoch, expiresAt: session.expiresAt }
    return { kind: 'granted', grant }
  }

  async release(sessionRef: string): Promise<void> {
    await this.requestHandoff(sessionRef, 'control_released')
  }

  async validateGrant(grant: SessionGrant): Promise<boolean> {
    const current = await this.grant({ ...grant, origin: grant.originScope })
    return current.kind === 'granted' && current.grant.grantEpoch === grant.grantEpoch
  }

  private async require(sessionRef: string): Promise<ManagedSessionRef> {
    const session = await this.store.get(sessionRef)
    if (!session) throw new Error(`session not found: ${sessionRef}`)
    return session
  }
}

function normalizeOrigin(value: string): string {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('originScope must be an HTTP(S) origin')
  return url.origin
}
function originAllowed(scope: string, target: string): boolean { try { return new URL(target).origin === scope } catch { return false } }

export function validateCdpEndpoint(value: string): string {
  const u = new URL(value)
  if (!['ws:','http:'].includes(u.protocol) || !['127.0.0.1','[::1]'].includes(u.hostname) || !u.port || u.username || u.password || u.search || u.hash) throw new Error('CDP endpoint must be explicit loopback without credentials')
  if (u.protocol === 'ws:' && !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(u.pathname)) throw new Error('invalid CDP browser endpoint')
  if (u.protocol === 'http:' && u.pathname !== '/') throw new Error('invalid CDP discovery endpoint')
  return u.href
}

export function publicSession(session: ManagedSessionRef): Omit<ManagedSessionRef, 'profileDir' | 'cdpEndpoint'> {
  const { profileDir: _dir, cdpEndpoint: _endpoint, ...publicFields } = session
  return publicFields
}
