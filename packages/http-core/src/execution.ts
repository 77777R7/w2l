/** One absolute wall-clock budget shared by every operation in an execution. */
export interface ExecutionBudget {
  signal?: AbortSignal
  deadlineAt?: number
  onRetryAfter?: (url: string, retryAt: number) => void
}

export function throwIfExecutionStopped(context: ExecutionBudget): void {
  context.signal?.throwIfAborted()
  if (context.deadlineAt !== undefined && Date.now() >= context.deadlineAt) {
    throw new DOMException('Execution deadline exceeded', 'TimeoutError')
  }
}

export function createExecutionScope(context: ExecutionBudget = {}): ExecutionBudget & { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController()
  const abort = () => controller.abort(context.signal?.reason ?? new DOMException('Execution aborted', 'AbortError'))
  context.signal?.addEventListener('abort', abort, { once: true })
  if (context.signal?.aborted) abort()
  let timer: ReturnType<typeof setTimeout> | undefined
  if (context.deadlineAt !== undefined) {
    const checkDeadline = () => {
      const remaining = context.deadlineAt! - Date.now()
      if (remaining <= 0) controller.abort(new DOMException('Execution deadline exceeded', 'TimeoutError'))
      else timer = setTimeout(checkDeadline, Math.min(remaining, 2_147_483_647))
    }
    checkDeadline()
  }
  return { ...context, signal: controller.signal, dispose() { if (timer !== undefined) clearTimeout(timer); context.signal?.removeEventListener('abort', abort) } }
}

export function raceWithSignal<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) { void operation.catch(() => {}); return Promise.reject(signal.reason) }
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}

/** Cancellation clears the timer rather than leaving a detached wait alive. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const until = Date.now() + Math.max(0, ms)
    let timer: ReturnType<typeof setTimeout>
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason) }
    const finish = () => {
      const remaining = until - Date.now()
      if (remaining > 0) { timer = setTimeout(finish, Math.min(remaining, 2_147_483_647)); return }
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    timer = setTimeout(finish, Math.min(Math.max(0, ms), 2_147_483_647))
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export function remainingTimeout(context: ExecutionBudget, capMs: number): number {
  throwIfExecutionStopped(context)
  return context.deadlineAt === undefined ? capMs : Math.max(1, Math.min(capMs, context.deadlineAt - Date.now()))
}
