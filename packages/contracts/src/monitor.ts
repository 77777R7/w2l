import type { ScrapeOutcome } from './crawl.js'

/** Deliberately one public document adapter for the first B1/B2 slice. */
export const FIRECRAWL_INTRO_URL = 'https://docs.firecrawl.dev/introduction'
export const FIRECRAWL_MONITOR_ID = 'firecrawl-introduction'
export const DOCUMENT_RULE_VERSION = 'firecrawl-introduction/v1'

export type FieldValue<T = string | boolean> =
  | { state: 'present'; value: T; evidenceRefs: string[] }
  | { state: 'explicit_null'; reason: string; evidenceRefs: string[] }
  | { state: 'unobserved'; reason: string }
  | { state: 'conflicting'; candidates: { value: T; evidenceRefs: string[] }[] }
  | { state: 'redacted'; reason: string }
export type DocumentFields = Record<string, string | FieldValue>
export interface MonitorFieldRule {
  name: string
  heading: string
  type: 'text' | 'code' | 'decimal' | 'boolean'
  required: boolean
  nullMarker?: string
  redactedMarker?: string
  /** Changes in field meaning are schema migrations, not price changes. */
  unit?: string
  currency?: string
}
export interface DocumentMonitorConfig {
  adapter: 'markdown-sections/v1'
  workspaceId: string
  entityKey: string
  viewKey: string
  expectedTitle: string
  schemaVersion: string
  fields: MonitorFieldRule[]
  conditionalRequests: boolean
  /** Acquisition capability is independent of transport caching. Defaults to ladder. */
  captureMode?: 'http' | 'ladder'
}
export type DocumentField = keyof DocumentFields
export interface FieldEvidence {
  field: DocumentField
  start: number
  end: number
  quote: string
}
export interface DocumentAssessment {
  ruleVersion: string
  quality: 'valid' | 'partial' | 'invalid' | 'unknown'
  reasons: string[]
  fields: DocumentFields | null
  evidence: FieldEvidence[]
}
export interface MonitorRevision {
  monitorId: string
  revision: number
  url: string
  ruleVersion: string
  config?: DocumentMonitorConfig
  intervalMs: number
  staleAfterMs: number
  createdAt: number
}
export type MonitorChange = 'initialized' | 'changed' | 'unchanged' | 'cannot_verify'
export interface DocumentDiff {
  field: DocumentField
  before: string | FieldValue | null
  after: string | FieldValue | null
}
export interface MonitorRun {
  id: string
  monitorId: string
  revision: number
  triggerKey: string
  state: 'queued' | 'running' | 'waiting_retry' | 'completed' | 'failed' | 'cancelled' | 'expired'
  epoch: number
  fencingToken: number
  attemptId: string | null
  leaseUntil: number | null
  deadlineAt: number | null
  nextAttemptAt?: number | null
  expectedBaselineId: string | null
  createdAt: number
  endedAt: number | null
  quality: DocumentAssessment['quality'] | null
  change: MonitorChange | null
  error: string | null
}
export interface MonitorAttempt {
  id: string
  runId: string
  fencingToken: number
  state: 'running' | 'succeeded' | 'failed' | 'interrupted' | 'cancelled'
  startedAt: number
  endedAt: number | null
  recoveredFromAttemptId: string | null
}
export interface MonitorObservation {
  id: string
  runId: string
  attemptId: string
  observedAt: number
  clientWallMs: number
  markdownSha256: string | null
  transport?: { etag: string | null; lastModified: string | null; representationKey: string; reusedFrom?: string; responseStatus?: number | null } | null
  outcome: ScrapeOutcome | null
  error: string | null
}
export interface MonitorSnapshot {
  id: string
  monitorId: string
  revision: number
  version: number
  observationId: string
  assessmentId: string
  fields: DocumentFields
  createdAt: number
}
export interface MonitorEvent {
  id: string
  runId: string
  monitorId: string
  kind: 'initialized' | 'changed'
  reason: 'source_changed' | 'initialized' | 'extraction_reprocessed' | 'schema_migrated'
  fromSnapshotId: string | null
  toSnapshotId: string
  changes: DocumentDiff[]
  observedAt: number
}
export interface MonitorView {
  revision: MonitorRevision
  enabled: boolean
  controlEpoch: number
  nextRunAt: number
  lastCheckedAt: number | null
  lastVerifiedAt: number | null
  freshness: 'fresh' | 'stale'
  baseline: MonitorSnapshot | null
  runs: MonitorRun[]
  events: MonitorEvent[]
  outbox: { eventId: string; state: 'pending' | 'acknowledged'; acknowledgedAt: number | null }[]
}

/** A bounded first-use sample. Preview never creates a run, baseline, or event. */
export interface MonitorPreview {
  url: string
  finalUrl: string | null
  status: string
  assessment: DocumentAssessment
  sampleMarkdown: string | null
  capturedAt: number
}

export interface MonitorRunDetail {
  run: MonitorRun
  assessment: DocumentAssessment | null
  observation: MonitorObservation | null
  attempts: MonitorAttempt[]
}

export interface TransportRepresentation {
  bodySha256?: string
  key: string
  url: string
  etag: string | null
  lastModified: string | null
  outcome: ScrapeOutcome
  storedAt: number
}
