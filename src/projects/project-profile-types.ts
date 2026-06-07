// ── Environment types ──

export type EnvironmentName = "local" | "staging" | "production";

export interface ProjectEnvironment {
  baseUrl?: string;
  deploymentTarget?: string;
  writePolicy: "allow" | "ask" | "deny";
  approvalPolicy: "none" | "single" | "double";
  healthCheckRequired: boolean;
  backupRequired: boolean;
  rollbackRequired: boolean;
  maintenanceWindows?: { start: string; end: string; tz: string }[];
}

// ── Permission types ──

export type PermissionLevel = "allow" | "ask" | "deny";

export interface ProjectPermissions {
  read: PermissionLevel;
  write: PermissionLevel;
  deploy: PermissionLevel;
  admin: PermissionLevel;
  shell: PermissionLevel;
  gitPush: PermissionLevel;
  gitForcePush: PermissionLevel;
}

// ── Budget types ──

export interface ProjectBudgets {
  dailyTokensRead: number;
  dailyTokensWrite: number;
  weeklyTokensRead: number;
  weeklyTokensWrite: number;
  maxTokensPerTask: number;
  maxToolCallsPerTask: number;
  maxDurationPerTaskMs: number;
  maxConcurrentTasks: number;
  maxScheduledRunsPerDay: number;
  softWarningPct: number;
}

// ── Concurrency ──

export interface ProjectConcurrency {
  maxReadTasks: number;
  maxWriteTasks: number;
  queuePolicy: "fifo" | "priority" | "deadline";
}

// ── Git policy ──

export interface GitPolicy {
  allowedBranches: string[];
  requirePullRequest: boolean;
  requireApproval: boolean;
  forbidForcePush: boolean;
  requireUpToDate: boolean;
  commitSigningRequired: boolean;
}

// ── Deployment policy ──

export interface DeploymentPolicy {
  requireBackup: boolean;
  requireHealthCheck: boolean;
  requireApproval: boolean;
  approvalCount: number;
  canaryEnabled: boolean;
  rollbackEnabled: boolean;
  maxRetries: number;
}

// ── AKM scoping ──

export interface ProjectAkmScope {
  namespaces: string[];
  sources: string[];
  tags: string[];
  collections: string[];
  searchFirstInProject: boolean;
  allowGlobalFallback: boolean;
}

// ── Schedules ──

export interface ProjectSchedule {
  id: string;
  name: string;
  environment: EnvironmentName;
  expression: string;
  timezone: string;
  readOnly: boolean;
  maxRunsPerDay: number;
}

// ── Observability ──

export interface ProjectObservability {
  metricsRetentionDays: number;
  alertOnFailure: boolean;
  alertOnBudgetExceeded: boolean;
  dailyDigest: boolean;
  weeklyDigest: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
}

// ── Backup policy ──

export interface ProjectBackupPolicy {
  repositoryBackup: boolean;
  databaseBackup: boolean;
  uploadsBackup: boolean;
  secretsBackup: boolean;
  rtoMinutes: number;
  rpoMinutes: number;
  backupRetentionDays: number;
}

// ── Full profile ──

export interface ProjectProfile {
  id: string;
  name: string;
  description: string;
  repositoryPath: string;
  repositoryRemote: string;
  defaultBranch: string;
  allowedBranches: string[];
  projectType: string;
  enabled: boolean;
  environments: Partial<Record<EnvironmentName, ProjectEnvironment>>;
  agents: string[];
  commands: string[];
  skills: string[];
  mcpServers: string[];
  mcpTools: string[];
  akm: ProjectAkmScope;
  permissions: ProjectPermissions;
  budgets: ProjectBudgets;
  concurrency: ProjectConcurrency;
  gitPolicy: GitPolicy;
  deploymentPolicy: DeploymentPolicy;
  schedules: ProjectSchedule[];
  observability: ProjectObservability;
  backupPolicy: ProjectBackupPolicy;
  createdAt: string;
  updatedAt: string;
}

// ── Defaults ──

export const DEFAULT_UNCLASSIFIED_PERMISSIONS: ProjectPermissions = {
  read: "allow",
  write: "deny",
  deploy: "deny",
  admin: "deny",
  shell: "deny",
  gitPush: "deny",
  gitForcePush: "deny",
};

export const DEFAULT_UNCLASSIFIED_BUDGETS: ProjectBudgets = {
  dailyTokensRead: 100_000,
  dailyTokensWrite: 0,
  weeklyTokensRead: 500_000,
  weeklyTokensWrite: 0,
  maxTokensPerTask: 50_000,
  maxToolCallsPerTask: 20,
  maxDurationPerTaskMs: 120_000,
  maxConcurrentTasks: 1,
  maxScheduledRunsPerDay: 0,
  softWarningPct: 80,
};

export const DEFAULT_AKM_SCOPE: ProjectAkmScope = {
  namespaces: [],
  sources: [],
  tags: [],
  collections: [],
  searchFirstInProject: true,
  allowGlobalFallback: false,
};