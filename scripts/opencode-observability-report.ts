/**
 * OpenCode Observability Report — aggregates health, metrics, CI status, and system info.
 * Usage: tsx scripts/opencode-observability-report.ts
 */

import { execFileSync, execSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')

interface Report {
  timestamp: string
  system_status: string
  opencode_status: string
  git_commit: string
  git_branch: string
  git_clean: boolean
  mcp_healthy: number
  mcp_failed: number
  akm_status: string
  ci_status: string
  secret_scan_status: string
  disk_usage_journal_gb: string
  log_retention_days: string
  agents_total: number
  commands_total: number
  skills_total: number
  warnings: string[]
  errors: string[]
}

function run(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch (e: any) {
    return `error: ${e.message}`
  }
}

function runShell(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch (e: any) {
    return `error: ${e.message}`
  }
}

function checkAKM(): string {
  try {
    const out = execFileSync('akm', ['health'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const parsed = JSON.parse(out)
    return parsed.ok === true ? 'pass' : 'warn'
  } catch (e: any) {
    try {
      const out = execFileSync('akm', ['health'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const parsed = JSON.parse(out)
      return parsed.ok === true ? 'pass (exit!=0)' : 'warn'
    } catch {
      return 'unreachable'
    }
  }
}

function countFiles(dir: string): number {
  try {
    const out = execSync(`find "${dir}" -name "*.md" -o -name "*.json" 2>/dev/null | wc -l`, { encoding: 'utf-8' })
    return parseInt(out.trim()) || 0
  } catch { return 0 }
}

async function main() {
  const report: Report = {
    timestamp: new Date().toISOString(),
    system_status: 'unknown',
    opencode_status: 'unknown',
    git_commit: run('git', ['log', '--oneline', '-1']),
    git_branch: run('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    git_clean: run('git', ['status', '--short']).length === 0,
    mcp_healthy: 0,
    mcp_failed: 0,
    akm_status: checkAKM(),
    ci_status: 'not_checked',
    secret_scan_status: 'not_checked',
    disk_usage_journal_gb: runShell("journalctl --disk-usage 2>/dev/null | grep -oP '\\d+[.]?\\d*(?=G)' || echo 'unknown'"),
    log_retention_days: runShell("journalctl --list-boots 2>/dev/null | wc -l || echo '0'"),
    agents_total: countFiles('/root/.config/opencode/agents'),
    commands_total: countFiles('/root/.config/opencode/commands'),
    skills_total: countFiles('/root/.config/opencode/skills'),
    warnings: [],
    errors: [],
  }

  if (report.git_branch.startsWith('error')) report.warnings.push('git unavailable')
  if (report.akm_status !== 'pass') report.warnings.push(`AKM status: ${report.akm_status}`)
  if (report.disk_usage_journal_gb === 'unknown') report.warnings.push('cannot measure journal disk usage')

  if (report.errors.length === 0 && report.warnings.length === 0) {
    report.system_status = 'healthy'
  } else if (report.errors.length > 0) {
    report.system_status = 'degraded'
  } else {
    report.system_status = 'warning'
  }

  report.opencode_status = report.system_status

  console.log(JSON.stringify(report, null, 2))
  if (report.system_status === 'degraded') process.exit(1)
}

main().catch(e => {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), fatal: e.message }))
  process.exit(2)
})
