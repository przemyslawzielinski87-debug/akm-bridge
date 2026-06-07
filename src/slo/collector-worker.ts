import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { collectAllSli } from "./sli-collector.js";
import { createSliStore, type SliRecord } from "./sli-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, "..", "..");
export const DATA_DIR = resolve(PROJECT_ROOT, "data");
export const LOCK_FILE = resolve(DATA_DIR, ".sli-collector.lock");
export const STATUS_FILE = resolve(DATA_DIR, "sli-collector-status.json");
const LOCK_TTL_MS = 120_000;

interface CollectorStatus {
  lastRunStarted: string | null;
  lastRunFinished: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  lastDurationMs: number;
  sourcesTotal: number;
  sourcesOk: number;
  sourcesFailed: number;
  samplesWritten: number;
  samplesSkippedDuplicate: number;
  retentionDeleted: number;
  lockStatus: string;
}

function now(): string {
  return new Date().toISOString();
}

function acquireLock(): boolean {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(LOCK_FILE)) {
    const content = readFileSync(LOCK_FILE, "utf-8").trim();
    const parts = content.split("|");
    const timestamp = parseInt(parts[0], 10);
    if (!isNaN(timestamp) && Date.now() - timestamp < LOCK_TTL_MS) {
      return false;
    }
    try { unlinkSync(LOCK_FILE); } catch { return false; }
  }
  try {
    writeFileSync(LOCK_FILE, `${Date.now()}|${process.pid}`, "utf-8");
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  try { unlinkSync(LOCK_FILE); } catch { }
}

function readStatus(): CollectorStatus {
  if (!existsSync(STATUS_FILE)) {
    return {
      lastRunStarted: null, lastRunFinished: null, lastSuccess: null,
      lastError: null, lastDurationMs: 0, sourcesTotal: 0, sourcesOk: 0,
      sourcesFailed: 0, samplesWritten: 0, samplesSkippedDuplicate: 0,
      retentionDeleted: 0, lockStatus: "inactive",
    };
  }
  try {
    return JSON.parse(readFileSync(STATUS_FILE, "utf-8"));
  } catch {
    return {
      lastRunStarted: null, lastRunFinished: null, lastSuccess: null,
      lastError: null, lastDurationMs: 0, sourcesTotal: 0, sourcesOk: 0,
      sourcesFailed: 0, samplesWritten: 0, samplesSkippedDuplicate: 0,
      retentionDeleted: 0, lockStatus: "inactive",
    };
  }
}

function writeStatus(s: CollectorStatus): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2), "utf-8");
}

function runRetention(store: ReturnType<typeof createSliStore>): number {
  try {
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
    let deleted = 0;
    const s = store as unknown as Record<string, unknown>;
    if (typeof s.pruneBefore === "function") {
      (s.pruneBefore as (date: string) => void)(cutoff);
      deleted = 1;
    }
    return deleted;
  } catch (e: unknown) {
    return 0;
  }
}

function runOnce(): void {
  if (!acquireLock()) {
    const status = readStatus();
    status.lastError = "Lock held by another process";
    status.lockStatus = "locked";
    writeStatus(status);
    process.exit(0);
  }

  const status = readStatus();
  status.lastRunStarted = now();
  status.lastError = null;
  status.lockStatus = "running";

  try {
    const store = createSliStore();
    const allSli = collectAllSli(200);
    const sources = Object.keys(allSli);
    status.sourcesTotal = sources.length;
    status.sourcesOk = 0;
    status.sourcesFailed = 0;
    status.samplesWritten = 0;
    status.samplesSkippedDuplicate = 0;

    for (const [sliId, summary] of Object.entries(allSli)) {
      try {
        const sourceMap: Record<string, string> = {
          "notification-dispatch-latency": "notifications.db",
          "task-create-latency": "remote-tasks.db",
          "queue-pickup-latency": "remote-tasks.db",
          "scheduler-scan-latency": "scheduler.db",
          "mcp-success-rate": "write-audit.jsonl",
          "mcp-latency": "write-audit.jsonl",
          "dashboard-availability": "dashboard-api",
        };
        const record: SliRecord = {
          sliId,
          component: sliId.split("-")[0] || "unknown",
          value: summary.p95,
          unit: "ms",
          status: summary.sampleCount === 0 ? "insufficient_data" : "healthy",
          timestamp: summary.lastTimestamp || now(),
          projectId: "akm-bridge",
          environmentId: "local",
          source: sourceMap[sliId] || "unknown",
        };
        store.save([record]);
        status.samplesWritten++;
        if (summary.sampleCount > 0) status.sourcesOk++;
        else status.sourcesFailed++;
      } catch {
        status.sourcesFailed++;
      }
    }

    status.retentionDeleted = runRetention(store);
    status.lastSuccess = now();
    status.lastError = null;
    status.sourcesTotal = sources.length;
  } catch (e) {
    status.lastError = e instanceof Error ? e.message.substring(0, 500) : String(e).substring(0, 500);
  }

  status.lastRunFinished = now();
  status.lastDurationMs = status.lastRunStarted
    ? Date.now() - new Date(status.lastRunStarted).getTime()
    : 0;
  status.lockStatus = "idle";
  writeStatus(status);
  releaseLock();

  if (status.lastError && status.sourcesOk === 0) {
    console.error(`SLI collector failed: ${status.lastError}`);
    process.exit(1);
  }
  if (status.lastError) {
    console.error(`SLI collector degraded: ${status.lastError}`);
    process.exit(2);
  }
  console.log(`SLI collector: ${status.samplesWritten} samples, ${status.sourcesOk}/${status.sourcesTotal} sources OK`);
  process.exit(0);
}

function printStatus(): void {
  const s = readStatus();
  s.lockStatus = existsSync(LOCK_FILE) ? "locked" : "idle";
  console.log(JSON.stringify(s, null, 2));
}

const args = process.argv.slice(2);

if (args.includes("--status")) {
  printStatus();
} else if (args.includes("--loop")) {
  const interval = parseInt(args.find((a) => a.startsWith("--interval="))?.split("=")[1] || "60", 10);
  setInterval(runOnce, interval * 1000);
} else if (args.includes("--retention")) {
  const store = createSliStore();
  const deleted = runRetention(store);
  console.log(`Retention: deleted ${deleted} records`);
  process.exit(0);
} else {
  runOnce();
}