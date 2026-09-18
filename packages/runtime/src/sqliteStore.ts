import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import type { Attempt, AttemptStatus, CrawlBudget, CrawlMode, FetchResult, Lane, StepRecord, StepStatus, Task, TaskStatus } from '@w2l/contracts'
import { assertId, type TaskStore } from './taskStore.js'

export const CHECKPOINT_FILENAME = 'checkpoint.sqlite'

interface TaskRow {
  id: string
  seed_url: string
  task_dir: string
  mode: string
  status: string
  budget_json: string
  created_at: string
  updated_at: string
}

interface AttemptRow {
  id: string
  task_id: string
  status: string
  started_at: string
  ended_at: string | null
  pages_fetched: number
  wall_ms: number
  cost_usd: number
  content_tokens: number
  budget_exceeded: string | null
}

interface StepRow {
  id: string
  task_id: string
  attempt_id: string
  url: string
  canonical_url: string
  depth: number
  status: string
  lane: string | null
  content_hash: string | null
  cached: number
  result_json: string | null
  created_at: string
  updated_at: string
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  seed_url TEXT NOT NULL,
  task_dir TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  budget_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  pages_fetched INTEGER NOT NULL,
  wall_ms INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  content_tokens INTEGER NOT NULL,
  budget_exceeded TEXT
);

CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  depth INTEGER NOT NULL,
  status TEXT NOT NULL,
  lane TEXT,
  content_hash TEXT,
  cached INTEGER NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS steps_task_canonical ON steps(task_id, canonical_url, updated_at);
CREATE INDEX IF NOT EXISTS steps_attempt ON steps(attempt_id);
CREATE INDEX IF NOT EXISTS attempts_task ON attempts(task_id);
`

/**
 * SQLite TaskStore. The database file lives next to the task directory
 * (`<taskDir>/checkpoint.sqlite`). Callers never see SQL.
 */
export class SqliteTaskStore implements TaskStore {
  private readonly db: Database.Database

  static open(taskDir: string): SqliteTaskStore {
    mkdirSync(taskDir, { recursive: true })
    return new SqliteTaskStore(join(taskDir, CHECKPOINT_FILENAME), false)
  }

  static openReadOnly(taskDir: string): SqliteTaskStore {
    return new SqliteTaskStore(join(taskDir, CHECKPOINT_FILENAME), true)
  }

  constructor(dbPath: string, readonly = false) {
    if (!readonly) mkdirSync(dirname(dbPath), { recursive: true })
    this.db = readonly
      ? new Database(dbPath, { readonly: true, fileMustExist: true })
      : new Database(dbPath)
    this.db.pragma('foreign_keys = ON')
    if (!readonly) {
      this.db.pragma('journal_mode = WAL')
      this.db.exec(SCHEMA)
      chmodSync(dbPath, 0o600)
    }
  }

  async putTask(task: Task): Promise<void> {
    assertId('task.id', task.id)
    this.db
      .prepare(
        `INSERT INTO tasks (id, seed_url, task_dir, mode, status, budget_json, created_at, updated_at)
         VALUES (@id, @seed_url, @task_dir, @mode, @status, @budget_json, @created_at, @updated_at)
         ON CONFLICT(id) DO UPDATE SET
           seed_url = excluded.seed_url,
           task_dir = excluded.task_dir,
           mode = excluded.mode,
           status = excluded.status,
           budget_json = excluded.budget_json,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
      )
      .run({
        id: task.id,
        seed_url: task.seedUrl,
        task_dir: task.taskDir,
        mode: task.mode,
        status: task.status,
        budget_json: JSON.stringify(task.budget),
        created_at: task.createdAt,
        updated_at: task.updatedAt,
      })
  }

  async getTask(taskId: string): Promise<Task | null> {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId) as TaskRow | undefined
    return row === undefined ? null : taskFromRow(row)
  }

  async listTasks(): Promise<readonly Task[]> {
    const rows = this.db
      .prepare(`SELECT * FROM tasks ORDER BY created_at ASC, id ASC`)
      .all() as TaskRow[]
    return rows.map(taskFromRow)
  }

  async putAttempt(attempt: Attempt): Promise<void> {
    assertId('attempt.id', attempt.id)
    assertId('attempt.taskId', attempt.taskId)
    if (this.db.prepare(`SELECT 1 FROM tasks WHERE id = ?`).get(attempt.taskId) === undefined) {
      throw new Error(`putAttempt: unknown task ${attempt.taskId}`)
    }
    this.db
      .prepare(
        `INSERT INTO attempts (
           id, task_id, status, started_at, ended_at, pages_fetched, wall_ms, cost_usd, content_tokens, budget_exceeded
         ) VALUES (
           @id, @task_id, @status, @started_at, @ended_at, @pages_fetched, @wall_ms, @cost_usd, @content_tokens, @budget_exceeded
         )
         ON CONFLICT(id) DO UPDATE SET
           task_id = excluded.task_id,
           status = excluded.status,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           pages_fetched = excluded.pages_fetched,
           wall_ms = excluded.wall_ms,
           cost_usd = excluded.cost_usd,
           content_tokens = excluded.content_tokens,
           budget_exceeded = excluded.budget_exceeded`,
      )
      .run({
        id: attempt.id,
        task_id: attempt.taskId,
        status: attempt.status,
        started_at: attempt.startedAt,
        ended_at: attempt.endedAt,
        pages_fetched: attempt.pagesFetched,
        wall_ms: attempt.wallMs,
        cost_usd: attempt.costUsd,
        content_tokens: attempt.contentTokens,
        budget_exceeded: attempt.budgetExceeded,
      })
  }

  async getAttempt(attemptId: string): Promise<Attempt | null> {
    const row = this.db.prepare(`SELECT * FROM attempts WHERE id = ?`).get(attemptId) as AttemptRow | undefined
    return row === undefined ? null : attemptFromRow(row)
  }

  async listAttempts(taskId: string): Promise<readonly Attempt[]> {
    const rows = this.db
      .prepare(`SELECT * FROM attempts WHERE task_id = ? ORDER BY started_at ASC, id ASC`)
      .all(taskId) as AttemptRow[]
    return rows.map(attemptFromRow)
  }

  async putStep(step: StepRecord): Promise<void> {
    assertId('step.id', step.id)
    assertId('step.taskId', step.taskId)
    assertId('step.attemptId', step.attemptId)
    const attempt = this.db
      .prepare(`SELECT task_id FROM attempts WHERE id = ?`)
      .get(step.attemptId) as { task_id: string } | undefined
    if (attempt === undefined) {
      throw new Error(`putStep: unknown attempt ${step.attemptId}`)
    }
    if (attempt.task_id !== step.taskId) {
      throw new Error(`putStep: attempt ${step.attemptId} belongs to task ${attempt.task_id}, not ${step.taskId}`)
    }
    this.db
      .prepare(
        `INSERT INTO steps (
           id, task_id, attempt_id, url, canonical_url, depth, status, lane, content_hash, cached, result_json, created_at, updated_at
         ) VALUES (
           @id, @task_id, @attempt_id, @url, @canonical_url, @depth, @status, @lane, @content_hash, @cached, @result_json, @created_at, @updated_at
         )
         ON CONFLICT(id) DO UPDATE SET
           task_id = excluded.task_id,
           attempt_id = excluded.attempt_id,
           url = excluded.url,
           canonical_url = excluded.canonical_url,
           depth = excluded.depth,
           status = excluded.status,
           lane = excluded.lane,
           content_hash = excluded.content_hash,
           cached = excluded.cached,
           result_json = excluded.result_json,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
      )
      .run({
        id: step.id,
        task_id: step.taskId,
        attempt_id: step.attemptId,
        url: step.url,
        canonical_url: step.canonicalUrl,
        depth: step.depth,
        status: step.status,
        lane: step.lane,
        content_hash: step.contentHash,
        cached: step.cached ? 1 : 0,
        result_json: step.result === null ? null : JSON.stringify(step.result),
        created_at: step.createdAt,
        updated_at: step.updatedAt,
      })
  }

  async getStep(stepId: string): Promise<StepRecord | null> {
    const row = this.db.prepare(`SELECT * FROM steps WHERE id = ?`).get(stepId) as StepRow | undefined
    return row === undefined ? null : stepFromRow(row)
  }

  async listSteps(taskId: string, attemptId?: string): Promise<readonly StepRecord[]> {
    const rows =
      attemptId === undefined
        ? (this.db
            .prepare(`SELECT * FROM steps WHERE task_id = ? ORDER BY created_at ASC, id ASC`)
            .all(taskId) as StepRow[])
        : (this.db
            .prepare(`SELECT * FROM steps WHERE task_id = ? AND attempt_id = ? ORDER BY created_at ASC, id ASC`)
            .all(taskId, attemptId) as StepRow[])
    return rows.map(stepFromRow)
  }

  async getStepByCanonicalUrl(taskId: string, canonicalUrl: string): Promise<StepRecord | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM steps
         WHERE task_id = ? AND canonical_url = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
      )
      .get(taskId, canonicalUrl) as StepRow | undefined
    return row === undefined ? null : stepFromRow(row)
  }

  async close(): Promise<void> {
    this.db.close()
  }
}

function taskFromRow(row: TaskRow): Task {
  return {
    id: row.id,
    seedUrl: row.seed_url,
    taskDir: row.task_dir,
    mode: row.mode as CrawlMode,
    status: row.status as TaskStatus,
    budget: JSON.parse(row.budget_json) as CrawlBudget,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function attemptFromRow(row: AttemptRow): Attempt {
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status as AttemptStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    pagesFetched: row.pages_fetched,
    wallMs: row.wall_ms,
    costUsd: row.cost_usd,
    contentTokens: row.content_tokens,
    budgetExceeded: row.budget_exceeded as Attempt['budgetExceeded'],
  }
}

function stepFromRow(row: StepRow): StepRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    attemptId: row.attempt_id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    depth: row.depth,
    status: row.status as StepStatus,
    lane: row.lane as Lane | null,
    contentHash: row.content_hash,
    cached: row.cached === 1,
    result: row.result_json === null ? null : (JSON.parse(row.result_json) as FetchResult),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
