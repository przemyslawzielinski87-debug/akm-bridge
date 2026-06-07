import { randomUUID } from 'node:crypto'
import type { TaskStore, Task } from './task-store.js'
import type { OpenCodeExecutionAdapter } from './opencode-execution-adapter.js'
import type { ApprovalManager } from './approval-manager.js'
import type { SSEManager } from './sse-manager.js'

// ── Types ───────────────────────────────────────────────────────────────────

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

// ── Incident Check ──────────────────────────────────────────────────────────

let incidentActive = false

export function setIncidentActive(active: boolean): void {
  incidentActive = active
}

// ── Worker ──────────────────────────────────────────────────────────────────

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

  // ── Recovery ────────────────────────────────────────────────────────

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

  // ── Polling ────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (this.stopping) return
    if (this.running.size >= this.concurrency) return
    if (incidentActive) return

    const task = this.store.nextQueuedTask()
    if (!task) return

    await this.executeTask(task)
  }

  // ── Execution ──────────────────────────────────────────────────────

  private async executeTask(task: Task): Promise<void> {
    const projectLock = task.project_lock ?? task.project

    // Per-project lock: only one write task per project
    if (task.command !== 'read' && this.projectLocks.has(projectLock)) {
      return
    }

    this.projectLocks.set(projectLock, task.id)

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
    })

    this.store.addEvent(task.id, 'task_started', `Execution started with agent ${task.agent ?? 'default'}`)

    try {
      // Pre-check: approval required?
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

      const timeout = this.getEffectiveTimeout(task)
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
      this.projectLocks.delete(projectLock)
    }
  }

  private getEffectiveTimeout(task: Task): number {
    if (task.priority === 'urgent') return this.defaultTimeoutMs * 2
    if (task.priority === 'low') return this.defaultTimeoutMs / 2
    return this.defaultTimeoutMs
  }
}
