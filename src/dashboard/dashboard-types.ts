/**
 * OpenCode Operations Dashboard — Data Contract Types
 *
 * Defines the full shape of the JSON payload served by the dashboard backend.
 * All reads, no writes. Consumer is the HTML dashboard and any API client.
 */

/* ── Status primitives ── */

export type ComponentStatus = 'healthy' | 'degraded' | 'failed' | 'unknown' | 'not_run'

export interface StatusSection {
  status: ComponentStatus
  summary: string
  updatedAt: string
  source: string
  details: Record<string, unknown>
}

/* ── Component models ── */

export interface AgentStatus {
  name: string
  file: string
  exists: boolean
  mode: 'primary' | 'subagent' | 'system'
  status: ComponentStatus
  summary: string
  updatedAt: string
}

export interface CommandStatus {
  name: string
  file: string
  exists: boolean
  agent: string
  subtask: string
  status: ComponentStatus
  summary: string
  updatedAt: string
}

export interface SkillStatus {
  name: string
  dir: string
  exists: boolean
  assignedAgents: string[]
  status: ComponentStatus
  summary: string
  updatedAt: string
}

export interface MCPServerStatus {
  name: string
  enabled: boolean
  transport: string
  status: ComponentStatus
  toolsCount: number
  latencyMs: number | null
  errorCount: number
  lastError: string | null
  updatedAt: string
}

export interface AKMStatus {
  version: string
  healthy: boolean
  entryCount: number | null
  lastIndexTime: string | null
  mcpAvailable: boolean
  cliAvailable: boolean
  ftsAvailable: boolean
  semanticAvailable: boolean
  sourcesCount: number
  status: ComponentStatus
  summary: string
  updatedAt: string
}

/* ── Metrics ── */

export interface TokenMetrics {
  pluginInstalled: boolean
  pluginVersion: string | null
  totalSessions: number
  totalTokensIn: number
  totalTokensOut: number
  totalCostUsd: number
  avgTokensPerSession: number
  topModels: Array<{ model: string; tokensIn: number; tokensOut: number; count: number }>
  status: ComponentStatus
  summary: string
  updatedAt: string
}

export interface ContextMetrics {
  compactionsCount: number
  avgCompressionRatio: number
  cacheHitRate: number
  contextResetsCount: number
  avgContextSizeTokens: number
  status: ComponentStatus
  summary: string
  updatedAt: string
}

export interface PermissionMetrics {
  totalRequests: number
  allowed: number
  asked: number
  denied: number
  topRequests: Array<{ tool: string; count: number; allowed: number; denied: number }>
  status: ComponentStatus
  summary: string
  updatedAt: string
}

/* ── Recovery / Updates / CI / DR / Learning ── */

export interface RecoveryStatus {
  escalation: boolean
  components: Record<string, {
    state: string
    consecutiveFailures: number
    recoveryAttempts: number
    lastError: string | null
    cooldownUntil: number | null
  }>
  status: ComponentStatus
  summary: string
  updatedAt: string
}

export interface UpdateStatus {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  updateType: 'none' | 'patch' | 'minor' | 'major'
  canaryActive: boolean
  canaryVersion: string | null
  lastCheck: string | null
  lastPromotion: string | null
  lastRollback: string | null
  blockedVersions: string[]
  status: ComponentStatus
  summary: string
  updatedAt: string
}

export interface E2EStatus {
  contractVersion: string
  agentsExpected: number
  agentsActual: number
  commandsExpected: number
  commandsActual: number
  skillsExpected: number
  skillsActual: number
  mcpServersExpected: number
  mcpServersActual: number
  lastRun: string | null
  status: ComponentStatus
  summary: string
  updatedAt: string
}

export interface CIStatus {
  gitBranch: string | null
  gitCommit: string | null
  gitDirty: boolean
  lastCommitTime: string | null
  lintStatus: ComponentStatus
  testStatus: ComponentStatus
  buildStatus: ComponentStatus
  status: ComponentStatus
  summary: string
  updatedAt: string
}

export interface DRStatus {
  manifestExists: boolean
  manifestVersion: string | null
  versionLockExists: boolean
  versionLockVersion: string | null
  matrixValidated: boolean
  rtoMinutes: number | null
  rpoMinutes: number | null
  cleanServerDrill: 'NOT_RUN' | 'PASSED' | 'FAILED'
  lastDrillTime: string | null
  status: ComponentStatus
  summary: string
  updatedAt: string
}

export interface LearningStatus {
  agentRunsToday: number
  totalRuns: number
  lessonsSaved: number
  memoryProposals: number
  feedbackCount: number
  agentMode: string
  status: ComponentStatus
  summary: string
  updatedAt: string
}

export interface SystemStatus {
  hostname: string
  platform: string
  arch: string
  osRelease: string
  nodeVersion: string
  bunVersion: string | null
  opencodeVersion: string | null
  akmBridgeVersion: string | null
  uptimeSeconds: number
  diskUsagePercent: number | null
  memoryUsagePercent: number | null
  services: Array<{
    name: string
    status: 'active' | 'inactive' | 'failed' | 'unknown'
    pid: number | null
  }>
  status: ComponentStatus
  summary: string
  updatedAt: string
}

/* ── Alerts ── */

export interface Alert {
  id: string
  severity: 'critical' | 'warning' | 'info'
  component: string
  title: string
  summary: string
  firstSeen: string
  lastSeen: string
  acknowledged: boolean
  recommendedAction: string
}

/* ── Events ── */

export interface DashboardEvent {
  id: string
  timestamp: string
  component: string
  type: string
  message: string
  severity: 'info' | 'warning' | 'error'
}

/* ── Config ── */

export interface DashboardConfig {
  port: number
  host: string
  cacheTTL: number
  authRequired: boolean
}

/* ── Main payload ── */

export interface DashboardData {
  schemaVersion: string
  generatedAt: string
  cacheTTL: number

  overall: StatusSection
  alerts: Alert[]
  events: DashboardEvent[]

  opencode: StatusSection
  mcp: StatusSection & { servers: MCPServerStatus[] }
  akm: AKMStatus
  agents: StatusSection & { items: AgentStatus[] }
  commands: StatusSection & { items: CommandStatus[] }
  skills: StatusSection & { items: SkillStatus[] }

  tokens: TokenMetrics
  context: ContextMetrics
  permissions: PermissionMetrics

  recovery: RecoveryStatus
  updates: UpdateStatus
  e2e: E2EStatus
  ci: CIStatus
  disasterRecovery: DRStatus
  learning: LearningStatus
  system: SystemStatus
}
