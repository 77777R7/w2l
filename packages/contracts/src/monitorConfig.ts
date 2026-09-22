import { RequestError } from './api.js'
import type { MonitorRevision, DocumentMonitorConfig } from './monitor.js'

export function parseMonitorRevision(input: unknown): MonitorRevision {
  const fail = (): never => { throw new RequestError('invalid public document monitor configuration') }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail()
  const r = input as MonitorRevision
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(r.monitorId ?? '') || typeof r.url !== 'string' || typeof r.ruleVersion !== 'string' || !r.ruleVersion.trim()) return fail()
  let u: URL
  try { u = new URL(r.url) } catch { return fail() }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return fail()
  if (![r.revision,r.intervalMs,r.staleAfterMs].every((v) => Number.isSafeInteger(v) && v > 0) || !Number.isSafeInteger(r.createdAt) || r.createdAt < 0) return fail()
  const c = r.config
  if (!c || c.adapter !== 'markdown-sections/v1' || c.viewKey !== 'public' || typeof c.conditionalRequests !== 'boolean') return fail()
  const captureMode = c.captureMode ?? 'ladder'
  if (captureMode !== 'http' && captureMode !== 'ladder') return fail()
  if (c.conditionalRequests && captureMode !== 'http') throw new RequestError('conditionalRequests requires explicit captureMode: http; ladder capability is never disabled by caching')
  if (![c.workspaceId,c.entityKey,c.schemaVersion,c.expectedTitle].every((v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 256)) return fail()
  if (!Array.isArray(c.fields) || !c.fields.length || c.fields.length > 50) return fail()
  const names = new Set<string>()
  const fields = c.fields.map((f) => {
    if (!f || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(f.name) || ['__proto__','prototype','constructor'].includes(f.name) || names.has(f.name) || typeof f.heading !== 'string' || !f.heading.trim() || f.heading.length > 256 || !['text','code','decimal','boolean'].includes(f.type) || typeof f.required !== 'boolean') return fail()
    for (const v of [f.nullMarker,f.redactedMarker,f.unit,f.currency]) if (v !== undefined && (typeof v !== 'string' || !v.length || v.length > 256)) return fail()
    if (f.nullMarker !== undefined && f.nullMarker === f.redactedMarker) return fail()
    names.add(f.name)
    return { name: f.name, heading: f.heading, type: f.type, required: f.required, ...(f.nullMarker === undefined ? {} : {nullMarker:f.nullMarker}), ...(f.redactedMarker === undefined ? {} : {redactedMarker:f.redactedMarker}), ...(f.unit === undefined ? {} : {unit:f.unit}), ...(f.currency === undefined ? {} : {currency:f.currency}) }
  })
  const config: DocumentMonitorConfig = { adapter: c.adapter, workspaceId:c.workspaceId, entityKey:c.entityKey, viewKey:c.viewKey, expectedTitle:c.expectedTitle, schemaVersion:c.schemaVersion, conditionalRequests:c.conditionalRequests, captureMode, fields }
  return { monitorId:r.monitorId, revision:r.revision, url:u.href, ruleVersion:r.ruleVersion, intervalMs:r.intervalMs, staleAfterMs:r.staleAfterMs, createdAt:r.createdAt, config }
}

export function monitorIdentity(r: MonitorRevision) {
  const resource = new URL(r.url); resource.hash = ''
  return { resourceKey: resource.href, viewKey: r.config?.viewKey ?? 'public', workspaceId: r.config?.workspaceId ?? 'local', entityKey:r.config?.entityKey ?? r.url }
}
