import { describe, expect, it } from 'vitest'
import { hostedNetworkPolicy, localNetworkPolicy } from '@w2l/contracts'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { request } from 'undici'
import { assertSafeUrl, BodyTooLargeError, createGuardedDispatcher, readCappedBody, SsrfDeniedError } from '../src/egress.js'

async function* chunks(...parts: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const part of parts) yield part
}

describe('assertSafeUrl', () => {
  it('allows loopback under the local operator policy', async () => {
    await expect(assertSafeUrl('http://127.0.0.1:9/', localNetworkPolicy())).resolves.toBeUndefined()
  })

  it('denies loopback and metadata under hosted policy without DNS', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/', hostedNetworkPolicy())).rejects.toBeInstanceOf(SsrfDeniedError)
    await expect(assertSafeUrl('http://169.254.169.254/', hostedNetworkPolicy())).rejects.toBeInstanceOf(SsrfDeniedError)
  })

  it('rejects credential-bearing URLs before a request', async () => {
    await expect(assertSafeUrl('https://user:pass@example.com/', hostedNetworkPolicy())).rejects.toBeInstanceOf(SsrfDeniedError)
  })
})

describe('guarded socket lookup', () => {
  it('rejects a private DNS answer at connect even when a prior answer was public', async () => {
    const server = createServer((_req, res) => { res.end('unexpected') })
    let wireRequests = 0
    server.on('request', () => { wireRequests++ })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing fixture port')
    const answers = [
      [{ address: '93.184.215.14', family: 4 }],
      [{ address: '127.0.0.1', family: 4 }],
    ]
    const resolver = async () => answers.shift() ?? []
    const dispatcher = createGuardedDispatcher(hostedNetworkPolicy(), resolver)
    try {
      // A separate preflight can see the first public answer. The connector
      // must still reject the changed answer before opening a socket.
      expect((await resolver())[0]?.address).toBe('93.184.215.14')
      await expect(request(`http://rebind.test:${address.port}/`, { dispatcher })).rejects.toThrow()
      expect(wireRequests).toBe(0)
    } finally {
      await dispatcher.close()
      server.close()
      await once(server, 'close')
    }
  })

  it('rejects a mixed public and private answer set without selecting the public member', async () => {
    const dispatcher = createGuardedDispatcher(hostedNetworkPolicy(), async () => [
      { address: '93.184.215.14', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ])
    try {
      await expect(request('http://mixed.test/', { dispatcher })).rejects.toThrow()
    } finally { await dispatcher.close() }
  })

  it('connects to the validated address while retaining the requested Host', async () => {
    let seenHost: string | undefined
    const server = createServer((req, res) => { seenHost = req.headers.host; res.end('safe') })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing fixture port')
    const dispatcher = createGuardedDispatcher(localNetworkPolicy(), async () => [{ address: '127.0.0.1', family: 4 }])
    try {
      const response = await request(`http://safe.test:${address.port}/`, { dispatcher })
      expect(await response.body.text()).toBe('safe')
      expect(seenHost).toBe(`safe.test:${address.port}`)
    } finally {
      await dispatcher.close()
      server.close()
      await once(server, 'close')
    }
  })
})

describe('readCappedBody', () => {
  it('concatenates chunks under the cap and throws BodyTooLargeError over it', async () => {
    const ok = await readCappedBody(chunks(new Uint8Array([1, 2]), new Uint8Array([3])), 4)
    expect([...ok]).toEqual([1, 2, 3])
    await expect(readCappedBody(chunks(new Uint8Array([1, 2, 3])), 2)).rejects.toBeInstanceOf(BodyTooLargeError)
  })
})
