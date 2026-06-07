import {
  BenchmarkResult,
  BenchmarkStatus,
  BenchmarkThreshold,
  BaselineFile,
  BaselineEnvironment,
  computeStats,
  defaultThresholds,
  ResourceUsage,
} from "../src/performance/performance-types.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import { execSync, spawnSync } from "child_process";

const ROOT = resolve(import.meta.dirname, "..");
const BASELINE_PATH = join(ROOT, "performance", "baseline.json");
const CI_FLAG = process.argv.includes("--ci");
const COMPARE_FLAG = process.argv.includes("--compare");
const JSON_FLAG = process.argv.includes("--json");
const UPDATE_FLAG = process.argv.includes("--update-baseline");
const FILTER_FLAG = process.argv.includes("--component");
const FILTER_COMPONENT = FILTER_FLAG
  ? process.argv[process.argv.indexOf("--component") + 1] || ""
  : "";

const WARMUP = 2;
const MEASURE = 4;
const BIG_MEASURE = 2;

function measure(ms: number, memoryMb = 50, errorRate = 0): BenchmarkThreshold {
  const base = defaultThresholds(ms, memoryMb);
  if (CI_FLAG) {
    base.failPercent = 100;
    base.failAbsoluteMs = Math.max(base.failAbsoluteMs, 10000);
  }
  return base;
}

function now(): { ms: number; usage: ResourceUsage } {
  const mem = process.memoryUsage();
  return {
    ms: performance.now(),
    usage: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      cpuUserMicros: 0,
      cpuSystemMicros: 0,
    },
  };
}

async function measuredRun(
  fn: () => Promise<void> | void,
  warmupRuns: number,
  measureRuns: number,
  timeoutMs: number,
): Promise<{
  times: number[];
  rssPeak: number;
  heapPeak: number;
  errorCount: number;
}> {
  const times: number[] = [];
  let rssPeak = 0;
  let heapPeak = 0;
  let errorCount = 0;

  for (let i = 0; i < warmupRuns + measureRuns; i++) {
    const start = now();
    try {
      const result = fn();
      if (result instanceof Promise) {
        await Promise.race([
          result,
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error("timeout")), timeoutMs)
          ),
        ]);
      }
      const end = now();
      const elapsed = end.ms - start.ms;
      rssPeak = Math.max(rssPeak, end.usage.rssBytes);
      heapPeak = Math.max(heapPeak, end.usage.heapUsedBytes);
      if (i >= warmupRuns) times.push(elapsed);
    } catch {
      errorCount++;
    }
  }
  return { times, rssPeak, heapPeak, errorCount };
}

async function benchmark(
  id: string,
  component: string,
  scenario: string,
  category: BenchmarkResult["category"],
  fn: () => Promise<void> | void,
  expectedMs: number,
  warmupRuns = WARMUP,
  measureRuns = MEASURE,
  timeoutMs = 30000,
): Promise<BenchmarkResult> {
  if (FILTER_COMPONENT && component !== FILTER_COMPONENT) {
    return skipResult(id, component, scenario, category);
  }

  const { times, rssPeak, heapPeak, errorCount } = await measuredRun(
    fn,
    warmupRuns,
    measureRuns,
    timeoutMs,
  );

  const stats = computeStats(times);
  const errorRate = measureRuns > 0 ? errorCount / measureRuns : 0;
  const threshold = measure(expectedMs, Math.round(rssPeak / 1024 / 1024));

  let status: BenchmarkStatus = "pass";
  if (errorRate > 0.3 || stats.p95 > threshold.failAbsoluteMs * 1.5) {
    status = "fail";
  } else if (errorRate > 0.1 || stats.p95 > threshold.failAbsoluteMs) {
    status = "warn";
  }

  return {
    id,
    component,
    scenario,
    category,
    environment: CI_FLAG ? "ci" : "server",
    runs: measureRuns,
    warmupRuns,
    medianMs: Math.round(stats.median * 100) / 100,
    p95Ms: Math.round(stats.p95 * 100) / 100,
    minMs: Math.round(stats.min * 100) / 100,
    maxMs: Math.round(stats.max * 100) / 100,
    stdDevMs: Math.round(stats.stdDev * 100) / 100,
    cpuUserMs: 0,
    cpuSystemMs: 0,
    rssPeakBytes: rssPeak,
    heapPeakBytes: heapPeak,
    ioReadBytes: 0,
    ioWriteBytes: 0,
    errorRate,
    status,
    threshold,
    metadata: {},
    measuredAt: new Date().toISOString(),
  };
}

function skipResult(
  id: string,
  component: string,
  scenario: string,
  category: BenchmarkResult["category"],
): BenchmarkResult {
  const threshold = measure(0);
  return {
    id,
    component,
    scenario,
    category,
    environment: CI_FLAG ? "ci" : "server",
    runs: 0,
    warmupRuns: 0,
    medianMs: -1,
    p95Ms: -1,
    minMs: -1,
    maxMs: -1,
    stdDevMs: -1,
    cpuUserMs: 0,
    cpuSystemMs: 0,
    rssPeakBytes: 0,
    heapPeakBytes: 0,
    ioReadBytes: 0,
    ioWriteBytes: 0,
    errorRate: 0,
    status: "pass",
    threshold,
    metadata: { skipped: true },
    measuredAt: new Date().toISOString(),
  };
}

async function measureStartup(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  results.push(
    await benchmark(
      "startup-tsc",
      "typescript",
      "tsc --noEmit compile time",
      "startup",
      () => {
        execSync("bunx tsc --noEmit --pretty false", {
          cwd: ROOT,
          stdio: "pipe",
          timeout: 60000,
        });
      },
      5000,
      1,
      2,
      60000,
    ),
  );

  results.push(
    await benchmark(
      "startup-tsx-import",
      "tsx",
      "tsx import of a source file",
      "startup",
      async () => {
        await import("../src/performance/performance-types.js");
      },
      2000,
      1,
      3,
      30000,
    ),
  );

  results.push(
    await benchmark(
      "startup-build",
      "build",
      "full tsc build",
      "startup",
      () => {
        execSync("bun run build", {
          cwd: ROOT,
          stdio: "pipe",
          timeout: 120000,
        });
      },
      10000,
      1,
      2,
      120000,
    ),
  );

  return results;
}

type BenchmarkDB = {
  run: (sql: string, ...params: unknown[]) => unknown;
  prepare: (sql: string) => BenchmarkStmt;
  close: () => void;
};
type BenchmarkStmt = {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
};

async function measureSqlite(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  let DBClass: new (...args: unknown[]) => BenchmarkDB;
  try {
    const sqliteMod = await import("bun:sqlite") as { Database: unknown };
    DBClass = sqliteMod.Database as new (...args: unknown[]) => BenchmarkDB;
} catch {
    return results;
  }

  results.push(
    await benchmark(
      "sqlite-insert-1000",
      "sqlite",
      "insert 1000 rows",
      "sqlite",
      () => {
        const db = new DBClass(":memory:");
        db.run(
          "CREATE TABLE IF NOT EXISTS perf_test (id INTEGER PRIMARY KEY, name TEXT, value REAL)",
        );
        const stmt = db.prepare(
          "INSERT INTO perf_test (name, value) VALUES (?, ?)",
        );
        for (let i = 0; i < 1000; i++) {
          stmt.run(`row-${i}`, Math.random() * 1000);
        }
        db.close();
      },
      50,
      1,
      3,
      15000,
    ),
  );

  results.push(
    await benchmark(
      "sqlite-lookup-indexed",
      "sqlite",
      "indexed lookup 10k rows",
      "sqlite",
      () => {
        const db = new DBClass(":memory:");
        db.run(
          "CREATE TABLE perf_test (id INTEGER PRIMARY KEY, name TEXT, value REAL)",
        );
        db.run(
          "CREATE INDEX idx_perf_test_name ON perf_test(name)",
        );
        const stmt = db.prepare(
          "INSERT INTO perf_test (name, value) VALUES (?, ?)",
        );
        for (let i = 0; i < 10000; i++) {
          stmt.run(`row-${i}`, Math.random() * 1000);
        }
        const lookup = db.prepare(
          "SELECT * FROM perf_test WHERE name = ?",
        );
        for (let i = 0; i < 100; i++) {
          lookup.get(`row-${Math.floor(Math.random() * 10000)}`);
        }
        db.close();
      },
      100,
      1,
      3,
      15000,
    ),
  );

  results.push(
    await benchmark(
      "sqlite-concurrent-reads",
      "sqlite",
      "10 concurrent readers",
      "sqlite",
      () => {
        const dbs: Array<{ close(): void; prepare(sql: string): { get(...params: unknown[]): unknown }; run(sql: string, ...params: unknown[]): unknown }> = [];
        for (let i = 0; i < 10; i++) {
          const db = new DBClass(":memory:");
          db.run(
            "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)",
          );
          db.run("INSERT INTO t VALUES (1, 'test')");
          dbs.push(db);
        }
        for (const db of dbs) {
          db.prepare("SELECT * FROM t").get();
          db.close();
        }
      },
      30,
      1,
      3,
      15000,
    ),
  );

  return results;
}

async function measureDashboard(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  results.push(
    await benchmark(
      "dashboard-data-import",
      "dashboard",
      "import and generate dashboard data",
      "dashboard",
      async () => {
        const mod = await import(
          "../scripts/opencode-dashboard-data.js"
        ) as Record<string, unknown>;
        const fn = mod.generateDashboardData || mod.default;
        if (typeof fn === "function") {
          await (fn as () => Promise<void>)();
        }
      },
      500,
      1,
      2,
      30000,
    ),
  );

  results.push(
    await benchmark(
      "dashboard-e2e-import",
      "dashboard",
      "import and run e2e data generation",
      "dashboard",
      async () => {
        const mod = await import("../scripts/opencode-e2e.js") as Record<string, unknown>;
        const fn = mod.generateE2EData || mod.default;
        if (typeof fn === "function") {
          await (fn as () => Promise<void>)();
        }
      },
      500,
      1,
      2,
      30000,
    ),
  );

  return results;
}

async function measureScheduler(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  results.push(
    await benchmark(
      "scheduler-scan-100",
      "scheduler",
      "scan 100 schedules (mock)",
      "scheduler",
      () => {
        const schedules = Array.from({ length: 100 }, (_, i) => ({
          id: `sched-${i}`,
          cron: i % 2 === 0 ? "0 */6 * * *" : "*/15 * * * *",
          project: "akm-bridge",
          enabled: true,
        }));
        for (const s of schedules) {
          const parts = s.cron.split(" ");
          if (parts.length === 5) {
            const _minute = parts[0];
            const _hour = parts[1];
          }
        }
      },
      5,
      1,
      3,
      10000,
    ),
  );

  results.push(
    await benchmark(
      "scheduler-scan-1000",
      "scheduler",
      "scan 1000 schedules (mock)",
      "scheduler",
      () => {
        const schedules = Array.from({ length: 1000 }, (_, i) => ({
          id: `sched-${i}`,
          cron: i % 3 === 0
            ? "0 0 * * *"
            : i % 3 === 1
            ? "*/10 * * * *"
            : "0 */2 * * *",
          project: i % 2 === 0 ? "akm-bridge" : "the-meridian",
          enabled: true,
        }));
        for (const s of schedules) {
          const parts = s.cron.split(" ");
          if (parts.length === 5) {
            const _minute = parts[0];
            const _hour = parts[1];
          }
        }
      },
      10,
      1,
      3,
      10000,
    ),
  );

  return results;
}

async function measureMemory(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const mem = process.memoryUsage();
  const baselineRss = mem.rss;
  const baselineHeap = mem.heapUsed;

  const allocations: Array<() => void> = [];
  for (let i = 0; i < 1000; i++) {
    allocations.push(() => {
      const obj = { id: i, data: "x".repeat(1000), nested: { a: 1, b: 2, c: [1, 2, 3] } };
      JSON.stringify(obj);
    });
  }

  results.push(
    await benchmark(
      "memory-alloc-1000",
      "memory",
      "allocate and serialize 1000 objects",
      "memory",
      () => {
        for (const alloc of allocations) alloc();
      },
      50,
      1,
      BIG_MEASURE,
      15000,
    ),
  );

  globalThis.gc?.();
  const afterGc = process.memoryUsage();
  const leakBytes = afterGc.rss - baselineRss;

  results.push({
    id: "memory-gc-leak-check",
    component: "memory",
    scenario: "GC leak check (1000 allocations)",
    category: "memory",
    environment: CI_FLAG ? "ci" : "server",
    runs: 1,
    warmupRuns: 0,
    medianMs: 10,
    p95Ms: 10,
    minMs: 10,
    maxMs: 10,
    stdDevMs: 0,
    cpuUserMs: 0,
    cpuSystemMs: 0,
    rssPeakBytes: baselineRss,
    heapPeakBytes: baselineHeap,
    ioReadBytes: 0,
    ioWriteBytes: 0,
    errorRate: 0,
    status: leakBytes < 5 * 1024 * 1024 ? "pass" : "warn",
    threshold: measure(10, 200),
    metadata: { leakBytes, baselineRss, afterGcRss: afterGc.rss },
    measuredAt: new Date().toISOString(),
  });

  return results;
}

async function measureMCP(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  if (!CI_FLAG) {
    try {
      const httpPort = process.env.MCP_HTTP_PORT || "4201";
      results.push(
        await benchmark(
          "mcp-http-tools-list",
          "mcp",
          "HTTP GET /mcp/tools",
          "mcp",
          async () => {
            const resp = await fetch(
              `http://localhost:${httpPort}/mcp/tools`,
            );
            await resp.json();
          },
          100,
          1,
          3,
          15000,
        ),
      );
    } catch {
      results.push(skipResult("mcp-http-tools-list", "mcp", "HTTP GET (server down)", "mcp"));
    }
  } else {
    results.push(skipResult("mcp-http-tools-list", "mcp", "HTTP GET (CI skip)", "mcp"));
  }

  return results;
}

async function measureStartupOverhead(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  results.push(
    await benchmark(
      "startup-node-require",
      "runtime",
      "node -e require process startup",
      "startup",
      () => {
        execSync("node -e 'process.exit(0)'", {
          cwd: ROOT,
          stdio: "pipe",
          timeout: 10000,
        });
      },
      100,
      2,
      5,
      10000,
    ),
  );

  return results;
}

async function runAll(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  results.push(...(await measureStartupOverhead()));
  results.push(...(await measureStartup()));
  results.push(...(await measureSqlite()));
  results.push(...(await measureDashboard()));
  results.push(...(await measureScheduler()));
  results.push(...(await measureMemory()));
  results.push(...(await measureMCP()));

  return results;
}

async function saveBaseline(results: BenchmarkResult[]): Promise<void> {
  const env: BaselineEnvironment = {
    os: process.platform,
    arch: process.arch,
    cpuCores: 0,
    ramTotal: "0",
    bunVersion: process.env.BUN_VERSION || "unknown",
    nodeVersion: process.version,
  };

  try {
    const cpus = (await import("os")).cpus().length;
    env.cpuCores = cpus;
  } catch {}
  try {
    const mem = (await import("os")).totalmem();
    env.ramTotal = `${Math.round(mem / 1024 / 1024 / 1024)}Gi`;
  } catch {}

  const baseline: BaselineFile = {
    schemaVersion: 1,
    environment: env,
    benchmarks: Object.fromEntries(results.map((r) => [r.id, r])),
    thresholds: {
      latencyRegressionPercent: 20,
      memoryRegressionPercent: 20,
      startupRegressionPercent: 25,
      cpuRegressionPercent: 25,
      absoluteLimits: {},
    },
    validatedCommit: "",
    validatedAt: new Date().toISOString(),
  };

  try {
    baseline.validatedCommit = execSync("git rev-parse --short HEAD", {
      cwd: ROOT,
      stdio: "pipe",
    })
      .toString()
      .trim();
  } catch {}

  const dir = join(ROOT, "performance");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
  console.log(`Baseline saved to ${BASELINE_PATH}`);
}

function compareWithBaseline(
  results: BenchmarkResult[],
  baseline: BaselineFile,
): {
  regressions: Array<{
    benchmarkId: string;
    component: string;
    scenario: string;
    baselineMs: number;
    currentMs: number;
    regressionPercent: number;
    thresholdPercent: number;
    severity: "warn" | "fail";
  }>;
} {
  const regressions: Array<{
    benchmarkId: string;
    component: string;
    scenario: string;
    baselineMs: number;
    currentMs: number;
    regressionPercent: number;
    thresholdPercent: number;
    severity: "warn" | "fail";
  }> = [];

  for (const current of results) {
    const prev = baseline.benchmarks[current.id];
    if (!prev || prev.medianMs <= 0 || current.medianMs < 0) continue;

    const regression =
      ((current.medianMs - prev.medianMs) / prev.medianMs) * 100;
    const threshold = baseline.thresholds.latencyRegressionPercent;
    const severity = regression > threshold * 2 ? "fail" : "warn";

    if (regression > threshold) {
      regressions.push({
        benchmarkId: current.id,
        component: current.component,
        scenario: current.scenario,
        baselineMs: prev.medianMs,
        currentMs: current.medianMs,
        regressionPercent: Math.round(regression * 100) / 100,
        thresholdPercent: threshold,
        severity,
      });
    }
  }

  return { regressions };
}

function printReport(
  results: BenchmarkResult[],
  regressions: Array<{
    benchmarkId: string;
    component: string;
    scenario: string;
    baselineMs: number;
    currentMs: number;
    regressionPercent: number;
    thresholdPercent: number;
    severity: "warn" | "fail";
  }>,
  durationMs: number,
): void {
  const passed = results.filter((r) => r.status === "pass").length;
  const warned = results.filter((r) => r.status === "warn").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.metadata?.skipped).length;

  console.log("\n=== PERFORMANCE BASELINE REPORT ===\n");
  console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
  console.log(
    `Results: ${passed} passed, ${warned} warned, ${failed} failed, ${skipped} skipped`,
  );
  console.log("");

  for (const result of results) {
    if (result.metadata?.skipped) {
      console.log(`  [SKIP] ${result.id}`);
      continue;
    }
    const icon = result.status === "pass"
      ? "PASS"
      : result.status === "warn"
      ? "WARN"
      : "FAIL";
    console.log(
      `  [${icon}] ${result.id}: median=${result.medianMs}ms p95=${result.p95Ms}ms rss=${Math.round(result.rssPeakBytes / 1024 / 1024)}MB errors=${result.errorRate}`,
    );
  }

  if (regressions.length > 0) {
    console.log("\n--- Regressions ---");
    for (const r of regressions) {
      console.log(
        `  [${r.severity.toUpperCase()}] ${r.benchmarkId}: ${r.baselineMs}ms → ${r.currentMs}ms (${r.regressionPercent}%)`,
      );
    }
  }
  console.log("");
  console.log("================================");
}

async function main(): Promise<number> {
  const start = Date.now();

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`
Usage: tsx scripts/run-performance-baseline.ts [options]

Options:
  --all              Run all benchmarks (default)
  --json             Output JSON results
  --ci               CI mode (relaxed thresholds)
  --compare FILE     Compare against a baseline JSON file
  --update-baseline  Save current results as new baseline
  --component NAME   Run only benchmarks for a specific component
  --help             Show this help

Components: startup, sqlite, dashboard, scheduler, memory, mcp, runtime
`);
    return 0;
  }

  const results = await runAll();
  const durationMs = Date.now() - start;

  let regressions: Array<{
    benchmarkId: string;
    component: string;
    scenario: string;
    baselineMs: number;
    currentMs: number;
    regressionPercent: number;
    thresholdPercent: number;
    severity: "warn" | "fail";
  }> = [];

  if (COMPARE_FLAG) {
    const compareIdx = process.argv.indexOf("--compare");
    const comparePath = process.argv[compareIdx + 1];
    if (comparePath) {
      if (existsSync(comparePath)) {
        const baseline: BaselineFile = JSON.parse(
          readFileSync(comparePath, "utf-8"),
        );
        regressions = compareWithBaseline(results, baseline).regressions;
      } else {
        console.error(`Baseline file not found: ${comparePath}`);
      }
    }
  }

  if (UPDATE_FLAG) {
    await saveBaseline(results);
  }

  if (JSON_FLAG) {
    console.log(JSON.stringify({ results, regressions, durationMs }, null, 2));
  } else {
    printReport(results, regressions, durationMs);
  }

  const failures = results.filter((r) => r.status === "fail" && !r.metadata?.skipped);
  return failures.length > 0 ? 1 : 0;
}

main().then((code) => process.exit(code));