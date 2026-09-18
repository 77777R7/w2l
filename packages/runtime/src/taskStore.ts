/**
 * Persistence seam for crawl checkpoint (ADR 0003).
 *
 * Callers see Task / Attempt / StepRecord only. No SQL, no isolation
 * levels, no lastInsertRowid. Primary keys are caller-generated UUIDs.
 * A repeated put of the same id does not create a second row.
 */

import type { Attempt, StepRecord, Task } from '@w2l/contracts'

export interface TaskStore {
  putTask(task: Task): Promise<void>
  getTask(taskId: string): Promise<Task | null>
  listTasks(): Promise<readonly Task[]>
  putAttempt(attempt: Attempt): Promise<void>
  getAttempt(attemptId: string): Promise<Attempt | null>
  listAttempts(taskId: string): Promise<readonly Attempt[]>
  putStep(step: StepRecord): Promise<void>
  getStep(stepId: string): Promise<StepRecord | null>
  listSteps(taskId: string, attemptId?: string): Promise<readonly StepRecord[]>
  /**
   * Latest step for this canonical URL on the task (any attempt).
   * Resume uses this to decide refetch vs `--use-cached`.
   */
  getStepByCanonicalUrl(taskId: string, canonicalUrl: string): Promise<StepRecord | null>
  close(): Promise<void>
}

export function assertId(label: string, value: string): void {
  if (value.length === 0) {
    throw new Error(`${label} must be a non-empty caller-generated id`)
  }
}

export function cloneJson<T>(value: T): T {
  return structuredClone(value)
}
