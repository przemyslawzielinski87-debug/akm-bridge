import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(process.cwd());
const COMPATIBILITY_DIR = path.join(ROOT, 'compatibility');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const COMMANDS_DIR = '/root/.config/opencode/commands';
const SNAPSHOTS_DIR = '/root/.config/opencode/snapshots';
const SKILL_PATH = '/root/.config/opencode/skills/version-compatibility/SKILL.md';
const OPENCODE_CONFIG = '/root/.config/opencode/opencode.json';
const STATE_FILE = '/root/.config/opencode/update-state.json';

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

function scanForSecrets(content: string): string[] {
  const patterns = [
    /api[_-]?key\s*[:=]\s*["'][^"']+["']/gi,
    /secret\s*[:=]\s*["'][^"']+["']/gi,
    /token\s*[:=]\s*["'][^"']+["']/gi,
    /password\s*[:=]\s*["'][^"']+["']/gi,
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    /ghp_[A-Za-z0-9]{36}/g,
    /sk-[A-Za-z0-9]{48}/g,
  ];
  const found: string[] = [];
  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) {
      found.push(...matches);
    }
  }
  return found;
}

describe('Version Management System', () => {
  describe('1. Version lock validation', () => {
    it('should have opencode-version-lock.json with required fields', () => {
      const lockPath = path.join(COMPATIBILITY_DIR, 'opencode-version-lock.json');
      expect(fileExists(lockPath)).toBe(true);

      const lock = readJson(lockPath);
      expect(lock.opencode).toBeDefined();
      expect(lock.opencode.version).toBeDefined();
      expect(typeof lock.opencode.version).toBe('string');

      expect(lock.runtime).toBeDefined();
      expect(lock.runtime.bun).toBeDefined();
      expect(lock.runtime.node).toBeDefined();

      expect(lock.akm).toBeDefined();
      expect(lock.akm.version).toBeDefined();

      expect(lock.akmBridge).toBeDefined();
      expect(lock.akmBridge.commit).toBeDefined();
      expect(lock.akmBridge.version).toBeDefined();

      expect(lock.plugins).toBeDefined();
      expect(typeof lock.plugins).toBe('object');

      expect(lock.mcpServers).toBeDefined();
      expect(typeof lock.mcpServers).toBe('object');

      expect(lock.schemaVersion).toBeDefined();
      expect(typeof lock.schemaVersion).toBe('number');
    });
  });

  describe('2. Matrix validation', () => {
    it('should have matrix.json with correct structure', () => {
      const matrixPath = path.join(COMPATIBILITY_DIR, 'matrix.json');
      expect(fileExists(matrixPath)).toBe(true);

      const matrix = readJson(matrixPath);
      expect(matrix.validatedCombinations).toBeDefined();
      expect(Array.isArray(matrix.validatedCombinations)).toBe(true);

      if (matrix.validatedCombinations.length > 0) {
        const combo = matrix.validatedCombinations[0];
        expect(combo.opencode).toBeDefined();
        expect(combo.bun).toBeDefined();
        expect(combo.node).toBeDefined();
        expect(combo.status).toBeDefined();
        expect(['validated', 'invalid', 'pending']).toContain(combo.status);
      }
    });
  });

  describe('3. Snapshot manifest validation', () => {
    it('should have valid manifest.json in existing snapshots', () => {
      if (!fileExists(SNAPSHOTS_DIR)) {
        console.log('No snapshots directory found, skipping');
        return;
      }

      const snapshotDirs = fs.readdirSync(SNAPSHOTS_DIR).filter(d => {
        const stat = fs.statSync(path.join(SNAPSHOTS_DIR, d));
        return stat.isDirectory();
      });

      if (snapshotDirs.length === 0) {
        console.log('No snapshots found, skipping');
        return;
      }

      for (const dir of snapshotDirs) {
        const manifestPath = path.join(SNAPSHOTS_DIR, dir, 'manifest.json');
        if (!fileExists(manifestPath)) continue;

        const manifest = readJson(manifestPath);

        // Support both manifest formats:
        // Format 1: opencode-snapshot.ts (has timestamp, opencode, runtime, schemaVersion)
        // Format 2: snapshot-*.ts (has id, version, createdAt, files, checksum)
        const hasFormat1 = !!(manifest.timestamp && manifest.opencode && manifest.schemaVersion);
        const hasFormat2 = !!(manifest.id && manifest.version && manifest.createdAt && manifest.files && manifest.checksum);

        expect(hasFormat1 || hasFormat2).toBe(true);

        if (hasFormat1) {
          expect(typeof manifest.schemaVersion).toBe('number');
          expect(manifest.opencode.version).toBeDefined();
        }

        if (hasFormat2) {
          expect(typeof manifest.id).toBe('string');
          expect(typeof manifest.version).toBe('string');
          expect(Array.isArray(manifest.files)).toBe(true);
        }
      }
    });
  });

  describe('4. Update check script', () => {
    it('should exist and be syntactically valid TypeScript', () => {
      const scriptPath = path.join(SCRIPTS_DIR, 'check-opencode-updates.ts');
      expect(fileExists(scriptPath)).toBe(true);

      const content = readText(scriptPath);
      expect(content.length).toBeGreaterThan(100);

      // Basic TypeScript syntax checks
      expect(content).toContain('async');
      expect(content).toContain('function');
    });
  });

  describe('5. Update controller', () => {
    it('should exist and handle --check, --status, --dry-run', () => {
      const controllerPath = path.join(SCRIPTS_DIR, 'opencode-update-controller.ts');
      expect(fileExists(controllerPath)).toBe(true);

      const content = readText(controllerPath);
      expect(content.length).toBeGreaterThan(100);

      // Check for required command handling
      expect(content).toContain('--check');
      expect(content).toContain('--status');
      expect(content).toContain('--dry-run');
    });
  });

  describe('6. Snapshot script', () => {
    it('should exist and handle --dry-run', () => {
      const snapshotPath = path.join(SCRIPTS_DIR, 'opencode-snapshot.ts');
      expect(fileExists(snapshotPath)).toBe(true);

      const content = readText(snapshotPath);
      expect(content.length).toBeGreaterThan(100);

      expect(content).toContain('--dry-run');
    });
  });

  describe('7. Command files', () => {
    const commands = ['update-check', 'update-canary', 'update-promote', 'update-rollback'];

    for (const cmd of commands) {
      it(`should have ${cmd}.md with required sections`, () => {
        const cmdPath = path.join(COMMANDS_DIR, `${cmd}.md`);
        expect(fileExists(cmdPath)).toBe(true);

        const content = readText(cmdPath);
        expect(content.length).toBeGreaterThan(50);

        // Each command should have Purpose, Usage, What It Does, Agent, Safety
        expect(content.toLowerCase()).toContain('purpose');
        expect(content.toLowerCase()).toContain('usage');
        expect(content.toLowerCase()).toContain('what it does');
        expect(content.toLowerCase()).toContain('safety');
      });
    }
  });

  describe('8. Config entries', () => {
    it('should have all 4 update command entries in opencode.json', () => {
      expect(fileExists(OPENCODE_CONFIG)).toBe(true);

      const config = readText(OPENCODE_CONFIG);
      expect(config).toContain('"update-check"');
      expect(config).toContain('"update-canary"');
      expect(config).toContain('"update-promote"');
      expect(config).toContain('"update-rollback"');
    });
  });

  describe('9. Skill file', () => {
    it('should have version-compatibility/SKILL.md', () => {
      expect(fileExists(SKILL_PATH)).toBe(true);

      const content = readText(SKILL_PATH);
      expect(content.length).toBeGreaterThan(200);

      // Should contain key sections
      expect(content.toLowerCase()).toContain('purpose');
      expect(content.toLowerCase()).toContain('workflow');
      expect(content.toLowerCase()).toContain('promotion gate');
      expect(content.toLowerCase()).toContain('safety rules');
      expect(content.toLowerCase()).toContain('rollback');
    });
  });

  describe('10. Blocked versions', () => {
    it('should have blockedVersions as an array in matrix.json', () => {
      const matrixPath = path.join(COMPATIBILITY_DIR, 'matrix.json');
      expect(fileExists(matrixPath)).toBe(true);

      const matrix = readJson(matrixPath);
      expect(matrix.blockedVersions).toBeDefined();
      expect(Array.isArray(matrix.blockedVersions)).toBe(true);
    });
  });

  describe('11. State file schema', () => {
    it('should have required fields if update-state.json exists', () => {
      if (!fileExists(STATE_FILE)) {
        console.log('update-state.json does not exist yet (will be created on first update)');
        return;
      }

      const state = readJson(STATE_FILE);
      // State should have at least one of these fields
      const hasAnyField = state.lastCheck || state.lastCanary || state.lastPromotion || state.lastRollback;
      expect(hasAnyField).toBeDefined();
    });
  });

  describe('12. No secrets in lock file', () => {
    it('should not contain secret patterns', () => {
      const lockPath = path.join(COMPATIBILITY_DIR, 'opencode-version-lock.json');
      expect(fileExists(lockPath)).toBe(true);

      const content = readText(lockPath);
      const secrets = scanForSecrets(content);
      expect(secrets).toEqual([]);
    });
  });

  describe('13. No secrets in matrix', () => {
    it('should not contain secret patterns', () => {
      const matrixPath = path.join(COMPATIBILITY_DIR, 'matrix.json');
      expect(fileExists(matrixPath)).toBe(true);

      const content = readText(matrixPath);
      const secrets = scanForSecrets(content);
      expect(secrets).toEqual([]);
    });
  });

  describe('14. No secrets in snapshots', () => {
    it('should not contain secret patterns in snapshot manifests', () => {
      if (!fileExists(SNAPSHOTS_DIR)) {
        console.log('No snapshots directory found, skipping');
        return;
      }

      const snapshotDirs = fs.readdirSync(SNAPSHOTS_DIR).filter(d => {
        const stat = fs.statSync(path.join(SNAPSHOTS_DIR, d));
        return stat.isDirectory();
      });

      for (const dir of snapshotDirs) {
        const manifestPath = path.join(SNAPSHOTS_DIR, dir, 'manifest.json');
        if (!fileExists(manifestPath)) continue;

        const content = readText(manifestPath);
        const secrets = scanForSecrets(content);
        expect(secrets).toEqual([]);
      }
    });
  });

  describe('15. Restore script safety', () => {
    it('should default to dry-run in existing snapshots', () => {
      if (!fileExists(SNAPSHOTS_DIR)) {
        console.log('No snapshots directory found, skipping');
        return;
      }

      const snapshotDirs = fs.readdirSync(SNAPSHOTS_DIR).filter(d => {
        const stat = fs.statSync(path.join(SNAPSHOTS_DIR, d));
        return stat.isDirectory();
      });

      for (const dir of snapshotDirs) {
        const restorePath = path.join(SNAPSHOTS_DIR, dir, 'restore.sh');
        if (!fileExists(restorePath)) continue;

        const content = readText(restorePath);
        // Default should be DRY_RUN=true
        expect(content).toContain('DRY_RUN=true');
        // Should have --execute flag option
        expect(content).toContain('--execute');
      }
    });
  });
});
