/**
 * Observability tests — verify health check and report scripts function correctly.
 */

import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')

const HEALTH_CHECK = resolve(PROJECT_ROOT, 'scripts/health-check.sh')
const FAKE_AKM = resolve(PROJECT_ROOT, 'fixtures/fake-akm.sh')

function runHealthCheck(): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync(HEALTH_CHECK, {
      encoding: 'utf-8',
      env: { ...process.env, AKM_BINARY: FAKE_AKM, PATH: '/usr/bin:/bin:/usr/local/bin' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { stdout: stdout.trim(), exitCode: 0 }
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString().trim() ?? '',
      exitCode: e.status ?? 1,
    }
  }
}

describe('Observability — Health Check Script', () => {
  test('health-check.sh produces valid JSON', () => {
    const { stdout } = runHealthCheck()
    expect(stdout).toBeTruthy()
    expect(() => JSON.parse(stdout)).not.toThrow()
    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty('timestamp')
    expect(parsed).toHaveProperty('component', 'health-check')
    expect(parsed).toHaveProperty('event', 'system_health')
    expect(parsed).toHaveProperty('opencode')
    expect(parsed).toHaveProperty('akm')
  })

  test('health-check.sh returns exit code 1 when tools unavailable', () => {
    const { exitCode } = runHealthCheck()
    expect(exitCode).toBe(1)
  })

  test('health-check.sh output contains required fields', () => {
    const { stdout } = runHealthCheck()
    const parsed = JSON.parse(stdout)
    expect(typeof parsed.timestamp).toBe('string')
    expect(typeof parsed.opencode).toBe('string')
    expect(typeof parsed.akm).toBe('string')
    expect(typeof parsed.http_health_endpoint).toBe('number')
  })
})

describe('Observability — MCP Health Check (via fake AKM)', () => {
  test('fake AKM search returns hits', () => {
    const out = execFileSync(FAKE_AKM, ['search', 'test'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const parsed = JSON.parse(out)
    expect(parsed.hits.length).toBeGreaterThan(0)
  })

  test('fake AKM search with noresults returns empty', () => {
    const out = execFileSync(FAKE_AKM, ['search', 'noresults'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const parsed = JSON.parse(out)
    expect(parsed.hits).toHaveLength(0)
  })

  test('fake AKM health returns pass', () => {
    const out = execFileSync(FAKE_AKM, ['health'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const parsed = JSON.parse(out)
    expect(parsed.ok).toBe(true)
    expect(parsed.status).toBe('pass')
  })

  test('fake AKM health warn exit code 4 is parsed', () => {
    try {
      execFileSync(FAKE_AKM, ['health'], {
        encoding: 'utf-8',
        env: { ...process.env, AKM_FAKE_HEALTH_EXIT_CODE_4: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      fail('should have exited with code 4')
    } catch (e: any) {
      expect(e.status).toBe(4)
      const parsed = JSON.parse(e.stdout.toString())
      expect(parsed.ok).toBe(true)
      expect(parsed.status).toBe('warn')
    }
  })
})
