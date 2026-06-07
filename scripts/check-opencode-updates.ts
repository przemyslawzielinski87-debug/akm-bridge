#!/usr/bin/env bun
/**
 * check-opencode-updates.ts
 * Checks for available updates across the OpenCode ecosystem.
 *
 * Usage:
 *   bun run check-opencode-updates.ts [--check] [--json] [--include-plugins] [--include-mcp] [--include-runtime]
 *
 * Reads current versions from compatibility/opencode-version-lock.json,
 * compares against remote registries, and reports available updates.
 * Does NOT install anything.
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ComponentVersion {
  component: string;
  installed: string;
  latestStable: string;
  updateAvailable: boolean;
  updateType: "patch" | "minor" | "major" | "none";
  breakingChanges: boolean;
  securityFixes: boolean;
  recommendation: string;
}

interface UpdateReport {
  timestamp: string;
  lockFile: string;
  components: ComponentVersion[];
  summary: {
    total: number;
    updatable: number;
    patch: number;
    minor: number;
    major: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readLockFile(): Record<string, any> {
  const lockPath = path.resolve(__dirname, "../compatibility/opencode-version-lock.json");
  if (!fs.existsSync(lockPath)) {
    console.error(`Version lock not found: ${lockPath}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(lockPath, "utf-8"));
}

async function fetchJson(url: string, timeoutMs = 10000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function classifyUpdate(installed: string, latest: string): {
  updateType: "patch" | "minor" | "major" | "none";
  updateAvailable: boolean;
} {
  const parse = (v: string) => {
    const m = v.replace(/^[v^~]/, "").split(".").map(Number);
    return { major: m[0] || 0, minor: m[1] || 0, patch: m[2] || 0 };
  };

  if (!installed || !latest || installed === "unknown" || latest === "unknown") {
    return { updateType: "none", updateAvailable: false };
  }

  const cur = parse(installed);
  const lat = parse(latest);

  if (lat.major > cur.major) return { updateType: "major", updateAvailable: true };
  if (lat.minor > cur.minor) return { updateType: "minor", updateAvailable: true };
  if (lat.patch > cur.patch) return { updateType: "patch", updateAvailable: true };
  return { updateType: "none", updateAvailable: false };
}

function recommendation(type: "patch" | "minor" | "major" | "none"): string {
  switch (type) {
    case "patch": return "Apply — bugfix/security only, low risk";
    case "minor": return "Review changelog then apply — new features, backward compatible";
    case "major": return "CAUTION — breaking changes likely, test thoroughly before upgrading";
    case "none": return "Up to date";
  }
}

// ---------------------------------------------------------------------------
// Registry checks
// ---------------------------------------------------------------------------

async function checkNpmPackage(name: string): Promise<string | null> {
  try {
    const data = await fetchJson(`https://registry.npmjs.org/${name}/latest`);
    return data?.version || null;
  } catch (err: any) {
    console.error(`  [npm] Failed to fetch ${name}: ${err.message}`);
    return null;
  }
}

async function checkGitHubRelease(owner: string, repo: string): Promise<string | null> {
  try {
    const data = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
    );
    return data?.tag_name?.replace(/^v/, "") || null;
  } catch (err: any) {
    console.error(`  [github] Failed to fetch ${owner}/${repo}: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const includePlugins = args.includes("--include-plugins");
  const includeMcp = args.includes("--include-mcp");
  const includeRuntime = args.includes("--include-runtime");

  const lock = readLockFile();
  const components: ComponentVersion[] = [];

  // --- Core: OpenCode ---
  if (!jsonOutput) console.log("Checking OpenCode core...");
  const ocInstalled = lock.opencode?.version || "unknown";
  const ocLatest = await checkNpmPackage("opencode");
  if (ocLatest) {
    const { updateType, updateAvailable } = classifyUpdate(ocInstalled, ocLatest);
    components.push({
      component: "opencode",
      installed: ocInstalled,
      latestStable: ocLatest,
      updateAvailable,
      updateType,
      breakingChanges: updateType === "major",
      securityFixes: false,
      recommendation: recommendation(updateType),
    });
  }

  // --- Core: AKM ---
  if (!jsonOutput) console.log("Checking AKM...");
  const akmInstalled = lock.akm?.version || "unknown";
  const akmLatest = await checkNpmPackage("akm");
  if (akmLatest) {
    const { updateType, updateAvailable } = classifyUpdate(akmInstalled, akmLatest);
    components.push({
      component: "akm",
      installed: akmInstalled,
      latestStable: akmLatest,
      updateAvailable,
      updateType,
      breakingChanges: updateType === "major",
      securityFixes: false,
      recommendation: recommendation(updateType),
    });
  }

  // --- Core: AKM Bridge ---
  if (!jsonOutput) console.log("Checking AKM Bridge...");
  const abVersion = lock.akmBridge?.version || "unknown";
  const abLatest = await checkGitHubRelease("strategikon", "akm-bridge");
  if (abLatest) {
    const { updateType, updateAvailable } = classifyUpdate(abVersion, abLatest);
    components.push({
      component: "akm-bridge",
      installed: abVersion,
      latestStable: abLatest,
      updateAvailable,
      updateType,
      breakingChanges: updateType === "major",
      securityFixes: false,
      recommendation: recommendation(updateType),
    });
  }

  // --- Plugins (opt-in) ---
  if (includePlugins && lock.plugins) {
    if (!jsonOutput) console.log("Checking plugins...");
    for (const [name, version] of Object.entries(lock.plugins)) {
      const latest = await checkNpmPackage(name);
      if (latest) {
        const { updateType, updateAvailable } = classifyUpdate(version, latest);
        components.push({
          component: `plugin:${name}`,
          installed: version,
          latestStable: latest,
          updateAvailable,
          updateType,
          breakingChanges: updateType === "major",
          securityFixes: false,
          recommendation: recommendation(updateType),
        });
      }
    }
  }

  // --- Runtime (opt-in) ---
  if (includeRuntime) {
    if (!jsonOutput) console.log("Checking runtime...");
    const bunLatest = await checkNpmPackage("bun");
    if (bunLatest && lock.runtime?.bun) {
      const { updateType, updateAvailable } = classifyUpdate(lock.runtime.bun, bunLatest);
      components.push({
        component: "runtime:bun",
        installed: lock.runtime.bun,
        latestStable: bunLatest,
        updateAvailable,
        updateType,
        breakingChanges: updateType === "major",
        securityFixes: false,
        recommendation: recommendation(updateType),
      });
    }
    const nodeLatest = await checkNpmPackage("@types/node");
    // Node version check is approximate — we compare against known LTS
    if (lock.runtime?.node) {
      components.push({
        component: "runtime:node",
        installed: lock.runtime.node,
        latestStable: nodeLatest || "check manually",
        updateAvailable: false,
        updateType: "none",
        breakingChanges: false,
        securityFixes: false,
        recommendation: "Check https://nodejs.org for latest LTS",
      });
    }
  }

  // --- MCP Servers (opt-in, informational) ---
  if (includeMcp && lock.mcpServers) {
    if (!jsonOutput) console.log("Checking MCP servers...");
    for (const [name, status] of Object.entries(lock.mcpServers)) {
      components.push({
        component: `mcp:${name}`,
        installed: status,
        latestStable: "check registry",
        updateAvailable: false,
        updateType: "none",
        breakingChanges: false,
        securityFixes: false,
        recommendation: `MCP server "${name}" is ${status}. Check registry for updates.`,
      });
    }
  }

  // --- Summary ---
  const summary = {
    total: components.length,
    updatable: components.filter((c) => c.updateAvailable).length,
    patch: components.filter((c) => c.updateType === "patch").length,
    minor: components.filter((c) => c.updateType === "minor").length,
    major: components.filter((c) => c.updateType === "major").length,
  };

  const report: UpdateReport = {
    timestamp: new Date().toISOString(),
    lockFile: path.resolve(__dirname, "../compatibility/opencode-version-lock.json"),
    components,
    summary,
  };

  // --- Output ---
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Text table output
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                        OpenCode Update Report                                             ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Lock file: ${report.lockFile}`);
  console.log("");

  if (components.length === 0) {
    console.log("No components to check.");
    return;
  }

  // Table header
  const hdr = [
    "COMPONENT".padEnd(20),
    "INSTALLED".padEnd(12),
    "LATEST".padEnd(12),
    "UPDATE?".padEnd(10),
    "TYPE".padEnd(8),
    "RECOMMENDATION",
  ].join(" │ ");
  console.log("─".repeat(hdr.length));
  console.log(hdr);
  console.log("─".repeat(hdr.length));

  for (const c of components) {
    const flag = c.updateAvailable ? "YES" : "—";
    console.log(
      [
        c.component.padEnd(20),
        c.installed.padEnd(12),
        c.latestStable.padEnd(12),
        flag.padEnd(10),
        c.updateType.padEnd(8),
        c.recommendation,
      ].join(" │ "),
    );
  }

  console.log("─".repeat(hdr.length));
  console.log("");
  console.log(`Total: ${summary.total} │ Updatable: ${summary.updatable} │ Patch: ${summary.patch} │ Minor: ${summary.minor} │ Major: ${summary.major}`);
  console.log("");
  console.log("NOTE: This tool does NOT install updates. Review changelogs before upgrading.");
  if (summary.major > 0) {
    console.log("⚠ WARNING: Major updates available — breaking changes likely. Test before upgrading.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
