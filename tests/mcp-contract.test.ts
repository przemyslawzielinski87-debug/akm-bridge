/**
 * MCP Contract Tests — verify JSON-RPC protocol compliance
 * Uses fake AKM binary for deterministic results in CI.
 */

import { execFileSync, execSync } from 'node:child_process'
import { resolve } from 'node:path'

const PROJECT_ROOT = resolve(process.cwd())
const FAKE_AKM = resolve(PROJECT_ROOT, 'fixtures/fake-akm.sh')

function runAKM(...args: string[]): { stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(FAKE_AKM, args, {
      encoding: 'utf-8',
      env: { ...process.env, AKM_BINARY: FAKE_AKM },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { stdout: stdout.trim(), stderr: '' }
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString().trim() ?? '',
      stderr: e.stderr?.toString().trim() ?? '',
    }
  }
}

function isJSON(str: string): boolean {
  try {
    JSON.parse(str)
    return true
  } catch {
    return false
  }
}

describe('MCP Contract — AKM Bridge', () => {
  test('search returns valid JSON with hits', () => {
    const { stdout, stderr } = runAKM('search', 'test')
    expect(stderr).toBe('')
    expect(isJSON(stdout)).toBe(true)
    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty('hits')
    expect(Array.isArray(parsed.hits)).toBe(true)
    expect(parsed.hits.length).toBeGreaterThan(0)
  })

  test('search with noresults query returns empty hits', () => {
    const { stdout, stderr } = runAKM('search', 'noresults')
    expect(stderr).toBe('')
    expect(isJSON(stdout)).toBe(true)
    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty('hits')
    expect(parsed.hits).toHaveLength(0)
    expect(parsed).toHaveProperty('tip')
  })

  test('health returns valid JSON', () => {
    const { stdout, stderr } = runAKM('health')
    expect(stderr).toBe('')
    expect(isJSON(stdout)).toBe(true)
    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty('ok')
    expect(parsed).toHaveProperty('status')
  })

  test('health warning exit code 4 returns warn status', () => {
    const { stdout, stderr } = runAKM('health')
    expect(isJSON(stdout)).toBe(true)
    // Test with simulated warning
    const env = { ...process.env, AKM_FAKE_HEALTH_EXIT_CODE_4: '1' }
    let result: { stdout: string; stderr: string }
    try {
      const out = execFileSync(FAKE_AKM, ['health'], {
        encoding: 'utf-8',
        env: { ...env, AKM_BINARY: FAKE_AKM },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      result = { stdout: out.trim(), stderr: '' }
    } catch (e: any) {
      result = {
        stdout: e.stdout?.toString().trim() ?? '',
        stderr: e.stderr?.toString().trim() ?? '',
      }
    }
    expect(isJSON(result.stdout)).toBe(true)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.status).toBe('warn')
  })

  test('info returns valid JSON with source details', () => {
    const { stdout, stderr } = runAKM('info')
    expect(stderr).toBe('')
    expect(isJSON(stdout)).toBe(true)
    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty('version')
    expect(parsed).toHaveProperty('sourceProviders')
    expect(parsed).toHaveProperty('searchModes')
  })

  test('list returns valid JSON with sources array', () => {
    const { stdout, stderr } = runAKM('list')
    expect(stderr).toBe('')
    expect(isJSON(stdout)).toBe(true)
    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty('sources')
    expect(Array.isArray(parsed.sources)).toBe(true)
    expect(parsed).toHaveProperty('totalSources')
  })

  test('show with valid ref returns content', () => {
    const { stdout, stderr } = runAKM('show', 'valid:ref')
    expect(stderr).toBe('')
    expect(isJSON(stdout)).toBe(true)
    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty('content')
  })

  test('show with invalid ref returns error', () => {
    const { stdout } = runAKM('show', 'invalid:ref')
    expect(isJSON(stdout)).toBe(true)
    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty('error')
  })

  test('search with empty query returns error', () => {
    const { stdout } = runAKM('search', '')
    expect(isJSON(stdout)).toBe(true)
    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty('error')
    expect(parsed).toHaveProperty('code', 'MISSING_REQUIRED_ARGUMENT')
  })

  test('no stdout contamination from stderr', () => {
    const { stdout, stderr } = runAKM('search', 'test')
    expect(stderr).toBe('')
    expect(stdout).not.toContain('error')
    expect(stdout).not.toContain('Error')
  })

  test('version returns string', () => {
    const { stdout, stderr } = runAKM('--version')
    expect(stderr).toBe('')
    expect(stdout).toContain('akm')
  })
})
