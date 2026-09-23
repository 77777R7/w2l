import type { NetworkPolicy } from '@w2l/contracts'
import { abortableSleep } from '@w2l/http-core'

interface Waiter {
  joinedAt: number
  signal?: AbortSignal
  resolve: (permit: OriginPermit) => void
  reject: (reason: unknown) => void
  abort: () => void
}

interface OriginState {
  active: number
  lastStartedAt: number
  lastRequestAtMono: number
  cooldownUntil: number
  waiters: Waiter[]
  timer?: ReturnType<typeof setTimeout>
}

export interface OriginPermit {
  queueMs: number
  cooldownWaitMs: number
  release(): void
}

/** A FIFO, bounded origin gate shared by the HTTP and local-browser lanes. */
export class OriginScheduler {
  private readonly origins = new Map<string, OriginState>()
  private readonly limit: number
  private readonly minDelayMs: number

  constructor(policy: NetworkPolicy) {
    if (!Number.isInteger(policy.perHostConcurrency) || policy.perHostConcurrency < 1) throw new Error('perHostConcurrency must be a positive integer')
    if (!Number.isFinite(policy.perHostMinDelayMs) || policy.perHostMinDelayMs < 0) throw new Error('perHostMinDelayMs must be nonnegative')
    // An operator can lower the ceiling; increasing it beyond four requires a
    // separate capacity review, rather than silently removing the origin gate.
    this.limit = Math.min(4, policy.perHostConcurrency)
    this.minDelayMs = policy.perHostMinDelayMs
  }

  cooldown(origin: string, retryAt: number): void {
    const state = this.state(origin)
    state.cooldownUntil = Math.max(state.cooldownUntil, retryAt)
    this.pump(origin, state)
  }

  retryAt(origin: string): number | undefined {
    const until = this.origins.get(origin)?.cooldownUntil ?? 0
    return until > Date.now() ? until : undefined
  }

  /** Pace the actual transport/navigation start, including retries. */
  async beforeRequest(origin: string, signal?: AbortSignal, onWait?: (intervalMs: number, cooldownMs: number) => void): Promise<void> {
    const state = this.state(origin)
    for (;;) {
      signal?.throwIfAborted()
      const intervalRemaining = Math.max(0, state.lastRequestAtMono + this.minDelayMs - performance.now())
      const cooldownRemaining = Math.max(0, state.cooldownUntil - Date.now())
      const wait = Math.max(intervalRemaining, cooldownRemaining)
      if (wait <= 0) {
        state.lastRequestAtMono = performance.now()
        return
      }
      const began = performance.now()
      try { await abortableSleep(Math.ceil(wait), signal) }
      finally {
        const actual = Math.max(0, performance.now() - began)
        if (cooldownRemaining >= intervalRemaining) onWait?.(0, actual)
        else onWait?.(actual, 0)
      }
    }
  }

  async acquire(origin: string, signal?: AbortSignal): Promise<OriginPermit> {
    if (signal?.aborted) throw signal.reason
    const state = this.state(origin)
    return new Promise<OriginPermit>((resolve, reject) => {
      const waiter: Waiter = {
        joinedAt: performance.now(), signal, resolve, reject,
        abort: () => {
          const index = state.waiters.indexOf(waiter)
          if (index >= 0) state.waiters.splice(index, 1)
          reject(signal?.reason ?? new DOMException('aborted', 'AbortError'))
          this.pump(origin, state)
        },
      }
      state.waiters.push(waiter)
      signal?.addEventListener('abort', waiter.abort, { once: true })
      this.pump(origin, state)
    })
  }

  private state(origin: string): OriginState {
    let state = this.origins.get(origin)
    if (!state) {
      state = { active: 0, lastStartedAt: -Infinity, lastRequestAtMono: -Infinity, cooldownUntil: 0, waiters: [] }
      this.origins.set(origin, state)
    }
    return state
  }

  private pump(origin: string, state: OriginState): void {
    if (state.timer) clearTimeout(state.timer)
    state.timer = undefined
    if (state.active >= this.limit || state.waiters.length === 0) return
    const now = Date.now()
    const readyAt = Math.max(state.cooldownUntil, state.lastStartedAt + this.minDelayMs)
    if (readyAt > now) {
      state.timer = setTimeout(() => this.pump(origin, state), readyAt - now)
      return
    }
    const waiter = state.waiters.shift()!
    waiter.signal?.removeEventListener('abort', waiter.abort)
    state.active++
    state.lastStartedAt = now
    const waited = Math.max(0, performance.now() - waiter.joinedAt)
    const cooldownWaitMs = Math.min(waited, Math.max(0, state.cooldownUntil - (now - waited)))
    let released = false
    waiter.resolve({
      queueMs: Math.max(0, waited - cooldownWaitMs),
      cooldownWaitMs,
      release: () => {
        if (released) return
        released = true
        state.active--
        this.pump(origin, state)
      },
    })
    this.pump(origin, state)
  }
}
