import Database from 'better-sqlite3'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { validateRecipe, type BackendRecipe, type RecipeRun, type RecipeState } from '@w2l/contracts'

export class RecipeStore {
  private readonly db: Database.Database
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new Database(path)
    this.db.pragma('journal_mode=WAL'); this.db.pragma('synchronous=FULL'); this.db.pragma('busy_timeout=5000')
    this.db.exec(`CREATE TABLE IF NOT EXISTS recipes(id TEXT, revision INTEGER, hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS recipe_runs(id TEXT PRIMARY KEY, workspace TEXT, trigger_key TEXT, body TEXT NOT NULL, UNIQUE(workspace,trigger_key));
      CREATE TABLE IF NOT EXISTS recipe_steps(run_id TEXT, attempt INTEGER, step_id TEXT, op TEXT, state TEXT, at INTEGER, PRIMARY KEY(run_id,attempt,step_id));`)
    chmodSync(path, 0o600)
  }
  register(input: BackendRecipe): void {
    const recipe = validateRecipe(input)
    const body = JSON.stringify(recipe)
    const hash = createHash('sha256').update(body).digest('hex')
    const prior = this.db.prepare('SELECT hash FROM recipes WHERE id=? AND revision=?').get(recipe.id, recipe.revision) as { hash: string } | undefined
    if (prior && prior.hash !== hash) throw new Error('recipe revision immutable')
    this.db.prepare('INSERT OR IGNORE INTO recipes VALUES(?,?,?,?)').run(recipe.id, recipe.revision, hash, body)
  }
  recipe(id: string, revision: number): BackendRecipe {
    const row = this.db.prepare('SELECT body FROM recipes WHERE id=? AND revision=?').get(id, revision) as { body: string } | undefined
    if (!row) throw new Error('recipe not registered')
    return JSON.parse(row.body) as BackendRecipe
  }
  begin(input: Pick<RecipeRun, 'recipeId'|'revision'|'workspaceId'|'accountRef'|'sessionRef'|'triggerKey'|'grantEpoch'>): { run: RecipeRun; fresh: boolean } {
    return this.db.transaction(() => {
      const prior = this.db.prepare('SELECT body FROM recipe_runs WHERE workspace=? AND trigger_key=?').get(input.workspaceId,input.triggerKey) as { body: string } | undefined
      if (prior) {
        const run = JSON.parse(prior.body) as RecipeRun
        if (['recipeId','revision','accountRef','sessionRef'].some((k) => run[k as keyof RecipeRun] !== input[k as keyof typeof input])) throw new Error('idempotency key conflict')
        return { run, fresh: false }
      }
      const recipe = this.recipe(input.recipeId,input.revision)
      const run: RecipeRun = { ...input, id: crypto.randomUUID(), recipeHash: createHash('sha256').update(JSON.stringify(recipe)).digest('hex'), state: 'running', attempt: 1, createdAt: Date.now(), updatedAt: Date.now(), reason: null, output: {} }
      this.db.prepare('INSERT INTO recipe_runs VALUES(?,?,?,?)').run(run.id,input.workspaceId,input.triggerKey,JSON.stringify(run))
      return { run, fresh: true }
    }).immediate()
  }
  get(id: string): RecipeRun {
    const row = this.db.prepare('SELECT body FROM recipe_runs WHERE id=?').get(id) as { body: string } | undefined
    if (!row) throw new Error('recipe run not found')
    return JSON.parse(row.body) as RecipeRun
  }
  step(run: RecipeRun, id: string, op: string, state: 'started'|'completed'): void {
    if (this.get(run.id).state !== 'running') throw new Error('run no longer owned')
    this.db.prepare('INSERT INTO recipe_steps VALUES(?,?,?,?,?,?) ON CONFLICT(run_id,attempt,step_id) DO UPDATE SET state=excluded.state,at=excluded.at').run(run.id,run.attempt,id,op,state,Date.now())
  }
  steps(id: string): unknown[] { return this.db.prepare('SELECT * FROM recipe_steps WHERE run_id=? ORDER BY attempt,at').all(id) }
  finish(run: RecipeRun, state: RecipeState, reason: string | null, output: Record<string,string> = {}): RecipeRun {
    const current = this.get(run.id)
    if (current.state !== 'running' || current.attempt !== run.attempt) throw new Error('stale recipe attempt')
    const next = { ...current, state, reason, output: state === 'completed' ? output : {}, updatedAt: Date.now() }
    this.db.prepare('UPDATE recipe_runs SET body=? WHERE id=?').run(JSON.stringify(next),run.id)
    return next
  }
  /** Called only after exclusive browser control is acquired; no automatic side-effect replay. */
  resume(id: string, grantEpoch: number): RecipeRun {
    return this.db.transaction(() => {
      const run = this.get(id)
      if (!['running','waiting_user','failed'].includes(run.state)) throw new Error('run cannot resume')
      const effects = this.db.prepare("SELECT step_id FROM recipe_steps WHERE run_id=? AND op IN ('query','download') LIMIT 1").get(id)
      if (effects) throw new Error('effect history requires reconciliation and a new trigger')
      const next = { ...run, grantEpoch, state: 'running' as const, attempt: run.attempt + 1, updatedAt: Date.now(), reason: 'resumed_from_start_revalidate_account', output: {} }
      this.db.prepare('UPDATE recipe_runs SET body=? WHERE id=?').run(JSON.stringify(next),id)
      return next
    }).immediate()
  }
  close(): void { this.db.close() }
}
