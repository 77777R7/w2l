import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { configureControlDatabase } from './sqliteSetup.js'
import type { DeliveryAttempt, DeliveryDestination, DeliveryDestinationInput, DeliveryQuery, DeliveryState, WebhookDelivery, WebhookEventEnvelope } from '@w2l/contracts'

export function createDeliveryTables(db: Database.Database): void {
  db.transaction(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS delivery_destinations (
      id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL, url TEXT NOT NULL, max_attempts INTEGER NOT NULL,
      enabled INTEGER NOT NULL, created_at INTEGER NOT NULL, secret_env TEXT
    );
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY, destination_id TEXT NOT NULL, monitor_id TEXT NOT NULL, event_id TEXT NOT NULL,
      event_version INTEGER NOT NULL, state TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL, lease_until INTEGER,
      fencing_token INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, delivered_at INTEGER,
      last_status INTEGER, last_error TEXT, payload_json TEXT NOT NULL,
      UNIQUE(destination_id,event_id)
    );
    CREATE INDEX IF NOT EXISTS webhook_delivery_due ON webhook_deliveries(state,next_attempt_at);
    CREATE TABLE IF NOT EXISTS delivery_origin_cooldowns (origin TEXT PRIMARY KEY, not_before INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS delivery_attempts (
      id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, fencing_token INTEGER NOT NULL,
      started_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT NOT NULL, status INTEGER,
      error TEXT, retry_after_at INTEGER, UNIQUE(delivery_id,fencing_token)
    );
  `)
  const columns = db.prepare('PRAGMA table_info(delivery_destinations)').all() as { name: string }[]
  if (!columns.some(column => column.name === 'secret_env')) db.exec('ALTER TABLE delivery_destinations ADD COLUMN secret_env TEXT')
  }).immediate()
}

/** Caller owns the transaction: invoke alongside event and outbox insertion. No network I/O. */
export function enqueueEventDeliveries(db: Database.Database, payload: WebhookEventEnvelope, now: number): number {
  const destinations = db.prepare('SELECT * FROM delivery_destinations WHERE monitor_id=?').all(payload.monitorId) as DestinationRow[]
  let count = 0
  for (const destination of destinations) {
    count += db.prepare(`INSERT OR IGNORE INTO webhook_deliveries
      (id,destination_id,monitor_id,event_id,event_version,state,max_attempts,next_attempt_at,created_at,payload_json)
      VALUES (?,?,?,?,?,'pending',?,?,?,?)`)
      .run(crypto.randomUUID(), destination.id, payload.monitorId, payload.eventId, payload.eventVersion, destination.max_attempts, Math.max(now, deliveryOriginNotBefore(db, destination.url)), now, JSON.stringify(payload)).changes
  }
  if (count > 0 && hasMonitorOutbox(db)) db.prepare("UPDATE monitor_outbox SET state='pending',acknowledged_at=NULL WHERE event_id=?").run(payload.eventId)
  return count
}

function deliveryOriginNotBefore(db: Database.Database, url: string): number {
  return (db.prepare('SELECT not_before FROM delivery_origin_cooldowns WHERE origin=?').get(new URL(url).origin) as { not_before: number } | undefined)?.not_before ?? 0
}

function hasMonitorOutbox(db: Database.Database): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='monitor_outbox'").get())
}

export function validateDestinationUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('webhook destination must be HTTPS without credentials or fragment')
  return url.href
}

interface DestinationRow { id: string; monitor_id: string; url: string; max_attempts: number; enabled: number; created_at: number; secret_env: string | null }
interface DeliveryRow { id: string; destination_id: string; monitor_id: string; event_id: string; event_version: number; state: DeliveryState; attempt_count: number; max_attempts: number; next_attempt_at: number; lease_until: number | null; fencing_token: number; created_at: number; delivered_at: number | null; last_status: number | null; last_error: string | null; payload_json: string }
interface AttemptRow { id: string; delivery_id: string; fencing_token: number; started_at: number; ended_at: number | null; outcome: DeliveryAttempt['outcome']; status: number | null; error: string | null; retry_after_at: number | null }
export interface DeliveryClaim { delivery: WebhookDelivery; destination: DeliveryDestination; attemptId: string }
export interface DeliveryCompletion { state: 'delivered' | 'pending' | 'dead_letter'; status: number | null; error: string | null; nextAttemptAt?: number; retryAfterAt?: number | null }

/** Caller owns the write transaction so subscription creation and historical enqueue can commit together. */
export function registerDeliveryDestination(db: Database.Database, input: DeliveryDestinationInput, now = Date.now()): DeliveryDestination {
  if (!input || typeof input.id !== 'string' || !input.id.trim() || input.id.length > 200 || typeof input.monitorId !== 'string' || !input.monitorId.trim() || input.monitorId.length > 200) throw new Error('invalid destination or monitor ID')
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('enabled must be boolean')
  if (input.secretEnv !== undefined && !/^W2L_WEBHOOK_SECRET_[A-Z0-9_]+$/.test(input.secretEnv)) throw new Error('secretEnv must name an operator W2L_WEBHOOK_SECRET_* variable')
  const url = validateDestinationUrl(input.url)
  const maxAttempts = input.maxAttempts ?? 8
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) throw new Error('maxAttempts must be an integer from 1 to 100')
  const row = db.prepare('SELECT * FROM delivery_destinations WHERE id=?').get(input.id) as DestinationRow | undefined
  const existing = row ? destinationFrom(row) : null
  if (existing) {
    if (existing.monitorId !== input.monitorId || existing.url !== url || existing.maxAttempts !== maxAttempts || existing.secretEnv !== input.secretEnv) throw new Error('destination identity is immutable; create a new destination ID')
    return existing
  }
  db.prepare('INSERT INTO delivery_destinations (id,monitor_id,url,max_attempts,enabled,created_at,secret_env) VALUES (?,?,?,?,?,?,?)')
    .run(input.id, input.monitorId, url, maxAttempts, input.enabled === false ? 0 : 1, now, input.secretEnv ?? null)
  return destinationFrom(db.prepare('SELECT * FROM delivery_destinations WHERE id=?').get(input.id) as DestinationRow)
}

export class DeliveryStore {
  private constructor(private readonly db: Database.Database) { createDeliveryTables(db) }
  static open(path: string): DeliveryStore {
    mkdirSync(dirname(path), { recursive: true })
    const db = new Database(path)
    try {
      chmodSync(path, 0o600)
      configureControlDatabase(db)
      return new DeliveryStore(db)
    } catch (error) { db.close(); throw error }
  }
  close(): void { this.db.close() }
  createDestination(input: DeliveryDestinationInput, now = Date.now()): DeliveryDestination {
    return this.db.transaction(() => registerDeliveryDestination(this.db, input, now)).immediate()
  }
  getDestination(id: string): DeliveryDestination | null {
    const row = this.db.prepare('SELECT * FROM delivery_destinations WHERE id=?').get(id) as DestinationRow | undefined
    return row ? destinationFrom(row) : null
  }
  listDestinations(monitorId?: string): DeliveryDestination[] {
    const rows = monitorId === undefined ? this.db.prepare('SELECT * FROM delivery_destinations ORDER BY created_at,id').all() : this.db.prepare('SELECT * FROM delivery_destinations WHERE monitor_id=? ORDER BY created_at,id').all(monitorId)
    return (rows as DestinationRow[]).map(destinationFrom)
  }
  setDestinationEnabled(id: string, enabled: boolean, _now = Date.now()): DeliveryDestination {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean')
    if (!this.db.prepare('UPDATE delivery_destinations SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id).changes) throw new Error('destination not found')
    return this.getDestination(id)!
  }
  /** Use this only when no monitor commit transaction is involved (e.g. explicit replay). */
  enqueue(payload: WebhookEventEnvelope, now = Date.now()): number {
    return this.db.transaction(() => enqueueEventDeliveries(this.db, payload, now)).immediate()
  }
  getDelivery(id: string): WebhookDelivery | null {
    const row = this.db.prepare('SELECT * FROM webhook_deliveries WHERE id=?').get(id) as DeliveryRow | undefined
    return row ? deliveryFrom(row) : null
  }
  listDeliveries(query: DeliveryQuery = {}): WebhookDelivery[] {
    const clauses: string[] = []
    const values: string[] = []
    for (const [column, value] of [['monitor_id', query.monitorId], ['destination_id', query.destinationId], ['state', query.state]]) {
      if (value !== undefined) { clauses.push(`${column}=?`); values.push(value) }
    }
    return (this.db.prepare(`SELECT * FROM webhook_deliveries ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at,id`).all(...values) as DeliveryRow[]).map(deliveryFrom)
  }
  attempts(id: string): DeliveryAttempt[] {
    return (this.db.prepare('SELECT * FROM delivery_attempts WHERE delivery_id=? ORDER BY fencing_token').all(id) as AttemptRow[]).map(row => ({ id: row.id, deliveryId: row.delivery_id, fencingToken: row.fencing_token, startedAt: row.started_at, endedAt: row.ended_at, outcome: row.outcome, status: row.status, error: row.error, retryAfterAt: row.retry_after_at }))
  }
  /** Claims/reclaims atomically across processes; a lease is never an exactly-once network guarantee. */
  claim(now: number, leaseMs: number): DeliveryClaim | null {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) throw new Error('invalid delivery lease')
    return this.db.transaction(() => {
      const rows = this.db.prepare(`SELECT d.* FROM webhook_deliveries d JOIN delivery_destinations s ON s.id=d.destination_id
        WHERE s.enabled=1 AND ((d.state='pending' AND d.next_attempt_at<=?) OR (d.state='delivering' AND d.lease_until<=?))
        ORDER BY d.next_attempt_at,d.created_at,d.id`).all(now, now) as DeliveryRow[]
      for (const row of rows) {
        const destination = this.getDestination(row.destination_id)!
        if (deliveryOriginNotBefore(this.db, destination.url) > now) continue
        if (row.state === 'delivering') this.db.prepare("UPDATE delivery_attempts SET outcome='lease_expired',ended_at=?,error='worker lease expired; acknowledgement unknown' WHERE delivery_id=? AND fencing_token=? AND outcome='sending'").run(now, row.id, row.fencing_token)
        if (row.attempt_count >= row.max_attempts) {
          this.db.prepare("UPDATE webhook_deliveries SET state='dead_letter',lease_until=NULL,last_error='attempt budget exhausted after lease expiry' WHERE id=?").run(row.id)
          continue
        }
        const token = row.fencing_token + 1
        const attemptId = crypto.randomUUID()
        this.db.prepare("UPDATE webhook_deliveries SET state='delivering',attempt_count=attempt_count+1,fencing_token=?,lease_until=? WHERE id=?").run(token, now + leaseMs, row.id)
        this.db.prepare("INSERT INTO delivery_attempts (id,delivery_id,fencing_token,started_at,outcome) VALUES (?,?,?,?,'sending')").run(attemptId, row.id, token, now)
        return { delivery: this.getDelivery(row.id)!, destination, attemptId }
      }
      return null
    }).immediate()
  }
  complete(id: string, fencingToken: number, result: DeliveryCompletion, now = Date.now()): boolean {
    return this.db.transaction(() => {
      const changed = this.db.prepare(`UPDATE webhook_deliveries SET state=?,lease_until=NULL,next_attempt_at=?,delivered_at=?,last_status=?,last_error=?
        WHERE id=? AND state='delivering' AND fencing_token=? AND lease_until>?`)
        .run(result.state, result.nextAttemptAt ?? now, result.state === 'delivered' ? now : null, result.status, result.error, id, fencingToken, now).changes
      if (!changed) return false
      if (result.retryAfterAt !== undefined && result.retryAfterAt !== null && result.retryAfterAt > now) {
        const delivery = this.getDelivery(id)!
        const origin = new URL(this.getDestination(delivery.destinationId)!.url).origin
        this.db.prepare('INSERT INTO delivery_origin_cooldowns (origin,not_before) VALUES (?,?) ON CONFLICT(origin) DO UPDATE SET not_before=MAX(not_before,excluded.not_before)').run(origin, result.retryAfterAt)
        // Make the effective retry schedule observable on already-queued sibling events.
        for (const destination of this.listDestinations()) {
          if (new URL(destination.url).origin === origin) this.db.prepare("UPDATE webhook_deliveries SET next_attempt_at=MAX(next_attempt_at,?) WHERE destination_id=? AND state='pending'").run(result.retryAfterAt, destination.id)
        }
      }
      this.db.prepare('UPDATE delivery_attempts SET ended_at=?,outcome=?,status=?,error=?,retry_after_at=? WHERE delivery_id=? AND fencing_token=?')
        .run(now, result.state === 'pending' ? 'retry' : result.state, result.status, result.error, result.retryAfterAt ?? null, id, fencingToken)
      if (result.state === 'delivered' && hasMonitorOutbox(this.db)) {
        const eventId = this.getDelivery(id)!.eventId
        if (!this.db.prepare("SELECT 1 FROM webhook_deliveries WHERE event_id=? AND state<>'delivered'").get(eventId)) this.db.prepare("UPDATE monitor_outbox SET state='acknowledged',acknowledged_at=? WHERE event_id=?").run(now, eventId)
      }
      return true
    }).immediate()
  }
  /** An explicit operator replay adds one fresh attempt budget but preserves identity/payload/history. */
  replayDeadLetter(id: string, now = Date.now()): WebhookDelivery {
    return this.db.transaction(() => {
      const delivery = this.getDelivery(id)
      if (!delivery || delivery.state !== 'dead_letter') throw new Error('delivery not found or not dead-lettered')
      const notBefore = deliveryOriginNotBefore(this.db, this.getDestination(delivery.destinationId)!.url)
      this.db.prepare("UPDATE webhook_deliveries SET state='pending',next_attempt_at=MAX(next_attempt_at,?),lease_until=NULL,max_attempts=attempt_count+1 WHERE id=? AND state='dead_letter'").run(Math.max(now, notBefore), id)
      return this.getDelivery(id)!
    }).immediate()
  }
}
function destinationFrom(row: DestinationRow): DeliveryDestination {
  return { id: row.id, monitorId: row.monitor_id, url: row.url, maxAttempts: row.max_attempts, enabled: row.enabled === 1, createdAt: row.created_at, ...(row.secret_env ? { secretEnv: row.secret_env } : {}) }
}
function deliveryFrom(row: DeliveryRow): WebhookDelivery {
  return { id: row.id, destinationId: row.destination_id, monitorId: row.monitor_id, eventId: row.event_id, eventVersion: row.event_version, state: row.state, attemptCount: row.attempt_count, maxAttempts: row.max_attempts, nextAttemptAt: row.next_attempt_at, leaseUntil: row.lease_until, fencingToken: row.fencing_token, createdAt: row.created_at, deliveredAt: row.delivered_at, lastStatus: row.last_status, lastError: row.last_error, payload: JSON.parse(row.payload_json) as WebhookEventEnvelope }
}
