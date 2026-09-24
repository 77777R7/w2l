import { createHash } from 'node:crypto'

/** Validate the disk-backed, anonymous Amazon.sg preference before attaching
 * it to a hosted browser. Cookie values are never logged or returned. */
export function validateAmazonPublicState(serialized: string): string {
  let state: unknown
  try { state = JSON.parse(serialized) } catch { throw new Error('invalid Amazon public preference JSON') }
  if (state === null || typeof state !== 'object' || Array.isArray(state)) throw new Error('invalid Amazon public preference state')
  const {cookies,origins} = state as Record<string, unknown>
  if (!Array.isArray(cookies) || !Array.isArray(origins)) throw new Error('invalid Amazon public preference state')
  const sgHost = (hostname: string) => hostname === 'amazon.sg' || hostname === 'www.amazon.sg'
  if (cookies.some(cookie => cookie === null || typeof cookie !== 'object' || Array.isArray(cookie)
    || typeof cookie.domain !== 'string' || !sgHost(cookie.domain.replace(/^\./,'')))) {
    throw new Error('Amazon public preference has an out-of-scope cookie')
  }
  if (origins.some(origin => {
    if (origin === null || typeof origin !== 'object' || Array.isArray(origin) || typeof origin.origin !== 'string') return true
    try { const parsed = new URL(origin.origin); return parsed.protocol !== 'https:' || !sgHost(parsed.hostname) }
    catch { return true }
  })) throw new Error('Amazon public preference has an out-of-scope origin')
  if (!cookies.some(cookie => cookie.name === 'i18n-prefs' && cookie.value === 'SGD' && sgHost(cookie.domain.replace(/^\./,'')))) {
    throw new Error('Amazon public preference lacks SGD currency')
  }
  return createHash('sha256').update(serialized).digest('hex')
}
