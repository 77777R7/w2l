export const SESSION_STATE = ['active', 'waiting_user', 'revoked', 'expired'] as const
export type SessionState = (typeof SESSION_STATE)[number]

export interface ManagedSessionRef {
  sessionRef: string
  workspaceId: string
  accountRef: string
  originScope: string
  profileId: string
  profileDir: string
  grantEpoch: number
  state: SessionState
  createdAt: string
  updatedAt: string
  revokedAt: string | null
  expiresAt: string | null
  handoff: SessionHandoff | null
  backend?: 'managed' | 'existing_chrome'
  /** Private registry only; never include in public status/logs. */
  cdpEndpoint?: string
}

export interface SessionHandoff {
  handoffId: string
  reason: string
  createdAt: string
  expiresAt: string
}

export interface SessionGrant {
  sessionRef: string
  workspaceId: string
  accountRef: string
  originScope: string
  grantEpoch: number
  expiresAt: string | null
}

export type SessionAccessResult =
  | { kind: 'granted'; grant: SessionGrant }
  | { kind: 'waiting_user'; sessionRef: string; reason: string }
  | { kind: 'revoked'; sessionRef: string; reason: string }
  | { kind: 'expired'; sessionRef: string; reason: string }
