import type { Attempt, StepRecord, Task } from '@w2l/contracts'
import { assertId, cloneJson, type TaskStore } from './taskStore.js'

/**
 * In-memory TaskStore for tests and the benchmark harness (ADR 0003).
 * Same semantics as the SQLite implementation; no disk.
 */
export class MemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, Task>()
  private readonly attempts = new Map<string, Attempt>()
  private readonly steps = new Map<string, StepRecord>()

  async putTask(task: Task): Promise<void> {
    assertId('task.id', task.id)
    this.tasks.set(task.id, cloneJson(task))
  }

  async getTask(taskId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId)
    return task === undefined ? null : cloneJson(task)
  }

  async listTasks(): Promise<readonly Task[]> {
    return [...this.tasks.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(cloneJson)
  }

  async putAttempt(attempt: Attempt): Promise<void> {
    assertId('attempt.id', attempt.id)
    assertId('attempt.taskId', attempt.taskId)
    if (!this.tasks.has(attempt.taskId)) {
      throw new Error(`putAttempt: unknown task ${attempt.taskId}`)
    }
    this.attempts.set(attempt.id, cloneJson(attempt))
  }

  async getAttempt(attemptId: string): Promise<Attempt | null> {
    const attempt = this.attempts.get(attemptId)
    return attempt === undefined ? null : cloneJson(attempt)
  }

  async listAttempts(taskId: string): Promise<readonly Attempt[]> {
    return [...this.attempts.values()]
      .filter((attempt) => attempt.taskId === taskId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
      .map(cloneJson)
  }

  async putStep(step: StepRecord): Promise<void> {
    assertId('step.id', step.id)
    assertId('step.taskId', step.taskId)
    assertId('step.attemptId', step.attemptId)
    const attempt = this.attempts.get(step.attemptId)
    if (attempt === undefined) {
      throw new Error(`putStep: unknown attempt ${step.attemptId}`)
    }
    if (attempt.taskId !== step.taskId) {
      throw new Error(`putStep: attempt ${step.attemptId} belongs to task ${attempt.taskId}, not ${step.taskId}`)
    }
    this.steps.set(step.id, cloneJson(step))
  }

  async getStep(stepId: string): Promise<StepRecord | null> {
    const step = this.steps.get(stepId)
    return step === undefined ? null : cloneJson(step)
  }

  async listSteps(taskId: string, attemptId?: string): Promise<readonly StepRecord[]> {
    return [...this.steps.values()]
      .filter((step) => step.taskId === taskId && (attemptId === undefined || step.attemptId === attemptId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(cloneJson)
  }

  async getStepByCanonicalUrl(taskId: string, canonicalUrl: string): Promise<StepRecord | null> {
    const matches = [...this.steps.values()]
      .filter((step) => step.taskId === taskId && step.canonicalUrl === canonicalUrl)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
    const latest = matches[0]
    return latest === undefined ? null : cloneJson(latest)
  }

  async close(): Promise<void> {
    this.tasks.clear()
    this.attempts.clear()
    this.steps.clear()
  }
}
