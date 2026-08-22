/**
 * The thin HTTP seam every vendor integration goes through.
 *
 * Injectable so the transports can be tested without an account: the tests
 * assert on the exact request bodies (the session config IS the compliance
 * claim), and a fake here is what lets them do that without a network.
 */

export interface VendorApiRequest {
  method: 'GET' | 'POST'
  url: string
  headers: Readonly<Record<string, string>>
  body?: unknown
  /** Cancellation. Vendor APIs are HTTP calls; a caller that stops waiting
   *  should be able to stop the call, not just ignore its answer. */
  signal?: AbortSignal
}

export interface VendorApiResponse {
  status: number
  json: unknown
}

export type VendorApi = (req: VendorApiRequest) => Promise<VendorApiResponse>

export const fetchVendorApi: VendorApi = async (req) => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: { 'content-type': 'application/json', ...req.headers },
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    signal: req.signal ?? AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text.length > 0 ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, json }
}

/**
 * Remove a secret from a message before it can travel. Vendor errors and CDP
 * connect failures like to echo the URL they were given, and for Steel that
 * URL carries the API key as a query parameter — an error that lands in a
 * trace or a bench artifact must not carry the credential with it.
 */
export function scrubSecret(message: string, secret: string): string {
  if (secret.length === 0) return message
  return message.split(secret).join('<redacted>')
}
