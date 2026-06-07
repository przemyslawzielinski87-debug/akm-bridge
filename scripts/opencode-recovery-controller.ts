/**
 * OpenCode Safe Recovery Controller
 *
 * State machine + guarded self-healing for OpenCode, AKM bridge, and MCP servers.
 * Usage:
 *   tsx scripts/opencode-recovery-controller.ts            # --check (default)
 *   tsx scripts/opencode-recovery-controller.ts --dry-run   # evaluate only
 *   tsx scripts/opencode-recovery-controller.ts --recover akm-bridge
 *   tsx scripts/opencode-recovery-controller.ts --status
 *   tsx scripts/opencode-recovery-controller.ts --reset-state
 */

import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')

// ──────────────────────────── Constants ──────────────────────────────

const STATE_FILE = '/tmp/opencode-recovery-state.json'
const BACKUP_DIR = '/root/.config/opencode/backup'
const OPENCODE_JSON = '/root/.config/opencode/opencode.json'
const AKM_BINARY = '/root/.bun/bin/akm'

const WARNING_AFTER = 2
const RECOVERY_AFTER = 3
const ESCALATE_AFTER = 3
const SUCCESS_RESET_AFTER = 2
const RECOVERY_COOLDOWN_SECONDS = 120
const MAX_RECOVERY_ATTEMPTS = 3
const ATTEMPT_WINDOW_MINUTES = 30
const MAX_RESTARTS_PER_HOUR = 2
const HEALTH_CHECK_TIMEOUT = 10000

// ──────────────────────────── Types ──────────────────────────────────

type FailureClass = 0 | 1 | 2 | 3 | 4
type RecoveryState = 'HEALTHY' | 'DEGRADED' | 'FAILURE_SUSPECTED' | 'RECOVERY_PENDING' | 'RECOVERY_RUNNING' | 'RECOVERED' | 'RECOVERY_FAILED' | 'COOLDOWN' | 'ESCALATION_REQUIRED'

interface ComponentState {
  state: RecoveryState
  consecutive_failures: number
  consecutive_successes: number
  recovery_attempts: number
  last_failure_time: number | null
  last_recovery_time: number | null
  last_success_time: number | null
  cooldown_until: number | null
  failure_class: FailureClass | null
  last_error: string | null
  last_action: string | null
}

interface RecoveryStateFile {
  components: Record<string, ComponentState>
  escalation: boolean
  updated_at: string
}

interface ComponentInfo {
  name: string
  startMethod: 'systemd' | 'stdio-child' | 'http-api'
  processOwner: string
  entrypoint: string
  configPath: string | null
  logPath: string | null
  healthCommand: () => ComponentHealth
  systemdService: string | null
  dependencies: string[]
  canRestartIndividually: boolean
}

interface ComponentHealth {
  alive: boolean
  failure_class: FailureClass
  error: string | null
  detail: Record<string, any>
}

interface ComponentHealthSummary {
  component: string
  alive: boolean
  failure_class: number
  error: string | null
  detail: Record<string, any>
}

interface RecoveryAction {
  component: string
  action_type: string
  description: string
  requires_ask: boolean
}

interface FunctionalTestResult {
  name: string
  status: 'pass' | 'fail'
  duration_ms: number
  detail: string
}

interface RecoveryReport {
  recovery_command: string
  timestamp: string
  checks: ComponentHealthSummary[]
  failures: ComponentHealthSummary[]
  degraded: ComponentHealthSummary[]
  state: Record<string, ComponentState>
  actions: RecoveryAction[]
  executed_actions: RecoveryAction[]
  functional_tests: FunctionalTestResult[]
  escalation: boolean
  messages: string[]
}

// ──────────────────────────── State Machine ──────────────────────────

function getDefaultState(): ComponentState {
  return {
    state: 'HEALTHY',
    consecutive_failures: 0,
    consecutive_successes: 0,
    recovery_attempts: 0,
    last_failure_time: null,
    last_recovery_time: null,
    last_success_time: null,
    cooldown_until: null,
    failure_class: null,
    last_error: null,
    last_action: null,
  }
}

function readState(): RecoveryStateFile {
  try {
    if (!existsSync(STATE_FILE)) return { components: {}, escalation: false, updated_at: new Date().toISOString() }
    const raw = readFileSync(STATE_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { components: {}, escalation: false, updated_at: new Date().toISOString() }
  }
}

function writeStateAtomic(state: RecoveryStateFile): void {
  const tmp = STATE_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8')
  renameSync(tmp, STATE_FILE)
  try { execSync(`chmod 600 "${STATE_FILE}"`, { encoding: 'utf-8' }) } catch {}
}

function getComponentState(state: RecoveryStateFile, name: string): ComponentState {
  if (!state.components[name]) state.components[name] = getDefaultState()
  return state.components[name]
}

function transitionState(
  comp: ComponentState,
  newState: RecoveryState,
  reason: string,
  component: string,
  attempt: number = 0,
): void {
  const prev = comp.state
  comp.state = newState
  comp.last_action = reason
  const log = JSON.stringify({
    timestamp: new Date().toISOString(),
    component,
    event: 'recovery_state_change',
    previous_state: prev,
    new_state: newState,
    reason,
    attempt,
  })
  process.stderr.write(log + '\n')
}

function isInCooldown(comp: ComponentState): boolean {
  if (!comp.cooldown_until) return false
  return Date.now() < comp.cooldown_until
}

function resetComponentState(comp: ComponentState): void {
  comp.state = 'HEALTHY'
  comp.consecutive_failures = 0
  comp.consecutive_successes = 0
  comp.recovery_attempts = 0
  comp.failure_class = null
  comp.last_error = null
  comp.last_action = 'state_reset'
}

function isRateLimited(name: string): boolean {
  const state = readState()
  const comp = getComponentState(state, name)
  if (comp.recovery_attempts >= MAX_RECOVERY_ATTEMPTS) return true
  if (comp.cooldown_until && Date.now() < comp.cooldown_until) return true
  const windowMs = ATTEMPT_WINDOW_MINUTES * 60 * 1000
  const recentAttempts = comp.last_recovery_time && (Date.now() - comp.last_recovery_time) < windowMs
  if (recentAttempts && comp.recovery_attempts >= MAX_RECOVERY_ATTEMPTS) return true
  return false
}

// ──────────────────────────── Component Definitions ──────────────────

const COMPONENTS: ComponentInfo[] = [
  {
    name: 'opencode',
    startMethod: 'systemd',
    processOwner: 'root',
    entrypoint: '/root/.opencode/bin/opencode web --hostname 127.0.0.1 --port 4096',
    configPath: OPENCODE_JSON,
    logPath: null,
    healthCommand: () => checkOpenCode(),
    systemdService: 'opencode.service',
    dependencies: [],
    canRestartIndividually: true,
  },
  {
    name: 'opencode-web',
    startMethod: 'systemd',
    processOwner: 'root',
    entrypoint: '/root/.opencode/bin/opencode web --hostname 127.0.0.1 --port 4097',
    configPath: OPENCODE_JSON,
    logPath: null,
    healthCommand: () => checkOpenCodeWeb(),
    systemdService: 'opencode-web.service',
    dependencies: [],
    canRestartIndividually: true,
  },
  {
    name: 'akm-bridge',
    startMethod: 'systemd',
    processOwner: 'root',
    entrypoint: '/usr/bin/node /root/projekt/akm-bridge/dist/http-server.js',
    configPath: '/root/projekt/akm-bridge/dist/http-server.js',
    logPath: null,
    healthCommand: () => checkAKMBridge(),
    systemdService: 'akm-bridge.service',
    dependencies: [],
    canRestartIndividually: true,
  },
  {
    name: 'akm-cli',
    startMethod: 'stdio-child',
    processOwner: 'root',
    entrypoint: AKM_BINARY,
    configPath: null,
    logPath: null,
    healthCommand: () => checkAKMCLI(),
    systemdService: null,
    dependencies: [],
    canRestartIndividually: false,
  },
]

// ──────────────────────────── Health Checks ──────────────────────────

function runCmd(cmd: string, args: string[], timeoutMs: number = HEALTH_CHECK_TIMEOUT): { stdout: string; stderr: string; exitCode: number } {
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

function httpGet(url: string, timeoutMs: number = 5000): { code: number; body: string; error: string | null } {
  try {
    const r = execSync(`curl -sf -m ${Math.ceil(timeoutMs / 1000)} -o /dev/null -w "%{http_code}" "${url}" 2>/dev/null || true`, {
      encoding: 'utf-8', timeout: timeoutMs + 1000, stdio: ['pipe', 'pipe', 'pipe'],
    })
    const code = parseInt(r.trim()) || 0
    return { code, body: '', error: code >= 200 && code < 500 ? null : `HTTP ${code}` }
  } catch (e: any) {
    return { code: 0, body: '', error: e.message || 'connection failed' }
  }
}

function httpGetBody(url: string, timeoutMs: number = 5000): { code: number; body: string; error: string | null } {
  try {
    const r = execSync(`curl -sf -m ${Math.ceil(timeoutMs / 1000)} "${url}" 2>/dev/null || true`, {
      encoding: 'utf-8', timeout: timeoutMs + 1000, stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { code: 200, body: r.trim(), error: null }
  } catch (e: any) {
    return { code: 0, body: '', error: e.message || 'connection failed' }
  }
}

function checkOpenCode(): ComponentHealth {
  const pid = runCmd('pgrep', ['-f', 'opencode.*4096'])
  const http = httpGet('http://127.0.0.1:4096/api/health', 3000)

  if (pid.exitCode !== 0) {
    return { alive: false, failure_class: 3, error: 'opencode process not found', detail: { pid: null, http_code: http.code } }
  }
  if (http.code === 0 && http.error) {
    return { alive: false, failure_class: 3, error: `opencode HTTP unreachable: ${http.error}`, detail: { pid: pid.stdout, http_code: http.code } }
  }
  if (http.code !== 200) {
    return { alive: true, failure_class: 2, error: `opencode HTTP returned ${http.code}`, detail: { pid: pid.stdout, http_code: http.code } }
  }
  return { alive: true, failure_class: 0, error: null, detail: { pid: pid.stdout, http_code: http.code } }
}

function checkOpenCodeWeb(): ComponentHealth {
  const pid = runCmd('pgrep', ['-f', 'opencode.*4097'])
  const http = httpGet('http://127.0.0.1:4097/api/health', 3000)

  if (pid.exitCode !== 0) {
    return { alive: false, failure_class: 3, error: 'opencode-web process not found', detail: { pid: null, http_code: http.code } }
  }
  if (http.code === 0 && http.error) {
    return { alive: false, failure_class: 3, error: `opencode-web HTTP unreachable: ${http.error}`, detail: { pid: pid.stdout, http_code: http.code } }
  }
  if (http.code !== 200) {
    return { alive: true, failure_class: 2, error: `opencode-web HTTP returned ${http.code}`, detail: { pid: pid.stdout, http_code: http.code } }
  }
  return { alive: true, failure_class: 0, error: null, detail: { pid: pid.stdout, http_code: http.code } }
}

function checkAKMBridge(): ComponentHealth {
  const pid = runCmd('pgrep', ['-f', 'akm-bridge.*http-server'])
  const http = httpGet('http://127.0.0.1:4199/api/akm/health', 3000)

  if (pid.exitCode !== 0) {
    return { alive: false, failure_class: 3, error: 'akm-bridge process not found', detail: { pid: null, http_code: http.code } }
  }
  if (http.code === 0 && http.error) {
    return { alive: false, failure_class: 3, error: `akm-bridge HTTP unreachable: ${http.error}`, detail: { pid: pid.stdout, http_code: http.code } }
  }
  if (http.code !== 200) {
    return { alive: true, failure_class: 2, error: `akm-bridge HTTP returned ${http.code}`, detail: { pid: pid.stdout, http_code: http.code } }
  }
  return { alive: true, failure_class: 0, error: null, detail: { pid: pid.stdout, http_code: http.code } }
}

function checkAKMCLI(): ComponentHealth {
  const bin = '/root/.bun/bin/bun'
  const args = [AKM_BINARY, 'health']
  const r = runCmd(bin, args)
  if (r.exitCode !== 0 && r.exitCode !== 4) {
    return { alive: false, failure_class: 2, error: `AKM CLI health failed: exit ${r.exitCode} ${r.stderr}`, detail: { exit_code: r.exitCode } }
  }
  try {
    const parsed = JSON.parse(r.stdout)
    if (!parsed.ok) {
      return { alive: true, failure_class: 1, error: 'AKM health returned ok=false', detail: { parsed } }
    }
    if (parsed.status === 'warn') {
      return { alive: true, failure_class: 1, error: null, detail: { status: 'warn', exit_code: r.exitCode, advisories: (parsed.advisories || []).map((a: any) => `${a.name}=${a.status}`) } }
    }
    return { alive: true, failure_class: 0, error: null, detail: { parsed } }
  } catch {
    return { alive: false, failure_class: 1, error: 'AKM health returned invalid JSON', detail: { stdout: r.stdout.slice(0, 200) } }
  }
}

// ──────────────────────────── Check All Components ───────────────────

function checkAllComponents(): ComponentHealthSummary[] {
  return COMPONENTS.map(c => {
    const health = c.healthCommand()
    return {
      component: c.name,
      alive: health.alive,
failure_class: health.failure_class as number,
      error: health.error,
      detail: health.detail,
    }
  })
}

// ──────────────────────────── Rate Limiting ──────────────────────────

function checkRateLimit(name: string): { allowed: boolean; reason: string | null } {
  const state = readState()
  const comp = getComponentState(state, name)
  const now = Date.now()

  if (comp.recovery_attempts >= MAX_RECOVERY_ATTEMPTS) {
    return { allowed: false, reason: `max attempts (${MAX_RECOVERY_ATTEMPTS}) reached` }
  }

  if (comp.cooldown_until && now < comp.cooldown_until) {
    const remaining = Math.ceil((comp.cooldown_until - now) / 1000)
    return { allowed: false, reason: `in cooldown for ${remaining}s more` }
  }

  const windowMs = ATTEMPT_WINDOW_MINUTES * 60 * 1000
  if (comp.last_recovery_time && (now - comp.last_recovery_time) < windowMs) {
    const attemptsInWindow = comp.recovery_attempts
    if (attemptsInWindow >= MAX_RECOVERY_ATTEMPTS) {
      return { allowed: false, reason: `rate limited: ${attemptsInWindow} attempts in ${ATTEMPT_WINDOW_MINUTES}min` }
    }
  }

  return { allowed: true, reason: null }
}

// ──────────────────────────── Recovery Actions ──────────────────────

function planRecovery(component: string, health: ComponentHealthSummary): RecoveryAction[] {
  const actions: RecoveryAction[] = []

  if (health.failure_class === 0) return actions

  if (health.failure_class === 1) {
    actions.push({
      component,
      action_type: 'fallback',
      description: `Functional degradation: ${health.error}. Attempt CLI or FTS fallback.`,
      requires_ask: false,
    })
    return actions
  }

  const compInfo = COMPONENTS.find(c => c.name === component)
  if (!compInfo) return actions

  if (compInfo.canRestartIndividually && compInfo.systemdService) {
    if (health.failure_class >= 3) {
      actions.push({
        component,
        action_type: 'restart_systemd',
        description: `Process missing (class ${health.failure_class}). Restart ${compInfo.systemdService}.`,
        requires_ask: false,
      })
    } else if (health.failure_class === 2) {
      actions.push({
        component,
        action_type: 'restart_systemd',
        description: `Process degraded (class ${health.failure_class}). Restart ${compInfo.systemdService}.`,
        requires_ask: false,
      })
    }
  } else {
    actions.push({
      component,
      action_type: 'escalate',
      description: `Cannot restart ${component} individually (stdio child). Escalate.`,
      requires_ask: true,
    })
  }

  return actions
}

function executeRestartSystemd(name: string, serviceName: string): boolean {
  try {
    execSync(`systemctl restart ${serviceName}`, { timeout: 60000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const check = runCmd('systemctl', ['is-active', serviceName])
    return check.stdout === 'active'
  } catch {
    return false
  }
}

function executeFallback(component: string, health: ComponentHealthSummary): boolean {
  if (component === 'akm-cli') {
    if (existsSync(AKM_BINARY)) {
      const r = runCmd('/root/.bun/bin/bun', [AKM_BINARY, 'health'])
      return r.exitCode === 0 || r.exitCode === 4
    }
  }
  return false
}

function executeRecovery(component: string, action: RecoveryAction): boolean {
  if (action.action_type === 'fallback') {
    const h = COMPONENTS.find(c => c.name === component)
    if (!h) return false
    const healthResult = h.healthCommand();
    const summary: ComponentHealthSummary = {
      component: h.name,
      alive: healthResult.alive,
      failure_class: healthResult.failure_class as number,
      error: healthResult.error,
      detail: healthResult.detail,
    };
    return executeFallback(component, summary)
  }
  if (action.action_type === 'restart_systemd') {
    const compInfo = COMPONENTS.find(c => c.name === component)
    if (!compInfo || !compInfo.systemdService) return false
    return executeRestartSystemd(component, compInfo.systemdService)
  }
  return false
}

// ──────────────────────────── Functional Tests ──────────────────────

function runFunctionalTests(component: string): FunctionalTestResult[] {
  const tests: FunctionalTestResult[] = []

  if (component === 'opencode' || component === 'opencode-web') {
    const port = component === 'opencode' ? 4096 : 4097
    const start = Date.now()
    const r = httpGet(`http://127.0.0.1:${port}/api/health`, 5000)
    tests.push({
      name: `${component}_http_health`,
      status: r.code === 200 ? 'pass' : 'fail',
      duration_ms: Date.now() - start,
      detail: r.code === 200 ? 'HTTP 200 OK' : `HTTP ${r.code}: ${r.error || 'unknown'}`,
    })

    if (r.code === 200) {
      const bodyStart = Date.now()
      const body = httpGetBody(`http://127.0.0.1:${port}/api/health`, 5000)
      tests.push({
        name: `${component}_body_not_empty`,
        status: body.body && body.body.length > 0 ? 'pass' : 'fail',
        duration_ms: Date.now() - bodyStart,
        detail: body.body ? `body length ${body.body.length}` : 'empty body',
      })
    }
  }

  if (component === 'akm-bridge') {
    const start = Date.now()
    const r = httpGetBody('http://127.0.0.1:4199/api/akm/health', 5000)
    tests.push({
      name: 'akm_bridge_http_health',
      status: r.code === 200 ? 'pass' : 'fail',
      duration_ms: Date.now() - start,
      detail: r.code === 200 ? 'HTTP 200 OK' : `HTTP ${r.code || 0}: ${r.error || 'unknown'}`,
    })

    if (r.code === 200 && r.body) {
      try {
        const parsed = JSON.parse(r.body)
        tests.push({
          name: 'akm_bridge_health_json',
          status: parsed.ok === true ? 'pass' : 'fail',
          duration_ms: 0,
          detail: parsed.ok === true ? 'valid health response' : 'health ok != true',
        })
      } catch {
        tests.push({ name: 'akm_bridge_health_json', status: 'fail', duration_ms: 0, detail: 'invalid JSON' })
      }
    }
  }

  if (component === 'akm-cli') {
    const bin = '/root/.bun/bin/bun'
    const start = Date.now()
    const r = runCmd(bin, [AKM_BINARY, 'health'])
    tests.push({
        name: 'akm_cli_health_cmd',
        status: (r.exitCode === 0 || r.exitCode === 4) ? 'pass' : 'fail',
      duration_ms: Date.now() - start,
      detail: r.exitCode === 0 ? 'exit 0' : `exit ${r.exitCode}: ${r.stderr || 'no stderr'}`,
    })

    if (r.exitCode === 0) {
      const searchStart = Date.now()
      const search = runCmd(bin, [AKM_BINARY, 'search', 'test'])
      tests.push({
        name: 'akm_cli_search_hits',
        status: search.exitCode === 0 ? 'pass' : 'fail',
        duration_ms: Date.now() - searchStart,
        detail: search.exitCode === 0 ? 'search works' : `search failed: exit ${search.exitCode}`,
      })

    }
  }

  if (tests.length === 0) {
    tests.push({
      name: `${component}_noop`,
      status: 'pass',
      duration_ms: 0,
      detail: 'no functional tests defined for this component',
    })
  }

  return tests
}

// ──────────────────────────── Main Recovery Evaluation ──────────────

interface RecoveryEvalResult {
  component: string
  initial_state: RecoveryState
  failure_class: FailureClass | null
  action_proposed: RecoveryAction[]
  action_executed: RecoveryAction[]
  final_state: RecoveryState
  functional_test: FunctionalTestResult[]
  cooldown: boolean
  escalation: boolean
  messages: string[]
}

function evaluateComponent(name: string, health: ComponentHealthSummary, dryRun: boolean): RecoveryEvalResult {
  const state = readState()
  const comp = getComponentState(state, name)
  const initial_state = comp.state
  const messages: string[] = []
  const action_proposed: RecoveryAction[] = []
  const action_executed: RecoveryAction[] = []
  let escalation = false
  let cooldown = false
  const functional_test: FunctionalTestResult[] = []

  if (health.alive && health.failure_class === 0) {
    comp.consecutive_successes++
    comp.consecutive_failures = 0
    comp.last_success_time = Date.now()

    if (comp.consecutive_successes >= SUCCESS_RESET_AFTER && comp.state !== 'HEALTHY') {
      transitionState(comp, 'HEALTHY', 'consecutive successes threshold met', name)
    } else if (comp.state === 'HEALTHY') {
      // already healthy
    }
    writeStateAtomic(state)
    return {
      component: name, initial_state, failure_class: health.failure_class as FailureClass | null,
      action_proposed: [], action_executed: [], final_state: comp.state,
      functional_test: [], cooldown: false, escalation: false, messages: ['healthy'],
    }
  }

  // Failure detected
  comp.consecutive_failures++
  comp.consecutive_successes = 0
  comp.last_failure_time = Date.now()
  comp.failure_class = health.failure_class as FailureClass | null
  comp.last_error = health.error

  // Class 0 — transient, no state transition
  if (health.failure_class === 0) {
    messages.push(`class 0 failure (transient) for ${name}: ${health.error || 'no error'}`)
    writeStateAtomic(state)
    return {
      component: name, initial_state, failure_class: 0,
      action_proposed: [], action_executed: [], final_state: comp.state,
      functional_test: [], cooldown: false, escalation: false,
      messages: ['transient issue — no action needed'],
    }
  }

  // Class 4 — always escalate
  if (health.failure_class === 4) {
    transitionState(comp, 'ESCALATION_REQUIRED', 'class 4 problem — human required', name)
    escalation = true
    messages.push(`class 4 failure: ${health.error}. Escalating to human.`)
    writeStateAtomic(state)
    return {
      component: name, initial_state, failure_class: 4,
      action_proposed: [], action_executed: [], final_state: 'ESCALATION_REQUIRED',
      functional_test: [], cooldown: false, escalation: true,
      messages: ['class 4 — escalation required'],
    }
  }

  // Check consecutive failures threshold
  if (comp.consecutive_failures < WARNING_AFTER) {
    transitionState(comp, 'DEGRADED', `failure ${comp.consecutive_failures}/${RECOVERY_AFTER} consecutive`, name)
    messages.push(`${name}: ${comp.consecutive_failures} consecutive failures (warning threshold: ${WARNING_AFTER})`)
    writeStateAtomic(state)
    return {
      component: name, initial_state, failure_class: health.failure_class as FailureClass | null,
      action_proposed: [], action_executed: [], final_state: comp.state,
      functional_test: [], cooldown: false, escalation: false,
      messages: [`below recovery threshold (${comp.consecutive_failures}/${RECOVERY_AFTER})`],
    }
  }

  if (comp.consecutive_failures < RECOVERY_AFTER) {
    transitionState(comp, 'FAILURE_SUSPECTED', `failure ${comp.consecutive_failures}/${RECOVERY_AFTER} consecutive`, name)
    messages.push(`${name}: FAILURE_SUSPECTED at ${comp.consecutive_failures} consecutive failures`)
    writeStateAtomic(state)
    return {
      component: name, initial_state, failure_class: health.failure_class as FailureClass | null,
      action_proposed: [], action_executed: [], final_state: comp.state,
      functional_test: [], cooldown: false, escalation: false,
      messages: ['recovery threshold not yet reached — monitoring'],
    }
  }

  // Recovery threshold reached
  transitionState(comp, 'RECOVERY_PENDING', `${comp.consecutive_failures} consecutive failures`, name)
  messages.push(`${name}: RECOVERY_PENDING after ${comp.consecutive_failures} failures`)

  // Check rate limits
  const rateLimit = checkRateLimit(name)
  if (!rateLimit.allowed) {
    transitionState(comp, 'COOLDOWN', rateLimit.reason!, name)
    messages.push(`rate limited: ${rateLimit.reason}`)
    cooldown = true
    writeStateAtomic(state)
    return {
      component: name, initial_state, failure_class: health.failure_class as FailureClass | null,
      action_proposed: [], action_executed: [], final_state: 'COOLDOWN',
      functional_test: [], cooldown: true, escalation: false,
      messages: [`rate limited: ${rateLimit.reason}`],
    }
  }

  // Plan recovery actions
  const proposed = planRecovery(name, health)
  action_proposed.push(...proposed)

  const askActions = proposed.filter(a => a.requires_ask)
  const autoActions = proposed.filter(a => !a.requires_ask)

  if (askActions.length > 0 && !dryRun) {
    messages.push(`requires ask: ${askActions.map(a => a.description).join('; ')}`)
    transitionState(comp, 'ESCALATION_REQUIRED', 'recovery requires human approval', name)
    escalation = true
    writeStateAtomic(state)
    return {
      component: name, initial_state, failure_class: health.failure_class as FailureClass | null,
      action_proposed, action_executed, final_state: 'ESCALATION_REQUIRED',
      functional_test: [], cooldown: false, escalation: true,
      messages: ['actions require human approval — escalating'],
    }
  }

  if (autoActions.length === 0 && askActions.length === 0) {
    messages.push('no recovery actions available')
    transitionState(comp, 'RECOVERY_FAILED', 'no recovery actions available', name)
    writeStateAtomic(state)
    return {
      component: name, initial_state, failure_class: health.failure_class as FailureClass | null,
      action_proposed, action_executed, final_state: 'RECOVERY_FAILED',
      functional_test: [], cooldown: false, escalation: false,
      messages: ['no recovery actions available'],
    }
  }

  // Execute automatic actions
  if (!dryRun) {
    transitionState(comp, 'RECOVERY_RUNNING', `executing ${autoActions.length} auto actions`, name)
    comp.recovery_attempts++
    comp.last_recovery_time = Date.now()

    for (const action of autoActions) {
      messages.push(`executing: ${action.description}`)
      const ok = executeRecovery(name, action)
      if (ok) {
        action_executed.push(action)
        messages.push(`action succeeded: ${action.action_type}`)
      } else {
        messages.push(`action failed: ${action.action_type}`)
      }
    }

    // Run functional tests
    const tests = runFunctionalTests(name)
    functional_test.push(...tests)
    const allPassed = tests.every(t => t.status === 'pass')

    if (allPassed) {
      transitionState(comp, 'RECOVERED', `all ${tests.length} functional tests passed`, name, comp.recovery_attempts)
      comp.consecutive_failures = 0
      comp.cooldown_until = Date.now() + RECOVERY_COOLDOWN_SECONDS * 1000
      cooldown = true
      messages.push(`recovered — ${tests.length} functional tests passed, cooldown ${RECOVERY_COOLDOWN_SECONDS}s`)
    } else {
      transitionState(comp, 'RECOVERY_FAILED', `${tests.filter(t => t.status === 'fail').length}/${tests.length} functional tests failed`, name, comp.recovery_attempts)
      if (comp.recovery_attempts >= ESCALATE_AFTER) {
        transitionState(comp, 'ESCALATION_REQUIRED', `${ESCALATE_AFTER} failed recovery attempts`, name)
        escalation = true
      }
      messages.push(`recovery failed — ${tests.filter(t => t.status === 'fail').length}/${tests.length} tests failed`)
    }
  } else {
    messages.push('DRY RUN — actions would be executed:')
    for (const action of autoActions) {
      messages.push(`  [${action.action_type}] ${action.description}`)
    }
    transitionState(comp, 'RECOVERY_PENDING', 'dry run — no action taken', name)
  }

  writeStateAtomic(state)

  return {
    component: name,
    initial_state,
    failure_class: health.failure_class as FailureClass | null,
    action_proposed,
    action_executed,
    final_state: comp.state,
    functional_test,
    cooldown,
    escalation,
    messages,
  }
}

// ──────────────────────────── Report Generator ──────────────────────

function generateReport(dryRun: boolean, targetComponent?: string): RecoveryReport {
  const report: RecoveryReport = {
    recovery_command: targetComponent ? `recover ${targetComponent}` : 'check',
    timestamp: new Date().toISOString(),
    checks: [],
    failures: [],
    degraded: [],
    state: {},
    actions: [],
    executed_actions: [],
    functional_tests: [],
    escalation: false,
    messages: [],
  }

  const allComponents = targetComponent ? COMPONENTS.filter(c => c.name === targetComponent) : COMPONENTS
  const state = readState()

  for (const comp of allComponents) {
    const healthResult = comp.healthCommand()
    const health: ComponentHealthSummary = { component: comp.name, ...healthResult }
    report.checks.push(health)
    report.state[comp.name] = getComponentState(state, comp.name)
    if (!health.alive || health.failure_class > 0) {
      const evalResult = evaluateComponent(comp.name, health, dryRun)
      report.actions.push(...evalResult.action_proposed)
      report.executed_actions.push(...evalResult.action_executed)
      report.functional_tests.push(...evalResult.functional_test)
      report.messages.push(...evalResult.messages)
      if (evalResult.escalation) report.escalation = true
      report.state[comp.name] = { ...getComponentState(readState(), comp.name) }

      if (evalResult.failure_class && evalResult.failure_class >= 2) {
        report.failures.push(health)
      } else if (evalResult.failure_class && evalResult.failure_class >= 1) {
        report.degraded.push(health)
      }
    }
  }

  report.timestamp = new Date().toISOString()
  return report
}

// ──────────────────────────── CLI Entrypoint ────────────────────────

function printUsage(): void {
  console.log(`
OpenCode Safe Recovery Controller

Usage:
  tsx scripts/opencode-recovery-controller.ts [options]

Options:
  --check              Run health checks (default)
  --dry-run            Evaluate only, no recovery actions
  --status             Show current state without running checks
  --reset-state        Reset all component state to HEALTHY
  --recover <name>     Run recovery for a specific component

Components: ${COMPONENTS.map(c => c.name).join(', ')}
`)
}

interface CliResult {
  recovery_command: string
  timestamp: string
  checks: ComponentHealthSummary[]
  failures: ComponentHealthSummary[]
  degraded: ComponentHealthSummary[]
  state: Record<string, any>
  actions: RecoveryAction[]
  executed_actions: RecoveryAction[]
  functional_tests: FunctionalTestResult[]
  escalation: boolean
  messages: string[]
  [key: string]: any
}

function main(): void {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    printUsage()
    process.exit(0)
  }

  if (args.includes('--reset-state')) {
    const state = readState()
    for (const name of Object.keys(state.components)) {
      resetComponentState(state.components[name])
    }
    state.escalation = false
    state.updated_at = new Date().toISOString()
    writeStateAtomic(state)
    console.log(JSON.stringify({
      recovery_command: 'reset-state',
      timestamp: new Date().toISOString(),
      event: 'state_reset',
      message: 'All component states reset to HEALTHY',
    }, null, 2))
    process.exit(0)
  }

  if (args.includes('--status')) {
    const state = readState()
    const report: CliResult = {
      recovery_command: 'status',
      timestamp: new Date().toISOString(),
      checks: [],
      failures: [],
      degraded: [],
      state: state.components,
      actions: [],
      executed_actions: [],
      functional_tests: [],
      escalation: state.escalation,
      messages: [],
    }
    report.updated_at = state.updated_at
    console.log(JSON.stringify(report, null, 2))
    process.exit(0)
  }

  const dryRun = args.includes('--dry-run')
  const recoverIdx = args.indexOf('--recover')
  const targetComponent = recoverIdx >= 0 && recoverIdx + 1 < args.length ? args[recoverIdx + 1] : undefined

  if (targetComponent && !COMPONENTS.find(c => c.name === targetComponent)) {
    console.error(`Unknown component: ${targetComponent}`)
    console.error(`Available: ${COMPONENTS.map(c => c.name).join(', ')}`)
    process.exit(1)
  }

  const report = generateReport(dryRun, targetComponent)
  report.timestamp = new Date().toISOString()
  console.log(JSON.stringify(report, null, 2))

  if (report.escalation) process.exit(2)
  if (report.failures.length > 0) process.exit(1)
}

main()
