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
