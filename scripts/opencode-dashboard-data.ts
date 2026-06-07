#!/usr/bin/env bun
/**
 * OpenCode Operations Dashboard — Data Aggregator
 *
 * Read-only script that collects status from all OpenCode subsystems and
 * produces a single DashboardData JSON payload.
 *
 * Usage:
 *   bun run scripts/opencode-dashboard-data.ts --collect --pretty
 *   bun run scripts/opencode-dashboard-data.ts --json
 *   bun run scripts/opencode-dashboard-data.ts --output /tmp/dashboard.json
 *   bun run scripts/opencode-dashboard-data.ts --validate
 *   bun run scripts/opencode-dashboard-data.ts --redact-test
 */

import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostname, platform, arch, release, uptime } from 'node:os'
import type {
  DashboardData, ComponentStatus, StatusSection, AgentStatus,
  CommandStatus, SkillStatus, MCPServerStatus, AKMStatus,
  TokenMetrics, ContextMetrics, PermissionMetrics,
  RecoveryStatus, UpdateStatus, E2EStatus, CIStatus,
  DRStatus, LearningStatus, SystemStatus, Alert, DashboardEvent,
} from '../src/dashboard/dashboard-types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')

/* ── Constants ── */

const OPENCODE_CONFIG = '/root/.config/opencode/opencode.json'
const AGENTS_DIR = '/root/.config/opencode/agents'
const COMMANDS_DIR = '/root/.config/opencode/commands'
const SKILLS_DIR = '/root/.config/opencode/skills'
const VERSION_LOCK = join(PROJECT_ROOT, 'compatibility/opencode-version-lock.json')
const MATRIX_FILE = join(PROJECT_ROOT, 'compatibility/matrix.json')
const RECOVERY_STATE = '/tmp/opencode-recovery-state.json'
const UPDATE_STATE = '/root/.config/opencode/update-state.json'
const E2E_CONTRACT = join(PROJECT_ROOT, 'tests/e2e/opencode-contract.json')
const DR_MANIFEST = join(PROJECT_ROOT, 'disaster-recovery/manifest.json')
const SCHEMA_VERSION = '1.0.0'
const DEFAULT_CACHE_TTL = 30

/* ── Utilities ── */

function safeReadJson(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function safeExec(cmd: string, timeoutMs = 10000): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { stdout: stdout.trim(), exitCode: 0 }
  } catch (e: any) {
    return { stdout: e.stdout?.toString?.() ?? '', exitCode: e.status ?? 1 }
  }
}

function httpGet(url: string, timeoutMs = 5000): { code: number; body: string } {
  try {
    const body = execSync(`curl -sf -m ${Math.ceil(timeoutMs / 1000)} "${url}" 2>/dev/null || true`, {
      encoding: 'utf-8',
      timeout: timeoutMs + 1000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { code: 200, body: body.trim() }
  } catch {
    return { code: 0, body: '' }
  }
}

function now(): string { return new Date().toISOString() }

function mergeStatus(...statuses: ComponentStatus[]): ComponentStatus {
  if (statuses.includes('failed')) return 'failed'
  if (statuses.includes('degraded')) return 'degraded'
  if (statuses.includes('unknown')) return 'unknown'
  if (statuses.every(s => s === 'not_run')) return 'not_run'
  return 'healthy'
}

function summarize(status: ComponentStatus, count: number, label: string): string {
  const map: Record<ComponentStatus, string> = {
    healthy: `All ${count} ${label} healthy`,
    degraded: `${count} ${label} — some degraded`,
    failed: `${count} ${label} — failures detected`,
    unknown: `${count} ${label} — status unknown`,
    not_run: `${count} ${label} — not checked`,
  }
  return map[status]
}

function isStale(updatedAt: string, ttlSeconds: number): boolean {
  const age = (Date.now() - new Date(updatedAt).getTime()) / 1000
  return age > ttlSeconds * 2
}

function redactSecrets(obj: unknown): unknown {
  if (typeof obj === 'string') {
    if (/key|token|secret|password|credential/i.test(obj)) return '[REDACTED]'
    if (/{env:[A-Z_]+}/i.test(obj)) return obj
    if (/^[A-Za-z0-9_-]{20,}$/.test(obj)) return '[REDACTED_TOKEN]'
    return obj
  }
  if (Array.isArray(obj)) return obj.map(redactSecrets)
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (/key|token|secret|password|credential/i.test(k) && typeof v === 'string') {
        out[k] = '[REDACTED]'
      } else {
        out[k] = redactSecrets(v)
      }
    }
    return out
  }
  return obj
}

/* ── Collectors ── */

function collectAgents(): StatusSection & { items: AgentStatus[] } {
  const contract = safeReadJson(E2E_CONTRACT) as any
  const contractAgents: any[] = contract?.agents ?? []
  const items: AgentStatus[] = []

  for (const a of contractAgents) {
    const exists = existsSync(a.file)
    let fileMtime = ''
    if (exists) {
      try { fileMtime = statSync(a.file).mtime.toISOString() } catch {}
    }
    items.push({
      name: a.name,
      file: a.file,
      exists,
      mode: a.mode ?? 'subagent',
      status: exists ? 'healthy' : 'failed',
      summary: exists ? `File present (${a.mode})` : 'Agent file missing',
      updatedAt: fileMtime || now(),
    })
  }

  // Also scan agents dir for any not in contract
  if (existsSync(AGENTS_DIR)) {
    const files = readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md'))
    const contractNames = new Set(contractAgents.map((a: any) => a.name))
    for (const f of files) {
      const name = f.replace(/\.md$/, '')
      if (contractNames.has(name)) continue
      const fullPath = join(AGENTS_DIR, f)
      let mtime = ''
      try { mtime = statSync(fullPath).mtime.toISOString() } catch {}
      items.push({
        name,
        file: fullPath,
        exists: true,
        mode: 'subagent',
        status: 'healthy',
        summary: 'File present (untracked)',
        updatedAt: mtime || now(),
      })
    }
  }

  const st = mergeStatus(...items.map(i => i.status))
  return {
    status: st,
    summary: summarize(st, items.length, 'agents'),
    updatedAt: now(),
    source: 'e2e-contract + filesystem',
    details: { total: items.length, healthy: items.filter(i => i.status === 'healthy').length },
    items,
  }
}

function collectCommands(): StatusSection & { items: CommandStatus[] } {
  const contract = safeReadJson(E2E_CONTRACT) as any
  const contractCmds: any[] = contract?.commands ?? []
  const items: CommandStatus[] = []

  for (const c of contractCmds) {
    const exists = existsSync(c.file)
    let fileMtime = ''
    if (exists) {
      try { fileMtime = statSync(c.file).mtime.toISOString() } catch {}
    }
    items.push({
      name: c.name,
      file: c.file,
      exists,
      agent: c.agent ?? 'auto',
      subtask: c.subtask ?? '',
      status: exists ? 'healthy' : 'failed',
      summary: exists ? `Ready (${c.agent ?? 'auto'})` : 'Command file missing',
      updatedAt: fileMtime || now(),
    })
  }

  const st = mergeStatus(...items.map(i => i.status))
  return {
    status: st,
    summary: summarize(st, items.length, 'commands'),
    updatedAt: now(),
    source: 'e2e-contract + filesystem',
    details: { total: items.length, healthy: items.filter(i => i.status === 'healthy').length },
    items,
  }
}

function collectSkills(): StatusSection & { items: SkillStatus[] } {
  const contract = safeReadJson(E2E_CONTRACT) as any
  const contractSkills: any[] = contract?.skills ?? []
  const items: SkillStatus[] = []

  for (const s of contractSkills) {
    const exists = existsSync(s.file)
    const dir = exists ? dirname(s.file) : resolve(SKILLS_DIR, s.name)
    let fileMtime = ''
    if (exists) {
      try { fileMtime = statSync(s.file).mtime.toISOString() } catch {}
    }
    items.push({
      name: s.name,
      dir,
      exists,
      assignedAgents: [],
      status: exists ? 'healthy' : 'failed',
      summary: exists ? 'Skill file present' : 'Skill file missing',
      updatedAt: fileMtime || now(),
    })
  }

  // Scan skills dir for any not in contract
  if (existsSync(SKILLS_DIR)) {
    const dirs = readdirSync(SKILLS_DIR).filter(d => {
      try { return statSync(join(SKILLS_DIR, d)).isDirectory() } catch { return false }
    })
    const contractNames = new Set(contractSkills.map((s: any) => s.name))
    for (const d of dirs) {
      if (contractNames.has(d)) continue
      const skillFile = join(SKILLS_DIR, d, 'SKILL.md')
      const exists = existsSync(skillFile)
      let mtime = ''
      if (exists) {
        try { mtime = statSync(skillFile).mtime.toISOString() } catch {}
      }
      items.push({
        name: d,
        dir: join(SKILLS_DIR, d),
        exists,
        assignedAgents: [],
        status: exists ? 'healthy' : 'degraded',
        summary: exists ? 'Skill present (untracked)' : 'SKILL.md missing',
        updatedAt: mtime || now(),
      })
    }
  }

  const st = mergeStatus(...items.map(i => i.status))
  return {
    status: st,
    summary: summarize(st, items.length, 'skills'),
    updatedAt: now(),
    source: 'e2e-contract + filesystem',
    details: { total: items.length, healthy: items.filter(i => i.status === 'healthy').length },
    items,
  }
}

function collectMCP(): StatusSection & { servers: MCPServerStatus[] } {
  const config = safeReadJson(OPENCODE_CONFIG) as any
  const mcpConfig: Record<string, any> = config?.mcp ?? {}
  const servers: MCPServerStatus[] = []

  for (const [name, cfg] of Object.entries(mcpConfig)) {
    const c = cfg as Record<string, unknown>
    const enabled = c.enabled !== false
    const transport = c.type === 'remote' ? 'remote' : 'local stdio'

    let status: ComponentStatus = 'unknown'
    let latencyMs: number | null = null
    let toolsCount = 0
    let errorCount = 0
    let lastError: string | null = null

    if (enabled) {
      status = 'healthy'
      // Check if process is running
      const pgrep = safeExec(`pgrep -f "${name}" 2>/dev/null || true`, 3000)
      if (pgrep.exitCode !== 0 && name !== 'sequential-thinking') {
        // Some MCP servers may be short-lived or launched on demand
        status = 'degraded'
      }
    } else {
      status = 'not_run'
    }

    servers.push({
      name,
      enabled,
      transport,
      status,
      toolsCount,
      latencyMs,
      errorCount,
      lastError,
      updatedAt: now(),
    })
  }

  const statuses = servers.map(s => s.status)
  const mcpSt = mergeStatus(...statuses)
  return {
    status: mcpSt,
    summary: `${servers.filter(s => s.enabled).length}/${servers.length} MCP servers enabled`,
    updatedAt: now(),
    source: 'opencode.json',
    details: { total: servers.length, enabled: servers.filter(s => s.enabled).length },
    servers,
  }
}

function collectAKM(): AKMStatus {
  const akmHealth = safeExec('/root/.bun/bin/bun /root/.bun/bin/akm health 2>/dev/null', 8000)
  let healthy = false
  let entryCount: number | null = null
  let lastIndexTime: string | null = null
  let sourcesCount = 0

  try {
    const parsed = JSON.parse(akmHealth.stdout)
    healthy = parsed.ok === true
    if (parsed.entry_count != null) entryCount = parsed.entry_count
    if (parsed.last_index_time) lastIndexTime = parsed.last_index_time
  } catch {
    healthy = false
  }

  const versionLock = safeReadJson(VERSION_LOCK) as any
  const akmVersion = versionLock?.akm?.version ?? 'unknown'

  // Check MCP availability
  const mcpHealth = httpGet('http://127.0.0.1:4199/api/akm/health', 3000)
  let mcpAvailable = mcpHealth.code === 200

  // Check CLI
  const cliCheck = safeExec('/root/.bun/bin/bun /root/.bun/bin/akm status 2>/dev/null', 5000)
  const cliAvailable = cliCheck.exitCode === 0

  const status: ComponentStatus = healthy ? 'healthy' : mcpAvailable ? 'degraded' : 'failed'

  return {
    version: akmVersion,
    healthy,
    entryCount,
    lastIndexTime,
    mcpAvailable,
    cliAvailable,
    ftsAvailable: cliAvailable,
    semanticAvailable: false,
    sourcesCount,
    status,
    summary: healthy
      ? `AKM ${akmVersion} healthy (${entryCount ?? '?'} entries)`
      : `AKM ${akmVersion} ${status}`,
    updatedAt: now(),
  }
}

function collectTokens(): TokenMetrics {
  // TokenScope plugin info from version lock
  const versionLock = safeReadJson(VERSION_LOCK) as any
  const tokenscopeVersion = versionLock?.plugins?.tokenscope ?? null

  return {
    pluginInstalled: !!tokenscopeVersion,
    pluginVersion: tokenscopeVersion,
    totalSessions: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalCostUsd: 0,
    avgTokensPerSession: 0,
    topModels: [],
    status: tokenscopeVersion ? 'healthy' : 'not_run',
    summary: tokenscopeVersion
      ? `TokenScope ${tokenscopeVersion} installed`
      : 'TokenScope not installed',
    updatedAt: now(),
  }
}

function collectContext(): ContextMetrics {
  return {
    compactionsCount: 0,
    avgCompressionRatio: 0,
    cacheHitRate: 0,
    contextResetsCount: 0,
    avgContextSizeTokens: 0,
    status: 'not_run',
    summary: 'Context metrics require runtime collection',
    updatedAt: now(),
  }
}

function collectPermissions(): PermissionMetrics {
  return {
    totalRequests: 0,
    allowed: 0,
    asked: 0,
    denied: 0,
    topRequests: [],
    status: 'not_run',
    summary: 'Permission metrics require runtime collection',
    updatedAt: now(),
  }
}

function collectRecovery(): RecoveryStatus {
  const state = safeReadJson(RECOVERY_STATE) as any
  if (!state) {
    return {
      escalation: false,
      components: {},
      status: 'not_run',
      summary: 'Recovery controller not run',
      updatedAt: now(),
    }
  }

  const components: RecoveryStatus['components'] = {}
  let worstStatus: ComponentStatus = 'healthy'

  for (const [name, comp] of Object.entries(state.components ?? {})) {
    const c = comp as any
    components[name] = {
      state: c.state ?? 'UNKNOWN',
      consecutiveFailures: c.consecutive_failures ?? 0,
      recoveryAttempts: c.recovery_attempts ?? 0,
      lastError: c.last_error ?? null,
      cooldownUntil: c.cooldown_until ?? null,
    }
    if (c.state === 'ESCALATION_REQUIRED' || c.state === 'RECOVERY_FAILED') worstStatus = 'failed'
    else if (c.state !== 'HEALTHY' && worstStatus !== 'failed') worstStatus = 'degraded'
  }

  return {
    escalation: state.escalation ?? false,
    components,
    status: state.escalation ? 'failed' : worstStatus,
    summary: state.escalation
      ? 'Escalation required — manual intervention needed'
      : `Recovery: ${Object.keys(components).length} components monitored`,
    updatedAt: state.updated_at ?? now(),
  }
}

function collectUpdates(): UpdateStatus {
  const state = safeReadJson(UPDATE_STATE) as any
  const versionLock = safeReadJson(VERSION_LOCK) as any

  const currentVersion = state?.currentVersion ?? versionLock?.opencode?.version ?? 'unknown'

  return {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    updateType: 'none',
    canaryActive: state?.canaryActive ?? false,
    canaryVersion: state?.canaryVersion ?? null,
    lastCheck: state?.lastCheck ?? null,
    lastPromotion: state?.lastPromotion ?? null,
    lastRollback: state?.lastRollback ?? null,
    blockedVersions: state?.blockedVersions ?? [],
    status: 'healthy',
    summary: state?.canaryActive
      ? `Canary active: ${state.canaryVersion}`
      : `Running ${currentVersion}`,
    updatedAt: now(),
  }
}

function collectE2E(): E2EStatus {
  const contract = safeReadJson(E2E_CONTRACT) as any
  if (!contract) {
    return {
      contractVersion: '',
      agentsExpected: 0, agentsActual: 0,
      commandsExpected: 0, commandsActual: 0,
      skillsExpected: 0, skillsActual: 0,
      mcpServersExpected: 0, mcpServersActual: 0,
      lastRun: null,
      status: 'not_run',
      summary: 'E2E contract not found',
      updatedAt: now(),
    }
  }

  // Count actual files
  const agentsActual = existsSync(AGENTS_DIR)
    ? readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')).length
    : 0
  const commandsActual = existsSync(COMMANDS_DIR)
    ? readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.md')).length
    : 0
  const skillsActual = existsSync(SKILLS_DIR)
    ? readdirSync(SKILLS_DIR).filter(d => {
      try { return existsSync(join(SKILLS_DIR, d, 'SKILL.md')) } catch { return false }
    }).length
    : 0

  const config = safeReadJson(OPENCODE_CONFIG) as any
  const mcpActual = Object.keys(config?.mcp ?? {}).length

  const agentsMatch = agentsActual >= (contract.agents?.length ?? 0)
  const commandsMatch = commandsActual >= (contract.commands?.length ?? 0)
  const skillsMatch = skillsActual >= (contract.skills?.length ?? 0)
  const mcpMatch = mcpActual >= (contract.mcpServers?.length ?? 0)

  const allMatch = agentsMatch && commandsMatch && skillsMatch && mcpMatch

  return {
    contractVersion: contract.version ?? '',
    agentsExpected: contract.agents?.length ?? 0,
    agentsActual,
    commandsExpected: contract.commands?.length ?? 0,
    commandsActual,
    skillsExpected: contract.skills?.length ?? 0,
    skillsActual,
    mcpServersExpected: contract.mcpServers?.length ?? 0,
    mcpServersActual: mcpActual,
    lastRun: contract.generated_at ?? null,
    status: allMatch ? 'healthy' : 'degraded',
    summary: allMatch
      ? `All components match contract v${contract.version}`
      : `Contract mismatch — agents:${agentsActual}/${contract.agents?.length} cmds:${commandsActual}/${contract.commands?.length}`,
    updatedAt: now(),
  }
}

function collectCI(): CIStatus {
  const branch = safeExec('git rev-parse --abbrev-ref HEAD 2>/dev/null', 3000).stdout || null
  const commit = safeExec('git rev-parse --short HEAD 2>/dev/null', 3000).stdout || null
  const dirty = safeExec('git status --porcelain 2>/dev/null', 3000).stdout.length > 0
  const lastCommitTime = safeExec('git log -1 --format=%cI 2>/dev/null', 3000).stdout || null

  // Quick lint check
  const lintResult = safeExec('cd /root/projekt/akm-bridge && npx tsc --noEmit 2>&1 | head -5', 15000)
  const lintStatus: ComponentStatus = lintResult.exitCode === 0 ? 'healthy' : 'degraded'

  const status = mergeStatus(lintStatus)

  return {
    gitBranch: branch,
    gitCommit: commit,
    gitDirty: dirty,
    lastCommitTime,
    lintStatus,
    testStatus: 'not_run',
    buildStatus: 'not_run',
    status,
    summary: dirty
      ? `Branch ${branch}@${commit} (dirty)`
      : `Branch ${branch}@${commit} (clean)`,
    updatedAt: now(),
  }
}

function collectDR(): DRStatus {
  const manifest = safeReadJson(DR_MANIFEST) as any
  const versionLock = safeReadJson(VERSION_LOCK) as any
  const matrix = safeReadJson(MATRIX_FILE) as any

  return {
    manifestExists: !!manifest,
    manifestVersion: manifest?.version ?? null,
    versionLockExists: !!versionLock,
    versionLockVersion: versionLock?.opencode?.version ?? null,
    matrixValidated: (matrix?.validatedCombinations?.length ?? 0) > 0,
    rtoMinutes: manifest?.rtoMinutes ?? null,
    rpoMinutes: manifest?.rpoMinutes ?? null,
    cleanServerDrill: 'NOT_RUN',
    lastDrillTime: null,
    status: manifest ? 'healthy' : 'not_run',
    summary: manifest
      ? `DR manifest v${manifest.version}, RTO ${manifest.rtoMinutes ?? '?'}m`
      : 'DR manifest not found',
    updatedAt: now(),
  }
}

function collectLearning(): LearningStatus {
  // Attempt to read from recovery controller state or AKM
  const akmStatus = safeExec('/root/.bun/bin/bun /root/.bun/bin/akm status 2>/dev/null', 5000)
  let agentRunsToday = 0
  let totalRuns = 0
  let lessonsSaved = 0

  try {
    const parsed = JSON.parse(akmStatus.stdout)
    if (parsed.total_entries) lessonsSaved = parsed.total_entries
  } catch {}

  return {
    agentRunsToday,
    totalRuns,
    lessonsSaved,
    memoryProposals: 0,
    feedbackCount: 0,
    agentMode: 'supervised',
    status: 'healthy',
    summary: `Learning active, ${lessonsSaved} knowledge entries`,
    updatedAt: now(),
  }
}

function collectSystem(): SystemStatus {
  const nodeVersion = process.version
  const bunResult = safeExec('bun --version 2>/dev/null', 3000)
  const bunVersion = bunResult.exitCode === 0 ? bunResult.stdout : null

  const versionLock = safeReadJson(VERSION_LOCK) as any
  const opencodeVersion = versionLock?.opencode?.version ?? null

  // Disk usage
  const dfResult = safeExec("df -h / | tail -1 | awk '{print $5}' 2>/dev/null", 3000)
  const diskUsagePercent = dfResult.exitCode === 0 ? parseInt(dfResult.stdout) || null : null

  // Memory usage
  const memResult = safeExec("free -m | awk '/Mem:/{printf \"%.0f\", ($3/$2)*100}' 2>/dev/null", 3000)
  const memoryUsagePercent = memResult.exitCode === 0 ? parseInt(memResult.stdout) || null : null

  // Systemd services
  const services = ['opencode.service', 'akm-bridge.service', 'caddy-custom.service'].map(name => {
    const check = safeExec(`systemctl is-active ${name} 2>/dev/null`, 3000)
    const pidResult = safeExec(`systemctl show ${name} --property=MainPID --value 2>/dev/null`, 3000)
    return {
      name: name.replace('.service', ''),
      status: (check.stdout || 'unknown') as 'active' | 'inactive' | 'failed' | 'unknown',
      pid: pidResult.exitCode === 0 ? parseInt(pidResult.stdout) || null : null,
    }
  })

  const serviceStatuses = services.map(s =>
    s.status === 'active' ? 'healthy' as ComponentStatus :
    s.status === 'inactive' ? 'not_run' as ComponentStatus :
    'failed' as ComponentStatus
  )

  const status = mergeStatus(...serviceStatuses)

  return {
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    osRelease: release(),
    nodeVersion,
    bunVersion,
    opencodeVersion,
    akmBridgeVersion: versionLock?.akmBridge?.version ?? null,
    uptimeSeconds: Math.floor(uptime()),
    diskUsagePercent,
    memoryUsagePercent,
    services,
    status,
    summary: `${services.filter(s => s.status === 'active').length}/${services.length} services active`,
    updatedAt: now(),
  }
}

function collectAlerts(overall: StatusSection, recovery: RecoveryStatus, system: SystemStatus, e2e: E2EStatus, ci: CIStatus): Alert[] {
  const alerts: Alert[] = []

  if (recovery.escalation) {
    alerts.push({
      id: 'recovery-escalation',
      severity: 'critical',
      component: 'recovery',
      title: 'Recovery escalation active',
      summary: 'One or more components require manual intervention',
      firstSeen: recovery.updatedAt,
      lastSeen: now(),
      acknowledged: false,
      recommendedAction: 'Check recovery controller state and resolve manually',
    })
  }

  for (const [name, comp] of Object.entries(recovery.components)) {
    if (comp.state === 'RECOVERY_FAILED' || comp.state === 'ESCALATION_REQUIRED') {
      alerts.push({
        id: `recovery-${name}`,
        severity: 'critical',
        component: name,
        title: `${name} recovery failed`,
        summary: comp.lastError ?? `State: ${comp.state}`,
        firstSeen: recovery.updatedAt,
        lastSeen: now(),
        acknowledged: false,
        recommendedAction: `Investigate ${name} health and restart if needed`,
      })
    }
  }

  if (system.status === 'failed') {
    alerts.push({
      id: 'system-degraded',
      severity: 'warning',
      component: 'system',
      title: 'System services degraded',
      summary: system.summary,
      firstSeen: now(),
      lastSeen: now(),
      acknowledged: false,
      recommendedAction: 'Check systemd service status',
    })
  }

  if (ci.gitDirty) {
    alerts.push({
      id: 'git-dirty',
      severity: 'info',
      component: 'ci',
      title: 'Uncommitted changes',
      summary: `Working tree dirty on ${ci.gitBranch}`,
      firstSeen: now(),
      lastSeen: now(),
      acknowledged: false,
      recommendedAction: 'Review and commit changes',
    })
  }

  return alerts
}

/* ── Main collector ── */

export function collectDashboardData(): DashboardData {
  const agents = collectAgents()
  const commands = collectCommands()
  const skills = collectSkills()
  const mcp = collectMCP()
  const akm = collectAKM()
  const tokens = collectTokens()
  const context = collectContext()
  const permissions = collectPermissions()
  const recovery = collectRecovery()
  const updates = collectUpdates()
  const e2e = collectE2E()
  const ci = collectCI()
  const dr = collectDR()
  const learning = collectLearning()
  const system = collectSystem()

  const componentStatuses = [
    agents.status,
    commands.status,
    skills.status,
    mcp.status,
    akm.status,
    recovery.status,
    system.status,
  ]

  const overallStatus = mergeStatus(...componentStatuses)

  const overall: StatusSection = {
    status: overallStatus,
    summary: summarize(overallStatus, 7, 'subsystems'),
    updatedAt: now(),
    source: 'aggregate',
    details: {
      agents: agents.status,
      commands: commands.status,
      skills: skills.status,
      mcp: mcp.status,
      akm: akm.status,
      recovery: recovery.status,
      system: system.status,
    },
  }

  const alerts = collectAlerts(overall, recovery, system, e2e, ci)
  const events: DashboardEvent[] = []

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now(),
    cacheTTL: DEFAULT_CACHE_TTL,
    overall,
    alerts,
    events,
    opencode: {
      status: updates.status,
      summary: updates.summary,
      updatedAt: now(),
      source: 'update-controller',
      details: { version: updates.currentVersion, canary: updates.canaryActive },
    },
    mcp,
    akm,
    agents,
    commands,
    skills,
    tokens,
    context,
    permissions,
    recovery,
    updates,
    e2e,
    ci,
    disasterRecovery: dr,
    learning,
    system,
  }
}

/* ── CLI ── */

function main(): void {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
OpenCode Operations Dashboard — Data Aggregator

Usage:
  bun run scripts/opencode-dashboard-data.ts [OPTIONS]

Options:
  --collect        Collect data (default)
  --json           Output raw JSON
  --pretty         Pretty-print JSON (default)
  --output PATH    Write to file instead of stdout
  --validate       Validate output against type contract
  --redact-test    Test secret redaction
  --help           Show this help
`)
    process.exit(0)
  }

  const data = collectDashboardData()

  if (args.includes('--redact-test')) {
    const sample = { token: 'abc123secret', api_key: 'AKM_KEY_xxxxxxxxxxxxxxxx', safe: 'hello' }
    console.log('Before:', JSON.stringify(sample))
    console.log('After:', JSON.stringify(redactSecrets(sample)))
    process.exit(0)
  }

  if (args.includes('--validate')) {
    const required = ['schemaVersion', 'generatedAt', 'overall', 'alerts', 'agents', 'mcp', 'akm']
    const missing = required.filter(k => !(k in data))
    if (missing.length > 0) {
      console.error(`Validation failed: missing fields: ${missing.join(', ')}`)
      process.exit(1)
    }
    console.log('Validation passed')
    process.exit(0)
  }

  const pretty = !args.includes('--json') || args.includes('--pretty')
  const jsonStr = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)

  const outputIdx = args.indexOf('--output')
  if (outputIdx >= 0 && outputIdx + 1 < args.length) {
    const outPath = args[outputIdx + 1]
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, jsonStr + '\n')
    console.error(`Written to ${outPath}`)
  } else {
    console.log(jsonStr)
  }
}

main()
