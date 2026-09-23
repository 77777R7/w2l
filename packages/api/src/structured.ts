import Ajv from 'ajv'
import type { ErrorObject, ValidateFunction } from 'ajv'
import type {
  CompactScrapeResponse,
  ExecutionContext,
  FetchResult,
  JsonFormatRequest,
  JsonSchema,
  JsonValue,
  ProductFact,
  ProductFacts,
  ScrapeFormat,
  ScrapeRequest,
  ScrapeResponse,
  StructuredExtractionIssue,
  StructuredExtractionResult,
  StructuredFieldEvidence,
  StructuredModelUsage,
} from '@w2l/contracts'
import { sha256Utf8 } from '@w2l/http-core'

export interface StructuredModelConfig {
  baseUrl: string
  model: string
  apiKey?: string
  fetch?: typeof fetch
}

export function structuredModelConfigFromEnv(): StructuredModelConfig | null {
  const baseUrl = process.env.W2L_EXTRACT_BASE_URL?.trim()
  const model = process.env.W2L_EXTRACT_MODEL?.trim()
  if (!baseUrl || !model) return null
  const apiKey = process.env.W2L_EXTRACT_API_KEY?.trim()
  return { baseUrl, model, ...(apiKey ? { apiKey } : {}) }
}

interface Candidate {
  value: JsonValue
  fact?: ProductFact
}

function numeric(value: string, integer = false): number | string {
  const parsed = Number(value.replace(integer ? /[^0-9-]/g : /[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? (integer ? Math.trunc(parsed) : parsed) : value
}

function candidates(result: FetchResult): Map<string, Candidate> {
  const map = new Map<string, Candidate>()
  const product = result.document?.product ?? null
  const put = (keys: readonly string[], fact: ProductFact | null | undefined, value?: JsonValue): void => {
    if (fact === null || fact === undefined) return
    for (const key of keys) map.set(key.toLowerCase(), { value: value ?? fact.value, fact })
  }
  map.set('url', { value: result.evidence.finalUrl })
  map.set('requesturl', { value: result.requestedUrl })
  map.set('finalurl', { value: result.evidence.finalUrl })
  if (result.document?.title) {
    map.set('title', { value: result.document.title })
    map.set('pagetitle', { value: result.document.title })
  }
  if (result.document?.pageType) map.set('pagetype', { value: result.document.pageType })
  if (product !== null) addProductCandidates(map, product, put)
  return map
}

function addProductCandidates(
  map: Map<string, Candidate>,
  product: ProductFacts,
  put: (keys: readonly string[], fact: ProductFact | null | undefined, value?: JsonValue) => void,
): void {
  put(['asin', 'id', 'productid', 'subjectid', 'sku'], product.subjectId ?? product.sku)
  put(['title', 'name', 'productname'], product.name)
  put(['brand'], product.brand)
  put(['price', 'amount', 'currentprice'], product.price, product.price ? numeric(product.price.value) : undefined)
  put(['currency', 'pricecurrency'], product.priceCurrency)
  put(['seller', 'merchant'], product.seller)
  put(['availability', 'stock'], product.availability)
  put(['deliverylocation', 'deliveryregion', 'region'], product.deliveryLocation)
  put(['rating'], product.rating, product.rating ? numeric(product.rating.value) : undefined)
  put(['reviewcount', 'reviews'], product.reviewCount, product.reviewCount ? numeric(product.reviewCount.value, true) : undefined)
  map.set('kind', { value: product.kind ?? 'unknown' })
  map.set('images', { value: (product.images ?? []).map(item => item.value), fact: product.images?.[0] })
  map.set('prices', {
    value: (product.prices ?? []).map(item => ({
      amount: numeric(item.amount.value),
      currency: item.currency?.value ?? null,
      priceType: item.priceType,
      seller: item.seller?.value ?? null,
    })),
    fact: product.prices?.[0]?.amount,
  })
  map.set('variants', {
    value: (product.variants ?? []).map(item => ({
      name: item.name,
      value: item.value,
      selected: item.selected,
    })),
    fact: product.variants?.[0] === undefined ? undefined : {
      value: product.variants[0].value,
      source: product.variants[0].source,
      path: product.variants[0].path,
    },
  })
  const specifications = Object.fromEntries(
    Object.entries(product.specifications ?? {}).map(([key, fact]) => [key, fact.value]),
  )
  map.set('specifications', {
    value: specifications,
    fact: Object.values(product.specifications ?? {})[0],
  })
}

function schemaTypes(schema: JsonSchema): readonly string[] {
  if (schema.type === undefined) return []
  return typeof schema.type === 'string' ? [schema.type] : schema.type
}

function resolveRef(root: JsonSchema, schema: JsonSchema): JsonSchema {
  if (!schema.$ref) return schema
  const parts = schema.$ref.slice(2).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  let value: unknown = root
  for (const part of parts) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return schema
    value = (value as Record<string, unknown>)[part]
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonSchema : schema
}

function coerce(value: JsonValue, schema: JsonSchema): JsonValue | undefined {
  const types = schemaTypes(schema)
  if (value === null) return types.length === 0 || types.includes('null') ? null : undefined
  if ((types.includes('number') || types.includes('integer')) && typeof value === 'string') {
    const parsed = numeric(value, types.includes('integer'))
    return typeof parsed === 'number' ? parsed : undefined
  }
  if (types.includes('string') && typeof value !== 'string') return String(value)
  if (types.includes('boolean') && typeof value === 'string') {
    if (value === 'true') return true
    if (value === 'false') return false
  }
  return value
}

function mapSchema(
  root: JsonSchema,
  schemaInput: JsonSchema,
  source: Map<string, Candidate>,
  path: string,
  evidence: StructuredFieldEvidence[],
): JsonValue | undefined {
  const schema = resolveRef(root, schemaInput)
  const key = path.split('/').at(-1)?.toLowerCase() ?? ''
  const direct = source.get(key)
  if (direct !== undefined) {
    const value = coerce(direct.value, schema)
    if (value !== undefined) {
      if (direct.fact !== undefined) {
        evidence.push({
          path,
          source: direct.fact.source,
          ...(direct.fact.path === undefined ? {} : { evidencePath: direct.fact.path }),
        })
      }
      return value
    }
  }
  if (schemaTypes(schema).includes('object') || schema.properties !== undefined) {
    const out: Record<string, JsonValue> = {}
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      const mapped = mapSchema(root, child, source, `${path}/${name}`, evidence)
      if (mapped !== undefined) out[name] = mapped
    }
    return out
  }
  return undefined
}

function fillNullableMissing(root: JsonSchema, schemaInput: JsonSchema, value: JsonValue | undefined): JsonValue | undefined {
  const schema = resolveRef(root, schemaInput)
  if ((schemaTypes(schema).includes('object') || schema.properties !== undefined) && value !== null) {
    const out: Record<string, JsonValue> = value !== undefined && typeof value === 'object' && !Array.isArray(value)
      ? { ...value }
      : {}
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      const next = fillNullableMissing(root, child, out[name])
      if (next !== undefined) out[name] = next
    }
    return out
  }
  if (value !== undefined) return value
  const types = schemaTypes(schema)
  if (types.includes('null')) return null
  if (types.includes('array')) return []
  if (types.includes('object')) return {}
  return undefined
}

function requiredMissing(root: JsonSchema, schemaInput: JsonSchema, value: JsonValue | undefined, path = ''): string[] {
  const schema = resolveRef(root, schemaInput)
  const missing: string[] = []
  if (schema.required !== undefined) {
    const rec = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : {}
    for (const key of schema.required) {
      if (!(key in rec)) missing.push(`${path}/${key}`)
    }
  }
  if (schema.properties !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      const childValue = (value as Record<string, JsonValue>)[key]
      if (childValue !== undefined) missing.push(...requiredMissing(root, child, childValue, `${path}/${key}`))
    }
  }
  return missing
}

function compile(schema: JsonSchema): ValidateFunction {
  const AjvConstructor = Ajv as unknown as new (options: { allErrors: boolean; strict: boolean }) => { compile(schema: object): ValidateFunction }
  const ajv = new AjvConstructor({ allErrors: true, strict: false })
  return ajv.compile(schema as object)
}

function validationMessage(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? []).map(error => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ') || 'model output did not match the schema'
}

function canonicalStructured(result: FetchResult): StructuredExtractionResult {
  const document = result.document
  if (document?.adapterValidation?.valid === false) {
    return {
      status: 'incomplete',
      data: { adapter: document.adapter, pageType: document.pageType, entities: [] },
      evidence: [],
      issues: document.adapterValidation.issues.map(message => ({ code: 'subject_unverified', message })),
      modelUsage: null,
    }
  }
  if (document === undefined || document === null || document.entities.length === 0) {
    return {
      status: 'incomplete',
      data: document === undefined || document === null ? null : {
        adapter: document.adapter,
        pageType: document.pageType,
        entities: [],
      },
      evidence: [],
      issues: [{ code: 'adapter_unavailable', message: 'no normalized entity was confirmed from the public page' }],
      modelUsage: null,
    }
  }
  const evidence: StructuredFieldEvidence[] = []
  for (const [entityIndex, entity] of document.entities.entries()) {
    for (const [field, fact] of Object.entries(entity.fields)) {
      evidence.push({ path: `/entities/${entityIndex}/fields/${field}`, source: fact.source, evidencePath: fact.path })
    }
  }
  return {
    status: 'complete',
    data: { adapter: document.adapter, pageType: document.pageType, entities: document.entities },
    evidence,
    issues: [],
    modelUsage: null,
  }
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

async function callModel(
  result: FetchResult,
  format: JsonFormatRequest,
  deterministic: JsonValue,
  execution: ExecutionContext,
  config: StructuredModelConfig,
  repair: string | null,
): Promise<{ value: JsonValue; inputTokens: number | null; outputTokens: number | null }> {
  execution.signal?.throwIfAborted()
  const fetchImpl = config.fetch ?? fetch
  const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    signal: execution.signal,
    headers: {
      'content-type': 'application/json',
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: 'Return only facts supported by the supplied subject content. Do not infer from recommendations or unrelated products.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            prompt: format.prompt ?? 'Complete the missing schema fields.',
            deterministic,
            subject: result.markdown ?? '',
            ...(repair === null ? {} : { repair }),
          }),
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'w2l_extract', strict: true, schema: format.schema },
      },
    }),
  })
  if (!response.ok) throw new Error(`model provider returned ${response.status}`)
  const payload = await response.json() as ChatCompletion
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('model provider omitted JSON content')
  return {
    value: JSON.parse(content) as JsonValue,
    inputTokens: payload.usage?.prompt_tokens ?? null,
    outputTokens: payload.usage?.completion_tokens ?? null,
  }
}

function mergeObjects(base: JsonValue, patch: JsonValue): JsonValue {
  if (base !== null && patch !== null && typeof base === 'object' && typeof patch === 'object' && !Array.isArray(base) && !Array.isArray(patch)) {
    return { ...base, ...patch }
  }
  return patch
}

export async function extractStructured(
  result: FetchResult,
  format?: JsonFormatRequest,
  execution: ExecutionContext = {},
  modelConfig: StructuredModelConfig | null = structuredModelConfigFromEnv(),
): Promise<StructuredExtractionResult> {
  if (format === undefined) return canonicalStructured(result)
  const schemaSha256 = sha256Utf8(JSON.stringify(format.schema))
  if (result.document?.adapterValidation?.valid === false) {
    return {
      status: 'incomplete',
      data: null,
      schemaSha256,
      evidence: [],
      issues: result.document.adapterValidation.issues.map(message => ({ code: 'subject_unverified', message })),
      modelUsage: null,
    }
  }
  const evidence: StructuredFieldEvidence[] = []
  let data = fillNullableMissing(format.schema, format.schema, mapSchema(format.schema, format.schema, candidates(result), '', evidence)) ?? null
  let validate: ValidateFunction
  try {
    validate = compile(format.schema)
  } catch (error) {
    return {
      status: 'invalid',
      data,
      schemaSha256,
      evidence,
      issues: [{ code: 'schema_invalid', message: error instanceof Error ? error.message : 'schema compilation failed' }],
      modelUsage: null,
    }
  }
  let missing = requiredMissing(format.schema, format.schema, data)
  const deterministicValid = validate(data)
  if (missing.length === 0 && deterministicValid) {
    return { status: 'complete', data, schemaSha256, evidence, issues: [], modelUsage: null }
  }
  const issues: StructuredExtractionIssue[] = []
  if (format.modelFallback !== true) {
    for (const path of missing) issues.push({ code: 'missing_required', path, message: `required field unavailable: ${path}` })
    if (!deterministicValid && missing.length === 0) issues.push({ code: 'field_unavailable', message: validationMessage(validate.errors) })
    return { status: 'incomplete', data, schemaSha256, evidence, issues, modelUsage: null }
  }
  if (modelConfig === null) {
    issues.push({ code: 'model_unavailable', message: 'model fallback requested but W2L extraction model is not configured' })
    for (const path of missing) issues.push({ code: 'missing_required', path, message: `required field unavailable: ${path}` })
    return { status: 'incomplete', data, schemaSha256, evidence, issues, modelUsage: null }
  }
  let attempts = 0
  let inputTokens = 0
  let outputTokens = 0
  let tokensKnown = true
  let repair: string | null = null
  while (attempts < 2) {
    attempts++
    try {
      const model = await callModel(result, format, data, execution, modelConfig, repair)
      if (model.inputTokens === null || model.outputTokens === null) tokensKnown = false
      else {
        inputTokens += model.inputTokens
        outputTokens += model.outputTokens
      }
      const merged = mergeObjects(data, model.value)
      if (validate(merged)) {
        data = merged
        const deterministicPaths = new Set(evidence.map(item => item.path))
        if (model.value !== null && typeof model.value === 'object' && !Array.isArray(model.value)) {
          for (const key of Object.keys(model.value)) {
            const path = `/${key}`
            if (!deterministicPaths.has(path)) evidence.push({ path, source: 'model' })
          }
        }
        const modelUsage: StructuredModelUsage = { model: modelConfig.model, attempts, inputTokens: tokensKnown ? inputTokens : null, outputTokens: tokensKnown ? outputTokens : null, externalCostUsd: null }
        return { status: 'complete', data, schemaSha256, evidence, issues: [], modelUsage }
      }
      repair = validationMessage(validate.errors)
      if (attempts === 2) {
        const modelUsage: StructuredModelUsage = { model: modelConfig.model, attempts, inputTokens: tokensKnown ? inputTokens : null, outputTokens: tokensKnown ? outputTokens : null, externalCostUsd: null }
        return { status: 'invalid', data, schemaSha256, evidence, issues: [{ code: 'model_output_invalid', message: repair }], modelUsage }
      }
    } catch (error) {
      const aborted = execution.signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError') || (error instanceof Error && error.name === 'TimeoutError')
      const modelUsage: StructuredModelUsage = { model: modelConfig.model, attempts, inputTokens: tokensKnown ? inputTokens : null, outputTokens: tokensKnown ? outputTokens : null, externalCostUsd: null }
      return {
        status: 'incomplete',
        data,
        schemaSha256,
        evidence,
        issues: [{ code: aborted ? 'model_timeout' : 'model_provider_error', message: aborted ? 'model extraction was cancelled or exceeded the deadline' : error instanceof Error ? error.message : 'model provider failed' }],
        modelUsage,
      }
    }
  }
  missing = requiredMissing(format.schema, format.schema, data)
  return {
    status: 'incomplete',
    data,
    schemaSha256,
    evidence,
    issues: missing.map(path => ({ code: 'missing_required', path, message: `required field unavailable: ${path}` })),
    modelUsage: null,
  }
}

function requestedFormats(req: ScrapeRequest, result?: ScrapeResponse): readonly ScrapeFormat[] {
  if (req.formats !== undefined) return req.formats
  // MCP marks its compact request with debug=false. Keep REST/SDK legacy
  // defaults, while returning adapter JSON (including incomplete identity
  // failures) on the simple MCP path.
  if (req.debug === false) {
    return result?.document?.adapter.id !== undefined && result.document.adapter.id !== 'generic'
      ? ['json'] : ['markdown']
  }
  return ['markdown', 'links']
}

function hasFormat(formats: readonly ScrapeFormat[], name: 'markdown' | 'links' | 'json'): boolean {
  return formats.some(format => typeof format === 'string' ? format === name : name === 'json')
}

function customJsonFormat(formats: readonly ScrapeFormat[]): JsonFormatRequest | undefined {
  return formats.find((format): format is JsonFormatRequest => typeof format === 'object')
}

function withoutRepeatedBodies(summary: ScrapeResponse['summary']): ScrapeResponse['summary'] {
  return {
    ...summary,
    attempts: summary.attempts.map(attempt => ({
      ...attempt,
      result: { ...attempt.result, markdown: null, links: [] },
    })),
  }
}

export async function prepareScrapeResponse(
  result: ScrapeResponse,
  req: ScrapeRequest,
  execution: ExecutionContext,
  modelConfig: StructuredModelConfig | null,
  overallStart: number,
): Promise<ScrapeResponse | CompactScrapeResponse> {
  const formats = requestedFormats(req, result)
  const modelStart = performance.now()
  const json = hasFormat(formats, 'json')
    ? await extractStructured(result, customJsonFormat(formats), execution, modelConfig ?? structuredModelConfigFromEnv())
    : undefined
  const modelMs = json?.modelUsage ? Math.max(0, performance.now() - modelStart) : 0
  const serializeStart = performance.now()
  const includeLinks = req.includeLinks === true || hasFormat(formats, 'links')
  const next: ScrapeResponse = {
    ...result,
    markdown: hasFormat(formats, 'markdown') ? result.markdown : null,
    links: includeLinks ? result.links ?? [] : [],
    ...(json === undefined ? {} : { json }),
    summary: req.debug === true ? result.summary : withoutRepeatedBodies(result.summary),
  }
  const serializeMs = Math.max(0, performance.now() - serializeStart)
  const totalMs = Math.max(0, performance.now() - overallStart)
  const withTiming: ScrapeResponse = {
    ...next,
    usage: {
      ...next.usage,
      wallMs: totalMs,
      ...(next.usage.timings ? { timings: { ...next.usage.timings, serializeMs, modelMs, totalMs } } : {}),
    },
    summary: { ...next.summary, totalMs },
  }
  if (req.debug !== false) return withTiming
  return compactScrapeResponse(withTiming, req, formats, totalMs)
}

export function compactScrapeResponse(
  next: ScrapeResponse,
  req: ScrapeRequest,
  formats: readonly ScrapeFormat[] = requestedFormats(req, next),
  totalMs = next.summary.totalMs ?? next.usage.wallMs,
): CompactScrapeResponse {
  const includeLinks = req.includeLinks === true || hasFormat(formats, 'links')
  return {
    requestedUrl: next.requestedUrl,
    finalUrl: next.evidence.finalUrl,
    snapshot: {
      rawBodySha256: next.evidence.rawBodySha256,
      artifacts: next.evidence.artifacts,
      httpStatus: next.evidence.httpStatus,
    },
    status: next.status,
    failureReason: next.failureReason,
    blockReason: next.blockReason,
    budgetExceeded: next.budgetExceeded,
    ...(next.retryAt === undefined ? {} : { retryAt: next.retryAt }),
    lane: next.lane,
    formats: [
      ...(hasFormat(formats, 'markdown') ? ['markdown' as const] : []),
      ...(includeLinks ? ['links' as const] : []),
      ...(hasFormat(formats, 'json') ? ['json' as const] : []),
    ],
    ...(hasFormat(formats, 'markdown') ? { markdown: next.markdown } : {}),
    ...(includeLinks ? { links: next.links ?? [] } : {}),
    ...(next.document === undefined ? {} : { document: next.document === null ? null : {
      title: next.document.title,
      pageType: next.document.pageType,
      strategy: next.document.strategy,
      confidence: next.document.confidence,
      adapter: next.document.adapter,
      ...(next.document.adapterValidation === undefined ? {} : { adapterValidation: next.document.adapterValidation }),
    } }),
    ...(hasFormat(formats, 'json') && next.json !== undefined ? { json: next.json } : {}),
    truncated: next.truncated,
    truncatedAt: next.truncatedAt,
    usage: { ...next.usage, totalMs },
    channelsTried: next.channelsTried,
  }
}
