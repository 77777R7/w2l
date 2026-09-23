/**
 * Amazon.sg may render a parent ASIN for a requested, available child until
 * the page's variant selection is made explicit. Only follow up when the
 * rendered twister itself witnesses the requested child as available; the URL
 * is an expectation, never sufficient evidence for product identity.
 */
export function amazonVariantFollowupUrl(
  requestedUrl: string,
  observedUrl: string,
  selectedAsin: string | null,
  requestedVariantAvailable: boolean,
): string | null {
  if (!requestedVariantAvailable || !selectedAsin) return null
  try {
    const requested = new URL(requestedUrl)
    const observed = new URL(observedUrl)
    if (requested.protocol !== 'https:' || requested.hostname !== 'www.amazon.sg' || requested.origin !== observed.origin) return null
    const requestedAsin = /^\/dp\/([A-Z0-9]{10})\/?$/i.exec(requested.pathname)?.[1]?.toUpperCase()
    const observedAsin = /^\/dp\/([A-Z0-9]{10})\/?$/i.exec(observed.pathname)?.[1]?.toUpperCase()
    if (!requestedAsin || observedAsin !== requestedAsin || selectedAsin.toUpperCase() === requestedAsin) return null
    if (requested.searchParams.has('psc') || observed.searchParams.has('psc')) return null
    observed.searchParams.set('psc', '1')
    return observed.href
  } catch {
    return null
  }
}
