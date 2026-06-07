import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadPolicy() {
  const path = resolve(root, "config/slo/slo-policy.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

interface BudgetEntry {
  sloId: string;
  sliId: string;
  targetPercent: number;
  budgetPercentPerWindow: number;
  status: string;
  totalBudget: number;
  consumedPercent: number;
  remainingPercent: number;
  source: string;
}

interface BudgetReport {
  timestamp: string;
  window: string;
  policies: BudgetEntry[];
  summary: { total: number; healthy: number; warning: number; exhausted: number };
}

function now(): string {
  return new Date().toISOString();
}

const args = process.argv.slice(2);
const windowFlag = args.find((a) => a.startsWith("--window"));
const windowHours = windowFlag ? parseInt(windowFlag.split("=")[1], 10) || 24 : 24;

const policy = loadPolicy();

const sliToSloMap: Record<string, string> = {};
for (const slo of policy.slos || []) {
  sliToSloMap[slo.sliId] = slo.id;
}

const sliSources: Record<string, () => { successRate: number; count: number }> = {
  "task-create-latency": () => {
    try {
      const { collectTaskLatency, computeSliSummary } = require(resolve(root, "src/slo/sli-collector.js"));
      const result = collectTaskLatency(50);
      const summary = computeSliSummary(result.samples.filter((s: { sliId: string }) => s.sliId === "task-create-latency"));
      return { successRate: summary.successRate, count: summary.sampleCount };
    } catch {
      return { successRate: 0, count: 0 };
    }
  },
  "queue-pickup-latency": () => {
    try {
      const { collectTaskLatency, computeSliSummary } = require(resolve(root, "src/slo/sli-collector.js"));
      const result = collectTaskLatency(50);
      const summary = computeSliSummary(result.samples.filter((s: { sliId: string }) => s.sliId === "queue-pickup-latency"));
      return { successRate: summary.successRate, count: summary.sampleCount };
    } catch {
      return { successRate: 0, count: 0 };
    }
  },
  "notification-dispatch-latency": () => {
    try {
      const { collectNotificationLatency, computeSliSummary } = require(resolve(root, "src/slo/sli-collector.js"));
      const result = collectNotificationLatency(50);
      const summary = computeSliSummary(result.samples);
      return { successRate: summary.successRate, count: summary.sampleCount };
    } catch {
      return { successRate: 0, count: 0 };
    }
  },
  "scheduler-scan-latency": () => {
    try {
      const { collectScheduleLatency, computeSliSummary } = require(resolve(root, "src/slo/sli-collector.js"));
      const result = collectScheduleLatency(50);
      const summary = computeSliSummary(result.samples);
      return { successRate: summary.successRate, count: summary.sampleCount };
    } catch {
      return { successRate: 0, count: 0 };
    }
  },
  "mcp-success-rate": () => {
    try {
      const { collectWriteAuditLatency, computeSliSummary } = require(resolve(root, "src/slo/sli-collector.js"));
      const result = collectWriteAuditLatency(50);
      const summary = computeSliSummary(result.samples);
      return { successRate: summary.successRate, count: summary.sampleCount };
    } catch {
      return { successRate: 0, count: 0 };
    }
  },
  "dashboard-availability": () => {
    try {
      const { collectAvailability, computeSliSummary } = require(resolve(root, "src/slo/sli-collector.js"));
      const result = collectAvailability();
      const summary = computeSliSummary(result.samples);
      return { successRate: summary.successRate, count: summary.sampleCount };
    } catch {
      return { successRate: 0, count: 0 };
    }
  },
};

const budgets: BudgetEntry[] = (policy.slos || []).map(
  (slo: { sloId: string; sliId: string; targetPercent: number; budgetPercentPerWindow: number }) => {
    const budgetPercent = slo.budgetPercentPerWindow || 5;
    const totalBudget = Math.round(
      (budgetPercent / 100) * 86400000 * (windowHours / 24)
    );
    const collector = sliSources[slo.sliId];
    let consumedPercent = 0;
    let source = "no_data";
    if (collector) {
      const data = collector();
      source = data.count > 0 ? "real" : "no_data";
      if (data.count > 0 && data.successRate < 100) {
        consumedPercent = Math.max(0, ((100 - data.successRate) / 100) * 100);
      } else if (data.count > 0) {
        consumedPercent = data.successRate >= slo.targetPercent ? 0 : 10;
      }
    }
    let status: string;
    if (source === "no_data") {
      status = "insufficient_data";
    } else if (consumedPercent >= 100) {
      status = "exhausted";
    } else if (consumedPercent >= budgetPercent * 0.7) {
      status = "warning";
    } else {
      status = "healthy";
    }
    return {
      sloId: slo.sloId || slo.sliId,
      sliId: slo.sliId,
      targetPercent: slo.targetPercent,
      budgetPercentPerWindow: budgetPercent,
      status,
      totalBudget,
      consumedPercent: Math.round(consumedPercent * 100) / 100,
      remainingPercent: Math.round(Math.max(0, 100 - consumedPercent) * 100) / 100,
      source,
    };
  }
);

const report: BudgetReport = {
  timestamp: now(),
  window: `${windowHours}h`,
  policies: budgets,
  summary: {
    total: budgets.length,
    healthy: budgets.filter((b) => b.status === "healthy").length,
    warning: budgets.filter((b) => b.status === "warning").length,
    exhausted: budgets.filter((b) => b.status === "exhausted").length,
  },
};

if (args.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\nError Budget Report (window: ${windowHours}h)`);
  console.log("─".repeat(60));
  for (const b of budgets) {
    const icon =
      b.status === "healthy"
        ? "✓"
        : b.status === "warning"
          ? "⚠"
          : b.status === "exhausted"
            ? "✗"
            : "?";
    console.log(
      `  ${icon} ${b.sloId}: ${b.consumedPercent}% consumed (${b.source})`
    );
  }
  console.log("─".repeat(60));
  console.log(
    `  ${report.summary.healthy} healthy, ${report.summary.warning} warning, ${report.summary.exhausted} exhausted`
  );
}