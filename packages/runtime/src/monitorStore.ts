import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { configureControlDatabase } from './sqliteSetup.js'
import type {
  DocumentAssessment, DocumentDiff, DocumentFields, MonitorAttempt, MonitorEvent,
  MonitorObservation, MonitorRevision, MonitorRun, MonitorSnapshot, MonitorView,
} from '@w2l/contracts'
import { DOCUMENT_RULE_VERSION, FIRECRAWL_INTRO_URL, parseMonitorRevision, monitorIdentity, type TransportRepresentation } from '@w2l/contracts'
import { fieldComparable } from './configuredAssessment.js'
import { createDeliveryTables, enqueueEventDeliveries, registerDeliveryDestination } from './deliveryStore.js'
import type { WebhookEventEnvelope, DeliveryDestinationInput, DeliveryDestination } from '@w2l/contracts'

interface MonitorRow { id: string; enabled: number; control_epoch: number; revision: number; url: string; rule_version: string; interval_ms: number; stale_after_ms: number; created_at: number; updated_at: number; next_run_at: number; last_checked_at: number | null; last_verified_at: number | null }
interface RunRow { id: string; monitor_id: string; revision: number; trigger_key: string; state: string; epoch: number; fencing_token: number; attempt_id: string | null; lease_until: number | null; deadline_at: number | null; next_attempt_at: number | null; expected_baseline_id: string | null; created_at: number; ended_at: number | null; quality: string | null; change_kind: string | null; error: string | null }
interface AttemptRow { id: string; run_id: string; fencing_token: number; state: string; started_at: number; ended_at: number | null; recovered_from_attempt_id: string | null }
export interface MonitorStoreTestOptions { failCommitAfter?: 'snapshot' | 'event'; leaseMs?: number; attemptTimeoutMs?: number }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS monitors (
 id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, control_epoch INTEGER NOT NULL, revision INTEGER NOT NULL,
 url TEXT NOT NULL, rule_version TEXT NOT NULL, interval_ms INTEGER NOT NULL, stale_after_ms INTEGER NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, next_run_at INTEGER NOT NULL,
 last_checked_at INTEGER, last_verified_at INTEGER
);
CREATE TABLE IF NOT EXISTS monitor_revisions (
 monitor_id TEXT NOT NULL, revision INTEGER NOT NULL, url TEXT NOT NULL, rule_version TEXT NOT NULL,
 interval_ms INTEGER NOT NULL, stale_after_ms INTEGER NOT NULL, created_at INTEGER NOT NULL, config_json TEXT,
 PRIMARY KEY (monitor_id, revision)
);
CREATE TABLE IF NOT EXISTS monitor_runs (
 id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL, revision INTEGER NOT NULL, trigger_key TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL, epoch INTEGER NOT NULL, fencing_token INTEGER NOT NULL, attempt_id TEXT,
 lease_until INTEGER, deadline_at INTEGER, expected_baseline_id TEXT, created_at INTEGER NOT NULL,
 ended_at INTEGER, quality TEXT, change_kind TEXT, error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS monitor_active_run ON monitor_runs(monitor_id)
 WHERE state IN ('queued','running','committing');
CREATE TABLE IF NOT EXISTS monitor_attempts (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, fencing_token INTEGER NOT NULL, state TEXT NOT NULL,
 started_at INTEGER NOT NULL, ended_at INTEGER, recovered_from_attempt_id TEXT
);
CREATE TABLE IF NOT EXISTS monitor_observations (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, attempt_id TEXT NOT NULL, observed_at INTEGER NOT NULL,
  client_wall_ms INTEGER NOT NULL, markdown_sha256 TEXT, transport_json TEXT, outcome_json TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS monitor_assessments (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, observation_id TEXT NOT NULL, quality TEXT NOT NULL,
 reasons_json TEXT NOT NULL, fields_json TEXT, evidence_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS monitor_snapshots (
 id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL, revision INTEGER NOT NULL, version INTEGER NOT NULL,
 observation_id TEXT NOT NULL, assessment_id TEXT NOT NULL, fields_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS monitor_baselines (monitor_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS monitor_events (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, monitor_id TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL,
 from_snapshot_id TEXT, to_snapshot_id TEXT NOT NULL, changes_json TEXT NOT NULL, observed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS monitor_origin_cooldowns (origin TEXT PRIMARY KEY, not_before INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS monitor_outbox (
 event_id TEXT PRIMARY KEY, state TEXT NOT NULL, acknowledged_at INTEGER
);
`

export class MonitorStore {
  private readonly db: Database.Database
  readonly leaseMs: number
  readonly attemptTimeoutMs: number

  static open(path: string, options: MonitorStoreTestOptions = {}): MonitorStore {
    mkdirSync(dirname(path), { recursive: true })
    const store = new MonitorStore(path, options)
    chmodSync(path, 0o600)
    return store
  }

  private readonly testOptions: MonitorStoreTestOptions

  private constructor(path: string, options: MonitorStoreTestOptions) {
    this.testOptions = options
    this.leaseMs = options.leaseMs ?? 30_000
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? 300_000
    if (![this.leaseMs, this.attemptTimeoutMs].every((n) => Number.isSafeInteger(n) && n > 0)) throw new Error('invalid execution timing')
    this.db = new Database(path)
    configureControlDatabase(this.db)
    this.db.transaction(() => {
    this.db.exec(SCHEMA)
    createDeliveryTables(this.db)
    const runColumns = this.db.prepare('PRAGMA table_info(monitor_runs)').all() as {name:string}[]
    if (!runColumns.some((c) => c.name === 'next_attempt_at')) this.db.exec('ALTER TABLE monitor_runs ADD COLUMN next_attempt_at INTEGER')
    this.db.transaction(() => {
      const index = this.db.prepare("SELECT sql FROM sqlite_master WHERE name='monitor_active_run'").get() as {sql:string} | undefined
      if (!index?.sql.includes('waiting_retry')) this.db.exec("DROP INDEX IF EXISTS monitor_active_run; CREATE UNIQUE INDEX monitor_active_run ON monitor_runs(monitor_id) WHERE state IN ('queued','running','waiting_retry','committing')")
    }).immediate()
    const observationColumns = this.db.prepare('PRAGMA table_info(monitor_observations)').all() as {name:string}[]
    if (!observationColumns.some((c)=>c.name==='transport_json')) this.db.exec('ALTER TABLE monitor_observations ADD COLUMN transport_json TEXT')
    this.db.transaction(() => {
      const columns = this.db.prepare('PRAGMA table_info(monitor_revisions)').all() as {name:string}[]
      if (!columns.some((c)=>c.name==='config_json')) this.db.exec('ALTER TABLE monitor_revisions ADD COLUMN config_json TEXT')
      this.db.exec('CREATE TABLE IF NOT EXISTS monitor_transport (key TEXT PRIMARY KEY, body TEXT NOT NULL)')
    }).immediate()
    }).immediate()
  }

  createOrGetRevision(revision: MonitorRevision, initialEnabled = true): MonitorRevision {
    if (revision.config) revision = parseMonitorRevision(revision)
    else if (revision.url !== FIRECRAWL_INTRO_URL || revision.ruleVersion !== DOCUMENT_RULE_VERSION) throw new Error('unsupported monitor adapter')
    if (![revision.revision, revision.intervalMs, revision.staleAfterMs].every((n) => Number.isSafeInteger(n) && n > 0)) throw new Error('invalid revision or interval')
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM monitor_revisions WHERE monitor_id = ? AND revision = ?').get(revision.monitorId, revision.revision) as Record<string, unknown> | undefined
      if (existing) {
        if (existing.url !== revision.url || existing.rule_version !== revision.ruleVersion || existing.interval_ms !== revision.intervalMs || existing.stale_after_ms !== revision.staleAfterMs || existing.config_json !== (revision.config ? JSON.stringify(revision.config) : null)) throw new Error('revision is immutable')
        return { ...revision, createdAt: Number(existing.created_at) }
      }
      const current = this.db.prepare('SELECT * FROM monitors WHERE id=?').get(revision.monitorId) as MonitorRow | undefined
      if (revision.revision !== (current?.revision ?? 0) + 1) throw new Error('revision must be sequential')
      if (current && JSON.stringify(monitorIdentity(this.getRevision(revision.monitorId))) !== JSON.stringify(monitorIdentity(revision))) throw new Error('identity change requires a new monitor')
      if (this.db.prepare("SELECT id FROM monitor_runs WHERE monitor_id=? AND state IN ('running','waiting_retry','queued','committing')").get(revision.monitorId)) throw new Error('cannot revise active monitor')
      const now = revision.createdAt
      if (!current) {
        this.db.prepare(`INSERT INTO monitors (id, enabled, control_epoch, revision, url, rule_version, interval_ms, stale_after_ms, created_at, updated_at, next_run_at) VALUES (?,?,1,?,?,?,?,?,?,?,?)`)
          .run(revision.monitorId, initialEnabled ? 1 : 0, revision.revision, revision.url, revision.ruleVersion, revision.intervalMs, revision.staleAfterMs, now, now, now)
      } else {
        this.db.prepare('UPDATE monitors SET revision=?, rule_version=?, url=?, control_epoch=control_epoch+1, interval_ms=?, stale_after_ms=?, updated_at=?, next_run_at=? WHERE id=?')
          .run(revision.revision, revision.ruleVersion, revision.url, revision.intervalMs, revision.staleAfterMs, now, now, revision.monitorId)
      }
      this.db.prepare(`INSERT INTO monitor_revisions (monitor_id, revision, url, rule_version, interval_ms, stale_after_ms, created_at, config_json) VALUES (?,?,?,?,?,?,?,?)`)
        .run(revision.monitorId, revision.revision, revision.url, revision.ruleVersion, revision.intervalMs, revision.staleAfterMs, now, revision.config ? JSON.stringify(revision.config) : null)
      return revision
    }).immediate()
  }

  /** A manual MCP run is durable before the HTTP response is sent. The scheduler claims it later. */
  enqueueRun(monitorId: string, triggerKey = `manual:${crypto.randomUUID()}`, now = Date.now()): MonitorRun {
    if (!triggerKey.trim() || triggerKey.length > 200) throw new Error('invalid trigger key')
    return this.db.transaction(() => {
      const monitor = this.db.prepare('SELECT * FROM monitors WHERE id=?').get(monitorId) as MonitorRow | undefined
      if (!monitor) throw new Error('monitor not found')
      if (!monitor.enabled) throw new Error('monitor paused')
      const storedKey = JSON.stringify([monitorId, triggerKey])
      const existing = this.db.prepare('SELECT * FROM monitor_runs WHERE monitor_id=? AND trigger_key IN (?,?)').get(monitorId, storedKey, triggerKey) as RunRow | undefined
      if (existing) return runFrom(existing)
      const active = this.db.prepare("SELECT id FROM monitor_runs WHERE monitor_id=? AND state IN ('queued','running','waiting_retry','committing')").get(monitorId) as {id:string} | undefined
      if (active) return this.getRun(active.id)!
      const id = crypto.randomUUID()
      this.db.prepare(`INSERT INTO monitor_runs (id,monitor_id,revision,trigger_key,state,epoch,fencing_token,expected_baseline_id,created_at) VALUES (?,?,?,?,'queued',?,?,?,?)`)
        .run(id, monitorId, monitor.revision, storedKey, monitor.control_epoch, monitor.control_epoch, this.getBaselineId(monitorId), now)
      this.db.prepare('UPDATE monitors SET next_run_at=? WHERE id=?').run(Math.min(now, monitor.next_run_at), monitorId)
      return this.getRun(id)!
    }).immediate()
  }

  startRun(monitorId: string, triggerKey: string, now: number): MonitorRun {
    if (!triggerKey.trim() || triggerKey.length > 200) throw new Error('invalid trigger key')
    return this.db.transaction(() => {
      const storedKey = JSON.stringify([monitorId, triggerKey])
      const existing = this.db.prepare('SELECT * FROM monitor_runs WHERE monitor_id=? AND trigger_key IN (?,?)').get(monitorId, storedKey, triggerKey) as RunRow | undefined
      if (existing && !['queued', 'running', 'waiting_retry', 'committing'].includes(existing.state)) return runFrom(existing)
      const monitor = this.db.prepare('SELECT * FROM monitors WHERE id=?').get(monitorId) as MonitorRow | undefined
      if (!monitor) throw new Error(`monitor not found: ${monitorId}`)
      if (!monitor.enabled) throw new Error('monitor paused')
      const notBefore = this.originNotBefore(monitorId)
      const active = this.db.prepare("SELECT * FROM monitor_runs WHERE monitor_id=? AND state IN ('queued','running','waiting_retry','committing')").get(monitorId) as RunRow | undefined
      if (active) {
        if (notBefore > now && (active.state === 'waiting_retry' || (active.lease_until ?? 0) <= now)) {
          const nextAttemptAt = Math.max(notBefore, active.next_attempt_at ?? 0)
          this.db.prepare("UPDATE monitor_attempts SET state='interrupted',ended_at=? WHERE id=? AND state='running'").run(now, active.attempt_id)
          this.db.prepare("UPDATE monitor_runs SET state='waiting_retry',lease_until=NULL,deadline_at=NULL,next_attempt_at=? WHERE id=?").run(nextAttemptAt, active.id)
          this.db.prepare('UPDATE monitors SET next_run_at=? WHERE id=?').run(nextAttemptAt, monitorId)
          return this.getRun(active.id)!
        }
        if (active.state === 'waiting_retry' && (active.next_attempt_at ?? Infinity) > now) return runFrom(active)
        if (active.state === 'running' && (active.lease_until ?? Infinity) > now) {
          if (existing?.id === active.id) return runFrom(active)
          throw new Error(`monitor already has active run: ${active.id}`)
        }
        const attemptId = crypto.randomUUID()
        this.db.prepare("UPDATE monitor_attempts SET state='interrupted',ended_at=? WHERE id=? AND state='running'").run(now, active.attempt_id)
        this.db.prepare("INSERT INTO monitor_attempts (id,run_id,fencing_token,state,started_at,recovered_from_attempt_id) VALUES (?,?,?,'running',?,?)")
          .run(attemptId, active.id, active.fencing_token + 1, now, active.attempt_id)
        this.db.prepare("UPDATE monitor_runs SET state='running',attempt_id=?,fencing_token=fencing_token+1,lease_until=?,deadline_at=?,next_attempt_at=NULL,error=NULL WHERE id=?")
          .run(attemptId, now + Math.min(this.leaseMs, this.attemptTimeoutMs), now + this.attemptTimeoutMs, active.id)
        return this.getRun(active.id)!
      }
      const id = crypto.randomUUID(), attemptId = crypto.randomUUID()
      if (notBefore > now) {
        this.db.prepare(`INSERT INTO monitor_runs (id,monitor_id,revision,trigger_key,state,epoch,fencing_token,next_attempt_at,expected_baseline_id,created_at) VALUES (?,?,?,?,'waiting_retry',?,?,?,?,?)`)
          .run(id, monitorId, monitor.revision, storedKey, monitor.control_epoch, monitor.control_epoch, notBefore, this.getBaselineId(monitorId), now)
        this.db.prepare('UPDATE monitors SET next_run_at=? WHERE id=?').run(notBefore, monitorId)
        return this.getRun(id)!
      }
      this.db.prepare(`INSERT INTO monitor_runs (id,monitor_id,revision,trigger_key,state,epoch,fencing_token,attempt_id,lease_until,deadline_at,expected_baseline_id,created_at) VALUES (?,?,?,?,'running',?,?,?,?,?,?,?)`)
        .run(id, monitorId, monitor.revision, storedKey, monitor.control_epoch, monitor.control_epoch, attemptId, now + Math.min(this.leaseMs, this.attemptTimeoutMs), now + this.attemptTimeoutMs, this.getBaselineId(monitorId), now)
      this.db.prepare("INSERT INTO monitor_attempts (id,run_id,fencing_token,state,started_at) VALUES (?,?,?,'running',?)").run(attemptId, id, monitor.control_epoch, now)
      this.db.prepare('UPDATE monitors SET next_run_at=? WHERE id=?').run(now + monitor.interval_ms, monitorId)
      return this.getRun(id)!
    }).immediate()
  }

  /** All scheduling decisions are made under claim's write transaction. */
  dueRun(monitorId: string, now: number): MonitorRun | null {
    const monitor = this.db.prepare('SELECT * FROM monitors WHERE id=?').get(monitorId) as MonitorRow | undefined
    if (!monitor?.enabled) return null
    const active = this.db.prepare("SELECT * FROM monitor_runs WHERE monitor_id=? AND state IN ('queued','running','waiting_retry')").get(monitorId) as RunRow | undefined
    if (active?.state === 'running' && (active.lease_until ?? Infinity) > now) return null
    if (active?.state === 'waiting_retry' && (active.next_attempt_at ?? Infinity) > now) return null
    if (!active && monitor.next_run_at > now) return null
    return this.startRun(monitorId, active ? runFrom(active).triggerKey : `scheduled:${monitorId}:${monitor.revision}:${monitor.next_run_at}`, now)
  }

  assertExecution(owner: MonitorRun, now = Date.now()): void {
    const current = this.getRun(owner.id)
    if (!current || current.attemptId !== owner.attemptId || current.fencingToken !== owner.fencingToken) throw new Error('stale execution token')
    this.assertOwner(current, now)
  }

  renew(owner: MonitorRun, nowOverride?: number): boolean {
    return this.db.transaction(() => {
      const now = nowOverride ?? Date.now()
      try { this.assertExecution(owner, now) } catch { return false }
      this.db.prepare('UPDATE monitor_runs SET lease_until=? WHERE id=?').run(Math.min(now + this.leaseMs, this.getRun(owner.id)!.deadlineAt!), owner.id)
      return true
    }).immediate()
  }

  endAttempt(owner: MonitorRun, state: 'cancelled' | 'expired' | 'failed', reason: string, nowOverride?: number): boolean {
    return this.db.transaction(() => {
      const now = nowOverride ?? Date.now()
      const current = this.getRun(owner.id)
      if (!current || current.state !== 'running' || current.attemptId !== owner.attemptId || current.fencingToken !== owner.fencingToken) return false
      this.finishRun(owner.id, state, 'unknown', 'cannot_verify', now, reason)
      return true
    }).immediate()
  }

  deferRun(owner: MonitorRun, retryAt: number, nowOverride?: number): void {
    this.db.transaction(() => {
      const now = nowOverride ?? Date.now()
      this.assertExecution(owner, now)
      if (!Number.isSafeInteger(retryAt) || retryAt <= now) throw new Error('invalid retry time')
      const origin = new URL(this.getRevision(owner.monitorId).url).origin
      this.db.prepare('INSERT INTO monitor_origin_cooldowns VALUES (?,?) ON CONFLICT(origin) DO UPDATE SET not_before=MAX(not_before,excluded.not_before)').run(origin, retryAt)
      this.db.prepare("UPDATE monitor_attempts SET state='failed',ended_at=? WHERE id=?").run(now, owner.attemptId)
      this.db.prepare("UPDATE monitor_runs SET state='waiting_retry',lease_until=NULL,deadline_at=NULL,next_attempt_at=?,error='retry_after' WHERE id=?").run(retryAt, owner.id)
      this.db.prepare('UPDATE monitors SET next_run_at=?,last_checked_at=? WHERE id=?').run(retryAt, now, owner.monitorId)
    }).immediate()
  }

  noteRetryAfter(owner: MonitorRun, responseUrl: string, retryAt: number, nowOverride?: number): void {
    this.db.transaction(() => {
      const now = nowOverride ?? Date.now()
      this.assertExecution(owner, now)
      if (!Number.isSafeInteger(retryAt) || retryAt <= now) return
      for (const origin of new Set([new URL(this.getRevision(owner.monitorId).url).origin, new URL(responseUrl).origin])) {
        this.db.prepare('INSERT INTO monitor_origin_cooldowns VALUES (?,?) ON CONFLICT(origin) DO UPDATE SET not_before=MAX(not_before,excluded.not_before)').run(origin, retryAt)
      }
    }).immediate()
  }

  private originNotBefore(monitorId: string): number {
    const origin = new URL(this.getRevision(monitorId).url).origin
    return (this.db.prepare('SELECT not_before FROM monitor_origin_cooldowns WHERE origin=?').get(origin) as {not_before:number} | undefined)?.not_before ?? 0
  }

  interrupt(owner: MonitorRun, nowOverride?: number): void {
    this.db.transaction(() => {
      const now = nowOverride ?? Date.now()
      const current = this.getRun(owner.id)
      if (!current || current.state !== 'running' || current.attemptId !== owner.attemptId || current.fencingToken !== owner.fencingToken) return
      this.db.prepare("UPDATE monitor_attempts SET state='interrupted',ended_at=? WHERE id=?").run(now, owner.attemptId)
      const next = Math.max(now, this.originNotBefore(owner.monitorId))
      this.db.prepare("UPDATE monitor_runs SET state='waiting_retry',lease_until=NULL,deadline_at=NULL,next_attempt_at=?,error='service shutdown' WHERE id=?").run(next, owner.id)
      this.db.prepare('UPDATE monitors SET next_run_at=? WHERE id=?').run(next, owner.monitorId)
    }).immediate()
  }

  cancel(monitorId: string, runId: string, now = Date.now()): MonitorView {
    this.db.transaction(() => {
      const run = this.getRun(runId)
      if (!run || run.monitorId !== monitorId) throw new Error('run not found')
      if (['queued','running','waiting_retry','committing'].includes(run.state)) {
        this.finishRun(runId, 'cancelled', 'unknown', 'cannot_verify', now, 'cancelled by user')
      }
    }).immediate()
    return this.view(monitorId, now)
  }

  setEnabled(monitorId: string, enabled: boolean, now = Date.now()): MonitorView {
    this.db.transaction(() => {
      const monitor = this.db.prepare('SELECT enabled FROM monitors WHERE id=?').get(monitorId) as {enabled:number} | undefined
      if (!monitor) throw new Error('monitor not found')
      if ((monitor.enabled === 1) === enabled) return
      const active = this.db.prepare("SELECT id FROM monitor_runs WHERE monitor_id=? AND state IN ('queued','running','waiting_retry','committing')").all(monitorId) as {id:string}[]
      if (!enabled) for (const run of active) this.cancel(monitorId, run.id, now)
      this.db.prepare('UPDATE monitors SET enabled=?,control_epoch=control_epoch+1,updated_at=?,next_run_at=? WHERE id=?').run(enabled ? 1 : 0, now, Math.max(now, this.originNotBefore(monitorId)), monitorId)
    }).immediate()
    return this.view(monitorId, now)
  }

  getRun(id: string): MonitorRun | null {
    const row = this.db.prepare('SELECT * FROM monitor_runs WHERE id = ?').get(id) as RunRow | undefined
    return row ? runFrom(row) : null
  }

  runDetail(monitorId: string, runId: string): { run: MonitorRun; assessment: DocumentAssessment | null; observation: MonitorObservation | null; attempts: MonitorAttempt[] } | null {
    const run = this.getRun(runId)
    if (!run || run.monitorId !== monitorId) return null
    const assessmentRow = this.db.prepare('SELECT * FROM monitor_assessments WHERE run_id=? ORDER BY rowid DESC LIMIT 1').get(runId) as {rule_version?:string; quality:DocumentAssessment['quality'];reasons_json:string;fields_json:string|null;evidence_json:string} | undefined
    const observationRow = this.db.prepare('SELECT * FROM monitor_observations WHERE run_id=? ORDER BY rowid DESC LIMIT 1').get(runId) as {id:string;run_id:string;attempt_id:string;observed_at:number;client_wall_ms:number;markdown_sha256:string|null;transport_json:string|null;outcome_json:string|null;error:string|null} | undefined
    const observation: MonitorObservation | null = observationRow ? { id:observationRow.id,runId:observationRow.run_id,attemptId:observationRow.attempt_id,observedAt:observationRow.observed_at,clientWallMs:observationRow.client_wall_ms,markdownSha256:observationRow.markdown_sha256,transport:observationRow.transport_json ? JSON.parse(observationRow.transport_json) : null,outcome:observationRow.outcome_json ? JSON.parse(observationRow.outcome_json) : null,error:observationRow.error } : null
    const assessment: DocumentAssessment | null = assessmentRow ? { ruleVersion:this.getRevision(monitorId,run.revision).ruleVersion,quality:assessmentRow.quality,reasons:JSON.parse(assessmentRow.reasons_json),fields:assessmentRow.fields_json ? JSON.parse(assessmentRow.fields_json) : null,evidence:JSON.parse(assessmentRow.evidence_json) } : null
    return {run,assessment,observation,attempts:this.attempts(runId)}
  }

  getBaseline(monitorId: string): MonitorSnapshot | null {
    const row = this.db.prepare('SELECT s.* FROM monitor_baselines b JOIN monitor_snapshots s ON s.id = b.snapshot_id WHERE b.monitor_id = ?').get(monitorId) as SnapshotRow | undefined
    return row ? snapshotFrom(row) : null
  }

  recordObservation(observation: MonitorObservation, assessmentId: string, assessment: DocumentAssessment, transportChange?: { key: string; representation: TransportRepresentation | null }, nowOverride?: number): void {
    this.db.transaction(() => {
    const run = this.getRun(observation.runId)
    if (!run || run.attemptId !== observation.attemptId) throw new Error('stale observation attempt')
    this.assertOwner(run, nowOverride ?? Date.now())
    if (transportChange) {
      if (transportChange.representation) this.saveRepresentation(transportChange.representation)
      else this.deleteRepresentation(transportChange.key)
    }
    if (assessment.ruleVersion !== this.getRevision(run.monitorId,run.revision).ruleVersion) throw new Error('assessment rule mismatch')
    this.db.prepare(`INSERT INTO monitor_observations (id, run_id, attempt_id, observed_at, client_wall_ms, markdown_sha256, transport_json, outcome_json, error) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(observation.id, observation.runId, observation.attemptId, observation.observedAt, observation.clientWallMs, observation.markdownSha256, JSON.stringify(observation.transport ?? null), JSON.stringify(observation.outcome), observation.error)
    this.db.prepare(`INSERT INTO monitor_assessments (id, run_id, observation_id, quality, reasons_json, fields_json, evidence_json) VALUES (?,?,?,?,?,?,?)`)
      .run(assessmentId, observation.runId, observation.id, assessment.quality, JSON.stringify(assessment.reasons), assessment.fields ? JSON.stringify(assessment.fields) : null, JSON.stringify(assessment.evidence))
    // Serialization can consume the remaining budget; rollback transport too.
    this.assertOwner(run, nowOverride ?? Date.now())
    }).immediate()
  }

  commit(runId: string, observationId: string, assessmentId: string, assessment: DocumentAssessment, nowOverride?: number): MonitorEvent | null {
    return this.db.transaction(() => {
    const now = nowOverride ?? Date.now()
    const run = this.getRun(runId)
    if (!run) throw new Error('run not found')
    const evidence = this.db.prepare(`SELECT a.*,o.attempt_id FROM monitor_assessments a JOIN monitor_observations o ON o.id=a.observation_id WHERE a.id=? AND a.run_id=? AND a.observation_id=?`).get(assessmentId, runId, observationId) as { attempt_id: string; quality: string; fields_json: string | null; reasons_json: string; evidence_json: string } | undefined
    if (!evidence || evidence.attempt_id !== run.attemptId || evidence.quality !== assessment.quality || evidence.fields_json !== (assessment.fields ? JSON.stringify(assessment.fields) : null) || evidence.reasons_json !== JSON.stringify(assessment.reasons) || evidence.evidence_json !== JSON.stringify(assessment.evidence)) throw new Error('unbound or modified assessment')
    if (run.state === 'completed' || run.state === 'failed') {
      // Persisted run + observation binding is the commit receipt.
      const row = this.db.prepare('SELECT * FROM monitor_events WHERE run_id=?').get(runId) as EventRow | undefined
      return row ? eventFrom(row) : null
    }
    this.assertOwner(run, now)
    if (this.getBaselineId(run.monitorId) !== run.expectedBaselineId) throw new Error('baseline conflict')
    if (assessment.quality !== 'valid' || assessment.fields === null) {
      this.finishRun(runId, 'completed', assessment.quality, 'cannot_verify', now, null)
      this.assertOwner(run, nowOverride ?? Date.now())
      return null
    }
    const prior = this.getBaseline(run.monitorId)
    const revision = this.getRevision(run.monitorId,run.revision)
    const priorRevision = prior ? this.getRevision(run.monitorId,prior.revision) : null
    const schemaChanged = priorRevision && (priorRevision.config?.schemaVersion !== revision.config?.schemaVersion || JSON.stringify(priorRevision.config?.fields.map(({name,type,unit,currency})=>({name,type,unit,currency}))) !== JSON.stringify(revision.config?.fields.map(({name,type,unit,currency})=>({name,type,unit,currency}))))
    const ruleChanged = priorRevision && (priorRevision.ruleVersion !== revision.ruleVersion || JSON.stringify(priorRevision.config?.fields) !== JSON.stringify(revision.config?.fields))
    const changes = prior ? diffFields(prior.fields, assessment.fields) : []
    const kind = prior ? (changes.length || schemaChanged || ruleChanged ? 'changed' : 'unchanged') : 'initialized'
    if (kind === 'unchanged') {
      this.finishRun(runId, 'completed', 'valid', 'unchanged', now, null)
      this.assertOwner(run, nowOverride ?? Date.now())
      return null
    }
    const version = (prior?.version ?? 0) + 1
    const snapshotId = crypto.randomUUID()
      this.db.prepare(`INSERT INTO monitor_snapshots (id, monitor_id, revision, version, observation_id, assessment_id, fields_json, created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(snapshotId, run.monitorId, run.revision, version, observationId, assessmentId, JSON.stringify(assessment.fields), now)
      this.db.prepare('INSERT OR REPLACE INTO monitor_baselines (monitor_id, snapshot_id, version) VALUES (?,?,?)').run(run.monitorId, snapshotId, version)
      if (this.testOptions.failCommitAfter === 'snapshot') throw new Error('injected commit failure after snapshot')
      let event: MonitorEvent | null = null
      {
        event = { id: crypto.randomUUID(), runId, monitorId: run.monitorId, kind, reason: kind === 'initialized' ? 'initialized' : schemaChanged ? 'schema_migrated' : ruleChanged ? 'extraction_reprocessed' : 'source_changed', fromSnapshotId: prior?.id ?? null, toSnapshotId: snapshotId, changes, observedAt: now }
        this.db.prepare(`INSERT INTO monitor_events (id, run_id, monitor_id, kind, reason, from_snapshot_id, to_snapshot_id, changes_json, observed_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(event.id, runId, run.monitorId, event.kind, event.reason, event.fromSnapshotId, event.toSnapshotId, JSON.stringify(event.changes), now)
        this.db.prepare('INSERT INTO monitor_outbox (event_id, state) VALUES (?,?)').run(event.id, 'pending')
        enqueueEventDeliveries(this.db, this.eventEnvelope(event), now)
        if (this.testOptions.failCommitAfter === 'event') throw new Error('injected commit failure after event')
      }
      this.finishRun(runId, 'completed', 'valid', kind, now, null)
      this.assertOwner(run, nowOverride ?? Date.now())
      return event
    }).immediate()
  }

  private eventEnvelope(event: MonitorEvent): WebhookEventEnvelope {
    const row = this.db.prepare('SELECT * FROM monitor_snapshots WHERE id=?').get(event.toSnapshotId) as SnapshotRow
    const snapshot = snapshotFrom(row)
    const identity = monitorIdentity(this.getRevision(event.monitorId, snapshot.revision))
    return {schemaVersion: 'w2l.monitor-event/v1', eventId: event.id, eventVersion: snapshot.version, monitorId: event.monitorId, workspaceId: identity.workspaceId, entityKey: identity.entityKey, viewKey: identity.viewKey, event, snapshot}
  }

  registerDestination(input: DeliveryDestinationInput): DeliveryDestination {
    return this.db.transaction(() => {
      if (!this.hasMonitor(input.monitorId)) throw new Error('monitor not found')
      const destination = registerDeliveryDestination(this.db, input)
      this.enqueueHistoricalDeliveries(input.monitorId)
      return destination
    }).immediate()
  }

  enqueueHistoricalDeliveries(monitorId: string): number {
    return this.db.transaction(() => {
      const events = this.db.prepare('SELECT * FROM monitor_events WHERE monitor_id=? ORDER BY observed_at,id').all(monitorId) as EventRow[]
      return events.reduce((count, row) => count + enqueueEventDeliveries(this.db, this.eventEnvelope(eventFrom(row)), Date.now()), 0)
    }).immediate()
  }

  private finishRun(runId: string, state: MonitorRun['state'], quality: MonitorRun['quality'], change: MonitorRun['change'], now: number, error: string | null): void {
    this.db.prepare('UPDATE monitor_runs SET state=?, ended_at=?, quality=?, change_kind=?, error=? WHERE id=?').run(state, now, quality, change, error, runId)
    this.db.prepare('UPDATE monitor_attempts SET state=?, ended_at=? WHERE run_id=? AND state=?').run(state === 'completed' ? 'succeeded' : state === 'cancelled' ? 'cancelled' : 'failed', now, runId, 'running')
    const run = this.getRun(runId)
    if (run) {
      const monitor = this.db.prepare('SELECT * FROM monitors WHERE id=?').get(run.monitorId) as MonitorRow
      this.db.prepare('UPDATE monitors SET last_checked_at=?, last_verified_at=?, next_run_at=?, updated_at=? WHERE id=?').run(now, quality === 'valid' ? now : monitor.last_verified_at, now + monitor.interval_ms, now, run.monitorId)
    }
  }

  view(monitorId: string, now: number): MonitorView {
    const row = this.db.prepare('SELECT * FROM monitors WHERE id=?').get(monitorId) as MonitorRow
    if (!row) throw new Error('monitor not found')
    const revision = this.getRevision(monitorId,row.revision)
    const runs = (this.db.prepare('SELECT * FROM monitor_runs WHERE monitor_id=? ORDER BY created_at DESC').all(monitorId) as RunRow[]).map(runFrom)
    const events = (this.db.prepare('SELECT * FROM monitor_events WHERE monitor_id=? ORDER BY observed_at DESC').all(monitorId) as EventRow[]).map(eventFrom)
    const outbox = this.db.prepare('SELECT event_id,state,acknowledged_at FROM monitor_outbox WHERE event_id IN (SELECT id FROM monitor_events WHERE monitor_id=?)').all(monitorId) as { event_id: string; state: 'pending' | 'acknowledged'; acknowledged_at: number | null }[]
    return { revision, enabled: row.enabled === 1, controlEpoch: row.control_epoch, nextRunAt: row.next_run_at, lastCheckedAt: row.last_checked_at, lastVerifiedAt: row.last_verified_at, freshness: row.last_verified_at !== null && now - row.last_verified_at <= row.stale_after_ms ? 'fresh' : 'stale', baseline: this.getBaseline(monitorId), runs, events, outbox: outbox.map((v) => ({ eventId: v.event_id, state: v.state, acknowledgedAt: v.acknowledged_at })) }
  }

  close(): void { this.db.close() }
  getRevision(monitorId: string, revision?: number): MonitorRevision {
    const row = this.db.prepare('SELECT * FROM monitor_revisions WHERE monitor_id=? '+(revision === undefined ? 'ORDER BY revision DESC LIMIT 1' : 'AND revision=?')).get(...(revision === undefined ? [monitorId] : [monitorId,revision])) as {revision:number;url:string;rule_version:string;interval_ms:number;stale_after_ms:number;created_at:number;config_json:string|null} | undefined
    if (!row) throw new Error('monitor revision not found')
    return {monitorId,revision:row.revision,url:row.url,ruleVersion:row.rule_version,intervalMs:row.interval_ms,staleAfterMs:row.stale_after_ms,createdAt:row.created_at,...(row.config_json ? {config:JSON.parse(row.config_json)} : {})}
  }
  listMonitorIds(): string[] {return (this.db.prepare('SELECT id FROM monitors ORDER BY id').all() as {id:string}[]).map((r)=>r.id)}
  representation(key: string): TransportRepresentation | null {
    const row=this.db.prepare('SELECT body FROM monitor_transport WHERE key=?').get(key) as {body:string}|undefined
    if (!row) return null
    try {
      const value = JSON.parse(row.body) as TransportRepresentation
      return value && value.key === key && value.outcome?.result?.evidence && typeof value.outcome.result.markdown === 'string' ? value : null
    } catch { return null }
  }
  saveRepresentation(value: TransportRepresentation): void {this.db.prepare('INSERT OR REPLACE INTO monitor_transport VALUES(?,?)').run(value.key,JSON.stringify(value))}
  deleteRepresentation(key: string): void {this.db.prepare('DELETE FROM monitor_transport WHERE key=?').run(key)}
  hasMonitor(id: string): boolean { return !!this.db.prepare('SELECT id FROM monitors WHERE id=?').get(id) }
  claim(monitorId: string, nowOverride?: number, triggerKey?: string, deadlineAt?: number): MonitorRun | null {
    return this.db.transaction(() => {
      const now = nowOverride ?? Date.now()
      const previous = this.db.prepare("SELECT id,attempt_id FROM monitor_runs WHERE monitor_id=? AND state='running'").get(monitorId) as { id: string; attempt_id: string } | undefined
      const run = triggerKey === undefined ? this.dueRun(monitorId, now) : this.startRun(monitorId, triggerKey, now)
      if (!run || run.state !== 'running' || (previous?.id === run.id && previous.attempt_id === run.attemptId)) return null
      if (deadlineAt !== undefined) {
        if (!Number.isSafeInteger(deadlineAt) || deadlineAt < 0) throw new Error('invalid execution deadline')
        run.deadlineAt = Math.min(run.deadlineAt!, deadlineAt)
        run.leaseUntil = Math.min(run.leaseUntil!, run.deadlineAt)
        this.db.prepare('UPDATE monitor_runs SET deadline_at=?,lease_until=? WHERE id=?').run(run.deadlineAt, run.leaseUntil, run.id)
      }
      return run
    }).immediate()
  }
  attempts(runId: string): MonitorAttempt[] {
    return (this.db.prepare('SELECT * FROM monitor_attempts WHERE run_id=? ORDER BY started_at,id').all(runId) as AttemptRow[]).map((r) => ({ id: r.id, runId: r.run_id, fencingToken: r.fencing_token, state: r.state as MonitorAttempt['state'], startedAt: r.started_at, endedAt: r.ended_at, recoveredFromAttemptId: r.recovered_from_attempt_id }))
  }
  acknowledge(eventId: string, now: number): void {
    this.db.prepare("UPDATE monitor_outbox SET state='acknowledged',acknowledged_at=? WHERE event_id=? AND state='pending'").run(now, eventId)
  }
  exportEvidence(monitorId: string) {
    const view = this.view(monitorId, Date.now())
    const attempts = view.runs.flatMap((run) => this.attempts(run.id))
    const observations = this.db.prepare('SELECT id,run_id,attempt_id,observed_at,client_wall_ms,markdown_sha256,transport_json,error FROM monitor_observations WHERE run_id IN (SELECT id FROM monitor_runs WHERE monitor_id=?) ORDER BY observed_at,id').all(monitorId)
    const assessments = this.db.prepare('SELECT id,run_id,observation_id,quality,reasons_json,fields_json,evidence_json FROM monitor_assessments WHERE run_id IN (SELECT id FROM monitor_runs WHERE monitor_id=?) ORDER BY id').all(monitorId)
    return { generatedAt: Date.now(), monitorId, revision: view.revision, baseline: view.baseline, runs: view.runs, attempts, observations, assessments, events: view.events, outbox: view.outbox }
  }
  private assertOwner(run: MonitorRun, now: number): void {
    const monitor = this.db.prepare('SELECT * FROM monitors WHERE id=?').get(run.monitorId) as MonitorRow | undefined
    if (run.state !== 'running' || !monitor?.enabled || run.epoch !== monitor.control_epoch || run.revision !== monitor.revision || (run.leaseUntil ?? 0) <= now || (run.deadlineAt ?? 0) <= now) throw new Error('expired or stale execution')
  }
  private getBaselineId(monitorId: string): string | null { return (this.db.prepare('SELECT snapshot_id FROM monitor_baselines WHERE monitor_id=?').get(monitorId) as { snapshot_id: string } | undefined)?.snapshot_id ?? null }
}

interface SnapshotRow { id: string; monitor_id: string; revision: number; version: number; observation_id: string; assessment_id: string; fields_json: string; created_at: number }
interface EventRow { id: string; run_id: string; monitor_id: string; kind: 'initialized' | 'changed'; reason: MonitorEvent['reason']; from_snapshot_id: string | null; to_snapshot_id: string; changes_json: string; observed_at: number }
function runFrom(row: RunRow): MonitorRun { let key=row.trigger_key; try {const parts=JSON.parse(key);if(Array.isArray(parts)&&parts[0]===row.monitor_id) key=parts[1]}catch{}; return { id: row.id, monitorId: row.monitor_id, revision: row.revision, triggerKey: key, state: row.state as MonitorRun['state'], epoch: row.epoch, fencingToken: row.fencing_token, attemptId: row.attempt_id, leaseUntil: row.lease_until, deadlineAt: row.deadline_at, nextAttemptAt: row.next_attempt_at, expectedBaselineId: row.expected_baseline_id, createdAt: row.created_at, endedAt: row.ended_at, quality: row.quality as MonitorRun['quality'], change: row.change_kind as MonitorRun['change'], error: row.error } }
function snapshotFrom(row: SnapshotRow): MonitorSnapshot { return { id: row.id, monitorId: row.monitor_id, revision: row.revision, version: row.version, observationId: row.observation_id, assessmentId: row.assessment_id, fields: JSON.parse(row.fields_json) as DocumentFields, createdAt: row.created_at } }
function eventFrom(row: EventRow): MonitorEvent { return { id: row.id, runId: row.run_id, monitorId: row.monitor_id, kind: row.kind, reason: row.reason, fromSnapshotId: row.from_snapshot_id, toSnapshotId: row.to_snapshot_id, changes: JSON.parse(row.changes_json) as DocumentDiff[], observedAt: row.observed_at } }
function diffFields(before: DocumentFields, after: DocumentFields): DocumentDiff[] { return (Object.keys({...before,...after}) as (keyof DocumentFields)[]).filter((field) => JSON.stringify(fieldComparable(before[field])) !== JSON.stringify(fieldComparable(after[field]))).map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null })) }
