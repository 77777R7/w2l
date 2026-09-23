import type { ProductFact, ProductFacts, ProductPrice, ProductVariant } from '@w2l/contracts'
import { qs, qsa, textOf } from './dom.js'

const AMAZON_HOST = /(^|\.)amazon\.[a-z.]+$/i
const ASIN_PATH = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i

function clean(value: string | null | undefined): string | null {
  const out = (value ?? '').replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim()
  return out.length > 0 ? out : null
}

function domFact(value: string | null | undefined, path: string): ProductFact | null {
  const cleaned = clean(value)
  return cleaned === null ? null : { value: cleaned, source: 'dom', path }
}

function metaFact(doc: Document, selector: string, name = 'content'): ProductFact | null {
  const value = clean(qs(doc, selector)?.getAttribute(name))
  return value === null ? null : { value, source: 'meta', path: selector }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function jsonLdProduct(doc: Document, asin: string | null): { node: Record<string, unknown>; path: string } | null {
  const candidates: Array<{ node: Record<string, unknown>; path: string }> = []
  for (const [scriptIndex, script] of qsa(doc, 'script[type="application/ld+json"]').entries()) {
    try {
      const root = JSON.parse(script.textContent ?? '') as unknown
      const visit = (value: unknown, path: string): void => {
        if (Array.isArray(value)) return void value.forEach((child, index) => visit(child, `${path}/${index}`))
        const item = record(value)
        if (item === null) return
        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']]
        if (types.includes('Product')) candidates.push({ node: item, path })
        const graph = item['@graph']
        if (graph !== undefined) visit(graph, `${path}/@graph`)
      }
      visit(root, `/script/${scriptIndex}`)
    } catch { /* malformed publisher JSON-LD is ignored */ }
  }
  if (asin === null) return candidates.length === 1 ? candidates[0]! : null
  return candidates.find(({ node }) => [node.asin, node.sku, node.productID].some(value => typeof value === 'string' && value.toUpperCase().includes(asin))) ?? null
}

function jsonFact(value: unknown, path: string): ProductFact | null {
  return typeof value === 'string' || typeof value === 'number' ? { value: String(value), source: 'jsonld', path } : null
}

function text(scope: ParentNode, selector: string): string | null {
  const el = qs(scope, selector)
  if (!el) return null
  const copy = el.cloneNode(true) as Element
  for (const noise of qsa(copy, 'script,style,noscript,template')) noise.remove()
  return clean(textOf(copy))
}

function attr(scope: ParentNode, selector: string, name: string): string | null {
  return clean(qs(scope, selector)?.getAttribute(name))
}

function first(scope: ParentNode, selectors: readonly string[]): { value: string; selector: string } | null {
  for (const selector of selectors) {
    const value = text(scope, selector)
    if (value !== null) return { value, selector }
  }
  return null
}

function deliveryLocation(doc: Document): { value: string; selector: string } | null {
  for (const selector of ['#glow-ingress-line2', '#contextualIngressPtLabel_deliveryShortLine', '#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE']) {
    const raw = text(doc, selector)
    if (raw === null || /^update\s+location$/i.test(raw)) continue
    const normalized = clean(raw
      .replace(/^deliver(?:ing|y)?\s+to\s+/i, '')
      .replace(/[–—-]?\s*update\s+location\s*$/i, '')
      .replace(/\b(Singapore)\s*(\d{6})\b/i, '$1 $2'))
    if (normalized !== null) return { value: normalized, selector }
  }
  return null
}

function currencyOf(value: string): string | null {
  if (/\bSGD\b|S\$/.test(value)) return 'SGD'
  if (/\bCAD\b|C\$/.test(value)) return 'CAD'
  if (/\bAUD\b|A\$/.test(value)) return 'AUD'
  if (/\bINR\b|₹/.test(value)) return 'INR'
  if (/\bEUR\b|€/.test(value)) return 'EUR'
  if (/\bGBP\b|£/.test(value)) return 'GBP'
  if (/\bUSD\b|\$/.test(value)) return 'USD'
  return null
}

function amountOf(value: string): string {
  return value.replace(/\b(?:INR|USD|EUR|GBP|CAD|AUD|SGD)\b/gi, '').replace(/(?:S|C|A|US)?\$/g, '').replace(/[₹€£]/g, '').replace(/\s+/g, '').trim()
}

export function amazonAsin(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (!AMAZON_HOST.test(parsed.hostname)) return null
    return parsed.pathname.match(ASIN_PATH)?.[1]?.toUpperCase() ?? null
  } catch {
    return null
  }
}

export function inferAmazonCurrency(url: string | undefined, price: string): ProductFact | null {
  if (!url) return null
  let hostname: string
  try { hostname = new URL(url).hostname.toLowerCase() } catch { return null }
  const explicit = currencyOf(price)
  if (explicit !== null && !price.includes('$')) return { value: explicit, source: 'text', path: 'subject price text' }
  const value = hostname.endsWith('amazon.ca') ? 'CAD'
    : hostname.endsWith('amazon.com.au') ? 'AUD'
      : hostname.endsWith('amazon.co.uk') ? 'GBP'
        : hostname.endsWith('amazon.sg') ? 'SGD'
        : hostname.endsWith('amazon.in') ? 'INR'
          : hostname.endsWith('amazon.com') ? 'USD'
            : explicit
  return value === null ? null : { value, source: 'text', path: 'subject price text + Amazon marketplace' }
}

export function isAmazonProductPage(doc: Document, url: string | undefined): boolean {
  const asin = amazonAsin(url)
  if (asin === null) return false
  if (qs(doc, '#productTitle, #title, [data-feature-name="title"] h1, input[name="ASIN"], [data-feature-name="buybox"]') !== null) return true
  const body = text(doc, 'body') ?? ''
  const documentTitle = clean(text(doc, 'title')) ?? ''
  return /\bPlan:\s*Blink\s+(?:AI\s+)?(?:basic|plus)\b/i.test(body) && /\bBilling:\s*(?:Monthly|Annual)\b/i.test(body) && /\bSold\s+by\s*Blink\b/i.test(body)
    || /\bBlink\s+(?:AI\s+)?(?:basic|plus)\s+plan\b/i.test(documentTitle)
}

export function selectAmazonProduct(doc: Document): Element | null {
  return qs(doc, '#dp-container, #ppd, main')
}

function amazonPrices(doc: Document, subscription: boolean): readonly ProductPrice[] {
  const selectors = subscription
    ? ['#subscriptionPrice', '[data-feature-name="subscriptionPrice"] .a-offscreen', '#buybox .a-price .a-offscreen']
    : ['#corePrice_feature_div .a-price .a-offscreen', '#apex_desktop .a-price .a-offscreen', '#buybox .a-price .a-offscreen', '#rightCol .priceToPay .a-offscreen', '.apexPriceToPay .a-offscreen', '.priceToPay .a-offscreen', '#priceblock_ourprice', '#priceblock_dealprice']
  const seen = new Set<string>()
  const prices: ProductPrice[] = []
  for (const selector of selectors) {
    for (const el of qsa(doc, selector)) {
      const raw = clean(textOf(el))
      if (raw === null || !/[\d]/.test(raw) || seen.has(raw)) continue
      seen.add(raw)
      const currency = currencyOf(raw)
      prices.push({
        amount: { value: amountOf(raw), source: 'dom', path: selector },
        currency: currency === null ? null : { value: currency, source: 'dom', path: selector },
        priceType: subscription ? 'subscription' : prices.length === 0 ? 'current' : 'other',
        seller: null,
      })
      if (prices.length >= 4) return prices
    }
  }
  return prices
}

function alternateOffers(doc: Document): readonly ProductPrice[] {
  const out: ProductPrice[] = []
  for (const row of qsa(doc, '#aod-offer-list .aod-information-block, #aod-offer-list [id^="aod-offer-"]')) {
    const raw = text(row, '.a-price .a-offscreen')
    if (raw === null || !/\d/.test(raw)) continue
    const sellerValue = text(row, '.aod-offer-soldBy a, [id^="aod-offer-soldBy"] a, .a-size-small a')
    out.push({
      amount: domFact(amountOf(raw), '#aod-offer-list .a-price')!,
      currency: domFact(currencyOf(raw), '#aod-offer-list .a-price'),
      priceType: 'other',
      seller: domFact(sellerValue, '#aod-offer-list .aod-offer-soldBy'),
    })
  }
  return out
}

function variants(doc: Document): readonly ProductVariant[] {
  const out: ProductVariant[] = []
  for (const el of qsa(doc, '#twister .a-button-selected, #twister .swatchSelect, #twister [data-csa-c-item-type="asin"]')) {
    const value = clean(el.getAttribute('title') ?? el.getAttribute('aria-label') ?? textOf(el))
    if (value === null) continue
    const parent = el.closest('li,div')
    const name = clean(parent?.parentElement?.previousElementSibling?.textContent) ?? 'variant'
    out.push({ name, value, selected: el.classList.contains('a-button-selected') || el.classList.contains('swatchSelect'), source: 'dom', path: '#twister' })
  }
  return out
}

function availabilityFact(value: string, selector: string): ProductFact | null {
  const patterns = [
    /This item cannot be shipped to your selected delivery location\.?(?: Please choose a different delivery location\.?)?/i,
    /Only\s+\d+\s+left in stock(?:\s*-\s*order soon)?\.?/i,
    /Currently unavailable\.?/i,
    /Temporarily out of stock\.?/i,
    /In Stock\.?/i,
    /Out of Stock\.?/i,
  ]
  for (const pattern of patterns) {
    const hit = value.match(pattern)?.[0]
    if (hit) return domFact(hit, selector)
  }
  return null
}

function specifications(doc: Document): Readonly<Record<string, ProductFact>> {
  const out: Record<string, ProductFact> = {}
  for (const row of qsa(doc, '#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, #prodDetails tr')) {
    const key = clean(text(row, 'th') ?? text(row, 'td:first-child'))
    const value = clean(text(row, 'td:last-child'))
    if (key !== null && value !== null && key !== value && out[key] === undefined) out[key] = { value, source: 'dom', path: '#productDetails' }
  }
  for (const li of qsa(doc, '#detailBullets_feature_div li')) {
    const raw = clean(textOf(li))
    const split = raw?.match(/^([^:]{2,80}):\s*(.+)$/)
    if (split?.[1] && split[2] && out[split[1]] === undefined) out[split[1]] = { value: split[2], source: 'dom', path: '#detailBullets_feature_div' }
  }
  return out
}

export function collectAmazonProductFacts(doc: Document, url: string | undefined, declared: ProductFacts): ProductFacts {
  const asin = amazonAsin(url)
  const jsonLd = jsonLdProduct(doc, asin)
  const jsonNode = jsonLd?.node ?? null
  const jsonPath = jsonLd?.path ?? ''
  const jsonBrand = record(jsonNode?.brand)
  const offersRaw = jsonNode?.offers
  const offer = record(Array.isArray(offersRaw) ? offersRaw[0] : offersRaw)
  const titleSelector = qs(doc, '#productTitle') ? '#productTitle' : '#title'
  const pageText = text(doc, 'body') ?? ''
  const documentTitle = clean(text(doc, 'title')) ?? ''
  const subscriptionPlan = pageText.match(/\bPlan:\s*(Blink\s+(?:AI\s+)?(?:basic|plus))\b/i)?.[1]
    ?? documentTitle.match(/\b(Blink\s+(?:AI\s+)?(?:basic|plus))\s+plan\b/i)?.[1]
    ?? null
  const subscription = subscriptionPlan !== null
    || /\bsubscription plan\b/i.test(pageText) && /\bBilling:\s*(?:Monthly|Annual)\b/i.test(pageText)
  const title = domFact(text(doc, titleSelector), titleSelector)
    ?? jsonFact(jsonNode?.name, `${jsonPath}/name`)
    ?? (subscriptionPlan === null ? null : domFact(`${subscriptionPlan} subscription plan`, 'body:Plan'))
    ?? metaFact(doc, 'meta[property="og:title"]')
  let rawPrices = [...amazonPrices(doc, subscription), ...alternateOffers(doc)]
  if (rawPrices.length === 0 && subscription) {
    const amount = pageText.match(/\bBilling:\s*(?:Monthly|Annual).*?([$€£]\s*\d[\d,]*(?:\.\d{1,2})?)/i)?.[1]
      ?? pageText.match(/([$€£]\s*\d[\d,]*(?:\.\d{1,2})?)/)?.[1]
      ?? null
    if (amount !== null) rawPrices = [{ amount: domFact(amountOf(amount), 'body:Billing')!, currency: domFact(currencyOf(amount), 'body:Billing'), priceType: 'subscription', seller: null }]
  }
  const store = first(doc, ['#bylineInfo', '[data-feature-name="bylineInfo"]'])
  const brand = store === null ? null : domFact(store.value.replace(/^Visit the\s+/i, '').replace(/\s+Store$/i, ''), store.selector)
  const sellerHit = first(doc, ['#sellerProfileTriggerId', '#merchant-info', '.tabular-buybox-text[tabular-attribute-name="Sold by"]'])
  const seller = sellerHit === null
    ? (/\bSold\s*by\s*Blink\b/i.test(pageText) || /SoldbyBlink/i.test(pageText.replace(/\s+/g, '')) ? domFact('Blink', 'body:Sold by') : null)
    : domFact(sellerHit.value, sellerHit.selector)
  const availabilityHit = first(doc, ['#availability span', '#availability', '#outOfStock'])
  const deliveryHit = deliveryLocation(doc)
  const ratingRaw = attr(doc, '#acrPopover', 'title') ?? text(doc, '#acrPopover .a-icon-alt') ?? text(doc, '[data-hook="rating-out-of-text"]')
  const reviewRaw = text(doc, '#acrCustomerReviewText') ?? text(doc, '[data-hook="total-review-count"]')
  const images: ProductFact[] = []
  for (const selector of ['#landingImage', '#imgTagWrapperId img', '#main-image-container img']) {
    for (const el of qsa(doc, selector)) {
      const value = clean(el.getAttribute('data-old-hires') ?? el.getAttribute('src'))
      if (value !== null && !images.some(image => image.value === value)) images.push({ value, source: 'dom', path: selector })
    }
  }
  const jsonPrice = jsonFact(offer?.price, `${jsonPath}/offers/price`)
  const metaPrice = metaFact(doc, 'meta[property="product:price:amount"]')
  const jsonCurrency = jsonFact(offer?.priceCurrency, `${jsonPath}/offers/priceCurrency`)
  const metaCurrency = metaFact(doc, 'meta[property="product:price:currency"]')
  const fallbackPrice = jsonPrice ?? metaPrice
  const fallbackCurrency = jsonCurrency ?? metaCurrency
  const jsonSeller = record(offer?.seller)
  const effectiveSeller = seller ?? jsonFact(jsonSeller?.name, `${jsonPath}/offers/seller/name`)
  const fallbackPrices: readonly ProductPrice[] = fallbackPrice === null ? [] : [{ amount: fallbackPrice, currency: fallbackCurrency, priceType: subscription ? 'subscription' : 'current', seller: null }]
  const prices: readonly ProductPrice[] = (rawPrices.length > 0 ? rawPrices : fallbackPrices)
    .map((price, index) => index === 0 && effectiveSeller !== null ? { ...price, seller: effectiveSeller } : price)
  const primary = prices[0] ?? null
  const jsonImage = Array.isArray(jsonNode?.image) ? jsonNode?.image[0] : jsonNode?.image
  const subjectImages = images.length > 0 ? images : [jsonFact(jsonImage, `${jsonPath}/image`), metaFact(doc, 'meta[property="og:image"]')].filter((value): value is ProductFact => value !== null).slice(0, 1)
  const jsonAvailability = typeof offer?.availability === 'string' ? offer.availability.split('/').pop() : null
  return {
    ...declared,
    name: title,
    price: primary?.amount ?? null,
    priceCurrency: primary?.currency ?? null,
    sku: asin === null ? jsonFact(jsonNode?.sku, `${jsonPath}/sku`) : { value: asin, source: 'dom', path: 'url:/dp/{asin}' },
    brand: brand ?? jsonFact(jsonBrand?.name ?? jsonNode?.brand, `${jsonPath}/brand/name`),
    availability: availabilityHit === null ? jsonFact(jsonAvailability, `${jsonPath}/offers/availability`) : availabilityFact(availabilityHit.value, availabilityHit.selector),
    kind: subscription ? 'subscription' : 'physical',
    subjectId: asin === null ? null : { value: asin, source: 'dom', path: 'url:/dp/{asin}' },
    prices,
    seller: effectiveSeller,
    deliveryLocation: deliveryHit === null ? null : domFact(deliveryHit.value, deliveryHit.selector),
    rating: domFact(ratingRaw?.match(/[0-5](?:\.[0-9])?/)?.[0] ?? null, '#acrPopover'),
    reviewCount: domFact(reviewRaw?.match(/[\d,]+/)?.[0]?.replaceAll(',', '') ?? null, '#acrCustomerReviewText'),
    images: subjectImages,
    variants: variants(doc),
    specifications: specifications(doc),
  }
}
