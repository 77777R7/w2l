import { lookup } from 'node:dns/promises'
import {
  evaluateResolved,
  evaluateUrl,
  localNetworkPolicy,
  type NetworkPolicy,
} from '@w2l/contracts'

export class SsrfDeniedError extends Error {
  override readonly name = 'SsrfDeniedError'
  constructor(
    readonly url: string,
    readonly detail: string,
  ) {
    super(`ssrf denied ${url}: ${detail}`)
  }
}

export class BodyTooLargeError extends Error {
  override readonly name = 'BodyTooLargeError'
  constructor(maxBytes: number) {
    super(`body exceeded ${maxBytes} bytes`)
  }
}

export function defaultNetworkPolicy(): NetworkPolicy {
  return localNetworkPolicy()
}

export async function assertSafeUrl(url: string, policy: NetworkPolicy): Promise<void> {
  const first = evaluateUrl(url, policy)
  if ('allowed' in first) {
    if (!first.allowed) throw new SsrfDeniedError(url, first.detail ?? first.violation ?? 'denied')
    return
  }
  let records: readonly { address: string }[]
  try {
    records = await lookup(first.hostname, { all: true })
  } catch (err) {
    throw new SsrfDeniedError(url, err instanceof Error ? err.message : 'dns lookup failed')
  }
  const decision = evaluateResolved(
    first.hostname,
    records.map((record) => record.address),
    policy,
  )
  if (!decision.allowed) throw new SsrfDeniedError(url, decision.detail ?? decision.violation ?? 'denied')
}

export async function readCappedBody(body: AsyncIterable<unknown>, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let n = 0
  for await (const chunk of body) {
    const buf = chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk))
    n += buf.byteLength
    if (n > maxBytes) throw new BodyTooLargeError(maxBytes)
    chunks.push(buf)
  }
  const out = new Uint8Array(n)
  let off = 0
  for (const chunk of chunks) {
    out.set(chunk, off)
    off += chunk.byteLength
  }
  return out
}
