import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type {
  DocumentAssessment, DocumentDiff, DocumentFields, MonitorAttempt, MonitorEvent,
  MonitorObservation, MonitorRevision, MonitorRun, MonitorSnapshot, MonitorView,
} from '@w2l/contracts'
import { DOCUMENT_RULE_VERSION, FIRECRAWL_INTRO_URL, FIRECRAWL_MONITOR_ID } from '@w2l/contracts'

interface MonitorRow { id: string; enabled: number; control_epoch: number; revision: number; url: string; rule_version: string; interval_ms: number; stale_after_ms: number; created_at: number; updated_at: number; next_run_at: number; last_checked_at: number | null; last_verified_at: number | null }
interface RunRow { id: string; monitor_id: string; revision: number; trigger_key: string; state: string; epoch: number; fencing_token: number; attempt_id: string | null; lease_until: number | null; deadline_at: number | null; expected_baseline_id: string | null; created_at: number; ended_at: number | null; quality: string | null; change_kind: string | null; error: string | null }
interface AttemptRow { id: string; run_id: string; fencing_token: number; state: string; started_at: number; ended_at: number | null; recovered_from_attempt_id: string | null }
export interface MonitorStoreTestOptions { failCommitAfter?: 'snapshot' | 'event' }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS monitors (
 id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, control_epoch INTEGER NOT NULL, revision INTEGER NOT NULL,
 url TEXT NOT NULL, rule_version TEXT NOT NULL, interval_ms INTEGER NOT NULL, stale_after_ms INTEGER NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, next_run_at INTEGER NOT NULL,
 last_checked_at INTEGER, last_verified_at INTEGER
);
CREATE TABLE IF NOT EXISTS monitor_revisions (
 monitor_id TEXT NOT NULL, revision INTEGER NOT NULL, url TEXT NOT NULL, rule_version TEXT NOT NULL,
 interval_ms INTEGER NOT NULL, stale_after_ms INTEGER NOT NULL, created_at INTEGER NOT NULL,
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
 client_wall_ms INTEGER NOT NULL, markdown_sha256 TEXT, outcome_json TEXT, error TEXT
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
CREATE TABLE IF NOT EXISTS monitor_outbox (
 event_id TEXT PRIMARY KEY, state TEXT NOT NULL, acknowledged_at INTEGER
);
`

export class MonitorStore {
  private readonly db: Database.Database

  static open(path: string, options: MonitorStoreTestOptions = {}): MonitorStore {
    mkdirSync(dirname(path), { recursive: true })
    const store = new MonitorStore(path, options)
    chmodSync(path, 0o600)
    return store
  }

  private readonly testOptions: MonitorStoreTestOptions

  private constructor(path: string, options: MonitorStoreTestOptions) {
    this.testOptions = options
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = FULL')
    this.db.pragma('busy_timeout = 5000')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA)
  }

  createOrGetRevision(revision: MonitorRevision): MonitorRevision {
    if (revision.monitorId !== FIRECRAWL_MONITOR_ID || revision.url !== FIRECRAWL_INTRO_URL || revision.ruleVersion !== DOCUMENT_RULE_VERSION) throw new Error('unsupported monitor adapter')
    if (![revision.revision, revision.intervalMs, revision.staleAfterMs].every((n) => Number.isSafeInteger(n) && n > 0)) throw new Error('invalid revision or interval')
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM monitor_revisions WHERE monitor_id = ? AND revision = ?').get(revision.monitorId, revision.revision) as Record<string, unknown> | undefined
      if (existing) {
        if (existing.url !== revision.url || existing.rule_version !== revision.ruleVersion || existing.interval_ms !== revision.intervalMs || existing.stale_after_ms !== revision.staleAfterMs) throw new Error('revision is immutable')
        return { ...revision, createdAt: Number(existing.created_at) }
      }
      const current = this.db.prepare('SELECT * FROM monitors WHERE id=?').get(revision.monitorId) as MonitorRow | undefined
      if (revision.revision !== (current?.revision ?? 0) + 1) throw new Error('revision must be sequential')
      if (this.db.prepare("SELECT id FROM monitor_runs WHERE monitor_id=? AND state='running'").get(revision.monitorId)) throw new Error('cannot revise active monitor')
      const now = revision.createdAt
      if (!current) {
        this.db.prepare(`INSERT INTO monitors (id, enabled, control_epoch, revision, url, rule_version, interval_ms, stale_after_ms, created_at, updated_at, next_run_at) VALUES (?,1,1,?,?,?,?,?,?,?,?)`)
          .run(revision.monitorId, revision.revision, revision.url, revision.ruleVersion, revision.intervalMs, revision.staleAfterMs, now, now, now)
      } else {
        this.db.prepare('UPDATE monitors SET revision=?, control_epoch=control_epoch+1, interval_ms=?, stale_after_ms=?, updated_at=?, next_run_at=? WHERE id=?')
          .run(revision.revision, revision.intervalMs, revision.staleAfterMs, now, now, revision.monitorId)
      }
      this.db.prepare(`INSERT INTO monitor_revisions (monitor_id, revision, url, rule_version, interval_ms, stale_after_ms, created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(revision.monitorId, revision.revision, revision.url, revision.ruleVersion, revision.intervalMs, revision.staleAfterMs, now)
      return revision
    }).immediate()
  }

  startRun(monitorId: string, triggerKey: string, now: number): MonitorRun {
    if (!triggerKey.trim() || triggerKey.length > 200) throw new Error('invalid trigger key')
    return this.db.transaction(() => {
    const existing = this.db.prepare('SELECT * FROM monitor_runs WHERE trigger_key = ?').get(triggerKey) as RunRow | undefined
    if (existing && existing.monitor_id !== monitorId) throw new Error('trigger belongs to another monitor')
    if (existing && (existing.state !== 'running' || (existing.lease_until ?? 0) > now)) return runFrom(existing)
    const monitor = this.db.prepare('SELECT * FROM monitors WHERE id = ?').get(monitorId) as MonitorRow | undefined
    if (!monitor) throw new Error(`monitor not found: ${monitorId}`)
    if (!monitor.enabled) throw new Error('monitor paused')
    const active = this.db.prepare("SELECT * FROM monitor_runs WHERE monitor_id = ? AND state IN ('queued','running','committing')").get(monitorId) as RunRow | undefined
    if (active) {
      if ((active.lease_until ?? Infinity) > now) throw new Error(`monitor already has active run: ${active.id}`)
      // Resume the same logical run. The caller must not lose it by inventing a new trigger.
      const attemptId = crypto.randomUUID()
      this.db.prepare("UPDATE monitor_attempts SET state='interrupted',ended_at=? WHERE id=? AND state='running'").run(now, active.attempt_id)
      this.db.prepare("INSERT INTO monitor_attempts (id,run_id,fencing_token,state,started_at,recovered_from_attempt_id) VALUES (?,?,?,'running',?,?)")
        .run(attemptId, active.id, active.fencing_token + 1, now, active.attempt_id)
      this.db.prepare('UPDATE monitor_runs SET attempt_id=?,fencing_token=fencing_token+1,lease_until=?,deadline_at=? WHERE id=?')
        .run(attemptId, now + 300_000, now + 300_000, active.id)
      return this.getRun(active.id)!
    }
    const id = crypto.randomUUID()
    const attemptId = crypto.randomUUID()
    const token = monitor.control_epoch
    this.db.prepare(`INSERT INTO monitor_runs (id, monitor_id, revision, trigger_key, state, epoch, fencing_token, attempt_id, lease_until, deadline_at, expected_baseline_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, monitorId, monitor.revision, triggerKey, 'running', monitor.control_epoch, token, attemptId, now + 300_000, now + 300_000, this.getBaselineId(monitorId), now)
    this.db.prepare(`INSERT INTO monitor_attempts (id, run_id, fencing_token, state, started_at) VALUES (?,?,?,?,?)`)
      .run(attemptId, id, token, 'running', now)
    this.db.prepare('UPDATE monitors SET next_run_at=? WHERE id=?').run(now + monitor.interval_ms, monitorId)
    return this.getRun(id)!
    }).immediate()
  }

  /** Timer/cron only wakes this transaction; persisted next_run_at owns scheduling. */
  dueRun(monitorId: string, now: number): MonitorRun | null {
    const monitor = this.db.prepare('SELECT * FROM monitors WHERE id=?').get(monitorId) as MonitorRow | undefined
    if (!monitor?.enabled) return null
    const active = this.db.prepare("SELECT * FROM monitor_runs WHERE monitor_id=? AND state='running'").get(monitorId) as RunRow | undefined
    if (active && (active.lease_until ?? Infinity) > now) return null
    if (!active && monitor.next_run_at > now) return null
    return this.startRun(monitorId, active?.trigger_key ?? `scheduled:${monitorId}:${monitor.revision}:${monitor.next_run_at}`, now)
  }

  getRun(id: string): MonitorRun | null {
    const row = this.db.prepare('SELECT * FROM monitor_runs WHERE id = ?').get(id) as RunRow | undefined
    return row ? runFrom(row) : null
  }

  getBaseline(monitorId: string): MonitorSnapshot | null {
    const row = this.db.prepare('SELECT s.* FROM monitor_baselines b JOIN monitor_snapshots s ON s.id = b.snapshot_id WHERE b.monitor_id = ?').get(monitorId) as SnapshotRow | undefined
    return row ? snapshotFrom(row) : null
  }

  recordObservation(observation: MonitorObservation, assessmentId: string, assessment: DocumentAssessment): void {
    this.db.transaction(() => {
    const run = this.getRun(observation.runId)
    if (!run || run.attemptId !== observation.attemptId) throw new Error('stale observation attempt')
    this.assertOwner(run, observation.observedAt)
    this.db.prepare(`INSERT INTO monitor_observations (id, run_id, attempt_id, observed_at, client_wall_ms, markdown_sha256, outcome_json, error) VALUES (?,?,?,?,?,?,?,?)`)
      .run(observation.id, observation.runId, observation.attemptId, observation.observedAt, observation.clientWallMs, observation.markdownSha256, JSON.stringify(observation.outcome), observation.error)
    this.db.prepare(`INSERT INTO monitor_assessments (id, run_id, observation_id, quality, reasons_json, fields_json, evidence_json) VALUES (?,?,?,?,?,?,?)`)
      .run(assessmentId, observation.runId, observation.id, assessment.quality, JSON.stringify(assessment.reasons), assessment.fields ? JSON.stringify(assessment.fields) : null, JSON.stringify(assessment.evidence))
    }).immediate()
  }

  commit(runId: string, observationId: string, assessmentId: string, assessment: DocumentAssessment, now: number): MonitorEvent | null {
    return this.db.transaction(() => {
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
      return null
    }
    const prior = this.getBaseline(run.monitorId)
    const changes = prior ? diffFields(prior.fields, assessment.fields) : []
    const kind = prior ? (changes.length ? 'changed' : 'unchanged') : 'initialized'
    if (kind === 'unchanged') {
      this.finishRun(runId, 'completed', 'valid', 'unchanged', now, null)
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
        event = { id: crypto.randomUUID(), runId, monitorId: run.monitorId, kind, reason: kind === 'initialized' ? 'initialized' : 'source_changed', fromSnapshotId: prior?.id ?? null, toSnapshotId: snapshotId, changes, observedAt: now }
        this.db.prepare(`INSERT INTO monitor_events (id, run_id, monitor_id, kind, reason, from_snapshot_id, to_snapshot_id, changes_json, observed_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(event.id, runId, run.monitorId, event.kind, event.reason, event.fromSnapshotId, event.toSnapshotId, JSON.stringify(event.changes), now)
        this.db.prepare('INSERT INTO monitor_outbox (event_id, state) VALUES (?,?)').run(event.id, 'pending')
        if (this.testOptions.failCommitAfter === 'event') throw new Error('injected commit failure after event')
      }
      this.finishRun(runId, 'completed', 'valid', kind, now, null)
      return event
    }).immediate()
  }

  private finishRun(runId: string, state: MonitorRun['state'], quality: MonitorRun['quality'], change: MonitorRun['change'], now: number, error: string | null): void {
    this.db.prepare('UPDATE monitor_runs SET state=?, ended_at=?, quality=?, change_kind=?, error=? WHERE id=?').run(state, now, quality, change, error, runId)
    this.db.prepare('UPDATE monitor_attempts SET state=?, ended_at=? WHERE run_id=? AND state=?').run(state === 'completed' ? 'succeeded' : 'failed', now, runId, 'running')
    const run = this.getRun(runId)
    if (run) {
      const monitor = this.db.prepare('SELECT * FROM monitors WHERE id=?').get(run.monitorId) as MonitorRow
      this.db.prepare('UPDATE monitors SET last_checked_at=?, last_verified_at=?, next_run_at=?, updated_at=? WHERE id=?').run(now, quality === 'valid' ? now : monitor.last_verified_at, now + monitor.interval_ms, now, run.monitorId)
    }
  }

  view(monitorId: string, now: number): MonitorView {
    const row = this.db.prepare('SELECT * FROM monitors WHERE id=?').get(monitorId) as MonitorRow
    if (!row) throw new Error('monitor not found')
    const revision: MonitorRevision = { monitorId, revision: row.revision, url: row.url as MonitorRevision['url'], ruleVersion: row.rule_version as MonitorRevision['ruleVersion'], intervalMs: row.interval_ms, staleAfterMs: row.stale_after_ms, createdAt: row.created_at }
    const runs = (this.db.prepare('SELECT * FROM monitor_runs WHERE monitor_id=? ORDER BY created_at DESC').all(monitorId) as RunRow[]).map(runFrom)
    const events = (this.db.prepare('SELECT * FROM monitor_events WHERE monitor_id=? ORDER BY observed_at DESC').all(monitorId) as EventRow[]).map(eventFrom)
    const outbox = this.db.prepare('SELECT event_id,state,acknowledged_at FROM monitor_outbox WHERE event_id IN (SELECT id FROM monitor_events WHERE monitor_id=?)').all(monitorId) as { event_id: string; state: 'pending' | 'acknowledged'; acknowledged_at: number | null }[]
    return { revision, enabled: row.enabled === 1, controlEpoch: row.control_epoch, nextRunAt: row.next_run_at, lastCheckedAt: row.last_checked_at, lastVerifiedAt: row.last_verified_at, freshness: row.last_verified_at !== null && now - row.last_verified_at <= row.stale_after_ms ? 'fresh' : 'stale', baseline: this.getBaseline(monitorId), runs, events, outbox: outbox.map((v) => ({ eventId: v.event_id, state: v.state, acknowledgedAt: v.acknowledged_at })) }
  }

  close(): void { this.db.close() }
  hasMonitor(id: string): boolean { return !!this.db.prepare('SELECT id FROM monitors WHERE id=?').get(id) }
  claim(monitorId: string, now: number, triggerKey?: string): MonitorRun | null {
    return this.db.transaction(() => {
      const previous = this.db.prepare("SELECT id,attempt_id FROM monitor_runs WHERE monitor_id=? AND state='running'").get(monitorId) as { id: string; attempt_id: string } | undefined
      const run = triggerKey === undefined ? this.dueRun(monitorId, now) : this.startRun(monitorId, triggerKey, now)
      if (!run || run.state !== 'running' || (previous?.id === run.id && previous.attempt_id === run.attemptId)) return null
      return run
    }).immediate()
  }
  attempts(runId: string): MonitorAttempt[] {
    return (this.db.prepare('SELECT * FROM monitor_attempts WHERE run_id=? ORDER BY started_at,id').all(runId) as AttemptRow[]).map((r) => ({ id: r.id, runId: r.run_id, fencingToken: r.fencing_token, state: r.state as MonitorAttempt['state'], startedAt: r.started_at, endedAt: r.ended_at, recoveredFromAttemptId: r.recovered_from_attempt_id }))
  }
  acknowledge(eventId: string, now: number): void {
    this.db.prepare("UPDATE monitor_outbox SET state='acknowledged',acknowledged_at=? WHERE event_id=? AND state='pending'").run(now, eventId)
  }
  exportEvidence(monitorId: string): Record<string, unknown> {
    const view = this.view(monitorId, Date.now())
    const attempts = view.runs.flatMap((run) => this.attempts(run.id))
    const observations = this.db.prepare('SELECT id,run_id,attempt_id,observed_at,client_wall_ms,markdown_sha256,error FROM monitor_observations WHERE run_id IN (SELECT id FROM monitor_runs WHERE monitor_id=?) ORDER BY observed_at,id').all(monitorId)
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
interface EventRow { id: string; run_id: string; monitor_id: string; kind: 'initialized' | 'changed'; reason: 'source_changed' | 'initialized'; from_snapshot_id: string | null; to_snapshot_id: string; changes_json: string; observed_at: number }
function runFrom(row: RunRow): MonitorRun { return { id: row.id, monitorId: row.monitor_id, revision: row.revision, triggerKey: row.trigger_key, state: row.state as MonitorRun['state'], epoch: row.epoch, fencingToken: row.fencing_token, attemptId: row.attempt_id, leaseUntil: row.lease_until, deadlineAt: row.deadline_at, expectedBaselineId: row.expected_baseline_id, createdAt: row.created_at, endedAt: row.ended_at, quality: row.quality as MonitorRun['quality'], change: row.change_kind as MonitorRun['change'], error: row.error } }
function snapshotFrom(row: SnapshotRow): MonitorSnapshot { return { id: row.id, monitorId: row.monitor_id, revision: row.revision, version: row.version, observationId: row.observation_id, assessmentId: row.assessment_id, fields: JSON.parse(row.fields_json) as DocumentFields, createdAt: row.created_at } }
function eventFrom(row: EventRow): MonitorEvent { return { id: row.id, runId: row.run_id, monitorId: row.monitor_id, kind: row.kind, reason: row.reason, fromSnapshotId: row.from_snapshot_id, toSnapshotId: row.to_snapshot_id, changes: JSON.parse(row.changes_json) as DocumentDiff[], observedAt: row.observed_at } }
function diffFields(before: DocumentFields, after: DocumentFields): DocumentDiff[] { return (Object.keys(before) as (keyof DocumentFields)[]).filter((field) => before[field] !== after[field]).map((field) => ({ field, before: before[field], after: after[field] })) }
