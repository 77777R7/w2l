import type Database from 'better-sqlite3'
/** Cold multi-process opens can contend before SQLite's normal transaction busy handler. */
export function configureControlDatabase(db: Database.Database): void {
  db.pragma('busy_timeout = 5000')
  const until = Date.now() + 5000
  for (;;) {
    try { db.pragma('journal_mode = WAL'); break }
    catch (error) {
      const code = (error as {code?:string}).code
      if (!['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(code ?? '') || Date.now() >= until) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    }
  }
  db.pragma('synchronous = FULL')
  db.pragma('foreign_keys = ON')
}
