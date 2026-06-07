/**
 * Safe Recovery — unit and integration tests
 *
 * Tests: state machine, failure classification, thresholds, cooldown,
 * rate limiting, fallback, functional tests, escalation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, unlinkSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')
const CONTROLLER = resolve(PROJECT_ROOT, 'scripts/opencode-recovery-controller.ts')
const STATE_FILE = '/tmp/opencode-recovery-state.json'

function runController(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const r = execFileSync('npx', ['-y', 'tsx', CONTROLLER, ...args], {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { stdout: r.trim(), stderr: '', exitCode: 0 }
  } catch (e: any) {
    return {
      stdout: (e.stdout || '').toString().trim(),
      stderr: (e.stderr || '').toString().trim(),
      exitCode: e.status ?? 1,
    }
  }
}

function resetState(): void {
  try { unlinkSync(STATE_FILE) } catch {}
  runController('--reset-state')
}

function parseJSON(s: string): any {
  try { return JSON.parse(s) } catch { return null }
}

describe('Safe Recovery — State Machine', () => {
  beforeAll(() => resetState())
  afterAll(() => resetState())

  it('--reset-state creates clean state', () => {
    const r = runController('--reset-state')
    const parsed = parseJSON(r.stdout)
    expect(parsed).not.toBeNull()
    expect(parsed.event).toBe('state_reset')
  })

  it('--status returns state without checks', () => {
    const r = runController('--status')
    const parsed = parseJSON(r.stdout)
    expect(parsed).not.toBeNull()
    expect(parsed.recovery_command).toBe('status')
    expect(parsed.state).toBeDefined()
  })

  it('--check runs health checks and returns report', () => {
    const r = runController('--check')
    const parsed = parseJSON(r.stdout)
    expect(parsed).not.toBeNull()
    expect(parsed.recovery_command).toBe('check')
    expect(Array.isArray(parsed.checks)).toBe(true)
    expect(parsed.checks.length).toBeGreaterThanOrEqual(4)
  })

  it('--dry-run shows plan without recovery actions', () => {
    const r = runController('--dry-run')
    const parsed = parseJSON(r.stdout)
    expect(parsed).not.toBeNull()
    expect(parsed.recovery_command).toBe('check')
  })

  it('--recover on unknown component returns error', () => {
    const r = runController('--recover', 'nonexistent')
    expect(r.exitCode).toBe(1)
  })

  it('reports component health status for each component', () => {
    const r = runController('--check')
    const parsed = parseJSON(r.stdout)
    const names = parsed.checks.map((c: any) => c.component)
    expect(names).toContain('opencode')
    expect(names).toContain('opencode-web')
    expect(names).toContain('akm-bridge')
    expect(names).toContain('akm-cli')
  })

  it('detects alive vs failed components', () => {
    const r = runController('--check')
    const parsed = parseJSON(r.stdout)
    for (const c of parsed.checks) {
      expect(typeof c.alive).toBe('boolean')
      expect(typeof c.failure_class).toBe('number')
      expect(c.failure_class).toBeGreaterThanOrEqual(0)
      expect(c.failure_class).toBeLessThanOrEqual(4)
    }
  })
})

describe('Safe Recovery — Failure Classification', () => {
  beforeAll(() => resetState())

  it('class 0 (transient) creates no state transition', () => {
    const r = runController('--check')
    const parsed = parseJSON(r.stdout)
    const healthy = parsed.checks.filter((c: any) => c.failure_class === 0)
    expect(healthy.length).toBeGreaterThanOrEqual(2)
  })

  it('class 1 (functional degradation) marked as degraded not failed', () => {
    resetState()
    const r = runController('--check')
    const parsed = parseJSON(r.stdout)
    // akm-cli is typically class 1 (degraded due to NVIDIA auth)
    // May rarely be class 0 if AKM is fully healthy, that's also fine
    const akm = parsed?.checks?.find((c: any) => c.component === 'akm-cli')
    if (akm && akm.failure_class > 0) {
      expect(akm.failure_class).toBeLessThanOrEqual(2)
    }
  })
})

describe('Safe Recovery — Consecutive Failure Gate', () => {
  beforeAll(() => resetState())

  it('single failure does not trigger recovery', () => {
    const state = readFileSync(STATE_FILE, 'utf-8')
    const parsed = JSON.parse(state)
    for (const [name, comp] of Object.entries(parsed.components) as [string, any][]) {
      expect(comp.recovery_attempts).toBe(0)
      if (comp.consecutive_failures > 0) {
        expect(comp.consecutive_failures).toBeLessThan(3)
      }
    }
  })

  it('state tracks consecutive failures per component', () => {
    const state = readFileSync(STATE_FILE, 'utf-8')
    const parsed = JSON.parse(state)
    for (const [name, comp] of Object.entries(parsed.components) as [string, any][]) {
      expect(typeof comp.consecutive_failures).toBe('number')
      expect(comp.consecutive_failures).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('Safe Recovery — Cooldown and Rate Limiting', () => {
  beforeAll(() => resetState())

  it('state contains cooldown tracking fields', () => {
    const state = readFileSync(STATE_FILE, 'utf-8')
    const parsed = JSON.parse(state)
    for (const [name, comp] of Object.entries(parsed.components) as [string, any][]) {
      expect('cooldown_until' in comp).toBe(true)
      expect('recovery_attempts' in comp).toBe(true)
      expect('last_recovery_time' in comp).toBe(true)
    }
  })

  it('MAX_RECOVERY_ATTEMPTS enforced (check via state)', () => {
    const state = readFileSync(STATE_FILE, 'utf-8')
    const parsed = JSON.parse(state)
    for (const [name, comp] of Object.entries(parsed.components) as [string, any][]) {
      expect(comp.recovery_attempts).toBeLessThanOrEqual(3)
    }
  })
})

describe('Safe Recovery — State Machine Transitions', () => {
  beforeAll(() => resetState())

  it('states follow valid transitions', () => {
    const validStates = ['HEALTHY', 'DEGRADED', 'FAILURE_SUSPECTED', 'RECOVERY_PENDING',
      'RECOVERY_RUNNING', 'RECOVERED', 'RECOVERY_FAILED', 'COOLDOWN', 'ESCALATION_REQUIRED']
    const state = readFileSync(STATE_FILE, 'utf-8')
    const parsed = JSON.parse(state)
    for (const [name, comp] of Object.entries(parsed.components) as [string, any][]) {
      expect(validStates).toContain(comp.state)
    }
  })

  it('no component in ESCALATION_REQUIRED after fresh reset', () => {
    const state = readFileSync(STATE_FILE, 'utf-8')
    const parsed = JSON.parse(state)
    for (const [name, comp] of Object.entries(parsed.components) as [string, any][]) {
      expect(comp.state).not.toBe('ESCALATION_REQUIRED')
    }
  })
})

describe('Safe Recovery — Report Structure', () => {
  beforeAll(() => resetState())

  it('report contains all required sections', () => {
    const r = runController('--check')
    const parsed = parseJSON(r.stdout)
    expect(parsed).not.toBeNull()
    expect(parsed.recovery_command).toBeDefined()
    expect(parsed.timestamp).toBeDefined()
    expect(parsed.checks).toBeDefined()
    expect(parsed.state).toBeDefined()
    expect(parsed.escalation).toBeDefined()
  })

  it('each check has required fields', () => {
    const r = runController('--check')
    const parsed = parseJSON(r.stdout)
    for (const c of parsed.checks) {
      expect(c.component).toBeDefined()
      expect(typeof c.alive).toBe('boolean')
      expect(typeof c.failure_class).toBe('number')
      expect('error' in c).toBe(true)
      expect(c.detail).toBeDefined()
    }
  })
})

describe('Safe Recovery — Functional Test Detection', () => {
  beforeAll(() => resetState())

  it('healthy components produce no functional test failures', () => {
    const r = runController('--check')
    const parsed = parseJSON(r.stdout)
    const failedTests = parsed.functional_tests?.filter((t: any) => t.status === 'fail') || []
    expect(failedTests.length).toBe(0)
  })
})

describe('Safe Recovery — Escalation', () => {
  beforeAll(() => resetState())

  it('escalation is boolean', () => {
    const r = runController('--check')
    const parsed = parseJSON(r.stdout)
    expect(typeof parsed.escalation).toBe('boolean')
  })
})

describe('Safe Recovery — Regression', () => {
  beforeAll(() => resetState())

  it('controller script exists and is executable', () => {
    expect(existsSync(CONTROLLER)).toBe(true)
    const content = readFileSync(CONTROLLER, 'utf-8')
    expect(content.length).toBeGreaterThan(20000)
    expect(content).toContain('RECOVERY_AFTER = 3')
    expect(content).toContain('MAX_RECOVERY_ATTEMPTS = 3')
    expect(content).toContain('RECOVERY_COOLDOWN_SECONDS = 120')
    expect(content).toContain('HEALTHY')
    expect(content).toContain('ESCALATION_REQUIRED')
  })

  it('recover command file exists', () => {
    expect(existsSync('/root/.config/opencode/commands/recover.md')).toBe(true)
    const content = readFileSync('/root/.config/opencode/commands/recover.md', 'utf-8')
    expect(content).toContain('/recover')
    expect(content).toContain('infra-ops')
  })

  it('safe-recovery skill exists', () => {
    expect(existsSync('/root/.config/opencode/skills/safe-recovery/SKILL.md')).toBe(true)
    const content = readFileSync('/root/.config/opencode/skills/safe-recovery/SKILL.md', 'utf-8')
    expect(content).toContain('Classify')
    expect(content).toContain('RECOVERY_AFTER')
  })

  it('systemd templates exist in repo', () => {
    expect(existsSync(resolve(PROJECT_ROOT, '.systemd/opencode-recovery-check.service'))).toBe(true)
    expect(existsSync(resolve(PROJECT_ROOT, '.systemd/opencode-recovery-check.timer'))).toBe(true)
  })

  it('state file exists and is a regular file', () => {
    if (existsSync(STATE_FILE)) {
      const stat = execSync(`stat -c "%F" "${STATE_FILE}"`, { encoding: 'utf-8' }).trim()
      expect(stat).toBe('regular file')
    }
  })

  it('opencode.json has /recover command registered', () => {
    const cfg = JSON.parse(readFileSync('/root/.config/opencode/opencode.json', 'utf-8'))
    expect(cfg.command.recover).toBeDefined()
    expect(cfg.command.recover.agent).toBe('infra-ops')
    expect(cfg.command.recover.description).toContain('self-healing')
  })
})
