import type { JsonSchema } from '@w2l/contracts'

/** Fixed, deterministic Amazon.sg product contract. Visitors cannot change it. */
export const AMAZON_PRODUCT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    asin: { type: 'string' },
    title: { type: 'string' },
    kind: { type: 'string', enum: ['physical', 'subscription', 'unknown'] },
    brand: { type: ['string', 'null'] },
    price: { type: ['number', 'null'] },
    currency: { type: ['string', 'null'] },
    seller: { type: ['string', 'null'] },
    availability: { type: ['string', 'null'] },
    deliveryLocation: { type: ['string', 'null'] },
    rating: { type: ['number', 'null'] },
    reviewCount: { type: ['integer', 'null'] },
    images: { type: 'array', items: { type: 'string' } },
    prices: { type: 'array', items: { type: 'object', additionalProperties: true } },
    variants: { type: 'array', items: { type: 'object', additionalProperties: true } },
    specifications: { type: 'object', additionalProperties: true },
  },
  required: ['asin', 'title', 'kind', 'brand', 'price', 'currency', 'seller', 'availability', 'deliveryLocation', 'rating', 'reviewCount', 'images', 'prices', 'variants', 'specifications'],
  additionalProperties: false,
}
