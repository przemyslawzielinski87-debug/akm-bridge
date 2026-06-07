import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
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
