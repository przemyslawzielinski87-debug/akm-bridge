#!/usr/bin/env bun
/**
 * opencode-snapshot.ts
 * Creates timestamped snapshots of the current OpenCode environment.
 *
 * Usage:
 *   bun run opencode-snapshot.ts [--output DIR] [--dry-run]
 *
 * Captures:
 *   - manifest.json (all component versions, config hash, binary info)
 *   - checksums.sha256 (SHA256 of all captured files)
 *   - restore.sh (executable bash script for restoration)
 *   - README.txt (explanation of the snapshot)
 *
 * Does NOT capture: secrets, tokens, private keys, active logs, session data.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnapshotManifest {
  timestamp: string;
  opencode: {
    version: string;
    binary: string;
    installMethod: string;
    binaryHash?: string;
  };
  runtime: {
    bun: string;
    node: string;
  };
  akm: {
    version: string;
  };
  akmBridge: {
    commit: string;
    version: string;
  };
  plugins: Record<string, string>;
  mcpServers: Record<string, string>;
  configHash: string;
  agentsCount: number;
  commandsCount: number;
  skillsCount: number;
  mcpCount: number;
  e2eCommit: string;
  schemaVersion: number;
}

interface SnapshotResult {
  snapshotDir: string;
  dryRun: boolean;
  manifestPath?: string;
  checksumsPath?: string;
  restorePath?: string;
  readmePath?: string;
  filesWritten: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

function sha256File(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function sha256String(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function fileExists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function countFiles(dir: string, ext?: string): number {
  if (!fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(full, ext);
    } else if (!ext || entry.name.endsWith(ext)) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Version capture
// ---------------------------------------------------------------------------

function captureVersions() {
  const lockPath = path.resolve(__dirname, "../compatibility/opencode-version-lock.json");
  let lock: Record<string, any> = {};
  if (fileExists(lockPath)) {
    lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
  }

  const opencodeVersion = lock.opencode?.version || run("opencode --version 2>/dev/null") || "unknown";
  const opencodeBinary = lock.opencode?.binary || "/root/.opencode/bin/opencode";
  const installMethod = lock.opencode?.installMethod || "binary";

  const bunVersion = lock.runtime?.bun || run("bun --version 2>/dev/null") || "unknown";
  const nodeVersion = lock.runtime?.node || run("node --version 2>/dev/null") || "unknown";

  const akmVersion = lock.akm?.version || "unknown";
  const akmBridgeCommit = lock.akmBridge?.commit || "unknown";
  const akmBridgeVersion = lock.akmBridge?.version || "unknown";

  const plugins: Record<string, string> = lock.plugins || {};
  const mcpServers: Record<string, string> = lock.mcpServers || {};
  const e2eCommit = lock.e2eCommit || "unknown";

  // Binary hash
  let binaryHash = "";
  if (fileExists(opencodeBinary)) {
    binaryHash = sha256File(opencodeBinary);
  }

  // Config hash
  const configPath = path.resolve(process.env.HOME || "/root", ".config/opencode/opencode.json");
  let configHash = "";
  let configRaw = "";
  if (fileExists(configPath)) {
    configRaw = fs.readFileSync(configPath, "utf-8");
    configHash = sha256String(configRaw);
  }

  // Count agents, commands, skills, MCP
  const agentsDir = path.resolve(process.env.HOME || "/root", ".config/opencode/agents");
  const commandsDir = path.resolve(process.env.HOME || "/root", ".config/opencode/commands");
  const skillsDir = path.resolve(process.env.HOME || "/root", ".config/opencode/skills");

  const agentsCount = countFiles(agentsDir, ".md");
  const commandsCount = countFiles(commandsDir, ".md");
  const skillsCount = countFiles(skillsDir, ".md");
  const mcpCount = Object.keys(mcpServers).length;

  const manifest: SnapshotManifest = {
    timestamp: new Date().toISOString(),
    opencode: {
      version: opencodeVersion,
      binary: opencodeBinary,
      installMethod,
      binaryHash,
    },
    runtime: {
      bun: bunVersion,
      node: nodeVersion,
    },
    akm: {
      version: akmVersion,
    },
    akmBridge: {
      commit: akmBridgeCommit,
      version: akmBridgeVersion,
    },
    plugins,
    mcpServers,
    configHash,
    agentsCount,
    commandsCount,
    skillsCount,
    mcpCount,
    e2eCommit,
    schemaVersion: 1,
  };

  return { manifest, configRaw };
}

// ---------------------------------------------------------------------------
// restore.sh generator
// ---------------------------------------------------------------------------

function generateRestoreScript(manifest: SnapshotManifest): string {
  const timestamp = manifest.timestamp;
  return `#!/usr/bin/env bash
# restore.sh — Restore OpenCode environment from snapshot
# Snapshot timestamp: ${timestamp}
# Generated by opencode-snapshot.ts
#
# Usage:
#   ./restore.sh --dry-run   (default: show what would be restored)
#   ./restore.sh --execute   (actually restore files)
#
# This script does NOT:
#   - Restore secrets, tokens, or private keys
#   - Restart the opencode server
#   - Modify binary files (opencode itself)

set -euo pipefail

DRY_RUN=true
SNAPSHOT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"

for arg in "\$@"; do
  case "\$arg" in
    --execute) DRY_RUN=false ;;
    --dry-run) DRY_RUN=true ;;
    --help|-h)
      echo "Usage: \$0 [--dry-run|--execute]"
      echo "  --dry-run   Show what would be restored (default)"
      echo "  --execute   Actually restore files"
      exit 0
      ;;
  esac
done

echo "=== OpenCode Restore Script ==="
echo "Snapshot: \${SNAPSHOT_DIR}"
echo "Mode: \$([ \"\$DRY_RUN\" = true ] && echo 'DRY RUN' || echo 'EXECUTE')"
echo ""

# --- Validate checksums ---
CHECKSUM_FILE="\${SNAPSHOT_DIR}/checksums.sha256"
if [ -f "\$CHECKSUM_FILE" ]; then
  echo "Validating checksums..."
  cd "\$SNAPSHOT_DIR"
  if sha256sum -c "\$CHECKSUM_FILE" --quiet 2>/dev/null; then
    echo "  All checksums OK"
  else
    echo "  WARNING: Some checksums failed! Proceed with caution."
  fi
  cd - > /dev/null
else
  echo "WARNING: No checksums.sha256 found. Skipping validation."
fi
echo ""

# --- Restore version lock ---
LOCK_SRC="\${SNAPSHOT_DIR}/opencode-version-lock.json"
LOCK_DST="/root/projekt/akm-bridge/compatibility/opencode-version-lock.json"
if [ -f "\$LOCK_SRC" ]; then
  echo "Would restore: \$LOCK_DST"
  if [ "\$DRY_RUN" = false ]; then
    cp "\$LOCK_SRC" "\$LOCK_DST"
    echo "  Restored."
  fi
fi

# --- Restore compatibility matrix ---
MATRIX_SRC="\${SNAPSHOT_DIR}/matrix.json"
MATRIX_DST="/root/projekt/akm-bridge/compatibility/matrix.json"
if [ -f "\$MATRIX_SRC" ]; then
  echo "Would restore: \$MATRIX_DST"
  if [ "\$DRY_RUN" = false ]; then
    cp "\$MATRIX_SRC" "\$MATRIX_DST"
    echo "  Restored."
  fi
fi

# --- Restore opencode.json ---
CONFIG_SRC="\${SNAPSHOT_DIR}/opencode.json"
CONFIG_DST="/root/.config/opencode/opencode.json"
if [ -f "\$CONFIG_SRC" ]; then
  echo "Would restore: \$CONFIG_DST"
  if [ "\$DRY_RUN" = false ]; then
    cp "\$CONFIG_SRC" "\$CONFIG_DST"
    echo "  Restored."
  fi
fi

echo ""
echo "=== Summary ==="
echo "Snapshot timestamp: ${timestamp}"
echo "NOTE: Secrets and session data are NEVER restored."
echo "NOTE: Server restart is NOT performed automatically."
if [ "\$DRY_RUN" = true ]; then
  echo ""
  echo "Run with --execute to apply changes."
fi
`;
}

// ---------------------------------------------------------------------------
// README generator
// ---------------------------------------------------------------------------

function generateReadme(manifest: SnapshotManifest): string {
  return `OpenCode Environment Snapshot
================================

Timestamp:    ${manifest.timestamp}
OpenCode:     v${manifest.opencode.version}
Runtime:      Bun ${manifest.runtime.bun}, Node ${manifest.runtime.node}
AKM:          v${manifest.akm.version}
AKM Bridge:   v${manifest.akmBridge.version} (${manifest.akmBridge.commit})
Config Hash:  ${manifest.configHash}

Contents
--------
  manifest.json          Component versions and metadata
  checksums.sha256       SHA256 checksums for integrity verification
  restore.sh             Restoration script (--dry-run by default)
  opencode-version-lock.json  Version lock file
  matrix.json            Compatibility matrix
  opencode.json          OpenCode configuration (if present)

What is NOT captured
--------------------
  - Secrets, tokens, API keys, private keys
  - Active logs or session data
  - Binary files (opencode binary itself is referenced, not copied)
  - Cache directories

Restoration
-----------
  ./restore.sh --dry-run     # Preview changes
  ./restore.sh --execute     # Apply changes

Always verify checksums before restoring on a different machine.
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  let outputDir = "/root/.config/opencode/snapshots";
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputDir = args[i + 1];
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  const result: SnapshotResult = {
    snapshotDir: "",
    dryRun,
    filesWritten: [],
    errors: [],
  };

  try {
    const { manifest, configRaw } = captureVersions();
    const ts = manifest.timestamp.replace(/[:.]/g, "-").slice(0, 19);
    const dirName = `${ts}-v${manifest.opencode.version}`;
    const snapshotDir = path.join(outputDir, dirName);
    result.snapshotDir = snapshotDir;

    if (dryRun) {
      console.log(`[DRY RUN] Would create snapshot at: ${snapshotDir}`);
      console.log("Components to capture:");
      console.log(`  OpenCode:  v${manifest.opencode.version}`);
      console.log(`  Runtime:   Bun ${manifest.runtime.bun}, Node ${manifest.runtime.node}`);
      console.log(`  AKM:       v${manifest.akm.version}`);
      console.log(`  Plugins:   ${Object.keys(manifest.plugins).length}`);
      console.log(`  MCP:       ${manifest.mcpCount}`);
      console.log(`  Agents:    ${manifest.agentsCount}`);
      console.log(`  Commands:  ${manifest.commandsCount}`);
      console.log(`  Skills:    ${manifest.skillsCount}`);
      return;
    }

    fs.mkdirSync(snapshotDir, { recursive: true });

    // Write manifest.json
    const manifestPath = path.join(snapshotDir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    result.manifestPath = manifestPath;
    result.filesWritten.push(manifestPath);

    // Write opencode-version-lock.json
    const lockPath = path.resolve(__dirname, "../compatibility/opencode-version-lock.json");
    if (fileExists(lockPath)) {
      const lockDst = path.join(snapshotDir, "opencode-version-lock.json");
      fs.copyFileSync(lockPath, lockDst);
      result.filesWritten.push(lockDst);
    }

    // Write matrix.json
    const matrixPath = path.resolve(__dirname, "../compatibility/matrix.json");
    if (fileExists(matrixPath)) {
      const matrixDst = path.join(snapshotDir, "matrix.json");
      fs.copyFileSync(matrixPath, matrixDst);
      result.filesWritten.push(matrixDst);
    }

    // Write opencode.json if present
    const configDst = path.join(snapshotDir, "opencode.json");
    if (configRaw) {
      fs.writeFileSync(configDst, configRaw + "\n");
      result.filesWritten.push(configDst);
    }

    // Write restore.sh
    const restoreScript = generateRestoreScript(manifest);
    const restorePath = path.join(snapshotDir, "restore.sh");
    fs.writeFileSync(restorePath, restoreScript);
    fs.chmodSync(restorePath, 0o755);
    result.restorePath = restorePath;
    result.filesWritten.push(restorePath);

    // Write README.txt
    const readmeContent = generateReadme(manifest);
    const readmePath = path.join(snapshotDir, "README.txt");
    fs.writeFileSync(readmePath, readmeContent);
    result.readmePath = readmePath;
    result.filesWritten.push(readmePath);

    // Generate checksums.sha256
    const checksumLines: string[] = [];
    for (const file of result.filesWritten) {
      const hash = sha256File(file);
      const basename = path.basename(file);
      checksumLines.push(`${hash}  ${basename}`);
    }
    const checksumsPath = path.join(snapshotDir, "checksums.sha256");
    fs.writeFileSync(checksumsPath, checksumLines.join("\n") + "\n");
    result.checksumsPath = checksumsPath;
    result.filesWritten.push(checksumsPath);

    // Output result
    console.log(JSON.stringify(result, null, 2));
  } catch (err: any) {
    result.errors.push(err.message || String(err));
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
}

main();
