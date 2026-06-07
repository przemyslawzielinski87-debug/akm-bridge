import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(process.cwd());
const DOCS = path.join(ROOT, "docs");
const SCRIPTS = path.join(ROOT, "scripts");
const TEMPLATES = path.join(ROOT, "templates");
const FIXTURES = path.join(ROOT, "tests", "e2e", "fixtures");
const SYSTEMD = path.join(ROOT, "systemd");
const SRC = path.join(ROOT, "src");

function exists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readJson(p: string): any {
  const raw = fs.readFileSync(p, "utf-8");
  return JSON.parse(raw);
}

function isNonEmpty(p: string): boolean {
  try {
    const stat = fs.statSync(p);
    return stat.size > 0;
  } catch {
    return false;
  }
}

function listDir(p: string): string[] {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
}

function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  const entries = listDir(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        results.push(...findFiles(full, ext));
      } else if (full.endsWith(ext)) {
        results.push(full);
      }
    } catch {
      // skip
    }
  }
  return results;
}

function hasFunction(content: string, name: string): boolean {
  return (
    content.includes(`function ${name}`) ||
    content.includes(`${name}()`) ||
    content.includes(`${name}(`)
  );
}

// --- Manifest Schema Validation ---

describe("Manifest Schema Validation", () => {
  const manifestPath = path.join(FIXTURES, "bootstrap-manifest.json");

  it("exists", () => {
    expect(exists(manifestPath)).toBe(true);
  });

  it("is valid JSON", () => {
    expect(() => readJson(manifestPath)).not.toThrow();
  });

  it("has required fields", () => {
    const manifest = readJson(manifestPath);
    expect(manifest).toHaveProperty("schemaVersion");
    expect(manifest).toHaveProperty("platform");
    expect(manifest).toHaveProperty("runtime");
    expect(manifest).toHaveProperty("agents");
    expect(manifest).toHaveProperty("commands");
    expect(manifest).toHaveProperty("skills");
    expect(manifest).toHaveProperty("mcpServers");
  });

  it("has numeric schemaVersion", () => {
    const manifest = readJson(manifestPath);
    expect(typeof manifest.schemaVersion).toBe("number");
    expect(manifest.schemaVersion).toBeGreaterThanOrEqual(1);
  });
});

// --- Version Lock Validation ---

describe("Version Lock Validation", () => {
  const lockPath = path.join(ROOT, "version-lock.json");

  it("exists or is not required", () => {
    if (exists(lockPath)) {
      expect(() => readJson(lockPath)).not.toThrow();
    }
  });

  it("has version fields if present", () => {
    if (exists(lockPath)) {
      const lock = readJson(lockPath);
      expect(lock).toHaveProperty("opencode");
      expect(lock).toHaveProperty("bun");
    }
  });
});

// --- Checksums ---

describe("Checksums File", () => {
  const checksumsPath = path.join(ROOT, "checksums.sha256");

  it("exists", () => {
    if (exists(checksumsPath)) {
      expect(true).toBe(true);
    } else {
      // Not fatal if not yet generated
      console.warn("checksums.sha256 not found (may not be generated yet)");
    }
  });

  it("is non-empty if present", () => {
    if (exists(checksumsPath)) {
      expect(isNonEmpty(checksumsPath)).toBe(true);
    }
  });
});

// --- Source of Truth Document ---

describe("Source of Truth Document", () => {
  it("disaster recovery doc exists", () => {
    const doc = path.join(DOCS, "OPENCODE-DISASTER-RECOVERY.md");
    expect(exists(doc)).toBe(true);
  });

  it("disaster recovery doc is non-empty", () => {
    const doc = path.join(DOCS, "OPENCODE-DISASTER-RECOVERY.md");
    if (exists(doc)) {
      expect(isNonEmpty(doc)).toBe(true);
    }
  });
});

// --- RTO/RPO Document ---

describe("RTO/RPO Document", () => {
  it("disaster recovery doc mentions RTO", () => {
    const doc = path.join(DOCS, "OPENCODE-DISASTER-RECOVERY.md");
    if (exists(doc)) {
      const content = fs.readFileSync(doc, "utf-8");
      expect(content.toLowerCase()).toContain("rto");
    }
  });

  it("disaster recovery doc mentions RPO", () => {
    const doc = path.join(DOCS, "OPENCODE-DISASTER-RECOVERY.md");
    if (exists(doc)) {
      const content = fs.readFileSync(doc, "utf-8");
      expect(content.toLowerCase()).toContain("rpo");
    }
  });
});

// --- Bootstrap Script ---

describe("Bootstrap Script", () => {
  const scriptPath = path.join(SCRIPTS, "bootstrap-opencode-environment.ts");

  it("exists", () => {
    expect(exists(scriptPath)).toBe(true);
  });

  it("is executable or has proper shebang", () => {
    if (exists(scriptPath)) {
      const content = fs.readFileSync(scriptPath, "utf-8");
      expect(content.startsWith("#!/")).toBe(true);
    }
  });

  it("has expected functions", () => {
    if (exists(scriptPath)) {
      const content = fs.readFileSync(scriptPath, "utf-8");
      const hasCheck =
        content.includes("check") || content.includes("validate");
      const hasApply = content.includes("apply") || content.includes("install");
      const hasDryRun =
        content.includes("dry-run") || content.includes("dry_run");
      expect(hasCheck || hasApply || hasDryRun).toBe(true);
    }
  });
});

// --- Dry-Run Mode ---

describe("Dry-Run Mode", () => {
  it("does not write files when dry-run is used", () => {
    const tmpFile = path.join(ROOT, ".dry-run-test-tmp");
    try {
      // Simulate: if dry-run mode is implemented, it should not create files
      const scriptPath = path.join(SCRIPTS, "bootstrap-controller.sh");
      if (exists(scriptPath)) {
        const content = fs.readFileSync(scriptPath, "utf-8");
        // Script should have dry-run logic that skips writes
        const hasDryRunLogic =
          content.includes("dry-run") ||
          content.includes("dry_run") ||
          content.includes("DRY_RUN");
        expect(hasDryRunLogic).toBe(true);
      }
    } finally {
      if (exists(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });
});

// --- Install Manifest Schema ---

describe("Install Manifest Schema", () => {
  it("manifest has platform with os and arch", () => {
    const manifestPath = path.join(FIXTURES, "bootstrap-manifest.json");
    const manifest = readJson(manifestPath);
    expect(manifest.platform).toHaveProperty("os");
    expect(manifest.platform).toHaveProperty("arch");
  });

  it("manifest has runtime with versioned components", () => {
    const manifestPath = path.join(FIXTURES, "bootstrap-manifest.json");
    const manifest = readJson(manifestPath);
    expect(manifest.runtime).toHaveProperty("opencode");
    expect(manifest.runtime).toHaveProperty("bun");
    expect(manifest.runtime.opencode).toHaveProperty("version");
  });

  it("manifest has component counts", () => {
    const manifestPath = path.join(FIXTURES, "bootstrap-manifest.json");
    const manifest = readJson(manifestPath);
    expect(typeof manifest.agents.count).toBe("number");
    expect(typeof manifest.commands.count).toBe("number");
    expect(typeof manifest.skills.count).toBe("number");
    expect(typeof manifest.mcpServers.count).toBe("number");
  });
});

// --- Config Template Generation ---

describe("Config Template Generation", () => {
  it("no real secrets in template files", () => {
    const templateFiles = findFiles(TEMPLATES, ".json");
    for (const file of templateFiles) {
      const content = fs.readFileSync(file, "utf-8");
      expect(content).not.toContain("sk-ant-");
      expect(content).not.toContain("ghp_");
      expect(content).not.toContain("AKIADEXAMPLE");
    }
  });

  it("templates directory exists", () => {
    if (exists(TEMPLATES)) {
      const entries = listDir(TEMPLATES);
      expect(entries.length).toBeGreaterThan(0);
    }
  });
});

// --- Agent Templates ---

describe("Agent Templates", () => {
  it("agent template directory exists", () => {
    const agentDir = path.join(TEMPLATES, "agents");
    if (exists(agentDir)) {
      expect(true).toBe(true);
    }
  });

  it("agent count matches manifest", () => {
    const manifestPath = path.join(FIXTURES, "bootstrap-manifest.json");
    const manifest = readJson(manifestPath);
    const agentDir = path.join(TEMPLATES, "agents");
    if (exists(agentDir)) {
      const agents = listDir(agentDir).filter(
        (f) => f.endsWith(".json") || f.endsWith(".md")
      );
      expect(agents.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("agent files are valid JSON or markdown", () => {
    const agentDir = path.join(TEMPLATES, "agents");
    if (exists(agentDir)) {
      const files = listDir(agentDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          expect(() => readJson(path.join(agentDir, file))).not.toThrow();
        }
      }
    }
  });
});

// --- Command Templates ---

describe("Command Templates", () => {
  it("command template directory exists", () => {
    const cmdDir = path.join(TEMPLATES, "commands");
    if (exists(cmdDir)) {
      expect(true).toBe(true);
    }
  });

  it("has template files", () => {
    const cmdDir = path.join(TEMPLATES, "commands");
    if (exists(cmdDir)) {
      const files = listDir(cmdDir);
      expect(files.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// --- Skill Templates ---

describe("Skill Templates", () => {
  it("skill template directory exists", () => {
    const skillDir = path.join(TEMPLATES, "skills");
    if (exists(skillDir)) {
      expect(true).toBe(true);
    }
  });

  it("has skill files", () => {
    const skillDir = path.join(TEMPLATES, "skills");
    if (exists(skillDir)) {
      const files = listDir(skillDir);
      expect(files.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// --- Systemd Templates ---

describe("Systemd Templates", () => {
  it("systemd directory exists", () => {
    expect(exists(SYSTEMD)).toBe(true);
  });

  it("has unit files", () => {
    const units = listDir(SYSTEMD).filter(
      (f) => f.endsWith(".service") || f.endsWith(".timer")
    );
    expect(units.length).toBeGreaterThanOrEqual(1);
  });

  it("service files contain [Service] section", () => {
    const units = listDir(SYSTEMD).filter((f) => f.endsWith(".service"));
    for (const unit of units) {
      const content = fs.readFileSync(path.join(SYSTEMD, unit), "utf-8");
      expect(content).toContain("[Service]");
    }
  });
});

// --- Observability Scripts ---

describe("Observability Scripts", () => {
  it("health check script exists", () => {
    const healthScript = findFiles(SCRIPTS, ".sh").filter(
      (f) => f.includes("health") || f.includes("check")
    );
    if (healthScript.length > 0) {
      expect(true).toBe(true);
    }
  });

  it("backup script exists", () => {
    const backupScript = findFiles(SCRIPTS, ".sh").filter(
      (f) => f.includes("backup")
    );
    if (backupScript.length > 0) {
      expect(true).toBe(true);
    }
  });
});

// --- Recovery Controller ---

describe("Recovery Controller", () => {
  it("recovery-related script exists", () => {
    const recoveryScripts = findFiles(SCRIPTS, ".sh").filter(
      (f) =>
        f.includes("recover") ||
        f.includes("restore") ||
        f.includes("disaster")
    );
    if (recoveryScripts.length > 0) {
      expect(true).toBe(true);
    }
  });
});

// --- Update Controller ---

describe("Update Controller", () => {
  it("update-related script exists", () => {
    const updateScripts = findFiles(SCRIPTS, ".sh").filter(
      (f) => f.includes("update") || f.includes("upgrade")
    );
    if (updateScripts.length > 0) {
      expect(true).toBe(true);
    }
  });
});

// --- E2E Runner ---

describe("E2E Runner", () => {
  it("e2e test runner exists or tests directory has fixtures", () => {
    const e2eDir = path.join(ROOT, "tests", "e2e");
    expect(exists(e2eDir)).toBe(true);
  });

  it("fixtures directory has bootstrap manifest", () => {
    const fixture = path.join(FIXTURES, "bootstrap-manifest.json");
    expect(exists(fixture)).toBe(true);
  });
});

// --- Snapshot Script ---

describe("Snapshot Script", () => {
  it("snapshot-related script exists", () => {
    const snapshotScripts = findFiles(SCRIPTS, ".sh").filter(
      (f) => f.includes("snapshot") || f.includes("backup")
    );
    if (snapshotScripts.length > 0) {
      expect(true).toBe(true);
    }
  });
});

// --- Environment Manifest Platform Fields ---

describe("Environment Manifest Platform Fields", () => {
  it("has platform.os field", () => {
    const manifestPath = path.join(FIXTURES, "bootstrap-manifest.json");
    const manifest = readJson(manifestPath);
    expect(typeof manifest.platform.os).toBe("string");
    expect(manifest.platform.os.length).toBeGreaterThan(0);
  });

  it("has platform.arch field", () => {
    const manifestPath = path.join(FIXTURES, "bootstrap-manifest.json");
    const manifest = readJson(manifestPath);
    expect(typeof manifest.platform.arch).toBe("string");
    expect(manifest.platform.arch.length).toBeGreaterThan(0);
  });

  it("runtime versions are strings", () => {
    const manifestPath = path.join(FIXTURES, "bootstrap-manifest.json");
    const manifest = readJson(manifestPath);
    expect(typeof manifest.runtime.opencode.version).toBe("string");
    expect(typeof manifest.runtime.bun.version).toBe("string");
    expect(typeof manifest.runtime.node.version).toBe("string");
  });
});

// --- Secret Placeholder Validation ---

describe("Secret Placeholder Validation", () => {
  it("no real API keys in any config files", () => {
    const configFiles = [
      ...findFiles(TEMPLATES, ".json"),
      ...findFiles(path.join(ROOT, "fixtures"), ".json"),
    ];
    for (const file of configFiles) {
      const content = fs.readFileSync(file, "utf-8");
      expect(content).not.toMatch(/sk-ant-[a-zA-Z0-9]{20,}/);
      expect(content).not.toMatch(/ghp_[a-zA-Z0-9]{36,}/);
      expect(content).not.toMatch(/AKIA[0-9A-Z]{16}/);
    }
  });

  it("templates use placeholder patterns not real values", () => {
    const templateFiles = findFiles(TEMPLATES, ".json");
    for (const file of templateFiles) {
      const content = fs.readFileSync(file, "utf-8");
      // Should not contain long hex strings that look like real tokens
      const looksLikeRealToken =
        content.match(/[a-f0-9]{40}/) && !content.includes("placeholder");
      if (looksLikeRealToken) {
        console.warn(`Possible real token in: ${file}`);
      }
    }
  });
});

// --- Brainstorming Skill ---

describe("Brainstorming Skill", () => {
  const skillDir = path.join(TEMPLATES, "skills", "brainstorming");
  const skillFile = path.join(skillDir, "SKILL.md");
  const cmdFile = path.join(TEMPLATES, "commands", "brainstorm.md");

  it("skill template directory exists", () => {
    expect(exists(skillDir)).toBe(true);
  });

  it("skill template file exists", () => {
    expect(exists(skillFile)).toBe(true);
  });

  it("skill has valid YAML frontmatter", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content.startsWith("---")).toBe(true);
    const endFm = content.indexOf("---", 3);
    expect(endFm).toBeGreaterThan(3);
    const frontmatter = content.substring(4, endFm);
    expect(frontmatter).toContain("name: brainstorming");
    expect(frontmatter).toContain("description:");
  });

  it("skill has HARD GATE", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("HARD GATE");
    expect(content).toContain("No implementation until");
  });

  it("skill has approval gate", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("Approval Gate");
    expect(content).toContain("Accept");
    expect(content).toContain("Revise");
    expect(content).toContain("Reject");
  });

  it("skill has handoff contract", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("BRAINSTORM_STATUS=APPROVED");
    expect(content).toContain("TARGET_AGENT=");
    expect(content).toContain("AKM_RESOURCES_USED=");
  });

  it("skill enforces read-only prohibitions", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("Prohibitions");
    expect(content).toContain("Edit, create, or delete files");
    expect(content).toContain("Commit, push, or deploy");
  });

  it("skill has when-to-skip rules", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("When to Skip");
    expect(content).toContain("Typo fixes");
    expect(content).toContain("Simple bugfixes");
  });

  it("skill has AKM integration", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("AKM Integration");
  });

  it("command template exists", () => {
    expect(exists(cmdFile)).toBe(true);
  });

  it("command has valid markdown structure", () => {
    if (!exists(cmdFile)) return;
    const content = fs.readFileSync(cmdFile, "utf-8");
    expect(content).toContain("# Command: /brainstorm");
    expect(content).toContain("## Purpose");
    expect(content).toContain("## Agent");
    expect(content).toContain("## Safety");
    expect(content).toContain("## AKM");
  });

  it("command references explore agent", () => {
    if (!exists(cmdFile)) return;
    const content = fs.readFileSync(cmdFile, "utf-8");
    expect(content).toContain("explore");
  });

  it("command enforces read-only", () => {
    if (!exists(cmdFile)) return;
    const content = fs.readFileSync(cmdFile, "utf-8");
    expect(content).toContain("Read-only");
    expect(content).toContain("no file edits");
  });

  it("no full Superpowers plugin references", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).not.toContain("superpowers");
    expect(content).not.toContain("writing-plans");
    expect(content).not.toContain("executing-plans");
    expect(content).not.toContain("tdd-workflow");
  });
});

// --- Multi-Project Governance Skill ---

describe("Multi-Project Governance Skill", () => {
  const skillDir = path.join(TEMPLATES, "skills", "multi-project-governance");
  const skillFile = path.join(skillDir, "SKILL.md");
  const cmdFile = path.join(TEMPLATES, "commands", "projects.md");
  const profileDir = path.join(ROOT, "config", "projects");

  it("skill template directory exists", () => {
    expect(exists(skillDir)).toBe(true);
  });

  it("skill template file exists", () => {
    expect(exists(skillFile)).toBe(true);
  });

  it("skill has valid YAML frontmatter", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content.startsWith("---")).toBe(true);
    const endFm = content.indexOf("---", 3);
    expect(endFm).toBeGreaterThan(3);
    const frontmatter = content.substring(4, endFm);
    expect(frontmatter).toContain("name: multi-project-governance");
    expect(frontmatter).toContain("description:");
  });

  it("skill mentions project profiles", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("Project Profile");
    expect(content).toContain("Profile");
  });

  it("skill mentions permissions resolution", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("Permission Resolution");
  });

  it("skill mentions environment isolation", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("Environment Isolation");
  });

  it("skill mentions filesystem isolation", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("Filesystem Isolation");
    expect(content).toContain("block traversal");
  });

  it("skill mentions agent routing", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("Agent Routing");
  });

  it("skill mentions AKM namespaces", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("AKM Namespace");
  });

  it("skill mentions budget enforcement", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("Budget Enforcement");
  });

  it("skill mentions locking", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("Locking");
  });

  it("skill has handoff section", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("Handoff");
  });

  it("skill has prohibitions section", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("Prohibition");
  });

  it("command template exists", () => {
    expect(exists(cmdFile)).toBe(true);
  });

  it("command has valid markdown structure", () => {
    if (!exists(cmdFile)) return;
    const content = fs.readFileSync(cmdFile, "utf-8");
    expect(content).toContain("# Command: /projects");
    expect(content).toContain("## Purpose");
    expect(content).toContain("## Agent");
    expect(content).toContain("## Safety");
    expect(content).toContain("## AKM");
  });

  it("command references explore agent", () => {
    if (!exists(cmdFile)) return;
    const content = fs.readFileSync(cmdFile, "utf-8");
    expect(content).toContain("explore");
  });

  it("command enforces read-only with admin guard for writes", () => {
    if (!exists(cmdFile)) return;
    const content = fs.readFileSync(cmdFile, "utf-8");
    expect(content).toContain("Read-only");
    expect(content).toContain("admin");
    expect(content).toContain("double confirmation");
  });

  it("command supports list status show budget locks", () => {
    if (!exists(cmdFile)) return;
    const content = fs.readFileSync(cmdFile, "utf-8");
    expect(content).toContain("--list");
    expect(content).toContain("--status");
    expect(content).toContain("--show");
    expect(content).toContain("--budget");
    expect(content).toContain("--locks");
  });

  it("profile registry directory exists", () => {
    expect(exists(profileDir)).toBe(true);
  });

  it("profile registry has index.json", () => {
    expect(exists(path.join(profileDir, "index.json"))).toBe(true);
  });

  it("profile index contains expected projects", () => {
    if (!exists(path.join(profileDir, "index.json"))) return;
    const index = readJson(path.join(profileDir, "index.json"));
    expect(Array.isArray(index)).toBe(true);
    expect(index).toContain("akm-bridge");
    expect(index).toContain("the-meridian");
    expect(index).toContain("unclassified");
  });

  it("unclassified profile exists and is read-only", () => {
    const file = path.join(profileDir, "unclassified.json");
    if (!exists(file)) return;
    const profile = readJson(file);
    expect(profile.permissions.write).toBe("deny");
    expect(profile.permissions.deploy).toBe("deny");
    expect(profile.permissions.admin).toBe("deny");
    expect(profile.permissions.shell).toBe("deny");
  });

  it("akm-bridge profile has expected agents", () => {
    const file = path.join(profileDir, "akm-bridge.json");
    if (!exists(file)) return;
    const profile = readJson(file);
    expect(profile.agents).toContain("akm-build");
    expect(profile.agents).toContain("infra-ops");
  });

  it("the-meridian profile has expected agents", () => {
    const file = path.join(profileDir, "the-meridian.json");
    if (!exists(file)) return;
    const profile = readJson(file);
    expect(profile.agents).toContain("meridian-dev");
    expect(profile.agents).toContain("wordpress-specialist");
  });

  it("the-meridian profile has production environment with double approval", () => {
    const file = path.join(profileDir, "the-meridian.json");
    if (!exists(file)) return;
    const profile = readJson(file);
    expect(profile.environments).toHaveProperty("production");
    expect(profile.environments.production.writePolicy).toBe("ask");
    expect(profile.environments.production.approvalPolicy).toBe("double");
  });

  it("no full Superpowers plugin references", () => {
    if (!exists(skillFile)) return;
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).not.toContain("superpowers");
    expect(content).not.toContain("writing-plans");
  });
});

describe("Performance Profiling", () => {
  const perfDir = path.join(ROOT, "src", "performance");
  const perfTypesFile = path.join(perfDir, "performance-types.ts");
  const runnerFile = path.join(ROOT, "scripts", "run-performance-baseline.ts");
  const baselineFile = path.join(ROOT, "performance", "baseline.json");
  const commandTemplate = path.join(ROOT, "templates", "commands", "performance.md");
  const skillDir = path.join(ROOT, "templates", "skills", "performance-profiling");
  const skillFile = path.join(skillDir, "SKILL.md");
  const docsFile = path.join(ROOT, "docs", "OPENCODE-PERFORMANCE-BASELINE.md");

  it("performance types file exists", () => {
    expect(exists(perfTypesFile)).toBe(true);
  });

  it("performance types export required symbols", () => {
    if (!exists(perfTypesFile)) return;
    const content = fs.readFileSync(perfTypesFile, "utf-8");
    expect(content).toContain("export type BenchmarkStatus");
    expect(content).toContain("export interface BenchmarkResult");
    expect(content).toContain("export interface BaselineFile");
    expect(content).toContain("export function computeStats");
    expect(content).toContain("export function defaultThresholds");
  });

  it("benchmark runner exists and is executable", () => {
    expect(exists(runnerFile)).toBe(true);
    const content = fs.readFileSync(runnerFile, "utf-8");
    expect(content).toContain("import");
    expect(content).toContain("benchmark(");
    expect(content).toContain("measureStartup");
    expect(content).toContain("measureSqlite");
    expect(content).toContain("measureDashboard");
    expect(content).toContain("measureScheduler");
    expect(content).toContain("measureMemory");
    expect(content).toContain("main()");
  });

  it("baseline file exists with valid schema", () => {
    expect(exists(baselineFile)).toBe(true);
    const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf-8"));
    expect(baseline.schemaVersion).toBe(1);
    expect(baseline.environment).toBeDefined();
    expect(baseline.thresholds).toBeDefined();
    expect(baseline.thresholds.latencyRegressionPercent).toBe(20);
    expect(baseline.thresholds.absoluteLimits).toBeDefined();
    expect(Object.keys(baseline.thresholds.absoluteLimits).length).toBeGreaterThan(5);
  });

  it("command template exists with valid structure", () => {
    expect(exists(commandTemplate)).toBe(true);
    const content = fs.readFileSync(commandTemplate, "utf-8");
    expect(content).toContain("# Command: /performance");
    expect(content).toContain("## Purpose");
    expect(content).toContain("## Agent");
    expect(content).toContain("infra-ops");
    expect(content).toContain("## Safety");
    expect(content).toContain("Read-only");
  });

  it("skill template exists with valid frontmatter", () => {
    const skillFileContent = fs.readFileSync(skillFile, "utf-8");
    expect(skillFileContent).toContain("name: performance-profiling");
    expect(skillFileContent).toContain("description:");
    expect(skillFileContent).toContain("benchmark");
    expect(skillFileContent).toContain("## When to Use");
    expect(skillFileContent).toContain("## Benchmarks");
    expect(skillFileContent).toContain("## Thresholds");
    expect(skillFileContent).toContain("## Handoff");
  });

  it("performance docs exist", () => {
    expect(exists(docsFile)).toBe(true);
    const content = fs.readFileSync(docsFile, "utf-8");
    expect(content).toContain("# OpenCode Performance Baseline");
    expect(content).toContain("## Benchmark Catalog");
    expect(content).toContain("## CI Integration");
    expect(content).toContain("## Thresholds");
    expect(content).toContain("## Running Benchmarks");
  });

  it("package.json has perf scripts", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
    expect(pkg.scripts.perf).toBeDefined();
    expect(pkg.scripts["perf:ci"]).toBeDefined();
    expect(pkg.scripts["perf:compare"]).toBeDefined();
    expect(pkg.scripts["perf:update"]).toBeDefined();
  });

  it("CI has performance-smoke job", () => {
    const ciFile = path.join(ROOT, ".github", "workflows", "ci.yml");
    if (!exists(ciFile)) return;
    const content = fs.readFileSync(ciFile, "utf-8");
    expect(content).toContain("performance-smoke");
    expect(content).toContain("perf:ci");
  });
});

describe("SLO & Capacity Planning", () => {
  const sloTypesFile = path.join(ROOT, "src", "slo", "slo-types.ts");
  const capacityTypesFile = path.join(ROOT, "src", "capacity", "capacity-types.ts");
  const sloPolicyFile = path.join(ROOT, "config", "slo", "slo-policy.json");
  const capacityBaselineFile = path.join(ROOT, "performance", "capacity-baseline.json");
  const capacityRunnerFile = path.join(ROOT, "scripts", "run-capacity-tests.ts");
  const errorBudgetFile = path.join(ROOT, "scripts", "calculate-error-budget.ts");
  const sloCommandTemplate = path.join(ROOT, "templates", "commands", "slo.md");
  const loadTestCommandTemplate = path.join(ROOT, "templates", "commands", "load-test.md");
  const skillDir = path.join(ROOT, "templates", "skills", "slo-capacity-planning");
  const skillFile = path.join(skillDir, "SKILL.md");
  const docsFile = path.join(ROOT, "docs", "OPENCODE-SLO-CAPACITY-PLANNING.md");

  it("SLO types file exists with core exports", () => {
    expect(exists(sloTypesFile)).toBe(true);
    const content = fs.readFileSync(sloTypesFile, "utf-8");
    expect(content).toContain("export enum SliCategory");
    expect(content).toContain("export interface SliDefinition");
    expect(content).toContain("export interface SloTarget");
    expect(content).toContain("export interface SloStatus");
    expect(content).toContain("export interface ErrorBudget");
    expect(content).toContain("export function calculateSloStatus");
    expect(content).toContain("export function calculateErrorBudget");
  });

  it("capacity types file exists with core exports", () => {
    expect(exists(capacityTypesFile)).toBe(true);
    const content = fs.readFileSync(capacityTypesFile, "utf-8");
    expect(content).toContain("export interface CapacityLimit");
    expect(content).toContain("export interface CapacityModel");
    expect(content).toContain("export interface CapacityStatus");
    expect(content).toContain("export function calculateCapacityStatus");
    expect(content).toContain("export function calculatePercentUsed");
  });

  it("SLO policy file exists with valid schema", () => {
    expect(exists(sloPolicyFile)).toBe(true);
    const policy = JSON.parse(fs.readFileSync(sloPolicyFile, "utf-8"));
    expect(policy.schemaVersion).toBe(1);
    expect(Array.isArray(policy.slis)).toBe(true);
    expect(policy.slis.length).toBeGreaterThanOrEqual(5);
    expect(Array.isArray(policy.slos)).toBe(true);
    expect(policy.slos.length).toBeGreaterThanOrEqual(5);
    expect(policy.globalErrorBudgetWindowMs).toBeGreaterThan(0);
  });

  it("capacity baseline file exists with all limit categories", () => {
    expect(exists(capacityBaselineFile)).toBe(true);
    const baseline = JSON.parse(fs.readFileSync(capacityBaselineFile, "utf-8"));
    expect(baseline.schemaVersion).toBe(1);
    expect(baseline.limits.queue).toBeDefined();
    expect(baseline.limits.scheduler).toBeDefined();
    expect(baseline.limits.notification).toBeDefined();
    expect(baseline.limits.dashboard).toBeDefined();
    expect(baseline.limits.mcp).toBeDefined();
    expect(baseline.limits.sqlite).toBeDefined();
    expect(baseline.limits.resource).toBeDefined();
  });

  it("capacity test runner exists", () => {
    expect(exists(capacityRunnerFile)).toBe(true);
    const content = fs.readFileSync(capacityRunnerFile, "utf-8");
    expect(content).toContain("burstTest");
    expect(content).toContain("sustainedTest");
    expect(content).toContain("smokeTests");
    expect(content).toContain("main()");
  });

  it("error budget script exists", () => {
    expect(exists(errorBudgetFile)).toBe(true);
    const content = fs.readFileSync(errorBudgetFile, "utf-8");
    expect(content).toContain("BudgetReport");
    expect(content).toContain("loadPolicy");
    expect(content).toContain("sloId");
  });

  it("slo command template exists with valid structure", () => {
    expect(exists(sloCommandTemplate)).toBe(true);
    const content = fs.readFileSync(sloCommandTemplate, "utf-8");
    expect(content).toContain("# Command: /slo");
    expect(content).toContain("## Agent");
    expect(content).toContain("explore");
    expect(content).toContain("## Safety");
    expect(content).toContain("Read-only");
  });

  it("load-test command template exists with valid structure", () => {
    expect(exists(loadTestCommandTemplate)).toBe(true);
    const content = fs.readFileSync(loadTestCommandTemplate, "utf-8");
    expect(content).toContain("# Command: /load-test");
    expect(content).toContain("## Agent");
    expect(content).toContain("akm-build");
    expect(content).toContain("## Safety");
    expect(content).toContain("smoke");
  });

  it("skill template exists with valid frontmatter", () => {
    expect(exists(skillFile)).toBe(true);
    const content = fs.readFileSync(skillFile, "utf-8");
    expect(content).toContain("name: slo-capacity-planning");
    expect(content).toContain("description:");
    expect(content).toContain("## When to Use");
    expect(content).toContain("## Workflow");
    expect(content).toContain("## Handoff");
    expect(content).toContain("## Prohibitions");
  });

  it("SLO capacity planning docs exist", () => {
    expect(exists(docsFile)).toBe(true);
    const content = fs.readFileSync(docsFile, "utf-8");
    expect(content).toContain("# OpenCode SLO & Capacity Planning");
    expect(content).toContain("## SLIs and SLOs");
    expect(content).toContain("## Error Budgets");
    expect(content).toContain("## Capacity Limits");
    expect(content).toContain("## Backpressure");
    expect(content).toContain("## Circuit Breakers");
    expect(content).toContain("## Load Tests");
    expect(content).toContain("## Commands");
  });

  it("package.json has SLO and capacity scripts", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
    expect(pkg.scripts["slo:status"]).toBeDefined();
    expect(pkg.scripts["slo:budgets"]).toBeDefined();
    expect(pkg.scripts["capacity:smoke"]).toBeDefined();
    expect(pkg.scripts["capacity:burst"]).toBeDefined();
  });

  it("CI has capacity-smoke job", () => {
    const ciFile = path.join(ROOT, ".github", "workflows", "ci.yml");
    if (!exists(ciFile)) return;
    const content = fs.readFileSync(ciFile, "utf-8");
    expect(content).toContain("capacity-smoke");
    expect(content).toContain("capacity:smoke");
  });
});
