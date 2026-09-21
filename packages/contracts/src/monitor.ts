import type { ScrapeOutcome } from './crawl.js'

/** Deliberately one public document adapter for the first B1/B2 slice. */
export const FIRECRAWL_INTRO_URL = 'https://docs.firecrawl.dev/introduction'
export const FIRECRAWL_MONITOR_ID = 'firecrawl-introduction'
export const DOCUMENT_RULE_VERSION = 'firecrawl-introduction/v1'

export interface DocumentFields {
  title: string
  introduction: string
  searchDescription: string
  scrapeDescription: string
  interactDescription: string
}
export type DocumentField = keyof DocumentFields
export interface FieldEvidence {
  field: DocumentField
  start: number
  end: number
  quote: string
}
export interface DocumentAssessment {
  ruleVersion: typeof DOCUMENT_RULE_VERSION
  quality: 'valid' | 'partial' | 'invalid' | 'unknown'
  reasons: string[]
  fields: DocumentFields | null
  evidence: FieldEvidence[]
}
export interface MonitorRevision {
  monitorId: string
  revision: number
  url: typeof FIRECRAWL_INTRO_URL
  ruleVersion: typeof DOCUMENT_RULE_VERSION
  intervalMs: number
  staleAfterMs: number
  createdAt: number
}
export type MonitorChange = 'initialized' | 'changed' | 'unchanged' | 'cannot_verify'
export interface DocumentDiff {
  field: DocumentField
  before: string
  after: string
}
export interface MonitorRun {
  id: string
  monitorId: string
  revision: number
  triggerKey: string
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  epoch: number
  fencingToken: number
  attemptId: string | null
  leaseUntil: number | null
  deadlineAt: number | null
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
  reason: 'source_changed' | 'initialized'
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
