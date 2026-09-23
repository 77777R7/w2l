import { randomBytes } from 'node:crypto'
import { abortableSleep } from '@w2l/http-core'

/** One durable gate for the anonymous Amazon.sg browser lane across Cloud Run instances. */
export interface AmazonOriginGate {
  acquire(signal: AbortSignal, deadlineAt: number): Promise<AmazonOriginPermit>
}

export interface AmazonOriginPermit {
  /** Persist a Retry-After as soon as it is observed, before the capture ends. */
  noteRetryAfter(retryAt: number): Promise<void>
  /** Release only this owner's lease; retain spacing and the longest cooldown. */
  release(retryAt?: number): Promise<void>
}

export class AmazonGateBusyError extends Error {
  constructor(readonly retryAfterAt?: number) { super('Amazon origin is busy until after the preview deadline'); this.name = 'AmazonGateBusyError' }
}

interface FirestoreDocument {
  name: string
  fields?: {
    owner?: { stringValue?: string }
    leaseUntil?: { integerValue?: string }
    nextEligibleAt?: { integerValue?: string }
  }
  updateTime?: string
}

interface GateDocument {
  name: string
  owner: string
  leaseUntil: number
  nextEligibleAt: number
  updateTime: string | null
}

export interface FirestoreAmazonGateOptions {
  fetcher?: typeof fetch
  now?: () => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Production defaults to 90 seconds; tests can use a controlled clock. */
  leaseMs?: number
  spacingMs?: number
  pollMs?: number
}

function parseTime(value: string | undefined, field: string): number {
  if (value === undefined) throw new Error(`Amazon gate ${field} is missing`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Amazon gate ${field} is malformed`)
  return parsed
}

function validateTime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Amazon gate time is invalid')
  return value
}

/** Firestore updateTime CAS serializes acquire/release across instances. No Firestore means no Amazon fetch. */
export class FirestoreAmazonOriginGate implements AmazonOriginGate {
  private readonly document: string
  private readonly documentUrl: string
  private readonly commits: string
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  private readonly leaseMs: number
  private readonly spacingMs: number
  private readonly pollMs: number

  constructor(projectId: string, options: FirestoreAmazonGateOptions = {}) {
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) throw new Error('W2L_FIRESTORE_PROJECT_ID is invalid')
    // Firestore Document.name is the resource path; only GET/commit requests
    // use the HTTPS REST URL.
    this.document = `projects/${projectId}/databases/(default)/documents/publicPreviewOriginGates/amazon-sg`
    this.documentUrl = `https://firestore.googleapis.com/v1/${this.document}`
    this.commits = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? abortableSleep
    this.leaseMs = options.leaseMs ?? 90_000
    this.spacingMs = options.spacingMs ?? 250
    this.pollMs = options.pollMs ?? 500
    for (const [name, value] of [['leaseMs', this.leaseMs], ['spacingMs', this.spacingMs], ['pollMs', this.pollMs]] as const) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Amazon gate ${name} must be a positive integer`)
    }
  }

  async acquire(signal: AbortSignal, deadlineAt: number): Promise<AmazonOriginPermit> {
    validateTime(deadlineAt)
    const owner = randomBytes(16).toString('hex')
    for (;;) {
      this.ensureActive(signal, deadlineAt)
      const token = await this.accessToken(signal, deadlineAt)
      const current = await this.read(token, signal, deadlineAt)
      this.ensureActive(signal, deadlineAt)
      const now = this.now()
      const occupiedUntil = current.owner && current.leaseUntil > now ? current.leaseUntil : 0
      const readyAt = Math.max(occupiedUntil, current.nextEligibleAt)
      if (readyAt > now) {
        // A Retry-After is immutable until it elapses, but an active owner
        // may release well before its 90-second crash lease expires.
        if (current.nextEligibleAt >= deadlineAt) throw new AmazonGateBusyError(current.nextEligibleAt)
        await this.sleep(Math.min(this.pollMs, readyAt - now, deadlineAt - now), signal)
        continue
      }
      const next: GateDocument = { ...current, owner, leaseUntil: now + this.leaseMs, nextEligibleAt: now + this.spacingMs }
      if (!await this.commit(token, current, next, signal, deadlineAt)) {
        await this.sleep(Math.min(25, Math.max(1, deadlineAt - this.now())), signal)
        continue
      }
      return {
        noteRetryAfter: retryAt => this.updateOwned(owner, retryAt, false),
        release: retryAt => this.updateOwned(owner, retryAt, true),
      }
    }
  }

  private async updateOwned(owner: string, retryAt: number | undefined, release: boolean): Promise<void> {
    if (retryAt !== undefined) validateTime(retryAt)
    for (let attempt = 0; attempt < 8; attempt++) {
      const token = await this.accessToken()
      const current = await this.read(token)
      if (current.owner !== owner) throw new Error('Amazon origin lease ownership changed')
      const next: GateDocument = {
        ...current,
        owner: release ? '' : owner,
        leaseUntil: release ? 0 : current.leaseUntil,
        nextEligibleAt: Math.max(current.nextEligibleAt, retryAt ?? 0, release ? this.now() + this.spacingMs : 0),
      }
      if (await this.commit(token, current, next)) return
    }
    throw new Error('Amazon origin lease contention exceeded retry budget')
  }

  private async accessToken(signal?: AbortSignal, deadlineAt?: number): Promise<string> {
    const response = await this.fetcher('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
      headers: { 'Metadata-Flavor': 'Google' }, signal: this.requestSignal(signal, deadlineAt, 3_000),
    })
    if (!response.ok) throw new Error('Cloud Run service identity is unavailable for Amazon gate')
    const body = await response.json() as { access_token?: string }
    if (!body.access_token) throw new Error('Cloud Run service identity returned no token for Amazon gate')
    return body.access_token
  }

  private async read(token: string, signal?: AbortSignal, deadlineAt?: number): Promise<GateDocument> {
    const response = await this.fetcher(this.documentUrl, {
      headers: { authorization: `Bearer ${token}` }, signal: this.requestSignal(signal, deadlineAt),
    })
    if (response.status === 404) return { name: this.document, owner: '', leaseUntil: 0, nextEligibleAt: 0, updateTime: null }
    if (!response.ok) throw new Error(`Firestore Amazon gate read failed (${response.status})`)
    const body = await response.json() as FirestoreDocument
    if (body.name !== this.document || !body.updateTime || typeof body.fields?.owner?.stringValue !== 'string') {
      throw new Error('Firestore Amazon gate document is malformed')
    }
    return {
      name: body.name, updateTime: body.updateTime,
      owner: body.fields?.owner?.stringValue ?? '',
      leaseUntil: parseTime(body.fields?.leaseUntil?.integerValue, 'leaseUntil'),
      nextEligibleAt: parseTime(body.fields?.nextEligibleAt?.integerValue, 'nextEligibleAt'),
    }
  }

  private async commit(token: string, current: GateDocument, next: GateDocument, signal?: AbortSignal, deadlineAt?: number): Promise<boolean> {
    const response = await this.fetcher(this.commits, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ writes: [{
        update: { name: next.name, fields: {
          owner: { stringValue: next.owner },
          leaseUntil: { integerValue: String(next.leaseUntil) },
          nextEligibleAt: { integerValue: String(next.nextEligibleAt) },
        } },
        currentDocument: current.updateTime === null ? { exists: false } : { updateTime: current.updateTime },
      }] }),
      signal: this.requestSignal(signal, deadlineAt),
    })
    if (response.ok) return true
    if (response.status === 409 || response.status === 412) return false
    if (response.status === 400) {
      const error = await response.json().catch(() => null) as { error?: { status?: string } } | null
      if (error?.error?.status === 'FAILED_PRECONDITION' || error?.error?.status === 'ABORTED') return false
    }
    throw new Error(`Firestore Amazon gate commit failed (${response.status})`)
  }

  private requestSignal(signal?: AbortSignal, deadlineAt?: number, capMs = 5_000): AbortSignal {
    if (signal && deadlineAt !== undefined) this.ensureActive(signal, deadlineAt)
    const remaining = deadlineAt === undefined ? capMs : Math.min(capMs, Math.max(1, deadlineAt - this.now()))
    const timeout = AbortSignal.timeout(remaining)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private ensureActive(signal: AbortSignal, deadlineAt: number): void {
    signal.throwIfAborted()
    if (this.now() >= deadlineAt) throw new AmazonGateBusyError()
  }
}

export function firestoreAmazonGateFromEnv(env: NodeJS.ProcessEnv = process.env): AmazonOriginGate {
  if (!env.W2L_FIRESTORE_PROJECT_ID) throw new Error('W2L_FIRESTORE_PROJECT_ID is required')
  return new FirestoreAmazonOriginGate(env.W2L_FIRESTORE_PROJECT_ID)
}
