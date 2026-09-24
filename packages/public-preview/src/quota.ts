import { createHmac } from 'node:crypto'
import { throwIfExecutionStopped, type ExecutionBudget } from '@w2l/http-core'

export type QuotaDecision = 'ok' | 'visitor_limited' | 'global_limited'

export interface PreviewQuota {
  /** Advisory read-only check before acquiring a scarce origin permit. */
  check?(visitor: string, now?: Date, execution?: ExecutionBudget): Promise<QuotaDecision>
  consume(visitor: string, now?: Date, execution?: ExecutionBudget): Promise<QuotaDecision>
}

interface FirestoreDocument {
  name: string
  fields?: { count?: { integerValue?: string } }
  updateTime?: string
}

interface DocumentRead {
  name: string
  count: number
  updateTime: string | null
}

/** Atomic two-counter compare-and-swap. A failed Firestore request never grants a scrape. */
export class FirestorePreviewQuota implements PreviewQuota {
  private readonly resourceBase: string
  private readonly endpointBase: string

  constructor(
    projectId: string,
    private readonly hashKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) throw new Error('W2L_FIRESTORE_PROJECT_ID is invalid')
    if (hashKey.length < 32) throw new Error('W2L_QUOTA_HASH_KEY must contain at least 32 characters')
    // Firestore Document.name is a resource name, not the REST endpoint URL.
    this.resourceBase = `projects/${projectId}/databases/(default)/documents`
    this.endpointBase = `https://firestore.googleapis.com/v1/${this.resourceBase}`
  }

  private names(visitor: string, now: Date): { global: string; individual: string } {
    const day = now.toISOString().slice(0, 10)
    const visitorHash = createHmac('sha256', this.hashKey).update(`${day}:${visitor}`).digest('hex')
    return {
      global: `${this.resourceBase}/publicPreviewQuotas/${day}-global`,
      individual: `${this.resourceBase}/publicPreviewQuotas/${day}-${visitorHash}`,
    }
  }

  async check(visitor: string, now = new Date(), execution: ExecutionBudget = {}): Promise<QuotaDecision> {
    throwIfExecutionStopped(execution)
    const { global, individual } = this.names(visitor, now)
    const token = await this.accessToken(execution)
    const [all, own] = await Promise.all([this.read(global, token, execution), this.read(individual, token, execution)])
    throwIfExecutionStopped(execution)
    if (all.count >= 100) return 'global_limited'
    if (own.count >= 3) return 'visitor_limited'
    return 'ok'
  }

  async consume(visitor: string, now = new Date(), execution: ExecutionBudget = {}): Promise<QuotaDecision> {
    const { global, individual } = this.names(visitor, now)
    // Firestore commits are atomic. Under contention the preconditions force
    // a retry instead of allowing two requests to consume the same last slot.
    for (let attempt = 0; attempt < 6; attempt++) {
      throwIfExecutionStopped(execution)
      const token = await this.accessToken(execution)
      const [all, own] = await Promise.all([this.read(global, token, execution), this.read(individual, token, execution)])
      if (all.count >= 100) return 'global_limited'
      if (own.count >= 3) return 'visitor_limited'
      // A client disconnect between the reads and commit must not consume a
      // quota slot for a scrape that will never start.
      throwIfExecutionStopped(execution)
      const response = await this.fetcher(`${this.endpointBase}:commit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ writes: [this.write(all), this.write(own)] }),
        signal: this.requestSignal(execution, 5_000),
      })
      if (response.ok) return 'ok'
      // FAILED_PRECONDITION / ABORTED: another instance won the race.
      if (response.status === 409 || response.status === 412) continue
      if (response.status === 400) {
        const error = await response.json().catch(() => null) as { error?: { status?: string } } | null
        if (error?.error?.status === 'FAILED_PRECONDITION' || error?.error?.status === 'ABORTED') continue
      }
      throw new Error(`Firestore quota commit failed (${response.status})`)
    }
    throw new Error('Firestore quota contention exceeded retry budget')
  }

  private write(doc: DocumentRead): Record<string, unknown> {
    return {
      update: { name: doc.name, fields: { count: { integerValue: String(doc.count + 1) } } },
      currentDocument: doc.updateTime === null ? { exists: false } : { updateTime: doc.updateTime },
    }
  }

  private async read(name: string, token: string, execution: ExecutionBudget): Promise<DocumentRead> {
    const response = await this.fetcher(`https://firestore.googleapis.com/v1/${name}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: this.requestSignal(execution, 5_000),
    })
    if (response.status === 404) return { name, count: 0, updateTime: null }
    if (!response.ok) throw new Error(`Firestore quota read failed (${response.status})`)
    const doc = await response.json() as FirestoreDocument
    const rawCount = doc.fields?.count?.integerValue
    const count = Number(rawCount)
    if (doc.name !== name || rawCount === undefined || !Number.isSafeInteger(count) || count < 0 || !doc.updateTime) {
      throw new Error('Firestore quota document is malformed')
    }
    return { name, count, updateTime: doc.updateTime }
  }

  private async accessToken(execution: ExecutionBudget): Promise<string> {
    const response = await this.fetcher('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: this.requestSignal(execution, 3_000),
    })
    if (!response.ok) throw new Error('Cloud Run service identity is unavailable')
    const body = await response.json() as { access_token?: string }
    if (!body.access_token) throw new Error('Cloud Run service identity returned no token')
    return body.access_token
  }

  private requestSignal(execution: ExecutionBudget, capMs: number): AbortSignal {
    throwIfExecutionStopped(execution)
    const remaining = execution.deadlineAt === undefined ? capMs : Math.min(capMs, Math.max(1, execution.deadlineAt - Date.now()))
    const timeout = AbortSignal.timeout(remaining)
    return execution.signal ? AbortSignal.any([execution.signal, timeout]) : timeout
  }
}

export function firestoreQuotaFromEnv(env: NodeJS.ProcessEnv = process.env): PreviewQuota {
  const project = env.W2L_FIRESTORE_PROJECT_ID
  const hashKey = env.W2L_QUOTA_HASH_KEY
  if (!project || !hashKey) throw new Error('W2L_FIRESTORE_PROJECT_ID and W2L_QUOTA_HASH_KEY are required')
  return new FirestorePreviewQuota(project, hashKey)
}
