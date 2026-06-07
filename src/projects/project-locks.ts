import type { ProjectProfile, EnvironmentName } from './project-profile-types.js'

export interface ProjectLockState {
  projectId: string
  environment: EnvironmentName
  holdingTaskId: string
  acquiredAt: string
  lockType: 'read' | 'write' | 'deploy'
  expiresAt: string
}

const projectLocks = new Map<string, ProjectLockState>()

function lockKey(projectId: string, environment: EnvironmentName): string {
  return `${projectId}:${environment}`
}

export function acquireLock(
  project: ProjectProfile,
  environment: EnvironmentName,
  taskId: string,
  lockType: 'read' | 'write' | 'deploy',
  ttlMs: number = 600_000
): { acquired: boolean; reason?: string } {
  const key = lockKey(project.id, environment)
  const existing = projectLocks.get(key)

  if (existing) {
    // Check if expired
    if (Date.now() > new Date(existing.expiresAt).getTime()) {
      projectLocks.delete(key)
    } else if (existing.holdingTaskId !== taskId) {
      return {
        acquired: false,
        reason: `Project "${project.id}" in environment "${environment}" is locked by task ${existing.holdingTaskId} (${existing.lockType})`,
      }
    }
  }

  // Write lock blocks other writes + deploys in same environment
  if (lockType === 'write' || lockType === 'deploy') {
    for (const [k, v] of projectLocks) {
      if (k.startsWith(project.id + ':') && v.holdingTaskId !== taskId) {
        if (v.lockType === 'write' || v.lockType === 'deploy') {
          return {
            acquired: false,
            reason: `Project "${project.id}" has an active ${v.lockType} lock (task ${v.holdingTaskId}) in ${v.environment}`,
          }
        }
      }
    }
  }

  projectLocks.set(key, {
    projectId: project.id,
    environment,
    holdingTaskId: taskId,
    acquiredAt: new Date().toISOString(),
    lockType,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  })

  return { acquired: true }
}

export function releaseLock(
  project: ProjectProfile,
  environment: EnvironmentName,
  taskId: string
): boolean {
  const key = lockKey(project.id, environment)
  const existing = projectLocks.get(key)
  if (existing && existing.holdingTaskId === taskId) {
    projectLocks.delete(key)
    return true
  }
  return false
}

export function getProjectLocks(projectId?: string): ProjectLockState[] {
  const all: ProjectLockState[] = []
  for (const [, state] of projectLocks) {
    if (!projectId || state.projectId === projectId) {
      all.push(state)
    }
  }
  return all
}

export function clearExpiredLocks(): number {
  let cleared = 0
  for (const [key, state] of projectLocks) {
    if (Date.now() > new Date(state.expiresAt).getTime()) {
      projectLocks.delete(key)
      cleared++
    }
  }
  return cleared
}

export function isProjectLocked(project: ProjectProfile, environment: EnvironmentName): boolean {
  const key = lockKey(project.id, environment)
  const existing = projectLocks.get(key)
  if (!existing) return false
  if (Date.now() > new Date(existing.expiresAt).getTime()) {
    projectLocks.delete(key)
    return false
  }
  return true
}