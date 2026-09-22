import type { AdapterDescriptor, ExtractedEntity, EntityField, EntityFieldSource, EntityValue, ProductFacts } from '@w2l/contracts'
import { qs, qsa, textOf } from './dom.js'
import { amazonAsin, isAmazonProductPage } from './amazon.js'

export interface AdapterMatch { descriptor: AdapterDescriptor; entities: readonly ExtractedEntity[] }

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
  const postRecord = hydration.flatMap(root => findRecords(root, rec => {
    const id = stringValue(rec, 'id', 'postId', 'name')
    return id !== null && (postId === null || id.replace(/^t3_/, '') === postId) && stringValue(rec, 'title') !== null
  }))[0] ?? null
  const postEl = postId ? qs(doc, `shreddit-post[post-id="${postId}"], [data-testid="post-container"][data-post-id="${postId}"]`) : qs(doc, 'shreddit-post, [data-testid="post-container"]')
  if (postMatch) {
    const fields: Record<string, EntityField> = {}
    const fromHydration = (name: string, ...keys: string[]): void => { const value = postRecord ? stringValue(postRecord, ...keys) : null; if (value) fields[name] = field(value, 'hydration', `hydration:post/${keys[0]}`) }
    const fromDom = (name: string, selector: string): void => { if (fields[name] || !postEl) return; const el = qs(postEl, selector); const value = clean(el ? textOf(el) : null); if (value) fields[name] = field(value, 'dom', selector) }
    fromHydration('title', 'title'); fromHydration('body', 'selftext', 'body', 'content'); fromHydration('author', 'author', 'authorName'); fromHydration('score', 'score', 'ups'); fromHydration('commentCount', 'num_comments', 'commentCount'); fromHydration('createdAt', 'created_utc', 'createdAt')
    fromDom('title', 'h1, [slot="title"]'); fromDom('body', '[data-click-id="text"], [slot="text-body"]'); fromDom('author', '[data-testid="post_author_link"], [slot="authorName"]')
    const community = postMatch[1]!; fields.community = field(community, 'dom', 'document:url')
    entities.push({ type: 'post', id: postId, fields, relationships: { community } })
    entities.push({ type: 'thread', id: postId, fields: { ...(fields.title ? { title: fields.title } : {}) }, relationships: { rootPost: postId, comments: [] } })
  }
  const commentIds: string[] = []
  const addComment = (id: string, parentId: string | null, values: Record<string, string>, source: EntityFieldSource, pathPrefix: string): void => {
    if (commentIds.includes(id)) return; commentIds.push(id)
    const fields = Object.fromEntries(Object.entries(values).filter(([, value]) => clean(value) !== null).map(([key, value]) => [key, field(clean(value)!, source, `${pathPrefix}/${key}`)]))
    entities.push({ type: 'comment', id, fields, relationships: { parent: parentId, thread: postId } })
  }
  const commentRecords = hydration.flatMap(root => findRecords(root, rec => stringValue(rec, 'body', 'content') !== null && stringValue(rec, 'parent_id', 'parentId') !== null))
  for (const rec of commentRecords) {
    const id = stringValue(rec, 'id', 'commentId', 'name')?.replace(/^t1_/, ''); if (!id) continue
    addComment(id, stringValue(rec, 'parent_id', 'parentId')?.replace(/^t[13]_/, '') ?? null, { body: stringValue(rec, 'body', 'content') ?? '', author: stringValue(rec, 'author', 'authorName') ?? '', score: stringValue(rec, 'score', 'ups') ?? '', createdAt: stringValue(rec, 'created_utc', 'createdAt') ?? '' }, 'hydration', `hydration:comment/${id}`)
  }
  for (const el of qsa(doc, 'shreddit-comment, [data-testid="comment"]')) {
    const id = clean(el.getAttribute('comment-id') ?? el.getAttribute('thingid') ?? el.id)?.replace(/^t1_/, ''); if (!id) continue
    const body = clean(textOf(qs(el, '[slot="comment"], [data-testid="comment"] p, .md') ?? el)) ?? ''
    addComment(id, clean(el.getAttribute('parent-id') ?? el.getAttribute('parentid'))?.replace(/^t[13]_/, '') ?? null, { body, author: clean(el.getAttribute('author')) ?? '', score: clean(el.getAttribute('score')) ?? '', depth: clean(el.getAttribute('depth')) ?? '' }, 'dom', `shreddit-comment[comment-id="${id}"]`)
  }
  const thread = entities.find(entity => entity.type === 'thread'); if (thread) thread.relationships = { ...thread.relationships, comments: commentIds }
  if (!postMatch && communityMatch) { const name = communityMatch[1]!; entities.push({ type: 'community', id: name, fields: { name: field(name, 'dom', 'document:url') }, relationships: {} }) }
  if (profileMatch) { const name = profileMatch[1]!; entities.push({ type: 'profile', id: name, fields: { username: field(name, 'dom', 'document:url') }, relationships: {} }) }
  return entities
}

function xEntities(doc: Document, url: string | undefined): ExtractedEntity[] {
  const path = pathOf(url); const statusMatch = path.match(/^\/([^/]+)\/status\/(\d+)/); const profileMatch = path.match(/^\/([^/]+)\/?$/); const entities: ExtractedEntity[] = []; const hydration = parseHydration(doc)
  if (statusMatch) {
    const username = statusMatch[1]!; const statusId = statusMatch[2]!
    const tweet = hydration.flatMap(root => findRecords(root, rec => { const legacy = record(rec.legacy); const id = stringValue(rec, 'rest_id', 'id_str', 'id') ?? (legacy ? stringValue(legacy, 'id_str') : null); return id === statusId && (stringValue(rec, 'full_text', 'text') !== null || legacy !== null && stringValue(legacy, 'full_text', 'text') !== null) }))[0] ?? null
    const legacy = tweet ? record(tweet.legacy) : null
    const article = qsa(doc, 'article[data-testid="tweet"]').find(el => qs(el, `a[href*="/status/${statusId}"]`) !== null) ?? qs(doc, 'article[data-testid="tweet"]')
    const fields: Record<string, EntityField> = {}; const text = tweet ? stringValue(legacy ?? tweet, 'full_text', 'text') : null
    if (text) fields.text = field(text, 'hydration', `hydration:tweet/${statusId}/legacy/full_text`)
    if (!fields.text && article) { const value = clean(textOf(qs(article, '[data-testid="tweetText"]') ?? article)); if (value) fields.text = field(value, 'dom', '[data-testid="tweetText"]') }
    fields.author = field(username, 'dom', 'document:url'); const time = article ? qs(article, 'time') : null; const created = clean(time?.getAttribute('datetime')); if (created) fields.createdAt = field(created, 'dom', 'article time[datetime]'); fields.url = field(url ?? '', 'dom', 'document:url')
    entities.push({ type: 'post', id: statusId, fields, relationships: { author: username } }); entities.push({ type: 'thread', id: statusId, fields: {}, relationships: { rootPost: statusId } })
  } else if (profileMatch && !['home', 'explore', 'search', 'i'].includes(profileMatch[1]!.toLowerCase())) {
    const username = profileMatch[1]!; const fields: Record<string, EntityField> = { username: field(username, 'dom', 'document:url') }; const nameEl = qs(doc, '[data-testid="UserName"] span, h2[role="heading"]'); const bioEl = qs(doc, '[data-testid="UserDescription"]'); const name = clean(nameEl ? textOf(nameEl) : null); const bio = clean(bioEl ? textOf(bioEl) : null); if (name) fields.name = field(name, 'dom', '[data-testid="UserName"]'); if (bio) fields.bio = field(bio, 'dom', '[data-testid="UserDescription"]'); entities.push({ type: 'profile', id: username, fields, relationships: {} })
  }
  return entities
}

export function adapterFor(doc: Document, url: string | undefined, product: ProductFacts | null = null): AdapterMatch {
  const host = hostOf(url)
  if (isAmazonProductPage(doc, url) || amazonAsin(url) !== null) return { descriptor: AMAZON, entities: product ? [productEntity(product, url)] : [] }
  if (/(^|\.)reddit\.com$/.test(host)) return { descriptor: REDDIT, entities: redditEntities(doc, url) }
  if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(host)) return { descriptor: X, entities: xEntities(doc, url) }
  return { descriptor: GENERIC, entities: [] }
}

export const BUILT_IN_ADAPTERS: readonly AdapterDescriptor[] = [AMAZON, REDDIT, X, GENERIC]
