import { createServer, type IncomingMessage, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  checkIdentityHonesty,
  headersFromIdentity,
  identityBundleFrom,
  modeIdentity,
} from '@w2l/contracts'
import { prepareHttpIdentity } from '../src/httpIdentity.js'
import { ExtractTfSubject } from '../src/subjects/extractTf.js'
import { ResilientHttpSubject } from '../src/subjects/resilientHttp.js'

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        reject(new Error('no address'))
        return
      }
      resolve(`http://127.0.0.1:${addr.port}`)
    })
  })
}

function receivedHeaders(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') out[name.toLowerCase()] = value
    else if (Array.isArray(value) && value[0] !== undefined) out[name.toLowerCase()] = value[0]
  }
  return out
}

describe('prepareHttpIdentity', () => {
  it('standard: UA major matches sec-ch-ua major', () => {
    const prepared = prepareHttpIdentity('standard')
    const uaMajor = /Chrome\/(\d+)/.exec(prepared.headers['user-agent'] ?? '')?.[1]
    const hintMajor = /Chromium";v="(\d+)"/.exec(prepared.headers['sec-ch-ua'] ?? '')?.[1]
    expect(uaMajor).toBeDefined()
    expect(hintMajor).toBe(uaMajor)
    expect(checkIdentityHonesty(prepared.identity, prepared.sentHeaders).honest).toBe(true)
  })

  it('research: no Chromium client hints on the wire object', () => {
    const prepared = prepareHttpIdentity('research')
    expect(prepared.headers['user-agent']).toContain('w2l-research')
    expect(prepared.headers['sec-ch-ua']).toBeUndefined()
    expect(prepared.sentHeaders.headers.every((h) => !h.name.startsWith('sec-ch-ua'))).toBe(true)
    expect(checkIdentityHonesty(prepared.identity, prepared.sentHeaders).honest).toBe(true)
  })
})

describe('product HTTP arms send the bundle', () => {
  let server: Server
  let url: string
  let last: Record<string, string> = {}

  beforeAll(async () => {
    server = createServer((req, res) => {
      last = receivedHeaders(req)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        '<!doctype html><html><body><article><h1>Echo</h1><p>The kiln reached 1240 degrees before the glaze vitrified.</p></article></body></html>',
      )
    })
    url = await listen(server)
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  })

  it('ExtractTfSubject standard sends aligned Chrome identity', async () => {
    const subject = new ExtractTfSubject('standard')
    const out = await subject.fetch(url)
    expect(out.status).toBe('success')
    const expected = headersFromIdentity(identityBundleFrom(modeIdentity('standard')))
    expect(last['user-agent']).toBe(expected['user-agent'])
    expect(last['sec-ch-ua']).toBe(expected['sec-ch-ua'])
    const uaMajor = /Chrome\/(\d+)/.exec(last['user-agent'] ?? '')?.[1]
    const hintMajor = /Chromium";v="(\d+)"/.exec(last['sec-ch-ua'] ?? '')?.[1]
    expect(uaMajor).toBeDefined()
    expect(hintMajor).toBe(uaMajor)
    expect(out.trace.some((t) => t.event === 'identity_sent')).toBe(true)
    expect(out.trace.some((t) => t.event === 'identity_mismatch')).toBe(false)
    expect(out.failureReason).not.toBe('identity_compromised')
  })

  it('ResilientHttpSubject research sends the declared bot and no Chromium hints', async () => {
    const subject = new ResilientHttpSubject('research')
    const out = await subject.fetch(url)
    expect(out.status).toBe('success')
    expect(last['user-agent']).toContain('w2l-research')
    expect(last['sec-ch-ua']).toBeUndefined()
    expect(last['sec-ch-ua-platform']).toBeUndefined()
    expect(out.trace.some((t) => t.event === 'identity_mismatch')).toBe(false)
  })
})
