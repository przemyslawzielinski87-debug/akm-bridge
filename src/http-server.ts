#!/usr/bin/env node
/**
 * AKM Bridge — HTTP API server.
 * Provides read-only AKM endpoints on 127.0.0.1:4199.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { loadConfig } from './config.js'
import {
  checkHealth, getStatus, listSources, getCapabilities,
  getStats, search, showResource, getActivity,
  reindex, syncSources, submitFeedback,
  listProposals, showProposal, acceptProposal, rejectProposal,
  remember, createLessonProposal, getWriteActivity,
  getAgentMode, getAgentRuns, recordAgentRun,
} from './adapter.js'
import { getCurrentOperation } from './write-lock.js'
import { createConfirmationToken, consumeConfirmationToken } from './confirmation-tokens.js'
import { detectSecrets } from './secret-detector.js'
import { MAX_SEARCH_RESULTS, MAX_QUERY_LENGTH, MAX_REF_LENGTH, ALLOWED_OPERATIONS, type AgentRunRecord } from './types.js'

const config = loadConfig()
const UI_DIR = resolve(import.meta.dirname, '../ui')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

/* ── URL parsing ── */

interface ParsedUrl {
  path: string
  query: Record<string, string>
}

function parseUrl(raw: string): ParsedUrl {
  const idx = raw.indexOf('?')
  const path = idx === -1 ? raw : raw.slice(0, idx)
  const query: Record<string, string> = {}
  if (idx !== -1) {
    const qs = raw.slice(idx + 1)
    for (const part of qs.split('&')) {
      const eq = part.indexOf('=')
      if (eq === -1) {
        query[decodeURIComponent(part)] = ''
      } else {
        query[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1))
      }
    }
  }
  return { path, query }
}

function json(res: ServerResponse, code: number, data: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function badRequest(res: ServerResponse, message: string) {
  json(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message } })
}

function methodNotAllowed(res: ServerResponse) {
  json(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } })
}

function notFound(res: ServerResponse) {
  json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } })
}

/* ── Static file serving ── */

function serveStatic(res: ServerResponse, urlPath: string) {
  let filePath = urlPath === '/' || urlPath === '/akm' || urlPath === '/akm/index.html'
    ? 'index.html'
    : urlPath.startsWith('/assets/') ? urlPath.slice(1) : null

  if (!filePath) {
    notFound(res)
    return
  }

  const fullPath = resolve(UI_DIR, filePath)
  if (!fullPath.startsWith(UI_DIR)) {
    notFound(res)
    return
  }

  if (!existsSync(fullPath)) {
    notFound(res)
    return
  }

  const ext = extname(fullPath)
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'
  const content = readFileSync(fullPath)

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
  })
  res.end(content)
}

/* ── Route handlers ── */

async function handleHealth(res: ServerResponse) {
  const result = await checkHealth()
  json(res, result.ok ? 200 : 503, result)
}

async function handleStatus(res: ServerResponse) {
  const result = await getStatus()
  json(res, result.ok ? 200 : 503, result)
}

async function handleCapabilities(res: ServerResponse) {
  const result = await getCapabilities()
  json(res, result.ok ? 200 : 503, result)
}

async function handleSources(res: ServerResponse) {
  const result = await listSources()
  json(res, result.ok ? 200 : 503, result)
}

async function handleStats(res: ServerResponse) {
  const result = await getStats()
  json(res, result.ok ? 200 : 503, result)
}

async function handleSearch(res: ServerResponse, query: Record<string, string>) {
  const q = (query.q ?? '').trim()
  if (!q) {
    badRequest(res, 'Missing query parameter: q')
    return
  }
  if (q.length > MAX_QUERY_LENGTH) {
    badRequest(res, `Query exceeds ${MAX_QUERY_LENGTH} characters`)
    return
  }
  const rawLimit = query.limit ? parseInt(query.limit, 10) : undefined
  const limit = rawLimit !== undefined && !isNaN(rawLimit) ? Math.min(rawLimit, MAX_SEARCH_RESULTS) : undefined
  const type = query.type?.trim() || undefined

  const result = await search({ query: q, type, limit })
  json(res, result.ok ? 200 : 500, result)
}

async function handleShow(res: ServerResponse, query: Record<string, string>) {
  const ref = (query.ref ?? '').trim()
  if (!ref) {
    badRequest(res, 'Missing query parameter: ref')
    return
  }
  if (ref.length > MAX_REF_LENGTH) {
    badRequest(res, `Reference exceeds ${MAX_REF_LENGTH} characters`)
    return
  }

  const result = await showResource({ ref })
  json(res, result.ok ? 200 : 404, result)
}

async function handleActivity(res: ServerResponse) {
  const limit = 50
  json(res, 200, { ok: true, data: getActivity(limit) })
}

/* ── Write route helpers ── */

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    const onData = (chunk: Buffer) => {
      body += chunk.toString()
      size += chunk.length
      if (size > 65536) { // 64KB limit
        req.removeListener('data', onData)
        req.removeListener('end', onEnd)
        reject(new Error('Request body too large'))
      }
    }
    const onEnd = () => {
      try { resolve(JSON.parse(body)) }
      catch { reject(new Error('Invalid JSON')) }
    }
    req.on('data', onData)
    req.on('end', onEnd)
  })
}

function writeDisabled(res: ServerResponse) {
  json(res, 503, { ok: false, error: { code: 'WRITE_DISABLED', message: 'Write operations are disabled. Set AKM_WRITE_ENABLED=true to enable.' } })
}

function requireWrite(fn: (res: ServerResponse, body: Record<string, unknown>) => Promise<void>) {
  return async (res: ServerResponse, body: Record<string, unknown>) => {
    if (!loadConfig().writeEnabled) { writeDisabled(res); return }
    await fn(res, body)
  }
}

function csrfCheck(body: Record<string, unknown>, expectedOp: string, params?: Record<string, string>): { ok: false; error: { code: string; message: string } } | null {
  const token = String(body.confirmation_token ?? '')
  if (!token) return { ok: false, error: { code: 'CONFIRMATION_REQUIRED', message: 'confirmation_token is required for this operation.' } }
  const result = consumeConfirmationToken(token, expectedOp, params)
  if (!result.valid) return { ok: false, error: { code: 'CONFIRMATION_FAILED', message: result.error! } }
  return null
}

/* ── Pre-confirmation ── */

async function handlePrepare(res: ServerResponse, body: Record<string, unknown>) {
  if (!loadConfig().writeEnabled) { writeDisabled(res); return }
  const op = String(body.operation ?? '').trim()
  const allowed = ['reindex', 'sync', 'feedback', 'proposal_accept', 'proposal_reject', 'remember', 'lesson_proposal']
  if (!allowed.includes(op)) {
    json(res, 400, { ok: false, error: { code: 'INVALID_OPERATION', message: `Unknown operation: ${op}` } })
    return
  }
  const params: Record<string, string> = {}
  if (body.ref) params.ref = String(body.ref)
  if (body.proposal_id) params.proposal_id = String(body.proposal_id)
  const token = createConfirmationToken(op, params)
  json(res, 200, { ok: true, data: { confirmation_token: token.token, expires_at: token.expires_at, operation: op } })
}

/* ── Write handlers ── */

async function handleReindex(res: ServerResponse, body: Record<string, unknown>) {
  const err = csrfCheck(body, 'reindex')
  if (err) { json(res, 400, err); return }
  const result = await reindex(body.full === true)
  json(res, result.ok ? 200 : 500, result)
}

async function handleSync(res: ServerResponse, body: Record<string, unknown>) {
  const err = csrfCheck(body, 'sync')
  if (err) { json(res, 400, err); return }
  const name = body.source ? String(body.source).trim() : undefined
  const result = await syncSources(name)
  json(res, result.ok ? 200 : 500, result)
}

async function handleFeedback(res: ServerResponse, body: Record<string, unknown>) {
  const ref = String(body.ref ?? '').trim()
  if (!ref) { badRequest(res, 'ref is required'); return }
  const positive = body.positive === true
  const reason = body.reason ? String(body.reason).trim().slice(0, 500) : undefined
  const result = await submitFeedback(ref, positive, reason)
  json(res, result.ok ? 200 : 500, result)
}

async function handleProposals(res: ServerResponse, query: Record<string, string>) {
  const status = query.status?.trim() || undefined
  const result = await listProposals(status)
  json(res, result.ok ? 200 : 500, result)
}

async function handleProposal(res: ServerResponse, query: Record<string, string>) {
  const id = query.id?.trim()
  if (!id) { badRequest(res, 'Proposal ID is required'); return }
  const result = await showProposal(id)
  json(res, result.ok ? 200 : 500, result)
}

async function handleAcceptProposal(res: ServerResponse, body: Record<string, unknown>) {
  const id = String(body.proposal_id ?? '').trim()
  if (!id) { badRequest(res, 'proposal_id is required'); return }
  const err = csrfCheck(body, 'proposal_accept', { proposal_id: id })
  if (err) { json(res, 400, err); return }
  const result = await acceptProposal(id)
  json(res, result.ok ? 200 : 500, result)
}

async function handleRejectProposal(res: ServerResponse, body: Record<string, unknown>) {
  const id = String(body.proposal_id ?? '').trim()
  if (!id) { badRequest(res, 'proposal_id is required'); return }
  const err = csrfCheck(body, 'proposal_reject', { proposal_id: id })
  if (err) { json(res, 400, err); return }
  const reason = body.reason ? String(body.reason).trim().slice(0, 500) : undefined
  const result = await rejectProposal(id, reason)
  json(res, result.ok ? 200 : 500, result)
}

async function handleRemember(res: ServerResponse, body: Record<string, unknown>) {
  const content = String(body.content ?? '').trim()
  if (!content) { badRequest(res, 'content is required'); return }
  const err = csrfCheck(body, 'remember')
  if (err) { json(res, 400, err); return }
  const secrets = detectSecrets(content)
  if (secrets.length > 0) {
    json(res, 400, { ok: false, error: { code: 'SECRET_DETECTED', message: `Potential secret detected: ${secrets[0].category}. Content rejected.` } })
    return
  }
  const name = body.name ? String(body.name).trim().slice(0, 200) : undefined
  const tag = body.tag ? String(body.tag).trim().slice(0, 100) : undefined
  const result = await remember(content, name, tag)
  json(res, result.ok ? 200 : 500, result)
}

async function handleLessonProposal(res: ServerResponse, body: Record<string, unknown>) {
  const name = String(body.name ?? '').trim()
  const task = String(body.task ?? '').trim()
  if (!name) { badRequest(res, 'name is required'); return }
  if (!task) { badRequest(res, 'task is required'); return }
  const err = csrfCheck(body, 'lesson_proposal')
  if (err) { json(res, 400, err); return }
  const secrets = detectSecrets(name + ' ' + task)
  if (secrets.length > 0) {
    json(res, 400, { ok: false, error: { code: 'SECRET_DETECTED', message: `Potential secret detected: ${secrets[0].category}. Content rejected.` } })
    return
  }
  const result = await createLessonProposal(name, task)
  json(res, result.ok ? 200 : 500, result)
}

async function handleCurrentOp(res: ServerResponse) {
  json(res, 200, { ok: true, data: getCurrentOperation() })
}

async function handleWriteActivity(res: ServerResponse) {
  json(res, 200, { ok: true, data: getWriteActivity(50) })
}

/* ── Agent endpoints ── */

async function handleAgentMode(res: ServerResponse) {
  json(res, 200, { ok: true, data: { mode: getAgentMode() } })
}

async function handleAgentRuns(res: ServerResponse, query: Record<string, string>) {
  const limit = query.limit ? Math.min(Math.max(1, parseInt(query.limit, 10) || 50), 50) : 50
  const allRuns = getAgentRuns(limit)
  const safe = allRuns.map(r => ({
    run_id: r.run_id,
    timestamp: r.timestamp,
    akm_decision: r.akm_decision,
    queries_count: r.queries_count,
    selected_refs: r.selected_refs,
    loaded_refs: r.loaded_refs,
    feedback_count: r.feedback_count,
    lesson_proposal_created: r.lesson_proposal_created,
    memory_proposal_created: r.memory_proposal_created,
    fallback_used: r.fallback_used,
    duration_ms: r.duration_ms,
    completed_at: r.completed_at ?? null,
  }))
  json(res, 200, { ok: true, data: safe })
}

async function handleAgentRunStart(res: ServerResponse, body: Record<string, unknown>) {
  const decision = String(body.decision ?? '').trim()
  if (!['required', 'optional', 'skipped'].includes(decision)) {
    badRequest(res, 'decision must be required, optional, or skipped')
    return
  }
  const queriesCount = typeof body.queries_count === 'number' ? Math.min(Math.max(0, body.queries_count), 4) : 0
  const selectedRefs: string[] = Array.isArray(body.selected_refs) ? (body.selected_refs as string[]).slice(0, 5) : []
  const loadedRefs: string[] = Array.isArray(body.loaded_refs) ? (body.loaded_refs as string[]).slice(0, 3) : []
  const runId = crypto.randomUUID()
  recordAgentRun({
    run_id: runId,
    timestamp: new Date().toISOString(),
    akm_decision: decision as 'required' | 'optional' | 'skipped',
    queries_count: queriesCount,
    selected_refs: selectedRefs,
    loaded_refs: loadedRefs,
    feedback_count: 0,
    lesson_proposal_created: false,
    memory_proposal_created: false,
    fallback_used: false,
    duration_ms: 0,
  })
  json(res, 200, { ok: true, data: { run_id: runId } })
}

async function handleAgentRunComplete(res: ServerResponse, body: Record<string, unknown>) {
  const runId = String(body.run_id ?? '').trim()
  if (!runId) { badRequest(res, 'run_id is required'); return }
  const feedbackCount = typeof body.feedback_count === 'number' ? Math.max(0, body.feedback_count) : 0
  const lessonCreated = body.lesson_proposal_created === true
  const memoryCreated = body.memory_proposal_created === true
  const fallbackUsed = body.fallback_used === true
  const runs = getAgentRuns(50)
  const existing = runs.find(r => r.run_id === runId)
  if (existing) {
    const completedAt = new Date().toISOString()
    const durationMs = new Date(completedAt).getTime() - new Date(existing.timestamp).getTime()
    recordAgentRun({
      ...existing,
      feedback_count: feedbackCount || existing.feedback_count,
      lesson_proposal_created: lessonCreated || existing.lesson_proposal_created,
      memory_proposal_created: memoryCreated || existing.memory_proposal_created,
      fallback_used: fallbackUsed || existing.fallback_used,
      duration_ms: durationMs > 0 ? durationMs : existing.duration_ms,
      completed_at: completedAt,
    })
  }
  json(res, 200, { ok: true, data: { run_id: runId } })
}

/* ── Server ── */

type AnyHandler = (res: ServerResponse, params: any) => Promise<void> | void

const STATIC_ROUTES = new Set(['/', '/akm', '/akm/index.html', '/index.html', '/assets/app.js', '/assets/akm-panel.css'])

const ROUTES: Record<string, { GET?: AnyHandler; POST?: AnyHandler }> = {
  '/api/akm/health': { GET: handleHealth },
  '/api/akm/status': { GET: handleStatus },
  '/api/akm/capabilities': { GET: handleCapabilities },
  '/api/akm/sources': { GET: handleSources },
  '/api/akm/stats': { GET: handleStats },
  '/api/akm/search': { GET: handleSearch },
  '/api/akm/resource': { GET: handleShow },
  '/api/akm/activity': { GET: handleActivity },
  '/api/akm/write-activity': { GET: handleWriteActivity },
  '/api/akm/operations/current': { GET: handleCurrentOp },
  '/api/akm/actions/prepare': { POST: requireWrite(handlePrepare) },
  '/api/akm/reindex': { POST: requireWrite(handleReindex) },
  '/api/akm/sync': { POST: requireWrite(handleSync) },
  '/api/akm/feedback': { POST: handleFeedback },
  '/api/akm/proposals': { GET: handleProposals },
  '/api/akm/proposal': { GET: handleProposal },
  '/api/akm/proposals/accept': { POST: requireWrite(handleAcceptProposal) },
  '/api/akm/proposals/reject': { POST: requireWrite(handleRejectProposal) },
  '/api/akm/remember': { POST: requireWrite(handleRemember) },
  '/api/akm/lesson-proposals': { POST: requireWrite(handleLessonProposal) },
  '/api/akm/agent/mode': { GET: handleAgentMode },
  '/api/akm/agent/runs': { GET: handleAgentRuns },
  '/api/akm/agent/run/start': { POST: handleAgentRunStart },
  '/api/akm/agent/run/complete': { POST: handleAgentRunComplete },
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const method = req.method ?? 'GET'
  const { path, query } = parseUrl(req.url ?? '/')

  // CORS: same-origin only (no wildcard)
  const origin = req.headers.origin
  if (origin && !origin.startsWith('http://127.0.0.1') && !origin.startsWith('http://localhost')) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: { code: 'CORS_REJECTED', message: 'Cross-origin requests denied' } }))
    return
  }

  // Static UI routes
  if (path === '/' || path === '/akm' || path === '/index.html' || path === '/akm/index.html' || path.startsWith('/assets/')) {
    serveStatic(res, path)
    return
  }

  const route = ROUTES[path]
  if (!route) {
    notFound(res)
    return
  }

  const handler = (route as Record<string, AnyHandler | undefined>)[method]
  if (!handler) {
    methodNotAllowed(res)
    return
  }

  try {
    if (method === 'POST') {
      const body = await readJsonBody(req)
      await handler(res, body)
    } else {
      await handler(res, query)
    }
  } catch (e) {
    json(res, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message: (e as Error).message } })
  }
})

server.listen(config.httpPort, config.httpHost, () => {
  process.stderr.write(`[akm-bridge] HTTP API listening on ${config.httpHost}:${config.httpPort}\n`)
})
