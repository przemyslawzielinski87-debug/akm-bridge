/**
 * MCP Health Check — tests all MCP servers with safe real calls.
 * Uses fake AKM in CI (AKM_BINARY env) or real AKM in production.
 */

import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')

interface HealthResult {
  server: string
  tool: string
  status: 'pass' | 'fail'
  duration_ms: number
  content_length: number
  error?: string
  empty_response: boolean
}

const AKM_BINARY = process.env.AKM_BINARY || 'akm'

function runAKM(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const start = Date.now()
  try {
    const stdout = execFileSync(AKM_BINARY, args, {
      encoding: 'utf-8',
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { stdout: stdout.trim(), stderr: '', exitCode: 0 }
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString().trim() ?? '',
      stderr: e.stderr?.toString().trim() ?? '',
      exitCode: e.status ?? 1,
    }
  }
}

async function checkAKM(): Promise<HealthResult[]> {
  const results: HealthResult[] = []
  const tests = [
    { server: 'akm-bridge', tool: 'health', args: ['health'] },
    { server: 'akm-bridge', tool: 'status', args: ['status'] },
    { server: 'akm-bridge', tool: 'capabilities', args: ['capabilities'] },
    { server: 'akm-bridge', tool: 'search-hits', args: ['search', 'test'] },
    { server: 'akm-bridge', tool: 'search-empty', args: ['search', 'noresults'] },
  ]

  for (const { server, tool, args } of tests) {
    const start = Date.now()
    const { stdout, stderr, exitCode } = runAKM(...args)
    const duration_ms = Date.now() - start
    const parsed = tryParseJSON(stdout)

    const empty = !stdout || stdout === '' || (parsed && Array.isArray(parsed.hits) && parsed.hits.length === 0 && tool === 'search-hits')
    const failed = exitCode !== 0 && exitCode !== 4

    results.push({
      server,
      tool,
      status: failed ? 'fail' : 'pass',
      duration_ms,
      content_length: stdout.length,
      error: failed ? stderr || `exit code ${exitCode}` : undefined,
      empty_response: empty,
    })
  }

  return results
}

function tryParseJSON(s: string): any {
  try { return JSON.parse(s) } catch { return null }
}

function report(results: HealthResult[]): string {
  const total = results.length
  const passed = results.filter(r => r.status === 'pass').length
  const failed = results.filter(r => r.status === 'fail').length
  const empty = results.filter(r => r.empty_response).length
  const totalDuration = results.reduce((s, r) => s + r.duration_ms, 0)

  return JSON.stringify({
    timestamp: new Date().toISOString(),
    component: 'mcp-health-check',
    event: 'health_check',
    mcp_total: total,
    mcp_healthy: passed,
    mcp_failed: failed,
    empty_responses: empty,
    total_duration_ms: totalDuration,
    avg_duration_ms: Math.round(totalDuration / total),
    results,
  }, null, 2)
}

async function main() {
  const akmResults = await checkAKM()
  const output = report(akmResults)
  console.log(output)
  const parsed = JSON.parse(output)
  if (parsed.mcp_failed > 0 || parsed.empty_responses > 0) {
    process.exit(1)
  }
}

main().catch(e => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    component: 'mcp-health-check',
    event: 'fatal_error',
    error: e.message,
  }))
  process.exit(2)
})
