import type {
  AdapterDescriptor,
  EntityField,
  EntityFieldSource,
  EntityValue,
  ExtractedEntity,
  ProductFacts,
} from '@w2l/contracts'
import { amazonAsin, isAmazonProductPage } from './amazon.js'

export interface AdapterMatch {
  descriptor: AdapterDescriptor
  entities: readonly ExtractedEntity[]
}

const GENERIC: AdapterDescriptor = { id: 'generic', version: '1.0.0', status: 'generic' }
const AMAZON: AdapterDescriptor = { id: 'amazon-product', version: '1.0.0', status: 'verified adapter' }

function field<T extends EntityValue>(raw: T, source: EntityFieldSource, path: string, normalized = raw): EntityField<T> {
  return { raw, normalized, source, path, status: 'confirmed' }
}

function sourceOf(source: string | undefined): EntityFieldSource {
  return source === 'jsonld' || source === 'microdata' || source === 'meta' ? source : 'dom'
}

function productEntity(product: ProductFacts, url: string | undefined): ExtractedEntity {
  const fields: Record<string, EntityField> = {}
  const put = (name: string, fact: { value: string; source: string; path?: string } | null | undefined): void => {
    if (fact !== null && fact !== undefined) fields[name] = field(fact.value, sourceOf(fact.source), fact.path ?? 'document')
  }
  put('asin', product.subjectId ?? product.sku)
  put('title', product.name)
  put('brand', product.brand)
  put('price', product.price)
  put('currency', product.priceCurrency)
  put('seller', product.seller)
  put('availability', product.availability)
  put('deliveryLocation', product.deliveryLocation)
  put('rating', product.rating)
  put('reviewCount', product.reviewCount)
  fields.kind = field(product.kind ?? 'unknown', 'dom', 'adapter:amazon-product')
  if (product.prices?.length) {
    const offers = product.prices.map(item => ({
      amount: item.amount.value,
      currency: item.currency?.value ?? null,
      priceType: item.priceType,
      seller: item.seller?.value ?? null,
    }))
    fields.offers = field(offers, sourceOf(product.prices[0]?.amount.source), product.prices[0]?.amount.path ?? 'document')
  }
  if (product.images?.length) fields.images = field(product.images.map(item => item.value), sourceOf(product.images[0]?.source), product.images[0]?.path ?? 'document')
  if (product.variants?.length) {
    const variants = product.variants.map(item => ({ name: item.name, value: item.value, selected: item.selected }))
    fields.variants = field(variants, sourceOf(product.variants[0]?.source), product.variants[0]?.path ?? 'document')
  }
  if (product.specifications && Object.keys(product.specifications).length > 0) {
    fields.specifications = field(
      Object.fromEntries(Object.entries(product.specifications).map(([key, fact]) => [key, fact.value])),
      'dom',
      '#productDetails',
    )
  }
  if (url) fields.url = field(url, 'dom', 'document:url')
  return {
    type: 'product',
    id: product.subjectId?.value ?? product.sku?.value ?? null,
    fields,
    relationships: {},
  }
}

export function adapterFor(doc: Document, url: string | undefined, product: ProductFacts | null = null): AdapterMatch {
  if (isAmazonProductPage(doc, url) || amazonAsin(url) !== null) {
    return { descriptor: AMAZON, entities: product === null ? [] : [productEntity(product, url)] }
  }
  return { descriptor: GENERIC, entities: [] }
}

export const BUILT_IN_ADAPTERS: readonly AdapterDescriptor[] = [AMAZON, GENERIC]
