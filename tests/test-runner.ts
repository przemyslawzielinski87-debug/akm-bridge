/**
 * AKM Bridge — Test runner.
 * Unit tests with fake AKM binary + integration tests with real AKM v0.8.1.
 */

import { execSync } from 'node:child_process'
import { unlinkSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const FAKE_AKM = resolve(__dirname, '../fixtures/fake-akm.sh')
const REAL_AKM = '/root/.bun/bin/akm'
const MARKER_DIR = '/tmp/akm-bridge-test'

let passed = 0
let failed = 0
const failures: string[] = []

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg)
}

function step(name: string) {
  process.stderr.write(`  ${name} ... `)
}

function pass() {
  process.stderr.write('PASS\n')
  passed++
}

function fail(e: unknown) {
  process.stderr.write(`FAIL\n    ${(e as Error).message}\n`)
  failed++
  failures.push((e as Error).message)
}

async function setup() {
  try { execSync(`mkdir -p ${MARKER_DIR}`) } catch {}
}

async function cleanup() {
  try { execSync(`rm -rf ${MARKER_DIR}`) } catch {}
}

// Import adapter once; config is read fresh via process.env on each call
async function loadAdapter() {
  return await import('../src/adapter.js')
}

/* ── Tests ── */

async function testValidHealth() {
  step('valid health call')
  process.env.AKM_BINARY = FAKE_AKM
  const { checkHealth } = await loadAdapter()
  const r = await checkHealth()
  assert(r.ok === true, 'health should succeed')
  assert(r.data!.status === 'pass', `status should be "pass", got "${r.data!.status}"`)
  pass()
}

async function testValidStatus() {
  step('valid status call')
  process.env.AKM_BINARY = FAKE_AKM
  const { getStatus } = await loadAdapter()
  const r = await getStatus()
  assert(r.ok === true, 'status should succeed')
  assert(r.data!.version === '0.8.1', `got ${r.data!.version}`)
  assert(r.data!.healthy === true, 'should be healthy')
  assert(r.data!.entry_count === 1866, `got ${r.data!.entry_count}`)
  pass()
}

async function testValidSources() {
  step('valid source listing')
  process.env.AKM_BINARY = FAKE_AKM
  const { listSources } = await loadAdapter()
  const r = await listSources()
  assert(r.ok === true, 'sources should succeed')
  assert(Array.isArray(r.data), 'should be array')
  assert(r.data!.length >= 2, `got ${r.data!.length}`)
  assert(r.data![0].name === 'meridian-docs', `got ${r.data![0].name}`)
  pass()
}

async function testValidCapabilities() {
  step('valid capabilities')
  process.env.AKM_BINARY = FAKE_AKM
  const { getCapabilities } = await loadAdapter()
  const r = await getCapabilities()
  assert(r.ok === true, 'caps should succeed')
  assert(Array.isArray(r.data), 'should be array')
  assert(r.data!.some((c: { name: string }) => c.name === 'search'), 'should include search')
  pass()
}

async function testValidStats() {
  step('valid stats')
  process.env.AKM_BINARY = FAKE_AKM
  const { getStats } = await loadAdapter()
  const r = await getStats()
  assert(r.ok === true, 'stats should succeed')
  assert(r.data!.total_entries === 1866, `got ${r.data!.total_entries}`)
  assert(r.data!.asset_types.length > 0, 'should have asset types')
  pass()
}

async function testValidSearch() {
  step('valid search with results')
  process.env.AKM_BINARY = FAKE_AKM
  const { search } = await loadAdapter()
  const r = await search({ query: 'deployment', limit: 5 })
  assert(r.ok === true, 'search should succeed')
  assert(Array.isArray(r.data), 'hits should be array')
  assert(r.data!.length > 0, 'should have results')
  assert(r.data![0].ref !== '', 'ref should be set')
  pass()
}

async function testSearchNoMatches() {
  step('search with no matches')
  process.env.AKM_BINARY = FAKE_AKM
  const { search } = await loadAdapter()
  const r = await search({ query: 'noresults' })
  assert(r.ok === true, 'should succeed')
  assert(r.data!.length === 0, `got ${r.data!.length} results`)
  pass()
}

async function testValidShow() {
  step('valid resource preview')
  process.env.AKM_BINARY = FAKE_AKM
  const { showResource } = await loadAdapter()
  const r = await showResource({ ref: 'test-source//knowledge:test-doc' })
  assert(r.ok === true, 'show should succeed')
  assert(r.data!.ref === 'test-source//knowledge:test-doc', 'ref mismatch')
  assert(r.data!.title === 'test-doc', `got ${r.data!.title}`)
  assert(r.data!.content.length > 0, 'content should not be empty')
  pass()
}

async function testInvalidShow() {
  step('invalid resource reference')
  process.env.AKM_BINARY = FAKE_AKM
  const { showResource } = await loadAdapter()
  const r = await showResource({ ref: 'invalid:ref' })
  assert(r.ok === false, 'invalid ref should fail')
  assert(r.error !== null, 'should have error')
  assert(r.error!.code !== '', `got code ${r.error!.code}`)
  pass()
}

async function testUnavailableBinary() {
  step('unavailable AKM binary')
  process.env.AKM_BINARY = '/nonexistent/akm-binary'
  const { checkHealth } = await loadAdapter()
  const r = await checkHealth()
  assert(r.ok === false, 'should fail')
  assert(r.error!.code === 'AKM_ERROR', `got code ${r.error!.code}`)
  pass()
}

async function testOversizedQuery() {
  step('oversized query rejected')
  process.env.AKM_BINARY = FAKE_AKM
  const { search } = await loadAdapter()
  const r = await search({ query: 'x'.repeat(500) })
  assert(r.ok === false, 'should reject oversized query')
  pass()
}

async function testEmptyQuery() {
  step('empty query rejected')
  process.env.AKM_BINARY = FAKE_AKM
  const { search } = await loadAdapter()
  const r = await search({ query: '' })
  assert(r.ok === false, 'should reject empty query')
  pass()
}

async function testOversizedRef() {
  step('oversized ref rejected')
  process.env.AKM_BINARY = FAKE_AKM
  const { showResource } = await loadAdapter()
  const r = await showResource({ ref: 'x'.repeat(1000) })
  assert(r.ok === false, 'should reject oversized ref')
  pass()
}

async function testActivityLog() {
  step('activity telemetry recording')
  process.env.AKM_BINARY = FAKE_AKM
  const { search, getActivity } = await loadAdapter()
  await search({ query: 'test' })
  await search({ query: 'deployment' })
  const activity = getActivity(5)
  assert(activity.length >= 2, `got ${activity.length} records`)
  assert(activity[0].operation === 'search', 'last should be search')
  assert(typeof activity[0].duration_ms === 'number', 'duration should be number')
  pass()
}

async function testMalformedOutput() {
  step('malformed AKM output')
  const badScript = `${MARKER_DIR}/bad-akm.sh`
  writeFileSync(badScript, '#!/usr/bin/env bash\necho "NOT JSON {{{"\n', 'utf-8')
  execSync(`chmod +x ${badScript}`)
  process.env.AKM_BINARY = badScript
  const { checkHealth } = await loadAdapter()
  const r = await checkHealth()
  assert(r.ok === false, 'should fail on malformed output')
  try { unlinkSync(badScript) } catch {}
  pass()
}

async function testAllowlist() {
  step('allowlist in types')
  const { ALLOWED_OPERATIONS } = await import('../src/types.js')
  assert(ALLOWED_OPERATIONS.has('search'), 'search allowed')
  assert(ALLOWED_OPERATIONS.has('reindex'), 'reindex allowed (ETAP 4B)')
  assert(ALLOWED_OPERATIONS.has('feedback'), 'feedback allowed (ETAP 4B)')
  assert(!ALLOWED_OPERATIONS.has('exec'), 'exec denied')
  assert(!ALLOWED_OPERATIONS.has('delete'), 'delete denied')
  pass()
}

/* ── Integration Tests ── */

async function testIntegrationHealth() {
  step('[integration] health')
  process.env.AKM_BINARY = REAL_AKM
  const { checkHealth } = await loadAdapter()
  const r = await checkHealth()
  assert(r.ok === true, 'real AKM health should pass')
  pass()
}

async function testIntegrationSearch() {
  step('[integration] search "Meridian deployment"')
  process.env.AKM_BINARY = REAL_AKM
  const { search } = await loadAdapter()
  const r = await search({ query: 'Meridian deployment', limit: 3 })
  assert(r.ok === true, 'real search should succeed')
  assert(r.data!.length > 0, `got ${r.data!.length} results`)
  pass()
}

async function testIntegrationShow() {
  step('[integration] show resource')
  process.env.AKM_BINARY = REAL_AKM
  const { showResource, search } = await loadAdapter()
  const s = await search({ query: '502 incident', limit: 1 })
  assert(s.ok && s.data!.length > 0, 'search should find 502 incident')
  const r = await showResource({ ref: s.data![0].ref })
  assert(r.ok === true, 'show should succeed')
  assert(r.data!.content.length > 0, 'content should not be empty')
  pass()
}

async function testIntegrationSources() {
  step('[integration] sources')
  process.env.AKM_BINARY = REAL_AKM
  const { listSources } = await loadAdapter()
  const r = await listSources()
  assert(r.ok === true, 'sources should succeed')
  assert(r.data!.length >= 1, `got ${r.data!.length} sources`)
  pass()
}

/* ── Main Runner ── */

async function runAll() {
  await setup()
  console.log('\n=== AKM Bridge — Unit Tests (fake AKM) ===\n')

  const unitTests = [
    testValidHealth, testValidStatus, testValidSources, testValidCapabilities,
    testValidStats, testValidSearch, testSearchNoMatches, testValidShow,
    testInvalidShow, testUnavailableBinary, testMalformedOutput,
    testAllowlist, testOversizedQuery, testEmptyQuery, testOversizedRef,
    testActivityLog,
  ]

  for (const test of unitTests) {
    try { await test() } catch (e) { fail(e) }
  }

  console.log(`\n--- Unit: ${passed} passed, ${failed} failed ---`)
  if (failures.length > 0) {
    console.log('Failures:', failures.map((f, i) => `\n  ${i + 1}. ${f}`).join(''))
  }

  if (failed > 0) {
    await cleanup()
    process.exit(1)
  }

  console.log('\n=== AKM Bridge — Integration Tests (real AKM v0.8.1) ===\n')
  passed = 0
  failures.length = 0

  const integrationTests = [
    testIntegrationHealth, testIntegrationSearch, testIntegrationShow,
    testIntegrationSources,
  ]

  for (const test of integrationTests) {
    try { await test() } catch (e) { fail(e) }
  }

  console.log(`\n--- Integration: ${passed} passed, ${failed} failed ---`)
  if (failures.length > 0) {
    console.log('Failures:', failures.map((f, i) => `\n  ${i + 1}. ${f}`).join(''))
  }

  await cleanup()

  if (failed > 0) process.exit(1)
  console.log('\n✓ All tests passed!')
}

runAll().catch((e) => {
  console.error(`\nFatal: ${e.message}`)
  process.exit(1)
})
