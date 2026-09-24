import { readFileSync } from 'node:fs'
import type { JsonSchema } from '@w2l/contracts'

/** The reviewed Amazon product contract, shared by simple local and hosted MCP. */
export const AMAZON_PRODUCT_SCHEMA = JSON.parse(readFileSync(new URL('../../../research/amazon-product-schema.v1.json',import.meta.url),'utf8')) as JsonSchema
