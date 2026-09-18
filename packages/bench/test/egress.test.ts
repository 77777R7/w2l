import { describe, expect, it } from 'vitest'
import { hostedNetworkPolicy, localNetworkPolicy } from '@w2l/contracts'
import { assertSafeUrl, BodyTooLargeError, readCappedBody, SsrfDeniedError } from '../src/egress.js'

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
})

describe('readCappedBody', () => {
  it('concatenates chunks under the cap and throws BodyTooLargeError over it', async () => {
    const ok = await readCappedBody(chunks(new Uint8Array([1, 2]), new Uint8Array([3])), 4)
    expect([...ok]).toEqual([1, 2, 3])
    await expect(readCappedBody(chunks(new Uint8Array([1, 2, 3])), 2)).rejects.toBeInstanceOf(BodyTooLargeError)
  })
})
