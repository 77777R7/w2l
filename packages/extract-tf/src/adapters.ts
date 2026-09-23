import type { AdapterDescriptor, AdapterValidation, ExtractedEntity, EntityField, EntityFieldSource, EntityValue, ProductFacts } from '@w2l/contracts'
import { qs, qsa, textOf } from './dom.js'
import { amazonAsin, isAmazonProductPage } from './amazon.js'

export interface PageAdapterContext { doc: Document; url: string | undefined; product: ProductFacts | null }
export interface PublicPageAdapter {
  descriptor: AdapterDescriptor
  matches(context: PageAdapterContext): boolean
  extract(context: PageAdapterContext): readonly ExtractedEntity[]
  validate(entities: readonly ExtractedEntity[], context: PageAdapterContext): AdapterValidation
  /** Optional public-page pagination discovery; absent means this adapter does not paginate yet. */
  nextPageUrls?(context: PageAdapterContext): readonly string[]
}
export interface AdapterMatch {
  descriptor: AdapterDescriptor
  entities: readonly ExtractedEntity[]
  validation: AdapterValidation
}

const GENERIC: AdapterDescriptor = { id: 'generic', version: '1.0.0', status: 'generic' }
const AMAZON: AdapterDescriptor = { id: 'amazon-product', version: '1.0.0', status: 'beta adapter' }
const REDDIT: AdapterDescriptor = { id: 'reddit-public', version: '1.0.0', status: 'beta adapter' }
const X: AdapterDescriptor = { id: 'x-public', version: '1.0.0', status: 'beta adapter' }

function clean(value: string | null | undefined): string | null {
  const next = (value ?? '').replace(/\s+/g, ' ').trim()
  return next.length > 0 ? next : null
}
function field<T extends EntityValue>(raw: T, source: EntityFieldSource, path: string, normalized = raw): EntityField<T> {
  return { raw, normalized, source, path, status: 'confirmed' }
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function sourceOf(source: string | undefined): EntityFieldSource {
  return source === 'jsonld' || source === 'microdata' || source === 'meta' ? source : 'dom'
}
function productEntity(product: ProductFacts, url: string | undefined): ExtractedEntity {
  const fields: Record<string, EntityField> = {}
  const put = (name: string, fact: { value: string; source: string; path?: string } | null | undefined): void => {
    if (fact) fields[name] = field(fact.value, sourceOf(fact.source), fact.path ?? 'document')
  }
  put('asin', product.subjectId ?? product.sku); put('title', product.name); put('brand', product.brand)
  put('price', product.price); put('currency', product.priceCurrency); put('seller', product.seller)
  put('availability', product.availability); put('deliveryLocation', product.deliveryLocation)
  put('rating', product.rating); put('reviewCount', product.reviewCount)
  fields.kind = field(product.kind ?? 'unknown', 'dom', 'adapter:amazon-product')
  if (product.prices?.length) fields.offers = field(product.prices.map(item => ({ amount: item.amount.value, currency: item.currency?.value ?? null, priceType: item.priceType, seller: item.seller?.value ?? null })), sourceOf(product.prices[0]?.amount.source), product.prices[0]?.amount.path ?? 'document')
  if (product.images?.length) fields.images = field(product.images.map(item => item.value), sourceOf(product.images[0]?.source), product.images[0]?.path ?? 'document')
  if (product.variants?.length) fields.variants = field(product.variants.map(item => ({ name: item.name, value: item.value, selected: item.selected })), sourceOf(product.variants[0]?.source), product.variants[0]?.path ?? 'document')
  if (product.specifications && Object.keys(product.specifications).length > 0) fields.specifications = field(Object.fromEntries(Object.entries(product.specifications).map(([key, fact]) => [key, fact.value])), 'dom', '#productDetails')
  if (url) fields.url = field(url, 'dom', 'document:url')
  return { type: 'product', id: product.subjectId?.value ?? product.sku?.value ?? null, fields, relationships: {} }
}
function hostOf(url: string | undefined): string { try { return url ? new URL(url).hostname.toLowerCase() : '' } catch { return '' } }
function pathOf(url: string | undefined): string { try { return url ? new URL(url).pathname : '' } catch { return '' } }
function parseHydration(doc: Document): unknown[] {
  const out: unknown[] = []
  for (const script of qsa(doc, 'script[type="application/json"], script#__NEXT_DATA__, script[data-testid="hydration"]')) {
    try { out.push(JSON.parse(script.textContent ?? '')) } catch { /* ignore malformed publisher data */ }
  }
  return out
}
function findRecords(root: unknown, predicate: (value: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []; const seen = new Set<unknown>()
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) return void value.forEach(visit)
    const rec = value as Record<string, unknown>; if (predicate(rec)) out.push(rec); Object.values(rec).forEach(visit)
  }
  visit(root); return out
}
function stringValue(rec: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) { const value = rec[key]; if (typeof value === 'string' || typeof value === 'number') return clean(String(value)) }
  return null
}

function redditEntities(doc: Document, url: string | undefined): ExtractedEntity[] {
  const path = pathOf(url); const postMatch = path.match(/^\/r\/([^/]+)\/comments\/([a-z0-9]+)/i)
  const profileMatch = path.match(/^\/(?:user|u)\/([^/]+)/i); const communityMatch = path.match(/^\/r\/([^/]+)/i)
  const entities: ExtractedEntity[] = []; const hydration = parseHydration(doc); const postId = postMatch?.[2] ?? null
  const postRecord = postId === null ? null : hydration.flatMap(root => findRecords(root, rec => {
    const id = stringValue(rec, 'id', 'postId', 'name')
    return id !== null && id.replace(/^t3_/, '') === postId && stringValue(rec, 'title') !== null
  }))[0] ?? null
  const postEl = postId ? qs(doc, `shreddit-post[post-id="${postId}"], [data-testid="post-container"][data-post-id="${postId}"]`) : null
  if (postMatch && (postRecord !== null || postEl !== null)) {
    const fields: Record<string, EntityField> = {}
    const fromHydration = (name: string, ...keys: string[]): void => { const value = postRecord ? stringValue(postRecord, ...keys) : null; if (value) fields[name] = field(value, 'hydration', `hydration:post/${keys[0]}`) }
    const fromDom = (name: string, selector: string): void => { if (fields[name] || !postEl) return; const el = qs(postEl, selector); const value = clean(el ? textOf(el) : null); if (value) fields[name] = field(value, 'dom', selector) }
    fromHydration('title', 'title'); fromHydration('body', 'selftext', 'body', 'content'); fromHydration('author', 'author', 'authorName'); fromHydration('score', 'score', 'ups'); fromHydration('commentCount', 'num_comments', 'commentCount'); fromHydration('createdAt', 'created_utc', 'createdAt')
    fromDom('title', 'h1, [slot="title"]'); fromDom('body', '[data-click-id="text"], [slot="text-body"]'); fromDom('author', '[data-testid="post_author_link"], [slot="authorName"]')
    const community = postMatch[1]!; fields.community = field(community, 'dom', 'document:url')
    entities.push({ type: 'post', id: postId, fields, relationships: { community } })
    entities.push({ type: 'thread', id: postId, fields: { ...(fields.title ? { title: fields.title } : {}) }, relationships: { rootPost: postId, comments: [] } })
  }
  type CommentCandidate = { id: string; parent: string | null; values: Record<string, string>; source: EntityFieldSource; path: string }
  const candidates = new Map<string, CommentCandidate>()
  const addCandidate = (candidate: CommentCandidate): void => {
    if (!candidates.has(candidate.id)) candidates.set(candidate.id, candidate)
  }
  const commentRecords = hydration.flatMap(root => findRecords(root, rec => stringValue(rec, 'body', 'content') !== null && stringValue(rec, 'parent_id', 'parentId') !== null))
  for (const rec of commentRecords) {
    const id = stringValue(rec, 'id', 'commentId', 'name')?.replace(/^t1_/, ''); if (!id) continue
    addCandidate({ id, parent: stringValue(rec, 'parent_id', 'parentId'), values: { body: stringValue(rec, 'body', 'content') ?? '', author: stringValue(rec, 'author', 'authorName') ?? '', score: stringValue(rec, 'score', 'ups') ?? '', createdAt: stringValue(rec, 'created_utc', 'createdAt') ?? '' }, source: 'hydration', path: `hydration:comment/${id}` })
  }
  for (const el of qsa(doc, 'shreddit-comment, [data-testid="comment"]')) {
    const id = clean(el.getAttribute('comment-id') ?? el.getAttribute('thingid') ?? el.id)?.replace(/^t1_/, ''); if (!id) continue
    const body = clean(textOf(qs(el, '[slot="comment"], [data-testid="comment"] p, .md') ?? el)) ?? ''
    addCandidate({ id, parent: clean(el.getAttribute('parent-id') ?? el.getAttribute('parentid')), values: { body, author: clean(el.getAttribute('author')) ?? '', score: clean(el.getAttribute('score')) ?? '', depth: clean(el.getAttribute('depth')) ?? '' }, source: 'dom', path: `shreddit-comment[comment-id="${id}"]` })
  }
  const rooted = (id: string, seen = new Set<string>()): boolean => {
    if (postId === null || seen.has(id)) return false
    const candidate = candidates.get(id)
    if (!candidate?.parent) return false
    const parent = candidate.parent
    if (parent === `t3_${postId}` || parent === postId) return true
    if (parent.startsWith('t3_')) return false
    seen.add(id)
    return rooted(parent.replace(/^t1_/, ''), seen)
  }
  const commentIds: string[] = []
  if (entities.some(entity => entity.type === 'post')) for (const candidate of candidates.values()) {
    if (!rooted(candidate.id)) continue
    commentIds.push(candidate.id)
    const fields = Object.fromEntries(Object.entries(candidate.values).filter(([, value]) => clean(value) !== null).map(([key, value]) => [key, field(clean(value)!, candidate.source, `${candidate.path}/${key}`)]))
    entities.push({ type: 'comment', id: candidate.id, fields, relationships: { parent: candidate.parent?.replace(/^t[13]_/, '') ?? null, thread: postId } })
  }
  const thread = entities.find(entity => entity.type === 'thread'); if (thread) thread.relationships = { ...thread.relationships, comments: commentIds }
  if (!postMatch && communityMatch) { const name = communityMatch[1]!; if (clean(textOf(qs(doc, 'h1') ?? doc.body))?.replace(/\W/g, '').toLowerCase().includes(name.replace(/\W/g, '').toLowerCase())) entities.push({ type: 'community', id: name, fields: { name: field(name, 'dom', 'h1') }, relationships: {} }) }
  if (profileMatch) { const name = profileMatch[1]!; if (clean(textOf(qs(doc, 'h1') ?? doc.body))?.toLowerCase().includes(name.toLowerCase())) entities.push({ type: 'profile', id: name, fields: { username: field(name, 'dom', 'h1') }, relationships: {} }) }
  return entities
}

function xEntities(doc: Document, url: string | undefined): ExtractedEntity[] {
  const path = pathOf(url); const statusMatch = path.match(/^\/([^/]+)\/status\/(\d+)/); const profileMatch = path.match(/^\/([^/]+)\/?$/); const entities: ExtractedEntity[] = []; const hydration = parseHydration(doc)
  if (statusMatch) {
    const username = statusMatch[1]!; const statusId = statusMatch[2]!
    const tweet = hydration.flatMap(root => findRecords(root, rec => { const legacy = record(rec.legacy); const id = stringValue(rec, 'rest_id', 'id_str', 'id') ?? (legacy ? stringValue(legacy, 'id_str') : null); return id === statusId && (stringValue(rec, 'full_text', 'text') !== null || legacy !== null && stringValue(legacy, 'full_text', 'text') !== null) }))[0] ?? null
    const legacy = tweet ? record(tweet.legacy) : null
    const article = qsa(doc, 'article[data-testid="tweet"]').find(el =>
      qsa(el, 'a[href]').some(link => {
        try { return new URL(link.getAttribute('href') ?? '', url).pathname === `/${username}/status/${statusId}` } catch { return false }
      })) ?? null
    if (tweet === null && article === null) return entities
    const fields: Record<string, EntityField> = {}; const text = tweet ? stringValue(legacy ?? tweet, 'full_text', 'text') : null
    if (text) fields.text = field(text, 'hydration', `hydration:tweet/${statusId}/legacy/full_text`)
    if (!fields.text && article) { const value = clean(textOf(qs(article, '[data-testid="tweetText"]') ?? article)); if (value) fields.text = field(value, 'dom', '[data-testid="tweetText"]') }
    fields.author = field(username, 'dom', 'document:url'); const time = article ? qs(article, 'time') : null; const created = clean(time?.getAttribute('datetime')); if (created) fields.createdAt = field(created, 'dom', 'article time[datetime]'); fields.url = field(url ?? '', 'dom', 'document:url')
    if (fields.text) {
      entities.push({ type: 'post', id: statusId, fields, relationships: { author: username } })
      entities.push({ type: 'thread', id: statusId, fields: {}, relationships: { rootPost: statusId } })
    }
  } else if (profileMatch && !['home', 'explore', 'search', 'i'].includes(profileMatch[1]!.toLowerCase())) {
    const username = profileMatch[1]!; const fields: Record<string, EntityField> = {}; const nameEl = qs(doc, '[data-testid="UserName"] span, h2[role="heading"]'); const bioEl = qs(doc, '[data-testid="UserDescription"]'); const name = clean(nameEl ? textOf(nameEl) : null); const bio = clean(bioEl ? textOf(bioEl) : null); if (name) fields.name = field(name, 'dom', '[data-testid="UserName"]'); if (bio) fields.bio = field(bio, 'dom', '[data-testid="UserDescription"]'); if (name?.toLowerCase().includes(username.toLowerCase()) || bio !== null && qs(doc, `a[href="/${username}"]`)) { fields.username = field(username, 'dom', '[data-testid="UserName"]'); entities.push({ type: 'profile', id: username, fields, relationships: {} }) }
  }
  return entities
}

function validateEntities(entities: readonly ExtractedEntity[], requiredTypes: readonly ExtractedEntity['type'][] = []): AdapterValidation {
  const issues: string[] = []
  for (const type of requiredTypes) if (!entities.some(entity => entity.type === type)) issues.push(`missing_${type}`)
  for (const [entityIndex, entity] of entities.entries()) {
    if (entity.id === '') issues.push(`entity_${entityIndex}_empty_id`)
    for (const [name, value] of Object.entries(entity.fields)) {
      if (value.path.trim().length === 0) issues.push(`entity_${entityIndex}_${name}_missing_path`)
      if (!['jsonld', 'microdata', 'meta', 'hydration', 'dom'].includes(value.source)) issues.push(`entity_${entityIndex}_${name}_invalid_source`)
    }
  }
  return { valid: issues.length === 0, issues }
}

const AMAZON_ADAPTER: PublicPageAdapter = {
  descriptor: AMAZON,
  matches: ({ doc, url }) => isAmazonProductPage(doc, url) || amazonAsin(url) !== null,
  extract: ({ product, url }) => product ? [productEntity(product, url)] : [],
  validate: (entities, { doc, url, product }) => {
    const base = validateEntities(entities, ['product'])
    const issues = [...base.issues]
    const expected = amazonAsin(url)
    const observedInput = clean(qs(doc, 'input[name="ASIN"], #ASIN')?.getAttribute('value') ?? qs(doc, 'input[name="ASIN"], #ASIN')?.textContent)?.toUpperCase() ?? null
    const canonical = clean(qs(doc, 'link[rel="canonical"]')?.getAttribute('href'))
    const observedCanonical = canonical?.match(/\/(?:dp|clp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]?.toUpperCase() ?? null
    if (!observedInput && !observedCanonical) issues.push('subject_id_unverified')
    // Amazon can canonicalize a selected child variant to a parent listing.
    // The page's own selected ASIN is stronger subject evidence than that
    // canonical URL. A conflicting selected ASIN still invalidates the page.
    if (expected && (observedInput !== null ? observedInput !== expected : observedCanonical !== null && observedCanonical !== expected)) issues.push('asin_mismatch')
    if (!product?.name || product.name.path === 'document:url') issues.push('subject_title_unverified')
    if (entities[0]?.id !== expected) issues.push('subject_id_mismatch')
    return { valid: issues.length === 0, issues }
  },
}
const REDDIT_ADAPTER: PublicPageAdapter = {
  descriptor: REDDIT,
  matches: ({ url }) => /(^|\.)reddit\.com$/.test(hostOf(url)),
  extract: ({ doc, url }) => redditEntities(doc, url),
  validate: (entities, { url }) => {
    const path = pathOf(url)
    const required = /^\/r\/[^/]+\/comments\//i.test(path) ? ['post', 'thread'] as const
      : /^\/(?:user|u)\//i.test(path) ? ['profile'] as const
        : /^\/r\//i.test(path) ? ['community'] as const : []
    return validateEntities(entities, required)
  },
}
const X_ADAPTER: PublicPageAdapter = {
  descriptor: X,
  matches: ({ url }) => ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(hostOf(url)),
  extract: ({ doc, url }) => xEntities(doc, url),
  validate: (entities, { url }) => validateEntities(entities, /\/status\/\d+/.test(pathOf(url)) ? ['post', 'thread'] : ['profile']),
}
const GENERIC_ADAPTER: PublicPageAdapter = {
  descriptor: GENERIC,
  matches: () => true,
  extract: () => [],
  validate: (entities) => validateEntities(entities),
}

/** Ordered registry: the generic adapter is deliberately the final fallback. */
export const BUILT_IN_PAGE_ADAPTERS: readonly PublicPageAdapter[] = [AMAZON_ADAPTER, REDDIT_ADAPTER, X_ADAPTER, GENERIC_ADAPTER]
export const BUILT_IN_ADAPTERS: readonly AdapterDescriptor[] = BUILT_IN_PAGE_ADAPTERS.map(adapter => adapter.descriptor)

export function adapterFor(doc: Document, url: string | undefined, product: ProductFacts | null = null): AdapterMatch {
  const context: PageAdapterContext = { doc, url, product }
  const adapter = BUILT_IN_PAGE_ADAPTERS.find(candidate => candidate.matches(context)) ?? GENERIC_ADAPTER
  const entities = adapter.extract(context)
  return { descriptor: adapter.descriptor, entities, validation: adapter.validate(entities, context) }
}
