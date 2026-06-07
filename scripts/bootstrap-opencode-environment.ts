#!/usr/bin/env bun
/**
 * bootstrap-opencode-environment.ts
 *
 * Main disaster-recovery bootstrap script for OpenCode environment.
 * Idempotent — running twice produces the same result.
 * Defaults to --dry-run (never writes without explicit flag).
 *
 * Modes:
 *   --dry-run              Show what WOULD happen, write nothing (DEFAULT)
 *   --install              Create backup, then install everything
 *   --restore              Read install manifest, restore files, validate
 *   --validate             Read manifest, check all files exist and are correct
 *   --upgrade-existing     Snapshot, diff, add missing, don't remove unmanaged
 *   --status               Show current state
 *   --uninstall-generated  Remove only files tracked in install manifest
 *
 * Flags:
 *   --json                 Output JSON report
 *   --non-interactive      Skip prompts, use defaults
 *   --skip-systemd         Skip systemd unit installation
 *   --skip-secrets         Skip secrets provisioning
 *   --secrets-file PATH    Read secrets from file
 *   --profile PATH         Use custom profile config
 */

import { execFileSync, execSync, spawnSync } from 'node:child_process'
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync,
  readdirSync, statSync, unlinkSync, copyFileSync, chmodSync, accessSync,
  constants, readSync, renameSync,
} from 'node:fs'
import { resolve, dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as crypto from 'node:crypto'

// ──────────────────────────── Constants ──────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')

const MANIFEST_DIR = '/root/.local/state/opencode-bootstrap'
const MANIFEST_PATH = join(MANIFEST_DIR, 'install-manifest.json')
const BACKUP_DIR = '/root/.config/opencode/backup'
const OPENCODE_CONFIG = '/root/.config/opencode/opencode.json'
const OPENCODE_BINARY = '/root/.opencode/bin/opencode'
const BUN_BINARY = '/root/.bun/bin/bun'
const NODE_BINARY = 'node'
const AKM_BINARY = '/root/.bun/bin/akm'
const AGENTS_DIR = '/root/.config/opencode/agents'
const COMMANDS_DIR = '/root/.config/opencode/commands'
const SKILLS_DIR = '/root/.config/opencode/skills'
const SYSTEMD_DIR = '/etc/systemd/system'
const SYSTEMD_TEMPLATES_DIR = join(PROJECT_ROOT, 'systemd')
const TEMPLATES_DIR = join(PROJECT_ROOT, 'templates')
const AGENTS_TEMPLATES_DIR = join(TEMPLATES_DIR, 'agents')
const COMMANDS_TEMPLATES_DIR = join(TEMPLATES_DIR, 'commands')
const SKILLS_TEMPLATES_DIR = join(TEMPLATES_DIR, 'skills')
const VERSION_LOCK = join(PROJECT_ROOT, 'compatibility', 'opencode-version-lock.json')
const MATRIX_FILE = join(PROJECT_ROOT, 'compatibility', 'matrix.json')
const ENVIRONMENT_MANIFEST = join(PROJECT_ROOT, 'disaster-recovery', 'environment-manifest.json')
const RECOVERY_SCRIPT = join(__dirname, 'opencode-recovery-controller.ts')
const UPDATE_SCRIPT = join(__dirname, 'opencode-update-controller.ts')
const OBSERVABILITY_SCRIPT = join(__dirname, 'opencode-observability-report.ts')
const E2E_SCRIPT = join(__dirname, 'opencode-e2e.ts')
const HEALTH_CHECK_SCRIPT = join(__dirname, 'health-check.sh')
const STATE_DIR = '/root/.config/opencode'
const LOG_DIR = '/root/.config/opencode/logs'
const MIN_DISK_GB = 10
const MIN_MEMORY_GB = 4
const BACKUP_TIMESTAMP_FMT = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

// ──────────────────────────── Types ──────────────────────────────────

type Mode = 'dry-run' | 'install' | 'restore' | 'validate' | 'upgrade-existing' | 'status' | 'uninstall-generated'

interface CliFlags {
  mode: Mode
  json: boolean
  nonInteractive: boolean
  skipSystemd: boolean
  skipSecrets: boolean
  secretsFile: string | null
  profilePath: string | null
}

interface SystemInfo {
  os: string
  arch: string
  user: string
  diskGB: number
  memoryGB: number
  kernelVersion: string
  hostname: string
  uptimeSeconds: number
}

interface PreflightResult {
  diskOk: boolean
  diskDetail: string
  networkOk: boolean
  networkDetail: string
  gitOk: boolean
  gitDetail: string
  bunOk: boolean
  bunDetail: string
  nodeOk: boolean
  nodeDetail: string
  dirsOk: boolean
  dirsDetail: string
  allPassed: boolean
  failures: string[]
}

interface VersionLock {
  opencode: { version: string; installMethod: string; binary: string }
  runtime: { bun: string; node: string }
  akm: { version: string }
  akmBridge: { commit: string; version: string }
  plugins: Record<string, string>
  mcpServers: Record<string, string>
  schemaVersion: number
  validatedAt: string
  e2eCommit: string
}

interface EnvironmentManifest {
  schemaVersion: number
  platform: { os: string; arch: string; user: string; minDiskGB: number; minMemoryGB: number }
  runtime: {
    opencode: { version: string; binary: string; installMethod: string }
    bun: { version: string; binary: string; installMethod: string }
    node: { version: string; binary: string; installMethod: string }
    akm: { version: string; binary: string; installMethod: string }
  }
  repository: { url: string; branch: string; currentCommit: string }
  agents: { count: number; directory: string; files: string[] }
  commands: { count: number; directory: string; files: string[] }
  skills: { count: number; directory: string; directories: string[] }
  mcpServers: { count: number; transport: string; managedBy: string }
  plugins: { count: number }
  systemdUnits: Array<{ name: string; type: string; enabled: boolean }>
  configFiles: string[]
  secretPlaceholders: Array<{ name: string; required: boolean; description: string }>
  validationChecks: string[]
}

interface InstallManifest {
  schemaVersion: number
  installedAt: string
  installedBy: string
  mode: string
  versionLock: string
  files: InstalledFile[]
  directories: string[]
  services: string[]
  secrets: string[]
  summary: {
    totalFiles: number
    totalDirectories: number
    totalServices: number
    totalSecrets: number
  }
}

interface InstalledFile {
  path: string
  source: string
  checksum: string
  installedAt: string
  category: 'config' | 'agent' | 'command' | 'skill' | 'systemd' | 'recovery' | 'observability' | 'compatibility' | 'script' | 'other'
}

interface ActionPlan {
  actions: PlannedAction[]
  backupRequired: boolean
  backupTarget: string | null
  estimatedChanges: number
}

interface PlannedAction {
  type: 'install' | 'update' | 'remove' | 'skip' | 'backup' | 'create-dir' | 'enable-service' | 'provision-secret'
  target: string
  source: string | null
  reason: string
  category: string
  reversible: boolean
}

interface ValidationResult {
  name: string
  passed: boolean
  detail: string
  severity: 'critical' | 'warning' | 'info'
}

interface Report {
  timestamp: string
  mode: Mode
  dryRun: boolean
  systemInfo: SystemInfo
  preflight: PreflightResult
  actions: PlannedAction[]
  executedActions: PlannedAction[]
  skippedActions: PlannedAction[]
  results: ValidationResult[]
  manifestPath: string | null
  backupPath: string | null
  errors: string[]
  warnings: string[]
  durationMs: number
  overallStatus: 'success' | 'partial' | 'failed' | 'dry-run'
  json: boolean
}

// ──────────────────────────── Logging ────────────────────────────────

let _logBuffer: string[] = []
let _quiet = false

function log(msg: string): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}`
  _logBuffer.push(line)
  if (!_quiet) process.stderr.write(line + '\n')
}

function logDry(msg: string): void {
  log(`[DRY-RUN] ${msg}`)
}

function logAction(action: PlannedAction, executed: boolean): void {
  const prefix = executed ? '[EXEC]' : '[PLAN]'
  log(`${prefix} ${action.type.toUpperCase()} ${action.target}`)
}

// ──────────────────────────── CLI Argument Parsing ───────────────────

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    mode: 'dry-run',
    json: false,
    nonInteractive: false,
    skipSystemd: false,
    skipSecrets: false,
    secretsFile: null,
    profilePath: null,
  }

  const modes: Mode[] = ['dry-run', 'install', 'restore', 'validate', 'upgrade-existing', 'status', 'uninstall-generated']

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    const stripped = arg.startsWith('--') ? arg.slice(2) : arg
    if (modes.includes(stripped as Mode)) {
      flags.mode = stripped as Mode
    } else if (arg === '--json') {
      flags.json = true
    } else if (arg === '--non-interactive') {
      flags.nonInteractive = true
    } else if (arg === '--skip-systemd') {
      flags.skipSystemd = true
    } else if (arg === '--skip-secrets') {
      flags.skipSecrets = true
    } else if (arg === '--secrets-file') {
      flags.secretsFile = argv[++i] ?? null
    } else if (arg === '--profile') {
      flags.profilePath = argv[++i] ?? null
    } else if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    } else {
      console.error(`Unknown argument: ${arg}`)
      printUsage()
      process.exit(1)
    }
  }

  return flags
}

function printUsage(): void {
  console.log(`
Usage: bun run bootstrap-opencode-environment.ts [MODE] [FLAGS]

Modes (default: --dry-run):
  --dry-run              Show what WOULD happen, write nothing
  --install              Create backup, then install everything
  --restore              Read install manifest, restore files, validate
  --validate             Read manifest, check all files exist and are correct
  --upgrade-existing     Snapshot, diff, add missing, don't remove unmanaged
  --status               Show current state
  --uninstall-generated  Remove only files tracked in install manifest

Flags:
  --json                 Output JSON report
  --non-interactive      Skip prompts, use defaults
  --skip-systemd         Skip systemd unit installation
  --skip-secrets         Skip secrets provisioning
  --secrets-file PATH    Read secrets from file (KEY=VALUE, one per line)
  --profile PATH         Use custom profile config
  --help, -h             Show this help

Safety:
  - Defaults to dry-run: nothing is written without explicit mode
  - Creates timestamped backup before any install/restore/upgrade
  - Never stores secrets in output or install manifest
  - Validates after every operation
  - Install manifest tracks all generated files for clean rollback
`)
}

// ──────────────────────────── Shell Helpers ──────────────────────────

function run(cmd: string, args: string[], timeoutMs = 15000): { stdout: string; stderr: string; exitCode: number } {
  try {
    const r = spawnSync(cmd, args, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return {
      stdout: (r.stdout || '').trim(),
      stderr: (r.stderr || '').trim(),
      exitCode: r.status ?? 1,
    }
  } catch (e: any) {
    return { stdout: '', stderr: e.message || 'unknown error', exitCode: 1 }
  }
}

function runShell(cmd: string, timeoutMs = 15000): { stdout: string; stderr: string; exitCode: number } {
  try {
    const r = spawnSync('bash', ['-c', cmd], {
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return {
      stdout: (r.stdout || '').trim(),
      stderr: (r.stderr || '').trim(),
      exitCode: r.status ?? 1,
    }
  } catch (e: any) {
    return { stdout: '', stderr: e.message || 'unknown error', exitCode: 1 }
  }
}

function fileExists(p: string): boolean {
  try {
    accessSync(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function sha256File(filePath: string): string {
  try {
    const data = readFileSync(filePath)
    return crypto.createHash('sha256').update(data).digest('hex')
  } catch {
    return ''
  }
}

function sha256String(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

function ensureDir(dir: string, dryRun: boolean): void {
  if (existsSync(dir)) return
  if (dryRun) {
    logDry(`Would create directory: ${dir}`)
    return
  }
  log(`Creating directory: ${dir}`)
  mkdirSync(dir, { recursive: true })
}

function writeFileSafe(filePath: string, content: string, dryRun: boolean): void {
  if (dryRun) {
    logDry(`Would write: ${filePath} (${content.length} bytes)`)
    return
  }
  ensureDir(dirname(filePath), false)
  const tmp = filePath + '.tmp.' + process.pid
  writeFileSync(tmp, content, 'utf-8')
  try {
    renameSync(tmp, filePath)
  } catch {
    writeFileSync(filePath, content, 'utf-8')
    try { unlinkSync(tmp) } catch {}
  }
}

function copyFileSafe(src: string, dst: string, dryRun: boolean): void {
  if (!existsSync(src)) {
    log(`Source not found, skipping: ${src}`)
    return
  }
  if (dryRun) {
    logDry(`Would copy: ${src} -> ${dst}`)
    return
  }
  ensureDir(dirname(dst), false)
  copyFileSync(src, dst)
  log(`Copied: ${src} -> ${dst}`)
}

function removeFileSafe(filePath: string, dryRun: boolean, reason: string): void {
  if (!existsSync(filePath)) return
  if (dryRun) {
    logDry(`Would remove: ${filePath} (${reason})`)
    return
  }
  log(`Removing: ${filePath} (${reason})`)
  unlinkSync(filePath)
}

// ──────────────────────────── System Detection ───────────────────────

function detectSystem(): SystemInfo {
  const os = runShell('cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'')
  const arch = runShell('uname -m')
  const user = runShell('whoami')
  const diskRaw = runShell("df -BG / | tail -1 | awk '{print $4}'")
  const diskGB = parseInt(diskRaw.stdout.replace(/[^0-9]/g, '')) || 0
  const memRaw = runShell("free -g | awk '/^Mem:/{print $2}'")
  const memoryGB = parseInt(memRaw.stdout.replace(/[^0-9]/g, '')) || 0
  const kernel = runShell('uname -r')
  const hostname = runShell('hostname')
  const uptimeRaw = runShell('cat /proc/uptime 2>/dev/null | cut -d" " -f1')
  const uptimeSeconds = Math.floor(parseFloat(uptimeRaw.stdout) || 0)

  return {
    os: os.stdout || 'unknown',
    arch: arch.stdout || 'unknown',
    user: user.stdout || 'unknown',
    diskGB,
    memoryGB,
    kernelVersion: kernel.stdout || 'unknown',
    hostname: hostname.stdout || 'unknown',
    uptimeSeconds,
  }
}

// ──────────────────────────── Preflight Checks ───────────────────────

function checkPreflight(sys: SystemInfo): PreflightResult {
  const failures: string[] = []

  // Disk
  const diskOk = sys.diskGB >= MIN_DISK_GB
  const diskDetail = `${sys.diskGB}GB free (min: ${MIN_DISK_GB}GB)`
  if (!diskOk) failures.push(`disk: ${diskDetail}`)

  // Network
  const netCheck = runShell('curl -sf -m 5 -o /dev/null https://github.com 2>/dev/null && echo OK || echo FAIL')
  const networkOk = netCheck.stdout.includes('OK')
  const networkDetail = networkOk ? 'reachable' : 'github.com unreachable'
  if (!networkOk) failures.push(`network: ${networkDetail}`)

  // Git
  const gitCheck = run('git', ['--version'])
  const gitOk = gitCheck.exitCode === 0
  const gitDetail = gitOk ? gitCheck.stdout : 'git not installed'
  if (!gitOk) failures.push(`git: ${gitDetail}`)

  // Bun
  const bunCheck = run(BUN_BINARY, ['--version'])
  const bunOk = bunCheck.exitCode === 0
  const bunDetail = bunOk ? `bun ${bunCheck.stdout}` : 'bun not installed'
  if (!bunOk) failures.push(`bun: ${bunDetail}`)

  // Node
  const nodeCheck = run('node', ['--version'])
  const nodeOk = nodeCheck.exitCode === 0
  const nodeDetail = nodeOk ? nodeCheck.stdout : 'node not installed'
  if (!nodeOk) failures.push(`node: ${nodeDetail}`)

  // Required directories
  const requiredDirs = ['/root/.config', '/root/.local', '/root/.local/state']
  const missingDirs = requiredDirs.filter(d => !existsSync(d))
  const dirsOk = missingDirs.length === 0
  const dirsDetail = dirsOk ? 'all required dirs exist' : `missing: ${missingDirs.join(', ')}`
  if (!dirsOk) failures.push(`dirs: ${dirsDetail}`)

  return {
    diskOk,
    diskDetail,
    networkOk,
    networkDetail,
    gitOk,
    gitDetail,
    bunOk,
    bunDetail,
    nodeOk,
    nodeDetail,
    dirsOk,
    dirsDetail,
    allPassed: failures.length === 0,
    failures,
  }
}

// ──────────────────────────── Manifest / Lock Reading ────────────────

function readManifest(): EnvironmentManifest | null {
  if (!existsSync(ENVIRONMENT_MANIFEST)) {
    log(`Environment manifest not found: ${ENVIRONMENT_MANIFEST}`)
    return null
  }
  try {
    return JSON.parse(readFileSync(ENVIRONMENT_MANIFEST, 'utf-8'))
  } catch (e: any) {
    log(`Failed to parse environment manifest: ${e.message}`)
    return null
  }
}

function readVersionLock(): VersionLock | null {
  if (!existsSync(VERSION_LOCK)) {
    log(`Version lock not found: ${VERSION_LOCK}`)
    return null
  }
  try {
    return JSON.parse(readFileSync(VERSION_LOCK, 'utf-8'))
  } catch (e: any) {
    log(`Failed to parse version lock: ${e.message}`)
    return null
  }
}

function readInstallManifest(): InstallManifest | null {
  if (!existsSync(MANIFEST_PATH)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
  } catch {
    return null
  }
}

function writeInstallManifest(manifest: InstallManifest, dryRun: boolean): void {
  const content = JSON.stringify(manifest, null, 2) + '\n'
  if (dryRun) {
    logDry(`Would write install manifest: ${MANIFEST_PATH} (${content.length} bytes)`)
    return
  }
  ensureDir(MANIFEST_DIR, false)
  const tmp = MANIFEST_PATH + '.tmp.' + process.pid
  writeFileSync(tmp, content, 'utf-8')
  renameSync(tmp, MANIFEST_PATH)
  try { chmodSync(MANIFEST_PATH, 0o600) } catch {}
  log(`Install manifest written: ${MANIFEST_PATH}`)
}

// ──────────────────────────── Backup ─────────────────────────────────

function backupExisting(flags: CliFlags): string | null {
  if (flags.mode === 'dry-run' || flags.mode === 'validate' || flags.mode === 'status') {
    return null
  }

  const backupPath = join(BACKUP_DIR, `pre-bootstrap-${BACKUP_TIMESTAMP_FMT}`)

  log(`Creating backup: ${backupPath}`)
  ensureDir(backupPath, false)

  const filesToBackup = [
    OPENCODE_CONFIG,
    join(AGENTS_DIR, '**'),
    join(COMMANDS_DIR, '**'),
    join(SKILLS_DIR, '**'),
    MANIFEST_PATH,
  ]

  for (const src of filesToBackup) {
    if (!existsSync(src)) continue
    const dest = join(backupPath, src)
    ensureDir(dirname(dest), false)
    try {
      if (statSync(src).isDirectory()) {
        cpSync(src, dest, { recursive: true })
      } else {
        copyFileSync(src, dest)
      }
    } catch (e: any) {
      log(`Warning: failed to backup ${src}: ${e.message}`)
    }
  }

  // Save current install manifest if exists
  const currentManifest = readInstallManifest()
  if (currentManifest) {
    writeFileSafe(join(backupPath, 'install-manifest.json'), JSON.stringify(currentManifest, null, 2), false)
  }

  log(`Backup created: ${backupPath}`)
  return backupPath
}

// ──────────────────────────── Plan Installation ──────────────────────

function planInstallation(
  manifest: EnvironmentManifest,
  lock: VersionLock,
  flags: CliFlags,
): ActionPlan {
  const actions: PlannedAction[] = []
  const isDryRun = flags.mode === 'dry-run'

  // 1. Runtime binaries
  if (!fileExists(OPENCODE_BINARY)) {
    actions.push({
      type: 'install',
      target: OPENCODE_BINARY,
      source: `opencode ${lock.opencode.version}`,
      reason: `opencode binary missing (locked: ${lock.opencode.version})`,
      category: 'runtime',
      reversible: true,
    })
  } else {
    actions.push({
      type: 'skip',
      target: OPENCODE_BINARY,
      source: null,
      reason: 'opencode binary already present',
      category: 'runtime',
      reversible: false,
    })
  }

  if (!fileExists(BUN_BINARY)) {
    actions.push({
      type: 'install',
      target: BUN_BINARY,
      source: `bun ${lock.runtime.bun}`,
      reason: `bun binary missing (locked: ${lock.runtime.bun})`,
      category: 'runtime',
      reversible: true,
    })
  } else {
    actions.push({
      type: 'skip',
      target: BUN_BINARY,
      source: null,
      reason: 'bun binary already present',
      category: 'runtime',
      reversible: false,
    })
  }

  const nodeCheck = run('node', ['--version'])
  if (nodeCheck.exitCode !== 0) {
    actions.push({
      type: 'install',
      target: 'node',
      source: `node ${lock.runtime.node}`,
      reason: `node not found (locked: ${lock.runtime.node})`,
      category: 'runtime',
      reversible: true,
    })
  }

  if (!fileExists(AKM_BINARY)) {
    actions.push({
      type: 'install',
      target: AKM_BINARY,
      source: `akm ${lock.akm.version}`,
      reason: `akm binary missing (locked: ${lock.akm.version})`,
      category: 'runtime',
      reversible: true,
    })
  }

  // 2. Repository
  if (!existsSync(join(PROJECT_ROOT, '.git'))) {
    actions.push({
      type: 'install',
      target: PROJECT_ROOT,
      source: manifest.repository.url,
      reason: 'akm-bridge repository not found',
      category: 'repo',
      reversible: true,
    })
  }

  // 3. Build output
  const distDir = join(PROJECT_ROOT, 'dist')
  if (!existsSync(distDir) || !existsSync(join(distDir, 'mcp-server.js'))) {
    actions.push({
      type: 'install',
      target: distDir,
      source: 'bun install + tsc',
      reason: 'build output missing or incomplete',
      category: 'build',
      reversible: true,
    })
  }

  // 4. Config
  if (!existsSync(OPENCODE_CONFIG)) {
    actions.push({
      type: 'install',
      target: OPENCODE_CONFIG,
      source: join(TEMPLATES_DIR, 'opencode.json'),
      reason: 'opencode.json config missing',
      category: 'config',
      reversible: true,
    })
  }

  // 5. Agent templates
  const agentFiles = listTemplateFiles(AGENTS_TEMPLATES_DIR)
  for (const f of agentFiles) {
    const target = join(AGENTS_DIR, f)
    if (!existsSync(target)) {
      actions.push({
        type: 'install',
        target,
        source: join(AGENTS_TEMPLATES_DIR, f),
        reason: `agent template missing: ${f}`,
        category: 'agent',
        reversible: true,
      })
    }
  }

  // 6. Command templates
  const commandFiles = listTemplateFiles(COMMANDS_TEMPLATES_DIR)
  for (const f of commandFiles) {
    const target = join(COMMANDS_DIR, f)
    if (!existsSync(target)) {
      actions.push({
        type: 'install',
        target,
        source: join(COMMANDS_TEMPLATES_DIR, f),
        reason: `command template missing: ${f}`,
        category: 'command',
        reversible: true,
      })
    }
  }

  // 7. Skill templates
  const skillDirs = listTemplateDirs(SKILLS_TEMPLATES_DIR)
  for (const d of skillDirs) {
    const target = join(SKILLS_DIR, d)
    if (!existsSync(target)) {
      actions.push({
        type: 'install',
        target,
        source: join(SKILLS_TEMPLATES_DIR, d),
        reason: `skill template missing: ${d}`,
        category: 'skill',
        reversible: true,
      })
    }
  }

  // 8. Systemd units
  if (!flags.skipSystemd) {
    const unitFiles = listTemplateFiles(SYSTEMD_TEMPLATES_DIR, '.service', '.timer')
    for (const f of unitFiles) {
      const target = join(SYSTEMD_DIR, f)
      if (!existsSync(target)) {
        actions.push({
          type: 'install',
          target,
          source: join(SYSTEMD_TEMPLATES_DIR, f),
          reason: `systemd unit missing: ${f}`,
          category: 'systemd',
          reversible: true,
        })
      }
    }
  }

  // 9. Recovery scripts
  for (const script of [RECOVERY_SCRIPT, UPDATE_SCRIPT, OBSERVABILITY_SCRIPT]) {
    if (!existsSync(script)) {
      actions.push({
        type: 'install',
        target: script,
        source: null,
        reason: `recovery script missing: ${basename(script)}`,
        category: 'recovery',
        reversible: true,
      })
    }
  }

  // 10. Compatibility files
  if (!existsSync(VERSION_LOCK)) {
    actions.push({
      type: 'install',
      target: VERSION_LOCK,
      source: null,
      reason: 'version lock missing',
      category: 'compatibility',
      reversible: true,
    })
  }
  if (!existsSync(MATRIX_FILE)) {
    actions.push({
      type: 'install',
      target: MATRIX_FILE,
      source: null,
      reason: 'compatibility matrix missing',
      category: 'compatibility',
      reversible: true,
    })
  }

  // 11. Secrets provisioning
  if (!flags.skipSecrets) {
    const placeholders = manifest.secretPlaceholders || []
    for (const sp of placeholders) {
      if (sp.required) {
        actions.push({
          type: 'provision-secret',
          target: sp.name,
          source: null,
          reason: sp.description,
          category: 'secret',
          reversible: false,
        })
      }
    }
  }

  // 12. Directories
  const requiredDirs = [STATE_DIR, LOG_DIR, MANIFEST_DIR, AGENTS_DIR, COMMANDS_DIR, SKILLS_DIR]
  for (const dir of requiredDirs) {
    if (!existsSync(dir)) {
      actions.push({
        type: 'create-dir',
        target: dir,
        source: null,
        reason: 'required directory missing',
        category: 'infrastructure',
        reversible: true,
      })
    }
  }

  const needsBackup = actions.some(a => a.type === 'install' && a.category !== 'infrastructure')

  return {
    actions,
    backupRequired: needsBackup,
    backupTarget: needsBackup ? join(BACKUP_DIR, `pre-bootstrap-${BACKUP_TIMESTAMP_FMT}`) : null,
    estimatedChanges: actions.filter(a => a.type !== 'skip').length,
  }
}

function listTemplateFiles(dir: string, ...exts: string[]): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(f => f.isFile())
    .filter(f => exts.length === 0 || exts.some(ext => f.name.endsWith(ext)))
    .map(f => f.name)
    .sort()
}

function listTemplateDirs(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(f => f.isDirectory())
    .map(f => f.name)
    .sort()
}

// ──────────────────────────── Installation Functions ─────────────────

function installRuntime(
  lock: VersionLock,
  manifest: EnvironmentManifest,
  dryRun: boolean,
): InstalledFile[] {
  const installed: InstalledFile[] = []

  // Install opencode if missing
  if (!fileExists(OPENCODE_BINARY)) {
    log(`Installing opencode ${lock.opencode.version}...`)
    if (!dryRun) {
      ensureDir(dirname(OPENCODE_BINARY), false)
      const url = `https://github.com/opencode-ai/opencode/releases/download/v${lock.opencode.version}/opencode-${lock.opencode.version}-linux-amd64`
      const dl = runShell(`curl -sfL -o "${OPENCODE_BINARY}" "${url}" 2>&1`)
      if (dl.exitCode === 0) {
        chmodSync(OPENCODE_BINARY, 0o755)
        installed.push({
          path: OPENCODE_BINARY,
          source: url,
          checksum: sha256File(OPENCODE_BINARY),
          installedAt: new Date().toISOString(),
          category: 'other',
        })
        log(`opencode installed: ${OPENCODE_BINARY}`)
      } else {
        log(`ERROR: Failed to install opencode: ${dl.stderr}`)
      }
    } else {
      logDry(`Would install opencode ${lock.opencode.version} to ${OPENCODE_BINARY}`)
    }
  }

  // Install bun if missing
  if (!fileExists(BUN_BINARY)) {
    log(`Installing bun ${lock.runtime.bun}...`)
    if (!dryRun) {
      const dl = runShell(`curl -fsSL https://bun.sh/install | bash -s "bun-v${lock.runtime.bun}" 2>&1`, 60000)
      if (dl.exitCode === 0 && fileExists(BUN_BINARY)) {
        installed.push({
          path: BUN_BINARY,
          source: 'bun.sh',
          checksum: sha256File(BUN_BINARY),
          installedAt: new Date().toISOString(),
          category: 'other',
        })
        log(`bun installed: ${BUN_BINARY}`)
      } else {
        log(`ERROR: Failed to install bun: ${dl.stderr}`)
      }
    } else {
      logDry(`Would install bun ${lock.runtime.bun} to ${BUN_BINARY}`)
    }
  }

  // Install akm if missing
  if (!fileExists(AKM_BINARY)) {
    log(`Installing akm ${lock.akm.version}...`)
    if (!dryRun) {
      const dl = runShell(`${BUN_BINARY} pm install -g @anthropic/akm@${lock.akm.version} 2>&1 || ${BUN_BINARY} pm install -g akm@${lock.akm.version} 2>&1`)
      if (fileExists(AKM_BINARY)) {
        installed.push({
          path: AKM_BINARY,
          source: `akm@${lock.akm.version}`,
          checksum: sha256File(AKM_BINARY),
          installedAt: new Date().toISOString(),
          category: 'other',
        })
        log(`akm installed: ${AKM_BINARY}`)
      } else {
        log(`Warning: akm installation may require manual setup`)
      }
    } else {
      logDry(`Would install akm ${lock.akm.version} to ${AKM_BINARY}`)
    }
  }

  return installed
}

function cloneOrUpdateRepo(
  manifest: EnvironmentManifest,
  dryRun: boolean,
): InstalledFile[] {
  const installed: InstalledFile[] = []

  if (!existsSync(join(PROJECT_ROOT, '.git'))) {
    log(`Cloning akm-bridge repository...`)
    if (!dryRun) {
      const cloneTarget = dirname(PROJECT_ROOT)
      ensureDir(cloneTarget, false)
      const cl = runShell(`git clone "${manifest.repository.url}" "${PROJECT_ROOT}" 2>&1`, 30000)
      if (cl.exitCode !== 0) {
        log(`ERROR: Failed to clone repo: ${cl.stderr}`)
        return installed
      }
    } else {
      logDry(`Would clone ${manifest.repository.url} to ${PROJECT_ROOT}`)
    }
  }

  // Checkout correct commit
  if (existsSync(join(PROJECT_ROOT, '.git')) && manifest.repository.currentCommit) {
    const currentCommit = runShell(`git -C "${PROJECT_ROOT}" rev-parse --short HEAD`)
    if (currentCommit.stdout !== manifest.repository.currentCommit) {
      log(`Checking out commit ${manifest.repository.currentCommit}...`)
      if (!dryRun) {
        runShell(`git -C "${PROJECT_ROOT}" fetch origin 2>&1`)
        const checkout = runShell(`git -C "${PROJECT_ROOT}" checkout ${manifest.repository.currentCommit} 2>&1`)
        if (checkout.exitCode === 0) {
          log(`Checked out: ${manifest.repository.currentCommit}`)
        } else {
          log(`Warning: could not checkout ${manifest.repository.currentCommit}: ${checkout.stderr}`)
        }
      } else {
        logDry(`Would checkout ${manifest.repository.currentCommit} (current: ${currentCommit.stdout})`)
      }
    }
  }

  return installed
}

function buildBridge(dryRun: boolean): InstalledFile[] {
  const installed: InstalledFile[] = []
  const distDir = join(PROJECT_ROOT, 'dist')

  if (existsSync(distDir) && existsSync(join(distDir, 'mcp-server.js'))) {
    log('Build output already present, skipping build')
    return installed
  }

  log('Building akm-bridge...')
  if (dryRun) {
    logDry(`Would run: cd ${PROJECT_ROOT} && ${BUN_BINARY} install && npx tsc`)
    return installed
  }

  // bun install
  const install = runShell(`cd "${PROJECT_ROOT}" && "${BUN_BINARY}" install 2>&1`, 60000)
  if (install.exitCode !== 0) {
    log(`Warning: bun install had issues: ${install.stderr}`)
  }

  // typecheck
  const tsc = runShell(`cd "${PROJECT_ROOT}" && npx tsc --noEmit 2>&1`, 30000)
  if (tsc.exitCode !== 0) {
    log(`Warning: typecheck had issues: ${tsc.stderr}`)
  }

  // build
  const build = runShell(`cd "${PROJECT_ROOT}" && npx tsc 2>&1`, 30000)
  if (build.exitCode === 0) {
    log('Build completed successfully')
    // Record built files
    if (existsSync(distDir)) {
      const files = readdirSync(distDir).filter(f => f.endsWith('.js'))
      for (const f of files) {
        installed.push({
          path: join(distDir, f),
          source: 'tsc build',
          checksum: sha256File(join(distDir, f)),
          installedAt: new Date().toISOString(),
          category: 'other',
        })
      }
    }
  } else {
    log(`ERROR: Build failed: ${build.stderr}`)
  }

  return installed
}

function installConfig(
  lock: VersionLock,
  manifest: EnvironmentManifest,
  dryRun: boolean,
): InstalledFile[] {
  const installed: InstalledFile[] = []
  const templatePath = join(TEMPLATES_DIR, 'opencode.json')

  if (existsSync(OPENCODE_CONFIG)) {
    log('opencode.json already exists, skipping (use --upgrade-existing to update)')
    return installed
  }

  let configContent: string

  if (existsSync(templatePath)) {
    configContent = readFileSync(templatePath, 'utf-8')
    // Replace version placeholders from lock file
    configContent = configContent.replace(/__OPENCODE_VERSION__/g, lock.opencode.version)
    configContent = configContent.replace(/__BUN_VERSION__/g, lock.runtime.bun)
    configContent = configContent.replace(/__NODE_VERSION__/g, lock.runtime.node)
    configContent = configContent.replace(/__AKM_VERSION__/g, lock.akm.version)
  } else {
    // Generate minimal config
    configContent = generateMinimalConfig(lock)
  }

  writeFileSafe(OPENCODE_CONFIG, configContent, dryRun)

  if (!dryRun) {
    installed.push({
      path: OPENCODE_CONFIG,
      source: existsSync(templatePath) ? templatePath : 'generated',
      checksum: sha256String(configContent),
      installedAt: new Date().toISOString(),
      category: 'config',
    })
    log(`Config installed: ${OPENCODE_CONFIG}`)
  } else {
    logDry(`Would install config: ${OPENCODE_CONFIG}`)
  }

  return installed
}

function generateMinimalConfig(lock: VersionLock): string {
  const mcpServers: Record<string, any> = {}
  for (const [name, status] of Object.entries(lock.mcpServers)) {
    if (status === 'enabled') {
      mcpServers[name] = { enabled: true }
    }
  }

  return JSON.stringify({
    $schema: 'https://opencode.ai/schema.json',
    mcpServers,
    plugins: Object.entries(lock.plugins).reduce((acc, [k, v]) => {
      acc[k] = { version: v }
      return acc
    }, {} as Record<string, any>),
  }, null, 2) + '\n'
}

function installAgents(dryRun: boolean): InstalledFile[] {
  const installed: InstalledFile[] = []
  const templateDir = AGENTS_TEMPLATES_DIR

  if (!existsSync(templateDir)) {
    log(`Agent templates directory not found: ${templateDir}`)
    return installed
  }

  ensureDir(AGENTS_DIR, dryRun)

  const files = listTemplateFiles(templateDir, '.md')
  for (const f of files) {
    const src = join(templateDir, f)
    const dst = join(AGENTS_DIR, f)
    if (!existsSync(dst)) {
      copyFileSafe(src, dst, dryRun)
      if (!dryRun) {
        installed.push({
          path: dst,
          source: src,
          checksum: sha256File(src),
          installedAt: new Date().toISOString(),
          category: 'agent',
        })
      } else {
        logDry(`Would install agent: ${f}`)
      }
    }
  }

  return installed
}

function installCommands(dryRun: boolean): InstalledFile[] {
  const installed: InstalledFile[] = []
  const templateDir = COMMANDS_TEMPLATES_DIR

  if (!existsSync(templateDir)) {
    log(`Command templates directory not found: ${templateDir}`)
    return installed
  }

  ensureDir(COMMANDS_DIR, dryRun)

  const files = listTemplateFiles(templateDir, '.md')
  for (const f of files) {
    const src = join(templateDir, f)
    const dst = join(COMMANDS_DIR, f)
    if (!existsSync(dst)) {
      copyFileSafe(src, dst, dryRun)
      if (!dryRun) {
        installed.push({
          path: dst,
          source: src,
          checksum: sha256File(src),
          installedAt: new Date().toISOString(),
          category: 'command',
        })
      } else {
        logDry(`Would install command: ${f}`)
      }
    }
  }

  return installed
}

function installSkills(dryRun: boolean): InstalledFile[] {
  const installed: InstalledFile[] = []
  const templateDir = SKILLS_TEMPLATES_DIR

  if (!existsSync(templateDir)) {
    log(`Skill templates directory not found: ${templateDir}`)
    return installed
  }

  ensureDir(SKILLS_DIR, dryRun)

  const dirs = listTemplateDirs(templateDir)
  for (const d of dirs) {
    const src = join(templateDir, d)
    const dst = join(SKILLS_DIR, d)
    if (!existsSync(dst)) {
      if (dryRun) {
        logDry(`Would install skill: ${d}`)
      } else {
        cpSync(src, dst, { recursive: true })
        log(`Installed skill: ${d}`)
        installed.push({
          path: dst,
          source: src,
          checksum: sha256String(d),
          installedAt: new Date().toISOString(),
          category: 'skill',
        })
      }
    }
  }

  return installed
}

function installSystemd(dryRun: boolean): InstalledFile[] {
  const installed: InstalledFile[] = []
  const templateDir = SYSTEMD_TEMPLATES_DIR

  if (!existsSync(templateDir)) {
    log(`Systemd templates directory not found: ${templateDir}`)
    return installed
  }

  const unitFiles = listTemplateFiles(templateDir, '.service', '.timer')
  for (const f of unitFiles) {
    const src = join(templateDir, f)
    const dst = join(SYSTEMD_DIR, f)
    if (!existsSync(dst)) {
      copyFileSafe(src, dst, dryRun)
      if (!dryRun) {
        installed.push({
          path: dst,
          source: src,
          checksum: sha256File(src),
          installedAt: new Date().toISOString(),
          category: 'systemd',
        })
        log(`Installed systemd unit: ${f}`)
      } else {
        logDry(`Would install systemd unit: ${f}`)
      }
    }
  }

  return installed
}

function installRecovery(dryRun: boolean): InstalledFile[] {
  const installed: InstalledFile[] = []

  ensureDir(MANIFEST_DIR, dryRun)
  ensureDir(LOG_DIR, dryRun)

  const recoveryFiles = [
    RECOVERY_SCRIPT,
    UPDATE_SCRIPT,
    OBSERVABILITY_SCRIPT,
    E2E_SCRIPT,
    HEALTH_CHECK_SCRIPT,
  ]

  for (const script of recoveryFiles) {
    if (!existsSync(script)) {
      log(`Warning: recovery script not found: ${basename(script)}`)
      continue
    }
    // Scripts are already in place, just track them
    if (!dryRun) {
      installed.push({
        path: script,
        source: script,
        checksum: sha256File(script),
        installedAt: new Date().toISOString(),
        category: 'recovery',
      })
    }
  }

  return installed
}

function installObservability(dryRun: boolean): InstalledFile[] {
  const installed: InstalledFile[] = []

  // Install observability config if template exists
  const obsTemplate = join(TEMPLATES_DIR, 'observability')
  if (existsSync(obsTemplate)) {
    const dstDir = join(STATE_DIR, 'observability')
    if (!existsSync(dstDir)) {
      if (dryRun) {
        logDry(`Would install observability configs to ${dstDir}`)
      } else {
        cpSync(obsTemplate, dstDir, { recursive: true })
        installed.push({
          path: dstDir,
          source: obsTemplate,
          checksum: sha256String('observability'),
          installedAt: new Date().toISOString(),
          category: 'observability',
        })
      }
    }
  }

  return installed
}

function installCompatibility(dryRun: boolean): InstalledFile[] {
  const installed: InstalledFile[] = []

  // Version lock
  if (!existsSync(VERSION_LOCK)) {
    log('Warning: version lock file not found in repo')
  } else {
    if (!dryRun) {
      installed.push({
        path: VERSION_LOCK,
        source: VERSION_LOCK,
        checksum: sha256File(VERSION_LOCK),
        installedAt: new Date().toISOString(),
        category: 'compatibility',
      })
    }
  }

  // Matrix
  if (!existsSync(MATRIX_FILE)) {
    log('Warning: compatibility matrix not found in repo')
  } else {
    if (!dryRun) {
      installed.push({
        path: MATRIX_FILE,
        source: MATRIX_FILE,
        checksum: sha256File(MATRIX_FILE),
        installedAt: new Date().toISOString(),
        category: 'compatibility',
      })
    }
  }

  return installed
}

function provisionSecrets(
  flags: CliFlags,
  manifest: EnvironmentManifest,
  dryRun: boolean,
): void {
  if (flags.skipSecrets) {
    log('Secrets provisioning skipped (--skip-secrets)')
    return
  }

  const placeholders = manifest.secretPlaceholders || []
  if (placeholders.length === 0) {
    log('No secret placeholders defined')
    return
  }

  let secrets: Record<string, string> = {}

  // Read from file if provided
  if (flags.secretsFile && existsSync(flags.secretsFile)) {
    log(`Reading secrets from: ${flags.secretsFile}`)
    const content = readFileSync(flags.secretsFile, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim()
        const val = trimmed.slice(eqIdx + 1).trim()
        secrets[key] = val
      }
    }
  } else if (!flags.nonInteractive && process.stdin.isTTY) {
    // Interactive prompt for required secrets
    for (const sp of placeholders) {
      if (!sp.required) continue
      // Never print secrets to output
      const val = promptForSecret(sp.name, sp.description)
      if (val) secrets[sp.name] = val
    }
  }

  // Apply secrets via environment or systemd credentials
  for (const [key, val] of Object.entries(secrets)) {
    if (dryRun) {
      logDry(`Would provision secret: ${key} (value redacted)`)
    } else {
      log(`Provisioning secret: ${key}`)
      // Store in systemd credential or env file, never in repo
      const envFile = join(STATE_DIR, '.env.secrets')
      const line = `${key}=${val}\n`
      const existing = existsSync(envFile) ? readFileSync(envFile, 'utf-8') : ''
      if (!existing.includes(`${key}=`)) {
        writeFileSync(envFile, existing + line, 'utf-8')
        chmodSync(envFile, 0o600)
      }
    }
  }
}

function promptForSecret(name: string, description: string): string | null {
  try {
    process.stderr.write(`\nSecret required: ${name}\n  ${description}\n  Value (empty to skip): `)
    const buf = Buffer.alloc(256)
    const fd = 0 // stdin
    const bytesRead = readSync(fd, buf, 0, 1, null)
    if (bytesRead <= 0) return null
    const val = buf.toString('utf-8', 0, bytesRead).trim()
    return val || null
  } catch {
    return null
  }
}

// ──────────────────────────── Upgrade Existing ───────────────────────

function upgradeExisting(
  manifest: EnvironmentManifest,
  lock: VersionLock,
  flags: CliFlags,
): { actions: PlannedAction[]; installed: InstalledFile[] } {
  const actions: PlannedAction[] = []
  const installed: InstalledFile[] = []
  const dryRun = flags.mode === 'dry-run'

  log('Upgrading existing installation (additive only)...')

  // Ensure all agent files exist
  const agentFiles = listTemplateFiles(AGENTS_TEMPLATES_DIR, '.md')
  for (const f of agentFiles) {
    const dst = join(AGENTS_DIR, f)
    if (!existsSync(dst)) {
      actions.push({ type: 'install', target: dst, source: join(AGENTS_TEMPLATES_DIR, f), reason: `missing agent: ${f}`, category: 'agent', reversible: true })
      copyFileSafe(join(AGENTS_TEMPLATES_DIR, f), dst, dryRun)
      if (!dryRun) {
        installed.push({ path: dst, source: join(AGENTS_TEMPLATES_DIR, f), checksum: sha256File(join(AGENTS_TEMPLATES_DIR, f)), installedAt: new Date().toISOString(), category: 'agent' })
      }
    }
  }

  // Ensure all command files exist
  const cmdFiles = listTemplateFiles(COMMANDS_TEMPLATES_DIR, '.md')
  for (const f of cmdFiles) {
    const dst = join(COMMANDS_DIR, f)
    if (!existsSync(dst)) {
      actions.push({ type: 'install', target: dst, source: join(COMMANDS_TEMPLATES_DIR, f), reason: `missing command: ${f}`, category: 'command', reversible: true })
      copyFileSafe(join(COMMANDS_TEMPLATES_DIR, f), dst, dryRun)
      if (!dryRun) {
        installed.push({ path: dst, source: join(COMMANDS_TEMPLATES_DIR, f), checksum: sha256File(join(COMMANDS_TEMPLATES_DIR, f)), installedAt: new Date().toISOString(), category: 'command' })
      }
    }
  }

  // Ensure all skill dirs exist
  const skillDirs = listTemplateDirs(SKILLS_TEMPLATES_DIR)
  for (const d of skillDirs) {
    const dst = join(SKILLS_DIR, d)
    if (!existsSync(dst)) {
      actions.push({ type: 'install', target: dst, source: join(SKILLS_TEMPLATES_DIR, d), reason: `missing skill: ${d}`, category: 'skill', reversible: true })
      if (!dryRun) {
        cpSync(join(SKILLS_TEMPLATES_DIR, d), dst, { recursive: true })
        installed.push({ path: dst, source: join(SKILLS_TEMPLATES_DIR, d), checksum: sha256String(d), installedAt: new Date().toISOString(), category: 'skill' })
      } else {
        logDry(`Would install skill: ${d}`)
      }
    }
  }

  // Ensure systemd units exist
  if (!flags.skipSystemd) {
    const unitFiles = listTemplateFiles(SYSTEMD_TEMPLATES_DIR, '.service', '.timer')
    for (const f of unitFiles) {
      const dst = join(SYSTEMD_DIR, f)
      if (!existsSync(dst)) {
        actions.push({ type: 'install', target: dst, source: join(SYSTEMD_TEMPLATES_DIR, f), reason: `missing systemd unit: ${f}`, category: 'systemd', reversible: true })
        copyFileSafe(join(SYSTEMD_TEMPLATES_DIR, f), dst, dryRun)
        if (!dryRun) {
          installed.push({ path: dst, source: join(SYSTEMD_TEMPLATES_DIR, f), checksum: sha256File(join(SYSTEMD_TEMPLATES_DIR, f)), installedAt: new Date().toISOString(), category: 'systemd' })
        }
      }
    }
  }

  return { actions, installed }
}

// ──────────────────────────── Validation ─────────────────────────────

function validateAll(
  manifest: EnvironmentManifest,
  lock: VersionLock,
): ValidationResult[] {
  const results: ValidationResult[] = []

  // 1. opencode binary
  const ocCheck = run(OPENCODE_BINARY, ['--version'])
  results.push({
    name: 'opencode_binary',
    passed: ocCheck.exitCode === 0,
    detail: ocCheck.exitCode === 0 ? `v${ocCheck.stdout}` : 'binary not found or not executable',
    severity: 'critical',
  })

  // 2. bun binary
  const bunCheck = run(BUN_BINARY, ['--version'])
  results.push({
    name: 'bun_binary',
    passed: bunCheck.exitCode === 0,
    detail: bunCheck.exitCode === 0 ? `v${bunCheck.stdout}` : 'bun not found',
    severity: 'warning',
  })

  // 3. node binary
  const nodeCheck = run('node', ['--version'])
  results.push({
    name: 'node_binary',
    passed: nodeCheck.exitCode === 0,
    detail: nodeCheck.exitCode === 0 ? nodeCheck.stdout : 'node not found',
    severity: 'warning',
  })

  // 4. Config syntax
  if (existsSync(OPENCODE_CONFIG)) {
    try {
      const config = JSON.parse(readFileSync(OPENCODE_CONFIG, 'utf-8'))
      results.push({
        name: 'config_syntax_valid',
        passed: true,
        detail: `valid JSON, ${Object.keys(config.mcpServers || {}).length} MCP servers`,
        severity: 'critical',
      })
    } catch (e: any) {
      results.push({
        name: 'config_syntax_valid',
        passed: false,
        detail: `invalid JSON: ${e.message}`,
        severity: 'critical',
      })
    }
  } else {
    results.push({
      name: 'config_syntax_valid',
      passed: false,
      detail: 'opencode.json not found',
      severity: 'critical',
    })
  }

  // 5. Agents discovered
  if (existsSync(AGENTS_DIR)) {
    const agents = readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md'))
    results.push({
      name: 'agents_discovered',
      passed: agents.length > 0,
      detail: `${agents.length} agent files`,
      severity: 'warning',
    })
  } else {
    results.push({
      name: 'agents_discovered',
      passed: false,
      detail: 'agents directory not found',
      severity: 'warning',
    })
  }

  // 6. Commands discovered
  if (existsSync(COMMANDS_DIR)) {
    const cmds = readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.md'))
    results.push({
      name: 'commands_discovered',
      passed: cmds.length > 0,
      detail: `${cmds.length} command files`,
      severity: 'warning',
    })
  } else {
    results.push({
      name: 'commands_discovered',
      passed: false,
      detail: 'commands directory not found',
      severity: 'warning',
    })
  }

  // 7. Skills discovered
  if (existsSync(SKILLS_DIR)) {
    const skills = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(f => f.isDirectory())
    results.push({
      name: 'skills_discovered',
      passed: skills.length > 0,
      detail: `${skills.length} skill directories`,
      severity: 'warning',
    })
  } else {
    results.push({
      name: 'skills_discovered',
      passed: false,
      detail: 'skills directory not found',
      severity: 'warning',
    })
  }

  // 8. MCP initialize check (quick)
  const mcpCheck = run(OPENCODE_BINARY, ['mcp', 'list'], 10000)
  results.push({
    name: 'mcp_initialize',
    passed: mcpCheck.exitCode === 0 || mcpCheck.stdout.length > 0,
    detail: mcpCheck.exitCode === 0 ? 'MCP servers listable' : `exit code ${mcpCheck.exitCode}`,
    severity: 'critical',
  })

  // 9. AKM health
  const akmCheck = run(AKM_BINARY, ['health'], 10000)
  results.push({
    name: 'akm_health',
    passed: akmCheck.exitCode === 0,
    detail: akmCheck.exitCode === 0 ? 'AKM healthy' : 'AKM unreachable or unhealthy',
    severity: 'warning',
  })

  // 10. Version lock consistency
  if (lock) {
    const lockValid = lock.schemaVersion === 1 && !!lock.opencode.version && !!lock.runtime.bun
    results.push({
      name: 'version_lock_valid',
      passed: lockValid,
      detail: lockValid ? `locked to opencode ${lock.opencode.version}` : 'version lock invalid',
      severity: 'critical',
    })
  }

  // 11. Build output
  const distExists = existsSync(join(PROJECT_ROOT, 'dist'))
  results.push({
    name: 'build_output',
    passed: distExists,
    detail: distExists ? 'dist/ directory present' : 'dist/ missing (build not run)',
    severity: 'warning',
  })

  // 12. Install manifest
  const manifestExists = existsSync(MANIFEST_PATH)
  results.push({
    name: 'install_manifest',
    passed: manifestExists,
    detail: manifestExists ? 'install manifest present' : 'no install manifest',
    severity: 'info',
  })

  return results
}

// ──────────────────────────── Smoke Tests ────────────────────────────

function runSmoke(): ValidationResult[] {
  const results: ValidationResult[] = []

  // Quick opencode version
  const oc = run(OPENCODE_BINARY, ['--version'])
  results.push({
    name: 'smoke_opencode_version',
    passed: oc.exitCode === 0,
    detail: oc.stdout || oc.stderr,
    severity: 'critical',
  })

  // Config loadable
  if (existsSync(OPENCODE_CONFIG)) {
    try {
      JSON.parse(readFileSync(OPENCODE_CONFIG, 'utf-8'))
      results.push({ name: 'smoke_config_loadable', passed: true, detail: 'config parses', severity: 'critical' })
    } catch {
      results.push({ name: 'smoke_config_loadable', passed: false, detail: 'config parse error', severity: 'critical' })
    }
  }

  // Agent count
  if (existsSync(AGENTS_DIR)) {
    const count = readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')).length
    results.push({ name: 'smoke_agents_count', passed: count > 0, detail: `${count} agents`, severity: 'warning' })
  }

  // Bun works
  const bun = run(BUN_BINARY, ['--version'])
  results.push({ name: 'smoke_bun', passed: bun.exitCode === 0, detail: bun.stdout || 'unavailable', severity: 'warning' })

  return results
}

function runFullE2E(): ValidationResult[] {
  const results: ValidationResult[] = []

  if (!existsSync(E2E_SCRIPT)) {
    results.push({ name: 'e2e_test', passed: false, detail: 'e2e script not found', severity: 'warning' })
    return results
  }

  log('Running E2E tests...')
  const e2e = run('bun', ['run', E2E_SCRIPT, '--json'], 60000)

  if (e2e.exitCode === 0) {
    try {
      const report = JSON.parse(e2e.stdout)
      results.push({
        name: 'e2e_test',
        passed: report.overall === 'PASS',
        detail: `${report.summary?.passed ?? 0}/${report.summary?.total ?? 0} passed`,
        severity: 'critical',
      })
    } catch {
      results.push({ name: 'e2e_test', passed: false, detail: 'could not parse e2e output', severity: 'critical' })
    }
  } else {
    results.push({ name: 'e2e_test', passed: false, detail: `e2e exited ${e2e.exitCode}: ${e2e.stderr.slice(0, 200)}`, severity: 'critical' })
  }

  return results
}

// ──────────────────────────── Restore ────────────────────────────────

function runRestore(flags: CliFlags): { actions: PlannedAction[]; results: ValidationResult[] } {
  const actions: PlannedAction[] = []
  const results: ValidationResult[] = []

  const manifest = readInstallManifest()
  if (!manifest) {
    log('ERROR: No install manifest found. Cannot restore.')
    results.push({ name: 'restore_manifest', passed: false, detail: 'install manifest not found', severity: 'critical' })
    return { actions, results }
  }

  log(`Restoring from install manifest: ${manifest.installedAt}`)

  // Restore each tracked file
  for (const file of manifest.files) {
    if (!existsSync(file.source)) {
      log(`Warning: source not available for restore: ${file.source}`)
      results.push({ name: `restore_${basename(file.path)}`, passed: false, detail: `source missing: ${file.source}`, severity: 'warning' })
      continue
    }

    if (!existsSync(file.path) || sha256File(file.path) !== file.checksum) {
      actions.push({ type: 'install', target: file.path, source: file.source, reason: 'restored from manifest', category: file.category, reversible: true })
      copyFileSafe(file.source, file.path, flags.mode === 'dry-run')
    } else {
      actions.push({ type: 'skip', target: file.path, source: null, reason: 'already correct', category: file.category, reversible: false })
    }
  }

  // Restore directories
  for (const dir of manifest.directories) {
    if (!existsSync(dir)) {
      actions.push({ type: 'create-dir', target: dir, source: null, reason: 'restored from manifest', category: 'infrastructure', reversible: true })
      ensureDir(dir, flags.mode === 'dry-run')
    }
  }

  // Validate after restore
  const envManifest = readManifest()
  const lock = readVersionLock()
  if (envManifest && lock) {
    results.push(...validateAll(envManifest, lock))
  }

  return { actions, results }
}

// ──────────────────────────── Uninstall Generated ────────────────────

function uninstallGenerated(dryRun: boolean): { actions: PlannedAction[] } {
  const actions: PlannedAction[] = []

  const manifest = readInstallManifest()
  if (!manifest) {
    log('ERROR: No install manifest found. Cannot determine what was generated.')
    return { actions }
  }

  log(`Uninstalling ${manifest.files.length} tracked files...`)

  // Remove tracked files
  for (const file of manifest.files) {
    if (existsSync(file.path)) {
      actions.push({ type: 'remove', target: file.path, source: null, reason: 'tracked in install manifest', category: file.category, reversible: false })
      removeFileSafe(file.path, dryRun, 'tracked in install manifest')
    }
  }

  // Remove tracked directories (only if empty)
  for (const dir of manifest.directories) {
    if (existsSync(dir)) {
      const entries = readdirSync(dir)
      if (entries.length === 0) {
        actions.push({ type: 'remove', target: dir, source: null, reason: 'empty tracked directory', category: 'infrastructure', reversible: false })
        removeFileSafe(dir, dryRun, 'empty tracked directory')
      } else {
        log(`Skipping non-empty directory: ${dir} (${entries.length} entries)`)
      }
    }
  }

  // Remove manifest itself
  actions.push({ type: 'remove', target: MANIFEST_PATH, source: null, reason: 'install manifest', category: 'other', reversible: false })
  removeFileSafe(MANIFEST_PATH, dryRun, 'install manifest')

  return { actions }
}

// ──────────────────────────── Status ─────────────────────────────────

function showStatus(sys: SystemInfo, preflight: PreflightResult): void {
  console.log('\n=== OpenCode Environment Status ===')
  console.log(`Timestamp:       ${new Date().toISOString()}`)
  console.log(`Hostname:        ${sys.hostname}`)
  console.log(`OS:              ${sys.os}`)
  console.log(`Arch:            ${sys.arch}`)
  console.log(`User:            ${sys.user}`)
  console.log(`Disk:            ${sys.diskGB}GB free`)
  console.log(`Memory:          ${sys.memoryGB}GB`)
  console.log(`Uptime:          ${Math.floor(sys.uptimeSeconds / 3600)}h ${Math.floor((sys.uptimeSeconds % 3600) / 60)}m`)
  console.log('')
  console.log('--- Preflight ---')
  console.log(`Disk:            ${preflight.diskOk ? 'OK' : 'FAIL'} (${preflight.diskDetail})`)
  console.log(`Network:         ${preflight.networkOk ? 'OK' : 'FAIL'} (${preflight.networkDetail})`)
  console.log(`Git:             ${preflight.gitOk ? 'OK' : 'FAIL'} (${preflight.gitDetail})`)
  console.log(`Bun:             ${preflight.bunOk ? 'OK' : 'FAIL'} (${preflight.bunDetail})`)
  console.log(`Node:            ${preflight.nodeOk ? 'OK' : 'FAIL'} (${preflight.nodeDetail})`)
  console.log(`Dirs:            ${preflight.dirsOk ? 'OK' : 'FAIL'} (${preflight.dirsDetail})`)
  console.log('')

  const lock = readVersionLock()
  const manifest = readManifest()
  const installManifest = readInstallManifest()

  console.log('--- Components ---')
  const oc = run(OPENCODE_BINARY, ['--version'])
  console.log(`OpenCode:        ${oc.exitCode === 0 ? oc.stdout : 'NOT INSTALLED'}`)
  const bun = run(BUN_BINARY, ['--version'])
  console.log(`Bun:             ${bun.exitCode === 0 ? bun.stdout : 'NOT INSTALLED'}`)
  const node = run('node', ['--version'])
  console.log(`Node:            ${node.exitCode === 0 ? node.stdout : 'NOT INSTALLED'}`)
  const akm = run(AKM_BINARY, ['health'])
  console.log(`AKM:             ${akm.exitCode === 0 ? 'healthy' : 'unhealthy or not installed'}`)
  console.log(`Config:          ${existsSync(OPENCODE_CONFIG) ? 'present' : 'MISSING'}`)
  console.log(`Agents:          ${existsSync(AGENTS_DIR) ? readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')).length : 0}`)
  console.log(`Commands:        ${existsSync(COMMANDS_DIR) ? readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.md')).length : 0}`)
  console.log(`Skills:          ${existsSync(SKILLS_DIR) ? readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(f => f.isDirectory()).length : 0}`)
  console.log(`Dist:            ${existsSync(join(PROJECT_ROOT, 'dist')) ? 'present' : 'MISSING'}`)
  console.log(`Install Manifest:${installManifest ? ` present (${installManifest.files.length} files, ${installManifest.installedAt})` : ' NOT FOUND'}`)

  if (lock) {
    console.log('')
    console.log('--- Version Lock ---')
    console.log(`OpenCode:        ${lock.opencode.version}`)
    console.log(`Bun:             ${lock.runtime.bun}`)
    console.log(`Node:            ${lock.runtime.node}`)
    console.log(`AKM:             ${lock.akm.version}`)
    console.log(`AKM-Bridge:      ${lock.akmBridge.version} (${lock.akmBridge.commit})`)
  }

  if (manifest) {
    console.log('')
    console.log('--- Environment Manifest ---')
    console.log(`Schema:          ${manifest.schemaVersion}`)
    console.log(`Expected Agents: ${manifest.agents.count}`)
    console.log(`Expected Cmds:   ${manifest.commands.count}`)
    console.log(`Expected Skills: ${manifest.skills.count}`)
    console.log(`Expected MCPs:   ${manifest.mcpServers.count}`)
  }
  console.log('')
}

// ──────────────────────────── Report Generation ──────────────────────

function generateReport(report: Report): void {
  if (report.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log('\n╔══════════════════════════════════════════════════════════════╗')
  console.log('║           OpenCode Bootstrap Report                        ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log(`Timestamp:    ${report.timestamp}`)
  console.log(`Mode:         ${report.mode}`)
  console.log(`Dry Run:      ${report.dryRun}`)
  console.log(`Duration:     ${report.durationMs}ms`)
  console.log(`Status:       ${report.overallStatus.toUpperCase()}`)
  console.log('')

  if (report.systemInfo) {
    console.log(`System:       ${report.systemInfo.os} (${report.systemInfo.arch})`)
    console.log(`Disk:         ${report.systemInfo.diskGB}GB free`)
    console.log(`Memory:       ${report.systemInfo.memoryGB}GB`)
  }

  console.log('')
  console.log('--- Preflight ---')
  if (report.preflight) {
    for (const f of report.preflight.failures) {
      console.log(`  FAIL: ${f}`)
    }
    if (report.preflight.allPassed) console.log('  All checks passed')
  }

  console.log('')
  console.log(`--- Actions (${report.actions.length}) ---`)
  for (const a of report.actions.slice(0, 30)) {
    const icon = a.type === 'skip' ? '○' : a.type === 'install' ? '●' : a.type === 'remove' ? '✕' : '◆'
    console.log(`  ${icon} ${a.type.toUpperCase()} ${a.target}`)
    if (a.reason) console.log(`    ${a.reason}`)
  }
  if (report.actions.length > 30) {
    console.log(`  ... and ${report.actions.length - 30} more`)
  }

  if (report.results.length > 0) {
    console.log('')
    console.log('--- Validation ---')
    for (const r of report.results) {
      const icon = r.passed ? '✓' : r.severity === 'critical' ? '✕' : '!'
      console.log(`  ${icon} ${r.name}: ${r.detail}`)
    }
  }

  if (report.errors.length > 0) {
    console.log('')
    console.log('--- Errors ---')
    for (const e of report.errors) console.log(`  ✕ ${e}`)
  }

  if (report.warnings.length > 0) {
    console.log('')
    console.log('--- Warnings ---')
    for (const w of report.warnings) console.log(`  ! ${w}`)
  }

  if (report.manifestPath) {
    console.log('')
    console.log(`Install Manifest: ${report.manifestPath}`)
  }
  if (report.backupPath) {
    console.log(`Backup:           ${report.backupPath}`)
  }

  console.log('')
}

// ──────────────────────────── Main ───────────────────────────────────

async function main(): Promise<void> {
  const startTime = Date.now()
  const flags = parseArgs(process.argv)

  // Default to dry-run
  if (flags.mode === 'dry-run') {
    _quiet = false
  }

  log(`Bootstrap starting in mode: ${flags.mode}`)

  const sys = detectSystem()
  const preflight = checkPreflight(sys)

  if (!preflight.allPassed && flags.mode !== 'status') {
    log('Preflight failures detected:')
    for (const f of preflight.failures) log(`  - ${f}`)
    if (!flags.nonInteractive && process.stdin.isTTY) {
      process.stderr.write('\nContinue despite failures? [y/N] ')
      const buf = Buffer.alloc(10)
      try {
        require('node:fs').readSync(0, buf, 0, 1, null)
        if (buf[0] !== 0x79 && buf[0] !== 0x59) { // 'y' or 'Y'
          log('Aborted by user')
          process.exit(1)
        }
      } catch {
        process.exit(1)
      }
    } else if (!flags.nonInteractive) {
      log('Non-interactive mode, aborting due to preflight failures')
      process.exit(1)
    }
  }

  const manifest = readManifest()
  const lock = readVersionLock()

  const report: Report = {
    timestamp: new Date().toISOString(),
    mode: flags.mode,
    dryRun: flags.mode === 'dry-run',
    systemInfo: sys,
    preflight,
    actions: [],
    executedActions: [],
    skippedActions: [],
    results: [],
    manifestPath: null,
    backupPath: null,
    errors: [],
    warnings: [],
    durationMs: 0,
    overallStatus: 'dry-run',
    json: flags.json,
  }

  switch (flags.mode) {
    case 'status': {
      showStatus(sys, preflight)
      report.overallStatus = 'success'
      break
    }

    case 'validate': {
      if (!manifest || !lock) {
        report.errors.push('Missing environment manifest or version lock')
        report.overallStatus = 'failed'
        break
      }
      report.results = validateAll(manifest, lock)
      report.results.push(...runSmoke())
      const failures = report.results.filter(r => !r.passed && r.severity === 'critical')
      report.overallStatus = failures.length === 0 ? 'success' : 'failed'
      break
    }

    case 'dry-run': {
      if (!manifest || !lock) {
        report.errors.push('Missing environment manifest or version lock')
        report.overallStatus = 'failed'
        break
      }
      const plan = planInstallation(manifest, lock, flags)
      report.actions = plan.actions
      report.backupPath = plan.backupTarget
      log(`Plan: ${plan.estimatedChanges} changes, backup ${plan.backupRequired ? 'required' : 'not needed'}`)
      report.results = validateAll(manifest, lock)
      report.overallStatus = 'dry-run'
      break
    }

    case 'install': {
      if (!manifest || !lock) {
        report.errors.push('Missing environment manifest or version lock')
        report.overallStatus = 'failed'
        break
      }

      // Create backup
      report.backupPath = backupExisting(flags)

      // Plan
      const installPlan = planInstallation(manifest, lock, flags)
      report.actions = installPlan.actions

      // Execute installations
      log('Installing runtime binaries...')
      const runtimeFiles = installRuntime(lock, manifest, false)
      report.executedActions.push(...installPlan.actions.filter(a => a.type !== 'skip'))

      log('Cloning/updating repository...')
      cloneOrUpdateRepo(manifest, false)

      log('Building akm-bridge...')
      buildBridge(false)

      log('Installing config...')
      installConfig(lock, manifest, false)

      log('Installing agents...')
      const agentFiles = installAgents(false)
      report.executedActions.push(...agentFiles.map(f => ({ type: 'install' as const, target: f.path, source: f.source, reason: 'agent', category: 'agent', reversible: true })))

      log('Installing commands...')
      const cmdFiles = installCommands(false)
      report.executedActions.push(...cmdFiles.map(f => ({ type: 'install' as const, target: f.path, source: f.source, reason: 'command', category: 'command', reversible: true })))

      log('Installing skills...')
      const skillFiles = installSkills(false)
      report.executedActions.push(...skillFiles.map(f => ({ type: 'install' as const, target: f.path, source: f.source, reason: 'skill', category: 'skill', reversible: true })))

      if (!flags.skipSystemd) {
        log('Installing systemd units...')
        const systemdFiles = installSystemd(false)
        report.executedActions.push(...systemdFiles.map(f => ({ type: 'install' as const, target: f.path, source: f.source, reason: 'systemd', category: 'systemd', reversible: true })))
      }

      log('Installing recovery scripts...')
      installRecovery(false)

      log('Installing observability...')
      installObservability(false)

      log('Installing compatibility files...')
      installCompatibility(false)

      log('Provisioning secrets...')
      provisionSecrets(flags, manifest, false)

      // Write install manifest
      const allInstalled: InstalledFile[] = [...runtimeFiles, ...agentFiles, ...cmdFiles, ...skillFiles]
      const installManifest: InstallManifest = {
        schemaVersion: 1,
        installedAt: new Date().toISOString(),
        installedBy: sys.user,
        mode: 'install',
        versionLock: sha256File(VERSION_LOCK),
        files: allInstalled,
        directories: [STATE_DIR, LOG_DIR, MANIFEST_DIR, AGENTS_DIR, COMMANDS_DIR, SKILLS_DIR].filter(d => existsSync(d)),
        services: existsSync(SYSTEMD_TEMPLATES_DIR) ? listTemplateFiles(SYSTEMD_TEMPLATES_DIR, '.service', '.timer') : [],
        secrets: (manifest.secretPlaceholders || []).map(s => s.name),
        summary: {
          totalFiles: allInstalled.length,
          totalDirectories: [STATE_DIR, LOG_DIR, MANIFEST_DIR, AGENTS_DIR, COMMANDS_DIR, SKILLS_DIR].filter(d => existsSync(d)).length,
          totalServices: existsSync(SYSTEMD_TEMPLATES_DIR) ? listTemplateFiles(SYSTEMD_TEMPLATES_DIR, '.service', '.timer').length : 0,
          totalSecrets: (manifest.secretPlaceholders || []).filter(s => s.required).length,
        },
      }
      writeInstallManifest(installManifest, false)
      report.manifestPath = MANIFEST_PATH

      // Validate
      log('Running validation...')
      report.results = validateAll(manifest, lock)
      report.results.push(...runSmoke())
      const failures = report.results.filter(r => !r.passed && r.severity === 'critical')
      report.overallStatus = failures.length === 0 ? 'success' : 'partial'
      break
    }

    case 'restore': {
      const restoreResult = runRestore(flags)
      report.actions = restoreResult.actions
      report.results = restoreResult.results
      const failures = report.results.filter(r => !r.passed && r.severity === 'critical')
      report.overallStatus = failures.length === 0 ? 'success' : 'partial'
      break
    }

    case 'upgrade-existing': {
      if (!manifest || !lock) {
        report.errors.push('Missing environment manifest or version lock')
        report.overallStatus = 'failed'
        break
      }

      report.backupPath = backupExisting(flags)

      const upgradeResult = upgradeExisting(manifest, lock, flags)
      report.actions = upgradeResult.actions
      report.executedActions.push(...upgradeResult.actions)

      // Write updated install manifest
      const existingManifest = readInstallManifest()
      const mergedFiles: InstalledFile[] = [
        ...(existingManifest?.files || []),
        ...upgradeResult.installed,
      ]
      const updatedManifest: InstallManifest = {
        schemaVersion: 1,
        installedAt: new Date().toISOString(),
        installedBy: sys.user,
        mode: 'upgrade-existing',
        versionLock: sha256File(VERSION_LOCK),
        files: mergedFiles,
        directories: Array.from(new Set([...(existingManifest?.directories || []), STATE_DIR, LOG_DIR, MANIFEST_DIR, AGENTS_DIR, COMMANDS_DIR, SKILLS_DIR])),
        services: existsSync(SYSTEMD_TEMPLATES_DIR) ? listTemplateFiles(SYSTEMD_TEMPLATES_DIR, '.service', '.timer') : [],
        secrets: (manifest.secretPlaceholders || []).map(s => s.name),
        summary: {
          totalFiles: mergedFiles.length,
          totalDirectories: Array.from(new Set([...(existingManifest?.directories || []), STATE_DIR, LOG_DIR, MANIFEST_DIR, AGENTS_DIR, COMMANDS_DIR, SKILLS_DIR])).length,
          totalServices: existsSync(SYSTEMD_TEMPLATES_DIR) ? listTemplateFiles(SYSTEMD_TEMPLATES_DIR, '.service', '.timer').length : 0,
          totalSecrets: (manifest.secretPlaceholders || []).filter(s => s.required).length,
        },
      }
      writeInstallManifest(updatedManifest, false)
      report.manifestPath = MANIFEST_PATH

      report.results = validateAll(manifest, lock)
      report.results.push(...runSmoke())
      const failures = report.results.filter(r => !r.passed && r.severity === 'critical')
      report.overallStatus = failures.length === 0 ? 'success' : 'partial'
      break
    }

    case 'uninstall-generated': {
      const uninstallResult = uninstallGenerated(false)
      report.actions = uninstallResult.actions
      report.executedActions.push(...uninstallResult.actions)
      report.overallStatus = 'success'
      break
    }

    default: {
      console.error(`Unknown mode: ${flags.mode}`)
      printUsage()
      process.exit(1)
    }
  }

  report.durationMs = Date.now() - startTime

  // Write log file
  if (flags.mode !== 'dry-run' && flags.mode !== 'status') {
    ensureDir(LOG_DIR, false)
    const logFile = join(LOG_DIR, `bootstrap-${BACKUP_TIMESTAMP_FMT}.jsonl`)
    try {
      writeFileSync(logFile, JSON.stringify({
        timestamp: report.timestamp,
        mode: report.mode,
        status: report.overallStatus,
        durationMs: report.durationMs,
        actionsCount: report.actions.length,
        errorsCount: report.errors.length,
      }) + '\n', 'utf-8')
    } catch {}
  }

  generateReport(report)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
