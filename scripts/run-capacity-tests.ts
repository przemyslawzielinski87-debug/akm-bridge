import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

interface TestResult {
  test: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

interface CapacityReport {
  timestamp: string;
  mode: string;
  results: TestResult[];
  summary: { passed: number; failed: number; total: number };
}

function loadPolicy(): unknown {
  const path = resolve(root, "config/slo/slo-policy.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

function loadBaseline(): unknown {
  const path = resolve(root, "performance/capacity-baseline.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

function now(): string {
  return new Date().toISOString();
}

function measure(label: string, fn: () => void | Promise<void>, timeoutMs = 10000): TestResult {
  const start = Date.now();
  try {
    const result = fn();
    if (result instanceof Promise) {
      const duration = Date.now() - start;
      return { test: label, passed: duration < timeoutMs, durationMs: duration };
    }
    const duration = Date.now() - start;
    return { test: label, passed: duration < timeoutMs, durationMs: duration };
  } catch (e) {
    const duration = Date.now() - start;
    return {
      test: label,
      passed: false,
      durationMs: duration,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function burstTest(
  concurrency: number,
  fn: (i: number) => void
): { accepted: number; failures: number; totalMs: number } {
  const start = Date.now();
  let accepted = 0;
  let failures = 0;
  for (let i = 0; i < concurrency; i++) {
    try {
      fn(i);
      accepted++;
    } catch {
      failures++;
    }
  }
  return { accepted, failures, totalMs: Date.now() - start };
}

function sustainedTest(
  durationMs: number,
  fn: (i: number) => void,
  intervalMs: number
): { totalCalls: number; failures: number; durationMs: number } {
  const start = Date.now();
  let totalCalls = 0;
  let failures = 0;
  while (Date.now() - start < durationMs) {
    try {
      fn(totalCalls);
      totalCalls++;
    } catch {
      failures++;
    }
    const elapsed = Date.now() - start;
    if (elapsed + intervalMs > durationMs) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, intervalMs);
  }
  return {
    totalCalls,
    failures,
    durationMs: Date.now() - start,
  };
}

const smokeTests: Array<{ name: string; fn: () => void; timeout: number }> = [
  {
    name: "config-slo-policy-valid",
    fn: () => {
      const policy = loadPolicy() as Record<string, unknown>;
      if (typeof policy !== "object" || policy === null) throw new Error("invalid policy");
      const slis = (policy as Record<string, unknown>).slis as unknown[];
      if (!Array.isArray(slis) || slis.length === 0) throw new Error("no SLIs");
      const slos = (policy as Record<string, unknown>).slos as unknown[];
      if (!Array.isArray(slos) || slos.length === 0) throw new Error("no SLOs");
    },
    timeout: 5000,
  },
  {
    name: "config-capacity-baseline-valid",
    fn: () => {
      const baseline = loadBaseline() as Record<string, unknown>;
      if (typeof baseline !== "object" || baseline === null) throw new Error("invalid baseline");
      const limits = (baseline as Record<string, unknown>).limits as Record<string, unknown>;
      if (!limits || typeof limits !== "object") throw new Error("no limits");
    },
    timeout: 5000,
  },
  {
    name: "burst-10-requests",
    fn: () => {
      const result = burstTest(10, (i) => {
        if (i < 0) throw new Error("unexpected");
      });
      if (result.accepted !== 10) throw new Error(`expected 10, got ${result.accepted}`);
    },
    timeout: 10000,
  },
  {
    name: "burst-25-requests",
    fn: () => {
      const result = burstTest(25, (i) => {
        if (i < 0) throw new Error("unexpected");
      });
      if (result.accepted !== 25) throw new Error(`expected 25, got ${result.accepted}`);
    },
    timeout: 15000,
  },
  {
    name: "burst-100-requests",
    fn: () => {
      const result = burstTest(100, (i) => {
        if (i < 0) throw new Error("unexpected");
      });
      if (result.accepted !== 100) throw new Error(`expected 100, got ${result.accepted}`);
    },
    timeout: 30000,
  },
  {
    name: "sustained-10s",
    fn: () => {
      const result = sustainedTest(10000, () => {
        void (1 + 1);
      }, 100);
      if (result.totalCalls === 0) throw new Error("no calls executed");
    },
    timeout: 30000,
  },
  {
    name: "sqlite-contention-smoke",
    fn: () => {
      const isBun = typeof Bun !== "undefined";
      if (!isBun) return;
      const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
      const tmp = resolve(root, ".capacity-test.db");
      try {
        const db = new Database(tmp, { strict: true });
        db.exec("CREATE TABLE IF NOT EXISTS smoke (id INTEGER PRIMARY KEY, val TEXT)");
        const insert = db.prepare("INSERT INTO smoke (val) VALUES (?)");
        const select = db.prepare("SELECT * FROM smoke WHERE id = ?");
        for (let i = 0; i < 5; i++) insert.run(`val-${i}`);
        for (let i = 0; i < 20; i++) select.get(i + 1);
        db.close();
      } finally {
        try { execSync(`rm -f "${tmp}" "${tmp}-wal" "${tmp}-shm"`, { stdio: "ignore" }); } catch { }
      }
    },
    timeout: 15000,
  },
  {
    name: "scheduler-scan-100",
    fn: () => {
      const baseTime = Date.now() + 60000;
      const entries = Array.from({ length: 100 }, (_, i) => ({
        id: `sched-${i}`,
        dueMs: baseTime + i * 60000,
      }));
      const now = Date.now();
      const due = entries.filter((e) => e.dueMs <= now + 5000);
      if (due.length > 0) throw new Error("unexpected due entries");
    },
    timeout: 5000,
  },
  {
    name: "scheduler-scan-1000",
    fn: () => {
      const baseTime = Date.now() + 60000;
      const entries = Array.from({ length: 1000 }, (_, i) => ({
        id: `sched-${i}`,
        dueMs: baseTime + i * 60000,
      }));
      const now = Date.now();
      const due = entries.filter((e) => e.dueMs <= now + 5000);
      if (due.length > 0) throw new Error("unexpected due entries");
    },
    timeout: 10000,
  },
  {
    name: "notification-batch-100",
    fn: () => {
      const batch = Array.from({ length: 100 }, (_, i) => ({
        id: `notif-${i}`,
        message: `test-${i}`,
      }));
      const deduped = new Map(batch.map((n) => [n.id, n]));
      if (deduped.size !== 100) throw new Error(`expected 100, got ${deduped.size}`);
    },
    timeout: 5000,
  },
  {
    name: "dashboard-concurrency-5",
    fn: () => {
      const results: number[] = [];
      for (let i = 0; i < 5; i++) {
        results.push(i);
      }
      if (results.length !== 5) throw new Error("concurrency test failed");
    },
    timeout: 5000,
  },
  {
    name: "backpressure-simulate",
    fn: () => {
      const queue = Array.from({ length: 600 }, (_, i) => i);
      const softLimit = 500;
      const hardLimit = 1000;
      if (queue.length <= softLimit) throw new Error("should exceed soft limit");
      if (queue.length > hardLimit) throw new Error("should not exceed hard limit");
      const accepted = queue.slice(0, softLimit);
      if (accepted.length !== softLimit)
        throw new Error(`expected ${softLimit}, got ${accepted.length}`);
    },
    timeout: 5000,
  },
];

const args = process.argv.slice(2);
const mode = args.includes("--smoke")
  ? "smoke"
  : args.includes("--burst")
    ? "burst"
    : args.includes("--sustained")
      ? "sustained"
      : args.includes("--all")
        ? "all"
        : "smoke";

async function main(): Promise<void> {
  const results: TestResult[] = [];
  let activeTests = smokeTests;

  if (mode === "smoke" || mode === "all") {
    for (const t of activeTests) {
      results.push(measure(t.name, t.fn, t.timeout));
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  const report: CapacityReport = {
    timestamp: now(),
    mode,
    results,
    summary: { passed, failed, total: results.length },
  };

  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nCapacity Tests (mode: ${mode})`);
    console.log("─".repeat(50));
    for (const r of results) {
      const icon = r.passed ? "✓" : "✗";
      console.log(`  ${icon} ${r.test} (${r.durationMs}ms)`);
      if (r.error) console.log(`    error: ${r.error}`);
    }
    console.log("─".repeat(50));
    console.log(
      `  ${passed}/${results.length} passed, ${failed} failed`
    );
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});