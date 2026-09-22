import type { MonitorEvent, MonitorSnapshot } from './monitor.js'

export interface DeliveryDestinationInput {
  id: string
  monitorId: string
  url: string
  maxAttempts?: number
  /** Operator environment reference; literal secrets are never stored or returned. */
  secretEnv?: string
  enabled?: boolean
}
export interface DeliveryDestination {
  id: string
  monitorId: string
  url: string
  maxAttempts: number
  secretEnv?: string
  enabled: boolean
  createdAt: number
}
/** eventVersion is the committed snapshot version, scoped to this monitor/entity/view. */
export interface WebhookEventEnvelope {
  schemaVersion: 'w2l.monitor-event/v1'
  eventId: string
  eventVersion: number
  monitorId: string
  workspaceId: string
  entityKey: string
  viewKey: string
  event: MonitorEvent
  snapshot: MonitorSnapshot
}
export type DeliveryState = 'pending' | 'delivering' | 'delivered' | 'dead_letter'
export interface WebhookDelivery {
  id: string
  destinationId: string
  monitorId: string
  eventId: string
  eventVersion: number
  state: DeliveryState
  attemptCount: number
  maxAttempts: number
  nextAttemptAt: number
  leaseUntil: number | null
  fencingToken: number
  createdAt: number
  deliveredAt: number | null
  lastStatus: number | null
  lastError: string | null
  payload: WebhookEventEnvelope
}
export interface DeliveryAttempt {
  id: string
  deliveryId: string
  fencingToken: number
  startedAt: number
  endedAt: number | null
  outcome: 'sending' | 'delivered' | 'retry' | 'dead_letter' | 'lease_expired'
  status: number | null
  error: string | null
  retryAfterAt: number | null
}
export interface DeliveryQuery {
  monitorId?: string
  destinationId?: string
  state?: DeliveryState
}
export interface DeliveryDetail {
  delivery: WebhookDelivery
  attempts: DeliveryAttempt[]
}
