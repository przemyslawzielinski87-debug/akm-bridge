import type { ProjectProfile, ProjectBudgets, EnvironmentName } from './project-profile-types.js'

export interface BudgetState {
  dailyTokensRead: number
  dailyTokensWrite: number
  weeklyTokensRead: number
  weeklyTokensWrite: number
  consecutiveTasks: number
  dailyReset: string
  weeklyReset: string
}

// In-memory budget tracking (persisted across process restarts would use SQLite)
const budgetStates = new Map<string, BudgetState>()

function getDateKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function getWeekKey(): string {
  const now = new Date()
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - now.getDay())
  return startOfWeek.toISOString().slice(0, 10)
}

function getOrCreateState(projectId: string): BudgetState {
  let state = budgetStates.get(projectId)
  if (!state) {
    state = {
      dailyTokensRead: 0,
      dailyTokensWrite: 0,
      weeklyTokensRead: 0,
      weeklyTokensWrite: 0,
      consecutiveTasks: 0,
      dailyReset: getDateKey(),
      weeklyReset: getWeekKey(),
    }
    budgetStates.set(projectId, state)
  }

  // Reset daily counters if day changed
  const today = getDateKey()
  if (state.dailyReset !== today) {
    state.dailyTokensRead = 0
    state.dailyTokensWrite = 0
    state.dailyReset = today
  }

  // Reset weekly counters if week changed
  const thisWeek = getWeekKey()
  if (state.weeklyReset !== thisWeek) {
    state.weeklyTokensRead = 0
    state.weeklyTokensWrite = 0
    state.weeklyReset = thisWeek
  }

  return state
}

export interface BudgetCheckResult {
  allowed: boolean
  requiresApproval: boolean
  reason?: string
  current: { dailyRead: number; dailyWrite: number; weeklyRead: number; weeklyWrite: number }
  limits: { dailyRead: number; dailyWrite: number; weeklyRead: number; weeklyWrite: number }
}

export function checkBudget(
  profile: ProjectProfile,
  estimatedInputTokens: number,
  estimatedOutputTokens: number,
  isWrite: boolean
): BudgetCheckResult {
  const budgets = profile.budgets
  const state = getOrCreateState(profile.id)

  const readTokens = estimatedInputTokens + estimatedOutputTokens
  const writeTokens = isWrite ? estimatedInputTokens + estimatedOutputTokens : 0

  const projectedDailyRead = state.dailyTokensRead + readTokens
  const projectedDailyWrite = state.dailyTokensWrite + writeTokens
  const projectedWeeklyRead = state.weeklyTokensRead + readTokens
  const projectedWeeklyWrite = state.weeklyTokensWrite + writeTokens

  const softWarningPct = budgets.softWarningPct / 100

  const dailyReadLimit = isWrite ? budgets.dailyTokensWrite : budgets.dailyTokensRead
  const dailyWriteLimit = budgets.dailyTokensWrite
  const weeklyReadLimit = isWrite ? budgets.weeklyTokensWrite : budgets.weeklyTokensRead
  const weeklyWriteLimit = budgets.weeklyTokensWrite

  // Hard limit checks
  if (isWrite && projectedDailyWrite > budgets.dailyTokensWrite) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Daily write budget exceeded for "${profile.id}": ${projectedDailyWrite} > ${budgets.dailyTokensWrite}`,
      current: { dailyRead: state.dailyTokensRead, dailyWrite: state.dailyTokensWrite, weeklyRead: state.weeklyTokensRead, weeklyWrite: state.weeklyTokensWrite },
      limits: { dailyRead: budgets.dailyTokensRead, dailyWrite: budgets.dailyTokensWrite, weeklyRead: budgets.weeklyTokensRead, weeklyWrite: budgets.weeklyTokensWrite },
    }
  }

  if (isWrite && projectedWeeklyWrite > budgets.weeklyTokensWrite) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Weekly write budget exceeded for "${profile.id}": ${projectedWeeklyWrite} > ${budgets.weeklyTokensWrite}`,
      current: { dailyRead: state.dailyTokensRead, dailyWrite: state.dailyTokensWrite, weeklyRead: state.weeklyTokensRead, weeklyWrite: state.weeklyTokensWrite },
      limits: { dailyRead: budgets.dailyTokensRead, dailyWrite: budgets.dailyTokensWrite, weeklyRead: budgets.weeklyTokensRead, weeklyWrite: budgets.weeklyTokensWrite },
    }
  }

  if (projectedDailyRead > budgets.dailyTokensRead) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Daily read budget exceeded for "${profile.id}": ${projectedDailyRead} > ${budgets.dailyTokensRead}`,
      current: { dailyRead: state.dailyTokensRead, dailyWrite: state.dailyTokensWrite, weeklyRead: state.weeklyTokensRead, weeklyWrite: state.weeklyTokensWrite },
      limits: { dailyRead: budgets.dailyTokensRead, dailyWrite: budgets.dailyTokensWrite, weeklyRead: budgets.weeklyTokensRead, weeklyWrite: budgets.weeklyTokensWrite },
    }
  }

  if (projectedWeeklyRead > budgets.weeklyTokensRead) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Weekly read budget exceeded for "${profile.id}": ${projectedWeeklyRead} > ${budgets.weeklyTokensRead}`,
      current: { dailyRead: state.dailyTokensRead, dailyWrite: state.dailyTokensWrite, weeklyRead: state.weeklyTokensRead, weeklyWrite: state.weeklyTokensWrite },
      limits: { dailyRead: budgets.dailyTokensRead, dailyWrite: budgets.dailyTokensWrite, weeklyRead: budgets.weeklyTokensRead, weeklyWrite: budgets.weeklyTokensWrite },
    }
  }

  // Soft warning (approval required if near limit)
  const nearDailyRead = projectedDailyRead > budgets.dailyTokensRead * softWarningPct
  const nearDailyWrite = isWrite && projectedDailyWrite > budgets.dailyTokensWrite * softWarningPct
  const nearWeeklyRead = projectedWeeklyRead > budgets.weeklyTokensRead * softWarningPct
  const nearWeeklyWrite = isWrite && projectedWeeklyWrite > budgets.weeklyTokensWrite * softWarningPct

  const requiresApproval = nearDailyRead || nearDailyWrite || nearWeeklyRead || nearWeeklyWrite

  return {
    allowed: true,
    requiresApproval,
    reason: requiresApproval ? 'Approaching budget limit — approval recommended' : undefined,
    current: { dailyRead: state.dailyTokensRead, dailyWrite: state.dailyTokensWrite, weeklyRead: state.weeklyTokensRead, weeklyWrite: state.weeklyTokensWrite },
    limits: { dailyRead: budgets.dailyTokensRead, dailyWrite: budgets.dailyTokensWrite, weeklyRead: budgets.weeklyTokensRead, weeklyWrite: budgets.weeklyTokensWrite },
  }
}

export function recordUsage(
  profile: ProjectProfile,
  inputTokens: number,
  outputTokens: number,
  isWrite: boolean
): void {
  const state = getOrCreateState(profile.id)
  state.dailyTokensRead += inputTokens + outputTokens
  state.weeklyTokensRead += inputTokens + outputTokens
  if (isWrite) {
    state.dailyTokensWrite += inputTokens + outputTokens
    state.weeklyTokensWrite += inputTokens + outputTokens
  }
  state.consecutiveTasks++
}

export function getBudgetStatus(profile: ProjectProfile): {
  state: BudgetState
  limits: ProjectBudgets
  usagePct: { dailyRead: number; dailyWrite: number; weeklyRead: number; weeklyWrite: number }
} {
  const state = getOrCreateState(profile.id)
  const limits = profile.budgets

  return {
    state,
    limits,
    usagePct: {
      dailyRead: limits.dailyTokensRead > 0 ? Math.round((state.dailyTokensRead / limits.dailyTokensRead) * 100) : 0,
      dailyWrite: limits.dailyTokensWrite > 0 ? Math.round((state.dailyTokensWrite / limits.dailyTokensWrite) * 100) : 0,
      weeklyRead: limits.weeklyTokensRead > 0 ? Math.round((state.weeklyTokensRead / limits.weeklyTokensRead) * 100) : 0,
      weeklyWrite: limits.weeklyTokensWrite > 0 ? Math.round((state.weeklyTokensWrite / limits.weeklyTokensWrite) * 100) : 0,
    },
  }
}