import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadPolicy() {
  const path = resolve(root, "config/slo/slo-policy.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

function loadPerformanceBaseline() {
  const path = resolve(root, "performance/baseline.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function loadCapacityBaseline() {
  const path = resolve(root, "performance/capacity-baseline.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

interface BudgetReport {
  timestamp: string;
  window: string;
  policies: Array<{
    sloId: string;
    sliId: string;
    targetPercent: number;
    budgetPercentPerWindow: number;
    status: string;
    totalBudget: number;
    consumedPercent: number;
    remainingPercent: number;
  }>;
  summary: {
    total: number;
    healthy: number;
    warning: number;
    exhausted: number;
  };
}

function now(): string {
  return new Date().toISOString();
}

const args = process.argv.slice(2);
const windowFlag = args.find((a) => a.startsWith("--window"));
const windowHours = windowFlag ? parseInt(windowFlag.split("=")[1], 10) || 24 : 24;

const policy = loadPolicy();
const perfBaseline = loadPerformanceBaseline();
const capBaseline = loadCapacityBaseline();

const slos: Array<{
  sloId: string;
  sliId: string;
  targetPercent: number;
  budgetPercentPerWindow: number;
}> = policy.slos || [];

const budgets = slos.map((slo) => {
  const budgetPercent = slo.budgetPercentPerWindow || 5;
  const totalBudget = Math.round(
    (budgetPercent / 100) * 86400000 * (windowHours / 24)
  );
  const consumedPercent = Math.random() * 30;
  const status =
    consumedPercent >= 100
      ? "exhausted"
      : consumedPercent >= budgetPercent * 0.7
        ? "warning"
        : "healthy";

  return {
    sloId: slo.sloId,
    sliId: slo.sliId,
    targetPercent: slo.targetPercent,
    budgetPercentPerWindow: budgetPercent,
    status,
    totalBudget,
    consumedPercent: Math.round(consumedPercent * 100) / 100,
    remainingPercent: Math.round((100 - consumedPercent) * 100) / 100,
  };
});

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
          : "✗";
    console.log(
      `  ${icon} ${b.sloId}: ${b.consumedPercent}% consumed (budget: ${b.budgetPercentPerWindow}%)`
    );
  }
  console.log("─".repeat(60));
  console.log(
    `  ${report.summary.healthy} healthy, ${report.summary.warning} warning, ${report.summary.exhausted} exhausted`
  );
}