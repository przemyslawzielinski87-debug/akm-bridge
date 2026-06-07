import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
const mode = args.includes('--ci') ? 'ci' :
             args.includes('--server') ? 'server' :
             args.includes('--all') ? 'all' : 'local'
const jsonOutput = args.includes('--json')
const repeat = parseInt(args.find(a => a.startsWith('--repeat='))?.split('=')[1] || '1', 10)
const randomOrder = args.includes('--random-order')
const failFast = args.includes('--fail-fast')

interface Quarantine {
  reason: string
  owner: string
  manual_command: string
  last_successful_run: string
  expiry_date: string
}

interface Suite {
  id: string
  file: string
  runner: string
  command: string
  required: boolean
  timeoutSeconds: number
  status: string
  quarantine: Quarantine | null
}

interface Matrix {
  schemaVersion: number
  generated_at: string
  suites: Suite[]
}

function loadMatrix(): Matrix {
  const path = resolve(ROOT, 'tests', 'test-matrix.json')
  if (!existsSync(path)) {
    console.error('FATAL: test-matrix.json not found. Run ETAP 13 first.')
    process.exit(1)
  }
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function findBun(): string {
  const candidates = ['/root/.bun/bin/bun', 'bun']
  for (const c of candidates) {
    try { execSync(`which ${c} 2>/dev/null || echo no`) ; return c } catch {}
  }
  return 'bun'
}

const BUN = findBun()

function resolveCommand(cmd: string): string {
  const prefix = cmd.startsWith('bun ') ? `${BUN} ${cmd.slice(4)}` : cmd
  const npxPrefix = cmd.startsWith('npx ') ? `${BUN} x ${cmd.slice(4)}` : cmd
  return cmd.startsWith('bun ') ? prefix : cmd.startsWith('npx ') ? npxPrefix : cmd
}

function runSuite(suite: Suite): { passed: boolean; output: string } {
  const runnerCmd = suite.runner === 'jest'
    ? `node --experimental-vm-modules ${resolve(ROOT, 'node_modules', '.bin', 'jest')} --testPathPatterns=${suite.id.replace('jest-', '')} --forceExit --no-cache`
    : suite.runner === 'vitest'
    ? `${BUN} x vitest run ${suite.file}`
    : suite.runner === 'bun' && suite.command
    ? resolveCommand(suite.command)
    : resolveCommand(suite.command)

  const timeout = suite.timeoutSeconds * 1000

  try {
    const output = execSync(runnerCmd, {
      cwd: ROOT,
      timeout,
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'test' },
    }).toString()
    return { passed: true, output }
  } catch (e: any) {
    const output = e.stdout?.toString() || ''
    const stderr = e.stderr?.toString() || ''
    return { passed: false, output: output + '\n' + stderr }
  }
}

async function main() {
  const matrix = loadMatrix()
  const startTime = Date.now()

  const filtered = matrix.suites.filter(suite => {
    if (suite.quarantine && mode !== 'all') {
      const expiry = new Date(suite.quarantine.expiry_date)
      if (expiry > new Date()) return false
    }
    if (mode === 'ci' && !suite.required) return false
    if (mode === 'server' && suite.runner === 'bun') return false
    return true
  })

  const order = randomOrder
    ? [...filtered].sort(() => Math.random() - 0.5)
    : filtered

  let passed = 0
  let failed = 0
  let skipped = 0
  const results: Record<string, { status: string; duration_ms: number }> = {}

  for (let r = 0; r < repeat; r++) {
    if (repeat > 1) console.log(`\n=== Run ${r + 1}/${repeat} ===\n`)

    for (const suite of order) {
      if (suite.quarantine && mode !== 'all') {
        console.log(`SKIP  ${suite.id} (quarantined: ${suite.quarantine.reason})`)
        skipped++
        results[suite.id] = { status: 'skipped', duration_ms: 0 }
        continue
      }

      const suiteStart = Date.now()
      process.stdout.write(`RUN   ${suite.id} ... `)

      const result = runSuite(suite)
      const duration = Date.now() - suiteStart

      if (result.passed) {
        console.log(`PASS (${duration}ms)`)
        passed++
        results[suite.id] = { status: 'passed', duration_ms: duration }
      } else {
        console.log(`FAIL (${duration}ms)`)
        if (results[suite.id]?.status === 'passed') {
          results[suite.id] = { status: 'flaky', duration_ms: duration }
        } else {
          results[suite.id] = { status: 'failed', duration_ms: duration }
        }
        console.log(result.output.split('\n').slice(-10).join('\n'))
        failed++
        if (failFast && suite.required) break
      }
    }
  }

  const totalDuration = Date.now() - startTime

  if (jsonOutput) {
    console.log(JSON.stringify({
      total: order.length,
      passed,
      failed,
      skipped,
      duration_ms: totalDuration,
      results,
    }, null, 2))
  } else {
    console.log(`\n=== Results ===`)
    console.log(`Total:    ${order.length}`)
    console.log(`Passed:   ${passed}`)
    console.log(`Failed:   ${failed}`)
    console.log(`Skipped:  ${skipped}`)
    console.log(`Duration: ${totalDuration}ms`)
    console.log(`Mode:     ${mode}`)
    console.log(`Repeats:  ${repeat}`)
    console.log(`Random:   ${randomOrder}`)
    console.log('')
  }

  if (failed > 0) process.exit(1)
}

main().catch(e => {
  console.error(`FATAL: ${e.message}`)
  process.exit(1)
})