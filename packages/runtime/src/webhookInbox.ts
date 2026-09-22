import { createHash, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { configureControlDatabase } from './sqliteSetup.js'
import type { WebhookEventEnvelope } from '@w2l/contracts'
import { webhookSignature } from './deliveryWorker.js'

export interface WebhookReceipt { eventId: string; disposition: 'applied' | 'duplicate' | 'stale'; eventVersion: number }
/** Reject tampering before parsing or acknowledging. Timestamp prevents unlimited signed replay. */
export function verifyWebhookSignature(secret: string, timestamp: string | undefined, signature: string | undefined, body: string, now = Date.now(), toleranceMs = 300_000): boolean {
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false
  const sent = Number(timestamp)
  if (!Number.isSafeInteger(sent) || Math.abs(now - sent) > toleranceMs) return false
  const expected = Buffer.from(webhookSignature(secret, timestamp, body))
  const actual = Buffer.from(signature)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Durable example downstream projection: receipt and version-gated state change share a transaction. */
export class WebhookInbox {
  private constructor(private readonly db: Database.Database) {
    db.transaction(() => db.exec(`CREATE TABLE IF NOT EXISTS webhook_inbox (event_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, identity_key TEXT NOT NULL, event_version INTEGER NOT NULL, disposition TEXT NOT NULL, received_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS webhook_projection (identity_key TEXT PRIMARY KEY, monitor_id TEXT NOT NULL, event_id TEXT NOT NULL, event_version INTEGER NOT NULL, payload_json TEXT NOT NULL, updated_at INTEGER NOT NULL);`)).immediate()
  }
  static open(path: string): WebhookInbox {
    mkdirSync(dirname(path), { recursive: true })
    const db = new Database(path)
    try {
      chmodSync(path, 0o600)
      configureControlDatabase(db)
      return new WebhookInbox(db)
    } catch (error) { db.close(); throw error }
  }
  close(): void { this.db.close() }
  receive(body: string, now = Date.now()): WebhookReceipt {
    const payload = parseEnvelope(body)
    const identity = JSON.stringify([payload.workspaceId, payload.monitorId, payload.entityKey, payload.viewKey])
    const hash = createHash('sha256').update(body).digest('hex')
    return this.db.transaction(() => {
      const prior = this.db.prepare('SELECT payload_hash FROM webhook_inbox WHERE event_id=?').get(payload.eventId) as { payload_hash: string } | undefined
      if (prior) {
        if (prior.payload_hash !== hash) throw new Error('event ID reused with different payload')
        return { eventId: payload.eventId, disposition: 'duplicate' as const, eventVersion: payload.eventVersion }
      }
      const current = this.db.prepare('SELECT event_version FROM webhook_projection WHERE identity_key=?').get(identity) as { event_version: number } | undefined
      const disposition: 'stale' | 'applied' = current && current.event_version >= payload.eventVersion ? 'stale' : 'applied'
      this.db.prepare('INSERT INTO webhook_inbox (event_id,payload_hash,identity_key,event_version,disposition,received_at) VALUES (?,?,?,?,?,?)').run(payload.eventId, hash, identity, payload.eventVersion, disposition, now)
      if (disposition === 'applied') this.db.prepare(`INSERT INTO webhook_projection (identity_key,monitor_id,event_id,event_version,payload_json,updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(identity_key) DO UPDATE SET event_id=excluded.event_id,event_version=excluded.event_version,payload_json=excluded.payload_json,updated_at=excluded.updated_at`).run(identity, payload.monitorId, payload.eventId, payload.eventVersion, body, now)
      return { eventId: payload.eventId, disposition, eventVersion: payload.eventVersion }
    }).immediate()
  }
  status(): { receipts: { eventId: string; eventVersion: number; disposition: string; receivedAt: number }[]; projections: WebhookEventEnvelope[] } {
    const rows = this.db.prepare('SELECT * FROM webhook_inbox ORDER BY received_at,event_id').all() as { event_id: string; event_version: number; disposition: string; received_at: number }[]
    const projections = this.db.prepare('SELECT payload_json FROM webhook_projection ORDER BY identity_key').all() as { payload_json: string }[]
    return { receipts: rows.map(row => ({ eventId: row.event_id, eventVersion: row.event_version, disposition: row.disposition, receivedAt: row.received_at })), projections: projections.map(row => JSON.parse(row.payload_json) as WebhookEventEnvelope) }
  }
}
function parseEnvelope(body: string): WebhookEventEnvelope {
  const payload: unknown = JSON.parse(body)
  if (!payload || typeof payload !== 'object') throw new Error('invalid webhook envelope')
  const value = payload as WebhookEventEnvelope
  if (value.schemaVersion !== 'w2l.monitor-event/v1' || !Number.isSafeInteger(value.eventVersion) || value.eventVersion < 1 || ['eventId', 'monitorId', 'workspaceId', 'entityKey', 'viewKey'].some(key => typeof (value as unknown as Record<string, unknown>)[key] !== 'string' || !(value as unknown as Record<string, string>)[key]?.trim()) || value.event?.id !== value.eventId || value.event.monitorId !== value.monitorId || value.snapshot?.monitorId !== value.monitorId || value.snapshot.version !== value.eventVersion || value.snapshot.id !== value.event.toSnapshotId) throw new Error('invalid webhook envelope')
  return value
}
