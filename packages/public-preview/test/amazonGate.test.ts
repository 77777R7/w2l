import { describe, expect, it } from 'vitest'
import { AmazonGateBusyError, FirestoreAmazonOriginGate } from '../src/amazonGate.js'

interface StoredGate {
  name: string
  fields: { owner: { stringValue: string }; leaseUntil: { integerValue: string }; nextEligibleAt: { integerValue: string } }
  updateTime: string
}
const resourceName = 'projects/valid-project-123/databases/(default)/documents/publicPreviewOriginGates/amazon-sg'
const documentUrl = `https://firestore.googleapis.com/v1/${resourceName}`
const commitUrl = 'https://firestore.googleapis.com/v1/projects/valid-project-123/databases/(default)/documents:commit'

function firestore() {
  let document: StoredGate | null = null
  let version = 0
  let fail = false
  let conflictOnce = false
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (fail) return new Response('unavailable', { status: 503 })
    const url = String(input)
    if (url.includes('metadata.google.internal')) return Response.json({ access_token: 'fixture-token' })
    if (url.endsWith(':commit')) {
      if (url !== commitUrl) throw new Error(`invalid commit URL: ${url}`)
      const write = (JSON.parse(String(init?.body)) as { writes: [{ update: Omit<StoredGate, 'updateTime'>; currentDocument: { exists?: boolean; updateTime?: string } }] }).writes[0]!
      if (write.update.name !== resourceName) throw new Error('Firestore gate write used a URL instead of a document resource name')
      if (conflictOnce) { conflictOnce = false; return new Response('', { status: 412 }) }
      if (write.currentDocument.exists === false ? document !== null : write.currentDocument.updateTime !== document?.updateTime) {
        return new Response('', { status: 412 })
      }
      document = { ...write.update, updateTime: `version-${++version}` }
      return Response.json({ writeResults: [{}] })
    }
    if (url !== documentUrl) throw new Error(`invalid document GET URL: ${url}`)
    if (!document) return new Response('', { status: 404 })
    return Response.json(document)
  }) as typeof fetch
  return { fetcher, get document() { return document }, set fail(value: boolean) { fail = value }, conflictNext() { conflictOnce = true } }
}

const project = 'valid-project-123'

describe('Firestore Amazon origin gate', () => {
  it('serializes two instances with a durable owner and spacing after release', async () => {
    const db = firestore()
    const first = new FirestoreAmazonOriginGate(project, { fetcher: db.fetcher, leaseMs: 5_000, spacingMs: 40, pollMs: 10 })
    const second = new FirestoreAmazonOriginGate(project, { fetcher: db.fetcher, leaseMs: 5_000, spacingMs: 40, pollMs: 10 })
    const one = await first.acquire(new AbortController().signal, Date.now() + 1_000)
    const initialOwner = db.document?.fields.owner.stringValue
    expect(initialOwner).toMatch(/^[a-f0-9]{32}$/)
    let twoStarted = false
    const pending = second.acquire(new AbortController().signal, Date.now() + 1_000).then(value => { twoStarted = true; return value })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(twoStarted).toBe(false)
    await one.release()
    const releasedAt = Date.now()
    const two = await pending
    expect(Date.now() - releasedAt).toBeGreaterThanOrEqual(30)
    expect(db.document?.fields.owner.stringValue).not.toBe(initialOwner)
    await two.release()
  })

  it('persists Retry-After independently of release and refuses a deadline inside cooldown', async () => {
    const db = firestore()
    let clock = 1_000_000
    const gate = new FirestoreAmazonOriginGate(project, { fetcher: db.fetcher, now: () => clock })
    const first = await gate.acquire(new AbortController().signal, clock + 10_000)
    await first.noteRetryAfter(clock + 5_000)
    expect(Number(db.document?.fields.nextEligibleAt.integerValue)).toBe(clock + 5_000)
    await first.release()
    await expect(gate.acquire(new AbortController().signal, clock + 100)).rejects.toBeInstanceOf(AmazonGateBusyError)
    clock += 5_001
    const next = await gate.acquire(new AbortController().signal, clock + 10_000)
    await next.release()
  })

  it('lets a crashed 90-second owner expire without letting it release a new owner', async () => {
    const db = firestore()
    let clock = 1_000_000
    const gate = new FirestoreAmazonOriginGate(project, { fetcher: db.fetcher, now: () => clock })
    const crashed = await gate.acquire(new AbortController().signal, clock + 10_000)
    clock += 90_001
    const recovered = await gate.acquire(new AbortController().signal, clock + 10_000)
    await expect(crashed.release()).rejects.toThrow('ownership changed')
    await recovered.release()
  })

  it('honors cancellation while waiting and fails closed on Firestore outages', async () => {
    const db = firestore()
    const gate = new FirestoreAmazonOriginGate(project, { fetcher: db.fetcher, pollMs: 10 })
    const owner = await gate.acquire(new AbortController().signal, Date.now() + 1_000)
    const abort = new AbortController()
    const pending = gate.acquire(abort.signal, Date.now() + 1_000)
    setTimeout(() => abort.abort(new DOMException('cancelled', 'AbortError')), 25)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await owner.release()
    db.fail = true
    await expect(gate.acquire(new AbortController().signal, Date.now() + 1_000)).rejects.toThrow('service identity')
  })

  it('retries a CAS conflict rather than granting overlapping leases', async () => {
    const db = firestore()
    const gate = new FirestoreAmazonOriginGate(project, { fetcher: db.fetcher, leaseMs: 1_000, spacingMs: 1, pollMs: 1 })
    db.conflictNext()
    const owner = await gate.acquire(new AbortController().signal, Date.now() + 1_000)
    expect(db.document?.fields.owner.stringValue).toMatch(/^[a-f0-9]{32}$/)
    await owner.release()
  })
})
