/**
 * Authorized-session persistence: cookies, login state, region, browser
 * environment continuity — saved per domain, restored by the ladder when a
 * channel needs it.
 *
 * Credential hygiene, same discipline as the rest of the repo: what a
 * compliance record carries is a HASH of the session material, never the
 * session itself. The plaintext exists only in this store's file (mode 0600,
 * created by the operator's own run) so the browser can actually use it; the
 * record proves the session existed and matches, without disclosing it.
 */

import { sha256Hex } from '@w2l/http-core'
import { readFile, writeFile, mkdir, chmod, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

/** One cookie, the shape both Playwright and the vendor layers accept. */
export interface StoredCookie {
  name: string
  value: string
  domain: string
  path: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

/**
 * A user-authorized session for one domain. `vendor` names the lane that
 * produced it (browser_local_authed or a vendor id); `resume` is the
 * vendor-specific continuation material (context/profile/storage) when the
 * session lives vendor-side. The attestation fields (attestedBy/attestedAt
 * plus the optional principal/statement) are what `normalizeAccessConfig`
 * needs to build an AccessConfig for the authed browser rung — a session
 * without them cannot be honestly recorded.
 */
export interface SessionSnapshot {
  /** Domain this session is scoped to. The ladder only applies it there. */
  domain: string
  /** Who authorized it and when, for the audit trail. */
  attestedBy: string
  attestedAt: string
  vendor: string
  cookies?: readonly StoredCookie[]
  /** Playwright storageState blob (serialized). Credential: hashed, not logged. */
  storageState?: string
  /** Vendor resume context (Browserbase contextId / Steel profileId+context). */
  resume?: Record<string, unknown> | null
  /** AccessAttestation.principal — the accepting principal. */
  principal?: string
  /** AccessAttestation.statement — what was accepted, verbatim. */
  statement?: string
}

export interface SessionStore {
  load(domain: string): Promise<SessionSnapshot | null>
  save(snapshot: SessionSnapshot): Promise<void>
}

/** The credential-free fact a record can carry. */
export function sessionFingerprint(snapshot: SessionSnapshot): string {
  return sha256Hex(
    new TextEncoder().encode(
      JSON.stringify({
        cookies: snapshot.cookies?.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path })),
        storageState: snapshot.storageState ?? null,
      }),
    ),
  )
}

/**
 * File-backed store. One JSON file; 0600 so session material is not readable
 * by other local users. Atomic-ish write: temp file then rename.
 */
export class FileSessionStore implements SessionStore {
  private readonly file: string

  constructor(file: string) {
    this.file = file
  }

  async load(domain: string): Promise<SessionSnapshot | null> {
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch {
      return null
    }
    try {
      const all = JSON.parse(raw) as { sessions?: SessionSnapshot[] }
      return all.sessions?.find((s) => s.domain === domain) ?? null
    } catch {
      return null
    }
  }

  async save(snapshot: SessionSnapshot): Promise<void> {
    let all: SessionSnapshot[] = []
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as { sessions?: SessionSnapshot[] }
      all = parsed.sessions ?? []
    } catch {
      // First save: no file yet.
    }
    all = [...all.filter((s) => s.domain !== snapshot.domain), snapshot]
    const tmp = `${this.file}.tmp`
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(tmp, JSON.stringify({ sessions: all }, null, 2), { mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, this.file)
  }
}

/** In-memory store for tests and one-shot runs. */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionSnapshot>()

  async load(domain: string): Promise<SessionSnapshot | null> {
    return this.sessions.get(domain) ?? null
  }

  async save(snapshot: SessionSnapshot): Promise<void> {
    this.sessions.set(snapshot.domain, snapshot)
  }
}
