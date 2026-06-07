export interface CapacityLimit {
  id: string;
  name: string;
  component: string;
  softLimit: number;
  hardLimit: number;
  recoveryThreshold: number;
  unit: "count" | "ms" | "bytes" | "percent" | "requests_per_sec";
  measurementSource: string;
  justification: string;
}

export interface QueueLimit {
  maxQueuedTasks: number;
  maxConcurrentReadTasks: number;
  maxConcurrentWriteTasks: number;
  maxTasksPerProject: number;
  maxTasksPerEnvironment: number;
}

export interface SchedulerLimit {
  maxEntries: number;
  scanBatchSize: number;
  maxCatchUpTasks: number;
}

export interface NotificationLimit {
  maxBacklog: number;
  maxBatchSize: number;
  maxRetries: number;
}

export interface DashboardLimit {
  maxSseClients: number;
  maxRequestsPerSecond: number;
  cacheTtlMs: number;
}

export interface McpLimit {
  maxCallsPerSecond: number;
  maxPayloadBytes: number;
  timeoutMs: number;
}

export interface SqliteLimit {
  maxWriteTransactionsPerSecond: number;
  busyTimeoutMs: number;
  maxWalSizeMb: number;
}

export interface ResourceLimit {
  safeCpuPercent: number;
  safeRamPercent: number;
  safeDiskPercent: number;
  maxOpenFiles: number;
}

export interface CapacityModel {
  schemaVersion: number;
  updatedAt: string;
  queue: QueueLimit;
  scheduler: SchedulerLimit;
  notification: NotificationLimit;
  dashboard: DashboardLimit;
  mcp: McpLimit;
  sqlite: SqliteLimit;
  resource: ResourceLimit;
  custom: CapacityLimit[];
}

export interface CapacityStatus {
  limitId: string;
  currentValue: number;
  softLimit: number;
  hardLimit: number;
  status: "ok" | "near_capacity" | "at_capacity" | "overloaded";
  percentUsed: number;
}

export function calculateCapacityStatus(
  currentValue: number,
  softLimit: number,
  hardLimit: number
): CapacityStatus["status"] {
  if (currentValue >= hardLimit) return "overloaded";
  if (currentValue >= softLimit) return "at_capacity";
  if (currentValue >= softLimit * 0.8) return "near_capacity";
  return "ok";
}

export function calculatePercentUsed(
  currentValue: number,
  softLimit: number
): number {
  return softLimit > 0
    ? Math.round((currentValue / softLimit) * 10000) / 100
    : 0;
}