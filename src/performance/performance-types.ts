export type BenchmarkStatus = "pass" | "warn" | "fail";
export type BenchmarkCategory =
  | "startup"
  | "mcp"
  | "dashboard"
  | "sqlite"
  | "scheduler"
  | "notifications"
  | "memory"
  | "cpu"
  | "long-session"
  | "systemd"
  | "watcher"
  | "network";

export interface BenchmarkResult {
  id: string;
  component: string;
  scenario: string;
  category: BenchmarkCategory;
  environment: string;
  runs: number;
  warmupRuns: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  stdDevMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  rssPeakBytes: number;
  heapPeakBytes: number;
  ioReadBytes: number;
  ioWriteBytes: number;
  errorRate: number;
  status: BenchmarkStatus;
  threshold: BenchmarkThreshold;
  metadata: Record<string, string | number | boolean>;
  measuredAt: string;
}

export interface BenchmarkThreshold {
  warnPercent: number;
  failPercent: number;
  warnAbsoluteMs: number;
  failAbsoluteMs: number;
  warnMemoryBytes: number;
  failMemoryBytes: number;
}

export interface BenchmarkSuite {
  id: string;
  name: string;
  category: BenchmarkCategory;
  scenarios: BenchmarkScenario[];
}

export interface BenchmarkScenario {
  id: string;
  name: string;
  warmupRuns: number;
  measurementRuns: number;
  timeoutMs: number;
  fixtureRequired: boolean;
  serverRequired: boolean;
}

export interface BaselineFile {
  schemaVersion: number;
  environment: BaselineEnvironment;
  benchmarks: Record<string, BenchmarkResult>;
  thresholds: BaselineThresholds;
  validatedCommit: string;
  validatedAt: string;
}

export interface BaselineEnvironment {
  os: string;
  arch: string;
  cpuCores: number;
  ramTotal: string;
  bunVersion: string;
  nodeVersion: string;
}

export interface BaselineThresholds {
  latencyRegressionPercent: number;
  memoryRegressionPercent: number;
  startupRegressionPercent: number;
  cpuRegressionPercent: number;
  absoluteLimits: Record<string, AbsoluteLimit>;
}

export interface AbsoluteLimit {
  warnMs: number;
  failMs: number;
  warnMemoryMb: number;
  failMemoryMb: number;
}

export interface PerformanceReport {
  benchmarks: BenchmarkResult[];
  summary: {
    total: number;
    passed: number;
    warned: number;
    failed: number;
    notRun: number;
  };
  failedIds: string[];
  warningIds: string[];
  durationMs: number;
  comparedToBaseline: string | null;
  regressions: RegressionFinding[];
}

export interface RegressionFinding {
  benchmarkId: string;
  component: string;
  scenario: string;
  baselineMs: number;
  currentMs: number;
  regressionPercent: number;
  thresholdPercent: number;
  severity: "warn" | "fail";
}

export interface ResourceUsage {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
}

export function defaultThresholds(
  ms: number,
  memoryMb: number,
): BenchmarkThreshold {
  return {
    warnPercent: 20,
    failPercent: 50,
    warnAbsoluteMs: ms * 0.2,
    failAbsoluteMs: ms * 0.5,
    warnMemoryBytes: memoryMb * 1024 * 1024,
    failMemoryBytes: memoryMb * 2 * 1024 * 1024,
  };
}

export function computeStats(values: number[]): {
  median: number;
  p95: number;
  min: number;
  max: number;
  stdDev: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  const p95Idx = Math.ceil(n * 0.95) - 1;
  const p95 = sorted[Math.min(p95Idx, n - 1)];
  const min = sorted[0];
  const max = sorted[n - 1];
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  return { median, p95, min, max, stdDev };
}