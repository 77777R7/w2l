import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FileSessionStore,
  MemorySessionStore,
  sessionFingerprint,
  type SessionSnapshot,
} from '../src/routing/sessionStore.js'

const SNAPSHOT: SessionSnapshot = {
  domain: 'example.com',
  attestedBy: 'operator@example.com',
  attestedAt: '2026-08-22T00:00:00.000Z',
  vendor: 'browser_local_authed',
  cookies: [{ name: 'sid', value: 'sekrit', domain: '.example.com', path: '/' }],
}

describe('sessionFingerprint', () => {
  it('is deterministic and credential-derived', () => {
    expect(sessionFingerprint(SNAPSHOT)).toBe(sessionFingerprint({ ...SNAPSHOT }))
    expect(sessionFingerprint(SNAPSHOT)).not.toBe(
      sessionFingerprint({ ...SNAPSHOT, cookies: [{ name: 'sid', value: 'other', domain: '.example.com', path: '/' }] }),
    )
  })
})

describe('MemorySessionStore', () => {
  it('loads what was saved, per domain', async () => {
    const store = new MemorySessionStore()
    expect(await store.load('example.com')).toBeNull()
    await store.save(SNAPSHOT)
    expect((await store.load('example.com'))?.attestedBy).toBe('operator@example.com')
    expect(await store.load('other.example')).toBeNull()
  })
})

describe('FileSessionStore', () => {
  it('persists across instances and is scoped per domain', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'w2l-session-'))
    const file = join(dir, 'sessions.json')
    try {
      const store = new FileSessionStore(file)
      await store.save(SNAPSHOT)

      const reloaded = new FileSessionStore(file)
      const loaded = await reloaded.load('example.com')
      expect(loaded?.cookies?.[0]?.value).toBe('sekrit')
      expect(await reloaded.load('nope.example')).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('overwrites the same domain on re-save', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'w2l-session-'))
    const file = join(dir, 'sessions.json')
    try {
      const store = new FileSessionStore(file)
      await store.save(SNAPSHOT)
      await store.save({ ...SNAPSHOT, cookies: [{ name: 'sid', value: 'new', domain: '.example.com', path: '/' }] })
      const loaded = await store.load('example.com')
      expect(loaded?.cookies?.[0]?.value).toBe('new')
      const raw = await readFile(file, 'utf8')
      const parsed = JSON.parse(raw) as { sessions: SessionSnapshot[] }
      expect(parsed.sessions).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
