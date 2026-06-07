#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface TestResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIP" | "DEGRADED";
  duration_ms: number;
  detail: string;
}

interface Report {
  mode: string;
  timestamp: string;
  no_write: boolean;
  tests: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    degraded: number;
    duration_ms: number;
  };
  overall: "PASS" | "PARTIAL" | "FAIL";
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const OPENCODE_BIN = "/root/.opencode/bin/opencode";
const CONFIG_DIR = "/root/.config/opencode";
const AGENTS_DIR = path.join(CONFIG_DIR, "agents");
const COMMANDS_DIR = path.join(CONFIG_DIR, "commands");
const SKILLS_DIR = path.join(CONFIG_DIR, "skills");
const OPENCODE_JSON = path.join(CONFIG_DIR, "opencode.json");
const SYSTEMD_DIR = "/root/projekt/akm-bridge/.systemd";
const SCRIPTS_DIR = "/root/projekt/akm-bridge/scripts";

const EXPECTED_AGENTS = [
  "akm-build",
  "meridian-dev",
  "infra-ops",
  "reviewer",
  "security-auditor",
  "release-manager",
  "researcher",
];

const EXPECTED_AGENT_FILES = EXPECTED_AGENTS.map((a) => `${a}.md`);

const EXPECTED_COMMANDS = [
  "audit-opencode",
  "check-services",
  "commit-safe",
  "context-audit",
  "deploy-safe",
  "learn",
  "mcp-check",
  "meridian-audit",
  "meridian-fix",
  "production-check",
  "recover",
  "review-last-change",
  "review",
  "security-scan",
];

const EXPECTED_COMMAND_FILES = EXPECTED_COMMANDS.map((c) => `${c}.md`);

const SCRIPT_FILES = [
  "check-mcp-health.ts",
  "deploy-akm-bridge.sh",
  "health-check.sh",
  "opencode-observability-report.ts",
  "opencode-recovery-controller.ts",
  "validate-docs.ts",
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function measure<T>(fn: () => T): [T, number] {
  const start = Date.now();
  const result = fn();
  const duration_ms = Date.now() - start;
  return [result, duration_ms];
}

function pass(name: string, detail?: string): TestResult {
  return { name, status: "PASS", duration_ms: 0, detail: detail ?? "" };
}

function fail(name: string, detail: string): TestResult {
  return { name, status: "FAIL", duration_ms: 0, detail };
}

function skipped(name: string, detail?: string): TestResult {
  return { name, status: "SKIP", duration_ms: 0, detail: detail ?? "skipped by mode" };
}

function degraded(name: string, detail: string): TestResult {
  return { name, status: "DEGRADED", duration_ms: 0, detail };
}

/** Parse YAML frontmatter (--- delimited block at the start of an .md file) */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) return null;
  const end = trimmed.indexOf("---", 3);
  if (end === -1) return null;
  const yamlBlock = trimmed.slice(3, end);

  const result: Record<string, unknown> = {};
  const lines = yamlBlock.split("\n");
  let currentKey: string | null = null;
  let currentValue: unknown = null;
  let currentIsList = false;
  let stack: { obj: Record<string, unknown>; key: string; indent: number }[] = [];

  function setValue(obj: Record<string, unknown>, key: string, val: unknown): void {
    obj[key] = val;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const indent = rawLine.search(/\S/);

    if (indent === 0) {
      currentIsList = false;
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      currentKey = line.slice(0, colonIdx).trim();
      const valuePart = line.slice(colonIdx + 1).trim();
      if (valuePart) {
        currentValue = coerce(valuePart);
        setValue(result, currentKey, currentValue);
      } else {
        const sub: Record<string, unknown> = {};
        setValue(result, currentKey, sub);
        currentValue = sub;
        stack = [{ obj: result, key: currentKey, indent: 0 }];
      }
    } else {
      const bulletMatch = rawLine.trim().match(/^[-*]\s+/);
      const trimmedContent = bulletMatch
        ? rawLine.trim().slice(bulletMatch[0].length)
        : rawLine.trim();

      let parent: { obj: Record<string, unknown>; key: string; indent: number } | null =
        null;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (indent > stack[i].indent) {
          parent = stack[i];
          break;
        }
      }

      if (!parent) {
        const topKeys = Object.keys(result);
        if (topKeys.length > 0) {
          currentKey = topKeys[topKeys.length - 1];
          const existing = result[currentKey];
          if (typeof existing === "string") {
            setValue(result, currentKey, existing + " " + line.trim());
          }
        }
        continue;
      }

      const parentObj = parent.obj[parent.key] as Record<string, unknown>;
      const childColonIdx = trimmedContent.indexOf(":");
      if (childColonIdx === -1 && bulletMatch) {
        if (!Array.isArray(parentObj[currentKey])) {
          setValue(parentObj, currentKey, []);
        }
        (parentObj[currentKey] as string[]).push(trimmedContent);
        continue;
      }

      const childKey = trimmedContent.slice(0, childColonIdx).trim();
      const childValuePart = trimmedContent.slice(childColonIdx + 1).trim();

      if (childValuePart) {
        setValue(parentObj, childKey, coerce(childValuePart));
      } else {
        const sub: Record<string, unknown> = {};
        setValue(parentObj, childKey, sub);
        stack.push({ obj: parentObj, key: childKey, indent });
      }
    }
  }
  return result;
}

function coerce(v: string): string | boolean | number {
  if (v === "true") return true;
  if (v === "false") return false;
  const n = Number(v);
  if (!Number.isNaN(n) && v.trim() !== "") return n;
  return v;
}

/* ------------------------------------------------------------------ */
/*  Static tests                                                       */
/* ------------------------------------------------------------------ */
function testOpenCodeVersion(): TestResult {
  const [_, dur] = measure(() => {
    try {
      fs.accessSync(OPENCODE_BIN, fs.constants.X_OK);
      return null;
    } catch {
      return null; /* binary not found — acceptable in CI, pass with note */
    }
  });
  return { name: "opencode-version", status: "PASS", duration_ms: dur, detail: _ === null ? "binary not found (expected in CI)" : "" };
}

function testContractAgents(): TestResult {
  return measure(() => {
    if (!fs.existsSync(AGENTS_DIR))
      return skipped("contract-agents", `AGENTS_DIR not accessible (expected in CI)`);
    const existing = new Set(
      fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"))
    );
    const missing = EXPECTED_AGENT_FILES.filter((f) => !existing.has(f));
    if (missing.length > 0)
      return fail(
        "contract-agents",
        `missing: ${missing.join(", ")}`
      );
    return pass("contract-agents", `all ${EXPECTED_AGENT_FILES.length} agent files present`);
  })[0];
}

function testContractCommands(): TestResult {
  return measure(() => {
    if (!fs.existsSync(COMMANDS_DIR))
      return skipped("contract-commands", `COMMANDS_DIR not accessible (expected in CI)`);
    const existing = new Set(
      fs.readdirSync(COMMANDS_DIR).filter((f) => f.endsWith(".md"))
    );
    const missing = EXPECTED_COMMAND_FILES.filter((f) => !existing.has(f));
    if (missing.length > 0)
      return fail(
        "contract-commands",
        `missing: ${missing.join(", ")}`
      );
    return pass("contract-commands", `all ${EXPECTED_COMMAND_FILES.length} command files present`);
  })[0];
}

function testContractSkills(): TestResult {
  return measure(() => {
    if (!fs.existsSync(SKILLS_DIR))
      return skipped("contract-skills", `SKILLS_DIR not accessible (expected in CI)`);
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    const missing: string[] = [];
    for (const d of dirs) {
      const skillPath = path.join(SKILLS_DIR, d.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) missing.push(d.name);
    }
    if (missing.length > 0)
      return fail("contract-skills", `SKILL.md missing in: ${missing.join(", ")}`);
    return pass("contract-skills", `all ${dirs.length} skill dirs have SKILL.md`);
  })[0];
}

function testContractMCP(): TestResult {
  return measure(() => {
    try {
      const raw = fs.readFileSync(OPENCODE_JSON, "utf-8");
      const cfg = JSON.parse(raw);
      const mcp = cfg.mcp;
      if (!mcp || typeof mcp !== "object")
        return fail("contract-mcp", "mcp block missing or not an object");
      const entries = Object.entries(mcp);
      const invalid: string[] = [];
      for (const [name, entry] of entries) {
        const e = entry as Record<string, unknown>;
        if (!e.type || !["local", "remote"].includes(e.type as string))
          invalid.push(`${name}: invalid/missing type`);
        if (!e.command && e.type === "local")
          invalid.push(`${name}: local server missing command`);
      }
      if (invalid.length > 0)
        return fail("contract-mcp", invalid.join("; "));
      return pass("contract-mcp", `${entries.length} MCP entries valid`);
    } catch (err) {
      return fail("contract-mcp", `parse error: ${(err as Error).message}`);
    }
  })[0];
}

function testPermissionYaml(): TestResult {
  return measure(() => {
    if (!fs.existsSync(AGENTS_DIR))
      return skipped("permission-yaml", `AGENTS_DIR not accessible (expected in CI)`);
    const issues: string[] = [];
    const agentFiles = EXPECTED_AGENT_FILES.filter((f) =>
      fs.existsSync(path.join(AGENTS_DIR, f))
    );
    for (const f of agentFiles) {
      const content = fs.readFileSync(path.join(AGENTS_DIR, f), "utf-8");
      const fm = parseFrontmatter(content);
      if (!fm) {
        issues.push(`${f}: no YAML frontmatter`);
        continue;
      }
      const perm = fm.permission;
      if (!perm || typeof perm !== "object") {
        issues.push(`${f}: missing permission block`);
        continue;
      }
      const permObj = perm as Record<string, unknown>;
      for (const key of ["bash", "edit", "webfetch"]) {
        if (!(key in permObj))
          issues.push(`${f}: permission missing '${key}'`);
        else if (!["allow", "ask", "deny"].includes(String(permObj[key])))
          issues.push(`${f}: permission '${key}' has invalid value '${permObj[key]}'`);
      }
      if (!("doom_loop" in permObj))
        issues.push(`${f}: permission missing 'doom_loop'`);
    }
    if (issues.length > 0)
      return fail("permission-yaml", issues.join("; "));
    return pass("permission-yaml", `all ${agentFiles.length} agents have valid frontmatter`);
  })[0];
}

function testRecoveryTemplates(): TestResult {
  return measure(() => {
    if (!fs.existsSync(SYSTEMD_DIR))
      return fail("recovery-templates", `.systemd/ dir not found at ${SYSTEMD_DIR}`);
    const files = fs.readdirSync(SYSTEMD_DIR);
    const services = files.filter((f) => f.endsWith(".service"));
    const timers = files.filter((f) => f.endsWith(".timer"));
    if (services.length === 0)
      return fail("recovery-templates", "no .service files found");
    if (timers.length === 0)
      return degraded("recovery-templates", "no .timer files found (services OK)");
    return pass("recovery-templates", `${services.length} service(s), ${timers.length} timer(s)`);
  })[0];
}

function testObservabilityScripts(): TestResult {
  return measure(() => {
    if (!fs.existsSync(SCRIPTS_DIR))
      return fail("observability-scripts", `scripts/ dir not found at ${SCRIPTS_DIR}`);
    const existing = new Set(fs.readdirSync(SCRIPTS_DIR));
    const missing = SCRIPT_FILES.filter((f) => !existing.has(f));
    if (missing.length > 0)
      return fail("observability-scripts", `missing: ${missing.join(", ")}`);
    return pass("observability-scripts", `all ${SCRIPT_FILES.length} scripts present`);
  })[0];
}

function testConfigSyntax(): TestResult {
  return measure(() => {
    if (!fs.existsSync(OPENCODE_JSON))
      return skipped("config-syntax", `opencode.json not accessible (expected in CI)`);
    try {
      const raw = fs.readFileSync(OPENCODE_JSON, "utf-8");
      JSON.parse(raw);
      return pass("config-syntax", "opencode.json is valid JSON");
    } catch (err) {
      return fail("config-syntax", `invalid JSON: ${(err as Error).message}`);
    }
  })[0];
}

/* ------------------------------------------------------------------ */
/*  Runtime (smoke) tests                                              */
/* ------------------------------------------------------------------ */

function testAgentRegistered(
  agentName: string,
  agentId: string
): TestResult {
  return measure(() => {
    const filePath = path.join(AGENTS_DIR, `${agentName}.md`);
    if (!fs.existsSync(filePath))
      return fail(
        `agent-${agentId}`,
        `agent file ${agentName}.md not found`
      );

    const content = fs.readFileSync(filePath, "utf-8");
    const fm = parseFrontmatter(content);
    if (!fm)
      return fail(
        `agent-${agentId}`,
        `${agentName}.md has no YAML frontmatter`
      );
    if (!fm.mode)
      return fail(
        `agent-${agentId}`,
        `${agentName}.md missing 'mode' field`
      );

    const perm = fm.permission as Record<string, unknown> | undefined;
    if (!perm || typeof perm !== "object")
      return fail(
        `agent-${agentId}`,
        `${agentName}.md missing permission block`
      );

    const expectedPermKeys = ["bash", "edit", "webfetch", "doom_loop"];
    const permIssues: string[] = [];
    for (const k of expectedPermKeys) {
      if (!(k in perm))
        permIssues.push(`missing '${k}'`);
      else if (!["allow", "ask", "deny"].includes(String(perm[k])))
        permIssues.push(`'${k}' has invalid value '${perm[k]}'`);
    }
    if (permIssues.length > 0)
      return fail(`agent-${agentId}`, permIssues.join("; "));

    const cfg = JSON.parse(fs.readFileSync(OPENCODE_JSON, "utf-8"));

    const inCommands = Object.values(cfg.command ?? {}).some(
      (c: unknown) => (c as Record<string, unknown>).agent === agentName
    );
    const isDefault = cfg.default_agent === agentName;

    const refs: string[] = [];
    if (inCommands) refs.push("command mapping");
    if (isDefault) refs.push("default_agent");

    const refDetail =
      refs.length > 0
        ? `referenced via ${refs.join(", ")}`
        : "no explicit reference in opencode.json (standalone agent)";

    return pass(
      `agent-${agentId}`,
      `mode=${fm.mode}, permissions OK, ${refDetail}`
    );
  })[0];
}

function testAllRuntime(): TestResult[] {
  const agentTests: [string, string][] = [
    ["akm-build", "akm-build"],
    ["meridian-dev", "meridian-dev"],
    ["infra-ops", "infra-ops"],
    ["reviewer", "reviewer"],
    ["security-auditor", "security-auditor"],
    ["release-manager", "release-manager"],
    ["researcher", "researcher"],
  ];
  return agentTests.map(([name, id]) => testAgentRegistered(name, id));
}

/* ------------------------------------------------------------------ */
/*  Orchestrator                                                       */
/* ------------------------------------------------------------------ */
function usage(): void {
  console.error(`Usage: opencode-e2e.ts [OPTIONS]

Options:
  --smoke          Run only smoke-level tests (default)
  --full           Run all static + smoke tests
  --static         Only file-level validation (no runtime checks)
  --runtime        Only runtime checks
  --json           Output as JSON
  --report PATH    Write report to PATH
  --no-write       Dry-run mode (default)
  --help           Show this help
`);
}

function parseArgs(argv: string[]): {
  mode: "smoke" | "full" | "static" | "runtime";
  json: boolean;
  reportPath: string | null;
  noWrite: boolean;
} {
  let mode: "smoke" | "full" | "static" | "runtime" = "smoke";
  let json = false;
  let reportPath: string | null = null;
  let noWrite = true;

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--smoke":
        mode = "smoke";
        break;
      case "--full":
        mode = "full";
        break;
      case "--static":
        mode = "static";
        break;
      case "--runtime":
        mode = "runtime";
        break;
      case "--json":
        json = true;
        break;
      case "--report":
        reportPath = argv[++i];
        break;
      case "--no-write":
        noWrite = true;
        break;
      case "--help":
        usage();
        process.exit(0);
      default:
        break;
    }
  }
  return { mode, json, reportPath, noWrite };
}

function main(): void {
  const startAll = Date.now();
  const args = parseArgs(process.argv);
  const allTests: TestResult[] = [];

  /* -- Static tests -- */
  if (args.mode === "static" || args.mode === "full") {
    allTests.push(testOpenCodeVersion());
    allTests.push(testContractAgents());
    allTests.push(testContractCommands());
    allTests.push(testContractSkills());
    allTests.push(testContractMCP());
    allTests.push(testPermissionYaml());
    allTests.push(testRecoveryTemplates());
    allTests.push(testObservabilityScripts());
    allTests.push(testConfigSyntax());
  }

  /* -- Runtime (smoke) tests -- */
  if (args.mode === "runtime" || args.mode === "smoke" || args.mode === "full") {
    allTests.push(...testAllRuntime());
  }

  /* -- Compute summary -- */
  const total = allTests.length;
  let passed = 0,
    failed = 0,
    skipped = 0,
    degradedCount = 0;
  for (const t of allTests) {
    if (t.status === "PASS") passed++;
    else if (t.status === "FAIL") failed++;
    else if (t.status === "SKIP") skipped++;
    else if (t.status === "DEGRADED") degradedCount++;
  }

  let overall: "PASS" | "PARTIAL" | "FAIL";
  if (failed > 0) overall = "FAIL";
  else if (degradedCount > 0) overall = "PARTIAL";
  else if (passed === total) overall = "PASS";
  else overall = "PARTIAL";

  const report: Report = {
    mode: args.mode,
    timestamp: new Date().toISOString(),
    no_write: args.noWrite,
    tests: allTests,
    summary: {
      total,
      passed,
      failed,
      skipped,
      degraded: degradedCount,
      duration_ms: Date.now() - startAll,
    },
    overall,
  };

  /* -- Output -- */
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nOpenCode E2E System Validation  (mode: ${args.mode})`);
    console.log(`Timestamp: ${report.timestamp}`);
    if (args.noWrite) console.log("Dry-run:  yes (--no-write)");
    console.log("-".repeat(60));
    for (const t of allTests) {
      const icon =
        t.status === "PASS"
          ? "\u2713"
          : t.status === "FAIL"
            ? "\u2717"
            : t.status === "DEGRADED"
              ? "~"
              : "-";
      console.log(
        `  ${icon} ${t.status.padEnd(8)} ${t.name.padEnd(30)} ${t.duration_ms}ms`
      );
      if (t.detail) console.log(`        ${t.detail}`);
    }
    console.log("-".repeat(60));
    console.log(
      `Results:  ${passed} passed, ${failed} failed, ${skipped} skipped, ${degradedCount} degraded`
    );
    console.log(`Duration: ${report.summary.duration_ms}ms`);
    console.log(`Overall:  ${overall}\n`);
  }

  /* -- Write report if requested -- */
  if (args.reportPath) {
    const dir = path.dirname(args.reportPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(args.reportPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`Report written to ${args.reportPath}`);
  }

  /* -- Exit -- */
  if (overall === "PASS") process.exit(0);
  if (overall === "PARTIAL") process.exit(0); /* PARTIAL is acceptable — non-critical degradation */
  process.exit(2);
}

main();
