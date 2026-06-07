import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(__dirname, "..", "..", "data");
export const ROOT_DIR = resolve(__dirname, "..", "..");

export interface SliSample {
  sliId: string;
  component: string;
  value: number;
  unit: "ms" | "percent" | "count" | "bytes" | "ratio";
  status: "pass" | "fail" | "warn";
  timestamp: string;
  projectId?: string;
  environmentId?: string;
  source: string;
}

export interface CollectorResult {
  sliId: string;
  samples: SliSample[];
  count: number;
  source: string;
  error?: string;
}

function now(): string {
  return new Date().toISOString();
}

export function collectNotificationLatency(limit = 100): CollectorResult {
  const samples: SliSample[] = [];
  const dbPath = join(DATA_DIR, "notifications.db");
  if (!existsSync(dbPath)) {
    return { sliId: "notification-dispatch-latency", samples, count: 0, source: "notifications.db", error: "not found" };
  }
  try {
    const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
    const db = new Database(dbPath, { readonly: true, strict: true });
    const rows = db
      .prepare(
        `SELECT nd.finished_at, nd.started_at, nd.status, nd.error_category
         FROM notification_deliveries nd
         WHERE nd.finished_at IS NOT NULL AND nd.started_at IS NOT NULL
         ORDER BY nd.finished_at DESC LIMIT ?`
      )
      .all(limit) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const finished = new Date(row.finished_at as string).getTime();
      const started = new Date(row.started_at as string).getTime();
      const latencyMs = finished - started;
      const status = row.status === "delivered" || row.status === "sent" ? "pass" : "fail";
      samples.push({
        sliId: "notification-dispatch-latency",
        component: "notification",
        value: latencyMs,
        unit: "ms",
        status,
        timestamp: row.finished_at as string,
        source: "notifications.db",
      });
    }
    db.close();
  } catch (e) {
    return { sliId: "notification-dispatch-latency", samples, count: 0, source: "notifications.db", error: String(e) };
  }
  return { sliId: "notification-dispatch-latency", samples, count: samples.length, source: "notifications.db" };
}

export function collectTaskLatency(limit = 100): CollectorResult {
  const samples: SliSample[] = [];
  const dbPath = join(DATA_DIR, "remote-tasks.db");
  if (!existsSync(dbPath)) {
    return { sliId: "task-create-latency", samples, count: 0, source: "remote-tasks.db", error: "not found" };
  }
  try {
    const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
    const db = new Database(dbPath, { readonly: true, strict: true });
    const rows = db
      .prepare(
        `SELECT created_at, started_at, finished_at, status
         FROM tasks
         WHERE started_at IS NOT NULL AND created_at IS NOT NULL
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const created = new Date(row.created_at as string).getTime();
      const started = new Date(row.started_at as string).getTime();
      const pickupMs = started - created;
      const status = row.status === "completed" || row.status === "running" ? "pass" : "fail";
      samples.push({
        sliId: "queue-pickup-latency",
        component: "remote-control",
        value: pickupMs,
        unit: "ms",
        status,
        timestamp: row.created_at as string,
        source: "remote-tasks.db",
      });
      if (row.finished_at) {
        const finished = new Date(row.finished_at as string).getTime();
        const taskMs = finished - created;
        samples.push({
          sliId: "task-create-latency",
          component: "remote-control",
          value: taskMs,
          unit: "ms",
          status: row.status === "completed" ? "pass" : "fail",
          timestamp: row.created_at as string,
          source: "remote-tasks.db",
        });
      }
    }
    db.close();
  } catch (e) {
    return { sliId: "task-create-latency", samples, count: 0, source: "remote-tasks.db", error: String(e) };
  }
  return { sliId: "task-create-latency", samples, count: samples.length, source: "remote-tasks.db" };
}

export function collectScheduleLatency(limit = 100): CollectorResult {
  const samples: SliSample[] = [];
  const dbPath = join(DATA_DIR, "scheduler.db");
  if (!existsSync(dbPath)) {
    return { sliId: "scheduler-scan-latency", samples, count: 0, source: "scheduler.db", error: "not found" };
  }
  try {
    const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
    const db = new Database(dbPath, { readonly: true, strict: true });
    const hasTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schedule_runs'")
      .get() as Record<string, unknown> | undefined;
    if (!hasTable) {
      db.close();
      return { sliId: "scheduler-scan-latency", samples, count: 0, source: "scheduler.db", error: "no schedule_runs table" };
    }
    const rows = db
      .prepare(
        `SELECT planned_at, started_at, finished_at, duration_ms, status
         FROM schedule_runs
         WHERE duration_ms IS NOT NULL
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const latencyMs = typeof row.duration_ms === "number" ? row.duration_ms : 0;
      samples.push({
        sliId: "scheduler-scan-latency",
        component: "scheduler",
        value: latencyMs,
        unit: "ms",
        status: row.status === "completed" || row.status === "success" ? "pass" : "fail",
        timestamp: typeof row.finished_at === "string" ? row.finished_at : now(),
        source: "scheduler.db",
      });
    }
    db.close();
  } catch (e) {
    return { sliId: "scheduler-scan-latency", samples, count: 0, source: "scheduler.db", error: String(e) };
  }
  return { sliId: "scheduler-scan-latency", samples, count: samples.length, source: "scheduler.db" };
}

export function collectWriteAuditLatency(limit = 100): CollectorResult {
  const samples: SliSample[] = [];
  const auditPath = join(DATA_DIR, "write-audit.jsonl");
  if (!existsSync(auditPath)) {
    return { sliId: "mcp-success-rate", samples, count: 0, source: "write-audit.jsonl", error: "not found" };
  }
  try {
    const lines = readFileSync(auditPath, "utf-8").split("\n").filter(Boolean);
    const slice = lines.slice(-limit);
    for (const line of slice) {
      const entry = JSON.parse(line);
      const durationMs = typeof entry.duration_ms === "number" ? entry.duration_ms : 0;
      const status = entry.result === "success" || entry.result === "ok" ? "pass" : "fail";
      samples.push({
        sliId: "mcp-success-rate",
        component: "mcp",
        value: durationMs,
        unit: "ms",
        status,
        timestamp: entry.timestamp || now(),
        source: "write-audit.jsonl",
      });
    }
  } catch (e) {
    return { sliId: "mcp-success-rate", samples, count: 0, source: "write-audit.jsonl", error: String(e) };
  }
  return { sliId: "mcp-success-rate", samples, count: samples.length, source: "write-audit.jsonl" };
}

export function collectAvailability(): CollectorResult {
  const samples: SliSample[] = [];
  const dbPaths = [
    { path: join(DATA_DIR, "notifications.db"), name: "notification" },
    { path: join(DATA_DIR, "remote-tasks.db"), name: "remote-control" },
    { path: join(DATA_DIR, "scheduler.db"), name: "scheduler" },
  ];
  for (const { path, name } of dbPaths) {
    const available = existsSync(path);
    samples.push({
      sliId: "dashboard-availability",
      component: name,
      value: available ? 1 : 0,
      unit: "ratio",
      status: available ? "pass" : "fail",
      timestamp: now(),
      source: "filesystem",
    });
  }
  return { sliId: "dashboard-availability", samples, count: samples.length, source: "multiple DBs" };
}

function computePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export interface SliSummary {
  sliId: string;
  sampleCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  values: number[];
  median: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  lastTimestamp: string;
  freshnessMs: number;
  status: "healthy" | "degraded" | "critical" | "insufficient_data";
}

export function computeSliSummary(samples: SliSample[]): SliSummary {
  if (samples.length === 0) {
    return {
      sliId: "unknown",
      sampleCount: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      values: [],
      median: 0,
      p95: 0,
      p99: 0,
      min: 0,
      max: 0,
      lastTimestamp: "",
      freshnessMs: 0,
      status: "insufficient_data",
    };
  }
  const values = samples.map((s) => s.value);
  const successCount = samples.filter((s) => s.status === "pass").length;
  const failureCount = samples.filter((s) => s.status === "fail").length;
  const successRate = samples.length > 0 ? (successCount / samples.length) * 100 : 0;
  const lastTimestamp = samples[samples.length - 1].timestamp;
  const freshnessMs = Date.now() - new Date(lastTimestamp).getTime();

  let status: "healthy" | "degraded" | "critical" | "insufficient_data";
  if (samples.length < 5) {
    status = "insufficient_data";
  } else if (successRate >= 99.5) {
    status = "healthy";
  } else if (successRate >= 95) {
    status = "degraded";
  } else {
    status = "critical";
  }

  return {
    sliId: samples[0].sliId,
    sampleCount: samples.length,
    successCount,
    failureCount,
    successRate: Math.round(successRate * 100) / 100,
    values,
    median: computePercentile(values, 50),
    p95: computePercentile(values, 95),
    p99: computePercentile(values, 99),
    min: Math.min(...values),
    max: Math.max(...values),
    lastTimestamp,
    freshnessMs,
    status,
  };
}

export function collectAllSli(limit = 100): Record<string, SliSummary> {
  const results: Record<string, SliSummary> = {};

  const notification = collectNotificationLatency(limit);
  results["notification-dispatch-latency"] = computeSliSummary(notification.samples);

  const task = collectTaskLatency(limit);
  const taskSamples = task.samples.filter((s) => s.sliId === "task-create-latency");
  const pickupSamples = task.samples.filter((s) => s.sliId === "queue-pickup-latency");
  results["task-create-latency"] = computeSliSummary(taskSamples);
  results["queue-pickup-latency"] = computeSliSummary(pickupSamples);

  const schedule = collectScheduleLatency(limit);
  results["scheduler-scan-latency"] = computeSliSummary(schedule.samples);

  const audit = collectWriteAuditLatency(limit);
  results["mcp-success-rate"] = computeSliSummary(audit.samples);

  const avail = collectAvailability();
  results["dashboard-availability"] = computeSliSummary(avail.samples);

  results["mcp-latency"] = computeSliSummary(audit.samples);
  results["notification-dispatch-latency"] = computeSliSummary(notification.samples);

  return results;
}