type OperationType = 'reindex' | 'sync' | 'feedback' | 'proposal_accept' | 'proposal_reject' | 'remember' | 'lesson_proposal' | string

interface LockState {
  active: boolean
  operation: OperationType | null
  startedAt: number | null
}

let state: LockState = { active: false, operation: null, startedAt: null }

export function acquireWriteLock(op: OperationType): boolean {
  if (state.active) return false
  state = { active: true, operation: op, startedAt: Date.now() }
  return true
}

export function releaseWriteLock() {
  state = { active: false, operation: null, startedAt: null }
}

export function getCurrentOperation(): { busy: boolean; operation?: string; started_at?: string } {
  if (!state.active) return { busy: false }
  return {
    busy: true,
    operation: state.operation ?? undefined,
    started_at: state.startedAt ? new Date(state.startedAt).toISOString() : undefined,
  }
}

export function writeLockBusyError() {
  return {
    ok: false,
    data: null,
    error: { code: 'AKM_WRITE_BUSY', message: 'Another AKM write operation is currently running.' },
  }
}
