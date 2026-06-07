import { randomUUID } from 'node:crypto'
import type { TaskStore, Task } from './task-store.js'
import type { OpenCodeExecutionAdapter } from './opencode-execution-adapter.js'
import type { ApprovalManager } from './approval-manager.js'
import type { SSEManager } from './sse-manager.js'
import { projectRegistry } from '../projects/project-registry.js'
import { checkBudget, recordUsage } from '../projects/project-budgets.js'
import { acquireLock, releaseLock, clearExpiredLocks } from '../projects/project-locks.js'

export interface WorkerOptions {
  concurrency?: number
  pollIntervalMs?: number
  defaultTimeoutMs?: number
}

export interface WorkerStatus {
  running: number
  queued: number
  activeTaskIds: string[]
}

let incidentActive = false

export function setIncidentActive(active: boolean): void {
  incidentActive = active
}

export class TaskWorker {
  private store: TaskStore
  private adapter: OpenCodeExecutionAdapter
  private approvalManager: ApprovalManager
  private sse: SSEManager
  private concurrency: number
  private pollIntervalMs: number
  private defaultTimeoutMs: number
  private running = new Map<string, AbortController>()
  private projectLocks = new Map<string, string>()
  private environmentLocks = new Map<string, string>()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private stopping = false

  constructor(
    store: TaskStore,
    adapter: OpenCodeExecutionAdapter,
    approvalManager: ApprovalManager,
    sse: SSEManager,
    opts: WorkerOptions = {}
  ) {
    this.store = store
    this.adapter = adapter
    this.approvalManager = approvalManager
    this.sse = sse
    this.concurrency = opts.concurrency ?? 1
    this.pollIntervalMs = opts.pollIntervalMs ?? 2_000
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 300_000
  }

  start(): void {
    this.stopping = false
    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs)
    this.recoverInterrupted()
  }

  stop(): void {
    this.stopping = true
    if (this.pollTimer) clearInterval(this.pollTimer)
  }

  async cancel(taskId: string): Promise<boolean> {
    const controller = this.running.get(taskId)
    if (!controller) return false
    controller.abort()
    this.running.delete(taskId)

    this.store.updateTask(taskId, {
      status: 'cancelled',
      finished_at: new Date().toISOString(),
    })
    this.store.addEvent(taskId, 'task_cancelled', 'Task cancelled by user')
    this.sse.send(taskId, { type: 'task_cancelled', taskId })
    return true
  }

  status(): WorkerStatus {
    return {
      running: this.running.size,
      queued: this.store.listTasks({ status: 'queued', limit: 1000 }).length,
      activeTaskIds: [...this.running.keys()],
    }
  }

  private recoverInterrupted(): void {
    const running = this.store.listTasks({ status: 'running', limit: 100 })
    for (const task of running) {
      this.store.updateTask(task.id, {
        status: 'queued',
        error: 'Interrupted by worker restart',
      })
      this.store.addEvent(task.id, 'task_recovered', 'Task re-queued after worker restart')
    }
  }

  private async poll(): Promise<void> {
    if (this.stopping) return
    if (this.running.size >= this.concurrency) return
    if (incidentActive) return

    const task = this.store.nextQueuedTask()
    if (!task) return

    await this.executeTask(task)
  }

  private async executeTask(task: Task): Promise<void> {
    const profile = projectRegistry.getProfile(task.project_id ?? task.project)
    const profileConcurrency = profile?.concurrency.maxWriteTasks ?? 1
    const environment = task.environment ?? 'local'
    const isWrite = task.command !== 'read'

    clearExpiredLocks()

    if (isWrite) {
      const envLockKey = `${task.project_lock ?? task.project}:${environment}`
      if (this.projectLocks.has(task.project_lock ?? task.project)) {
        return
      }
      if (this.environmentLocks.has(envLockKey)) {
        return
      }
      if (this.running.size >= profileConcurrency) {
        return
      }

      const lockResult = acquireLock(
        profile ?? { id: 'unclassified' } as any,
        environment as any,
        task.id,
        'write',
        600_000
      )
      if (!lockResult.acquired) {
        return
      }

      this.projectLocks.set(task.project_lock ?? task.project, task.id)
      this.environmentLocks.set(envLockKey, task.id)
    }

    const budgetCheck = profile ? checkBudget(profile, 1000, 4000, isWrite) : { allowed: true }
    if (!budgetCheck.allowed) {
      this.store.updateTask(task.id, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: budgetCheck.reason ?? 'Budget exceeded',
      })
      return
    }

    const controller = new AbortController()
    this.running.set(task.id, controller)

    this.store.updateTask(task.id, {
      status: 'running',
      started_at: new Date().toISOString(),
    })

    this.sse.send(task.id, {
      type: 'task_started',
      taskId: task.id,
      agent: task.agent,
      environment,
    })

    this.store.addEvent(task.id, 'task_started', `Execution started with agent ${task.agent ?? 'default'} in ${environment}`)

    try {
      const needsApproval = this.approvalManager.needsApproval(task)
      if (needsApproval) {
        const approval = this.approvalManager.createApprovalForTask(task)
        this.sse.send(task.id, {
          type: 'permission_requested',
          taskId: task.id,
          approvalId: approval.id,
          tool: approval.tool,
          summary: approval.safe_summary,
        })

        const decision = await this.approvalManager.waitForDecision(approval.id, 600_000, controller.signal)

        if (decision !== 'approved') {
          this.store.updateTask(task.id, {
            status: 'cancelled',
            finished_at: new Date().toISOString(),
            error: `Approval ${decision}`,
          })
          this.store.addEvent(task.id, 'task_cancelled', `Approval ${decision}`)
          this.sse.send(task.id, { type: 'task_cancelled', taskId: task.id })
          return
        }
      }

      const timeout = this.getEffectiveTimeout(task, profile)
      const result = await this.adapter.execute({
        prompt: task.full_prompt ?? task.prompt_summary,
        sessionId: task.session_id ?? undefined,
        project: task.project,
        timeoutMs: timeout,
        cancellationSignal: controller.signal,
      })

      this.store.updateTask(task.id, {
        status: result.status === 'cancelled' ? 'cancelled' : result.status === 'failed' ? 'failed' : 'completed',
        session_id: result.sessionId,
        finished_at: new Date().toISOString(),
        token_input: result.tokenUsage.input,
        token_output: result.tokenUsage.output,
        token_cached: result.tokenUsage.cached,
        result_summary: result.summary,
        error: result.error ?? null,
      })

      this.store.addEvent(
        task.id,
        result.status === 'completed' ? 'task_completed' : 'task_failed',
        result.summary
      )

      this.sse.send(task.id, {
        type: result.status === 'completed' ? 'task_completed' : 'task_failed',
        taskId: task.id,
        summary: result.summary,
        tokenUsage: result.tokenUsage,
      })

      if (result.permissionRequests.length > 0) {
        this.store.addEvent(
          task.id,
          'permission_requests',
          `${result.permissionRequests.length} permission request(s) during execution`
        )
      }

      if (profile) {
        recordUsage(profile, isWrite ? 'write' : 'read', result.tokenUsage.input + result.tokenUsage.output)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.store.updateTask(task.id, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: msg,
      })
      this.store.addEvent(task.id, 'task_failed', msg)
      this.sse.send(task.id, { type: 'task_failed', taskId: task.id, error: msg })
    } finally {
      this.running.delete(task.id)
      this.projectLocks.delete(task.project_lock ?? task.project)
      if (environment) {
        this.environmentLocks.delete(`${task.project_lock ?? task.project}:${environment}`)
      }
      releaseLock(task.project_lock ?? task.project)
    }
  }

  private getEffectiveTimeout(task: Task, profile?: any): number {
    if (profile?.budgets?.maxDurationPerTaskMs) {
      return profile.budgets.maxDurationPerTaskMs
    }
    if (task.priority === 'urgent') return this.defaultTimeoutMs * 2
    if (task.priority === 'low') return this.defaultTimeoutMs / 2
    return this.defaultTimeoutMs
  }
}