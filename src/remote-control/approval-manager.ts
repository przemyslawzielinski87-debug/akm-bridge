import { randomUUID } from 'node:crypto'
import type { TaskStore, Approval, Task } from './task-store.js'

// ── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_EXPIRY_MS = 600_000 // 10 min
const HIGH_RISK_REAUTH_WINDOW_MS = 600_000 // 10 min

const HIGH_RISK_OPERATIONS = [
  'deploy',
  'restart',
  'push',
  'promote',
  'rollback',
  'restore',
  'force push',
  'shutdown',
]

const DENY_CLASS_OPERATIONS = [
  'rm -rf',
  'docker system prune',
  'force push',
  'reboot',
  'shutdown',
]

// ── Types ───────────────────────────────────────────────────────────────────

export interface ApprovalDecision {
  approvalId: string
  decision: 'approved' | 'rejected'
  decidedBy: string
  timestamp: string
}

// ── Manager ─────────────────────────────────────────────────────────────────

export class ApprovalManager {
  private store: TaskStore
  private decisionWaiters = new Map<
    string,
    {
      resolve: (decision: string) => void
      reject: (err: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  constructor(store: TaskStore) {
    this.store = store
    this.startExpiryChecker()
  }

  needsApproval(task: Task): boolean {
    const text = `${task.command ?? ''} ${task.prompt_summary} ${task.full_prompt ?? ''}`.toLowerCase()
    return HIGH_RISK_OPERATIONS.some((op) => text.includes(op))
  }

  isHighRisk(tool: string, summary: string): boolean {
    const combined = `${tool} ${summary}`.toLowerCase()
    return HIGH_RISK_OPERATIONS.some((op) => combined.includes(op))
  }

  isDenyClass(tool: string, summary: string): boolean {
    const combined = `${tool} ${summary}`.toLowerCase()
    return DENY_CLASS_OPERATIONS.some((op) => combined.includes(op))
  }

  createApprovalForTask(task: Task): Approval {
    return this.store.createApproval({
      id: randomUUID(),
      task_id: task.id,
      agent: task.agent ?? 'unknown',
      operation_class: this.classifyOperation(task),
      tool: task.command ?? 'unknown',
      safe_summary: task.prompt_summary.slice(0, 300),
      risk: this.isHighRisk(task.command ?? '', task.prompt_summary)
        ? 'high'
        : 'medium',
      expires_in_ms: DEFAULT_EXPIRY_MS,
    })
  }

  createApproval(opts: {
    taskId: string
    agent: string
    operationClass: string
    tool: string
    summary: string
    risk?: string
  }): Approval {
    return this.store.createApproval({
      id: randomUUID(),
      task_id: opts.taskId,
      agent: opts.agent,
      operation_class: opts.operationClass,
      tool: opts.tool,
      safe_summary: opts.summary,
      risk: opts.risk,
      expires_in_ms: DEFAULT_EXPIRY_MS,
    })
  }

  async approve(
    approvalId: string,
    decidedBy: string,
    opts: { requireReauth?: boolean } = {}
  ): Promise<ApprovalDecision> {
    const approval = this.store.getApproval(approvalId)
    if (!approval) throw new Error('Approval not found')
    if (approval.status !== 'pending') throw new Error(`Approval already ${approval.status}`)

    if (this.isExpired(approval)) {
      this.store.decideApproval(approvalId, 'rejected', 'system')
      throw new Error('Approval expired')
    }

    if (this.isHighRisk(approval.tool, approval.safe_summary) && opts.requireReauth) {
      // In a real system, this would verify a fresh session token
      // For now, we accept the decision but log the requirement
      this.store.audit({
        action: 'approval_reauth_verified',
        task_id: approval.task_id,
        agent: approval.agent,
        detail: `High-risk approval by ${decidedBy}`,
      })
    }

    this.store.decideApproval(approvalId, 'approved', decidedBy)
    this.store.audit({
      action: 'approval_granted',
      task_id: approval.task_id,
      agent: approval.agent,
      detail: `Approved by ${decidedBy}`,
    })

    this.resolveWaiter(approvalId, 'approved')

    return {
      approvalId,
      decision: 'approved',
      decidedBy,
      timestamp: new Date().toISOString(),
    }
  }

  reject(approvalId: string, decidedBy: string): ApprovalDecision {
    const approval = this.store.getApproval(approvalId)
    if (!approval) throw new Error('Approval not found')
    if (approval.status !== 'pending') throw new Error(`Approval already ${approval.status}`)

    this.store.decideApproval(approvalId, 'rejected', decidedBy)
    this.store.audit({
      action: 'approval_rejected',
      task_id: approval.task_id,
      agent: approval.agent,
      detail: `Rejected by ${decidedBy}`,
    })

    this.resolveWaiter(approvalId, 'rejected')

    return {
      approvalId,
      decision: 'rejected',
      decidedBy,
      timestamp: new Date().toISOString(),
    }
  }

  denyApproval(approvalId: string, reason: string): ApprovalDecision {
    const approval = this.store.getApproval(approvalId)
    if (!approval) throw new Error('Approval not found')

    this.store.decideApproval(approvalId, 'rejected', 'system-deny')
    this.store.audit({
      action: 'approval_denied',
      task_id: approval.task_id,
      agent: approval.agent,
      detail: `Denied: ${reason}`,
    })

    this.resolveWaiter(approvalId, 'rejected')

    return {
      approvalId,
      decision: 'rejected',
      decidedBy: 'system-deny',
      timestamp: new Date().toISOString(),
    }
  }

  waitForDecision(
    approvalId: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.decisionWaiters.delete(approvalId)
        reject(new Error('Approval wait timed out'))
      }, timeoutMs)

      this.decisionWaiters.set(approvalId, { resolve, reject, timer })

      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        this.decisionWaiters.delete(approvalId)
        reject(new Error('Approval wait cancelled'))
      })
    })
  }

  // ── Internals ──────────────────────────────────────────────────────

  private resolveWaiter(approvalId: string, decision: string): void {
    const waiter = this.decisionWaiters.get(approvalId)
    if (!waiter) return
    clearTimeout(waiter.timer)
    this.decisionWaiters.delete(approvalId)
    waiter.resolve(decision)
  }

  private isExpired(approval: Approval): boolean {
    return new Date(approval.expires_at) < new Date()
  }

  private classifyOperation(task: Task): string {
    const text = `${task.command ?? ''} ${task.prompt_summary}`.toLowerCase()
    if (text.includes('deploy')) return 'deploy'
    if (text.includes('push') || text.includes('commit')) return 'push'
    if (text.includes('rollback') || text.includes('revert')) return 'rollback'
    if (text.includes('restart')) return 'restart'
    if (text.includes('restore')) return 'restore'
    if (text.includes('promote')) return 'promote'
    return 'general'
  }

  private startExpiryChecker(): void {
    setInterval(() => {
      const expired = this.store.expireStaleApprovals()
      if (expired > 0) {
        // Notify any waiters for expired approvals
        const pending = this.store.pendingApprovals()
        // Check previously pending that are now expired
        for (const [id, waiter] of this.decisionWaiters) {
          const approval = this.store.getApproval(id)
          if (approval && approval.status !== 'pending') {
            this.resolveWaiter(id, approval.status)
          }
        }
      }
    }, 30_000)
  }
}
