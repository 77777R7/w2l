import type { Attempt, CrawlReport, Task } from '@w2l/contracts'
import type { TaskStore } from './taskStore.js'

export async function crawlReportFromStore(store: TaskStore, taskId: string): Promise<CrawlReport | null> {
  const task = await store.getTask(taskId)
  if (task === null) return null
  const attempts = await store.listAttempts(taskId)
  const latest = attempts[attempts.length - 1]
  if (latest === undefined) {
    return {
      taskId,
      attemptId: '',
      status: task.status,
      pagesFetched: 0,
      cachedPages: 0,
      budgetExceeded: null,
      loopDetected: false,
    }
  }
  return reportFromTaskAttempt(task, latest, await cachedCount(store, taskId, latest.id))
}

export function reportFromTaskAttempt(task: Task, attempt: Attempt, cachedPages: number): CrawlReport {
  return {
    taskId: task.id,
    attemptId: attempt.id,
    status: task.status,
    pagesFetched: attempt.pagesFetched,
    cachedPages,
    budgetExceeded: attempt.budgetExceeded,
    loopDetected: attempt.status === 'failed' && task.status === 'failed',
  }
}

async function cachedCount(store: TaskStore, taskId: string, attemptId: string): Promise<number> {
  const steps = await store.listSteps(taskId, attemptId)
  return steps.filter((step) => step.cached).length
}
