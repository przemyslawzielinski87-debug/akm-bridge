/**
 * OpenCode Remote Control — HTTP API Server
 *
 * Extends the existing dashboard server pattern. Provides task management,
 * approval workflows, SSE live updates, and artifact serving.
 *
 * Security: CSRF protection, rate limiting, CORS localhost-only,
 * project/agent allowlists, audit logging, no shell execution endpoints.
 *
 * Usage:
 *   bun run src/remote-control/server.ts
 *   REMOTE_PORT=4201 bun run src/remote-control/server.ts
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHmac } from 'node:crypto'
import { TaskStore } from './task-store.js'
import { TaskWorker } from './task-worker.js'
import { ApprovalManager } from './approval-manager.js'
import { SSEManager } from './sse-manager.js'
import { OpenCodeExecutionAdapter } from './opencode-execution-adapter.js'
import {
  generateCsrfToken,
  validateCsrfToken,
  checkReplay,
  recordToken,
  isRateLimited,
} from './csrf-protection.js'
import {
  validateTask,
  checkIdempotency,
  registerIdempotencyKey,
} from './task-validator.js'
import { NotificationStore } from '../notifications/notification-store.js'
import { buildManagerFromEnv } from '../notifications/notification-manager.js'
import { buildNotificationRoutes } from '../notifications/notification-api.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PUBLIC_DIR = resolve(__dirname, 'public')

/* ── Config ── */

const PORT = parseInt(process.env.REMOTE_PORT ?? '4201')
const HOST = process.env.REMOTE_HOST ?? '127.0.0.1'
const CSRF_SECRET = process.env.CSRF_SECRET ?? randomUUID()
const SESSION_SECRET = process.env.SESSION_SECRET ?? randomUUID()
const AUTH_REQUIRED = process.env.REMOTE_AUTH === 'true'
const RATE_LIMIT_WINDOW = 60_000
const RATE_LIMIT_MAX_WRITE = 30
const RATE_LIMIT_MAX_READ = 120

/* ── Bootstrap services ── */

const store = new TaskStore()
const sse = new SSEManager()
const adapter = new OpenCodeExecutionAdapter()
const approvalManager = new ApprovalManager(store)
const worker = new TaskWorker(store, adapter, approvalManager, sse, {
  concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '1'),
  pollIntervalMs: parseInt(process.env.WORKER_POLL_MS ?? '2000'),
})
worker.start()

const notificationStore = new NotificationStore(
  process.env.NOTIFICATION_DB_PATH ?? resolve(__dirname, '..', '..', 'data', 'notifications.db')
)
const notificationManager = buildManagerFromEnv(notificationStore)

/* ── Session cookie auth ── */

interface Session {
  userId: string
  role: string
  createdAt: number
}

const sessions = new Map<string, Session>()
const SESSION_TTL = 8 * 3600 * 1000

function createSession(userId: string, role = 'operator'): string {
  const token = randomUUID()
  sessions.set(token, { userId, role, createdAt: Date.now() })
  return token
}

function validateSession(req: Request): Session | null {
  const cookie = req.headers.get('cookie') ?? ''
  const match = cookie.match(/rc_session=([a-f0-9-]+)/)
  if (!match) return null
  const session = sessions.get(match[1])
  if (!session) return null
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(match[1])
    return null
  }
  return session
}

function requireAuth(req: Request): Session | null {
  if (!AUTH_REQUIRED) {
    return { userId: 'local', role: 'admin', createdAt: Date.now() }
  }
  return validateSession(req)
}

/* ── Rate limiter (write ops) ── */

const writeRateLimits = new Map<string, { count: number; resetAt: number }>()
const notifRateLimits = new Map<string, { count: number; resetAt: number }>()

function isWriteRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = writeRateLimits.get(ip)
  if (!entry || now > entry.resetAt) {
    writeRateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT_MAX_WRITE
}

setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of writeRateLimits) {
    if (now > entry.resetAt) writeRateLimits.delete(ip)
  }
}, 300_000)

/* ── Global SSE (non-task-scoped) ── */

const globalSSEClients = new Set<ReadableStreamDefaultController>()

function broadcastGlobal(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const controller of globalSSEClients) {
    try {
      controller.enqueue(new TextEncoder().encode(payload))
    } catch {
      globalSSEClients.delete(controller)
    }
  }
}

/* ── Security headers ── */

function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  }
}

/* ── CORS ── */

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  return (
    origin.startsWith('http://127.0.0.1') ||
    origin.startsWith('http://localhost') ||
    origin === `http://${HOST}:${PORT}`
  )
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin || !isAllowedOrigin(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Idempotency-Key',
    'Access-Control-Max-Age': '86400',
  }
}

/* ── Response helpers ── */

function json(data: unknown, status = 200, req?: Request): Response {
  const origin = req?.headers.get('origin')
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...securityHeaders(),
      ...corsHeaders(origin),
    },
  })
}

function html(content: string, req?: Request): Response {
  const origin = req?.headers.get('origin')
  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...securityHeaders(),
      ...corsHeaders(origin),
      'Cache-Control': 'no-cache',
    },
  })
}

function errorResponse(message: string, status = 500, req?: Request): Response {
  return json({ ok: false, error: message, timestamp: new Date().toISOString() }, status, req)
}

function auditLog(
  action: string,
  session: Session | null,
  detail: string,
  taskId?: string,
  ip?: string
): void {
  store.audit({
    action,
    session_id: session?.userId,
    task_id: taskId,
    agent: undefined,
    detail,
    ip_address: ip,
  })
}

function okResponse(data: unknown, req?: Request): Response {
  return json({ ok: true, ...((data as object) ?? {}) }, 200, req)
}

function stale(data: unknown, generatedAt: string, ttlSec: number): unknown {
  const age = (Date.now() - new Date(generatedAt).getTime()) / 1000
  return { ...data as object, stale: age > ttlSec * 2 }
}

/* ── MIME types ── */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/* ── Request logger (no secrets) ── */

function logRequest(method: string, path: string, status: number, ip: string): void {
  process.stderr.write(
    `[remote-control] ${new Date().toISOString()} ${method} ${path} ${status} ${ip}\n`
  )
}

/* ── CSRF validation for write operations ── */

function validateCsrf(req: Request): { valid: boolean; error?: string } {
  const token = req.headers.get('x-csrf-token')
  if (!token) return { valid: false, error: 'CSRF token required' }
  if (checkReplay(token)) return { valid: false, error: 'Replay detected' }
  const result = validateCsrfToken(token, CSRF_SECRET)
  if (!result.valid) return { valid: false, error: (result as any).err ?? 'Invalid token' }
  recordToken(token)
  return { valid: true }
}

/* ── Routes ── */

/* ── Notification route handlers ── */

const notifHandlers = buildNotificationRoutes({
  manager: notificationManager,
  requireAuth: (req) => requireAuth(req),
  csrfCheck: (req) => validateCsrf(req),
  recordAudit: (action, target, outcome) =>
    store.audit({ action, session_id: undefined, task_id: target, agent: undefined, detail: outcome, ip_address: undefined }),
  isAllowedOrigin: (origin) => isAllowedOrigin(origin ?? undefined),
  securityHeaders: () => securityHeaders(),
  corsHeaders: (origin) => corsHeaders(origin ?? null),
  errorResponse: (msg, status, req) => errorResponse(msg, status, req),
  okResponse: (data, req) => okResponse(data, req),
  rateLimit: (ip: string, key: string, limit: number, windowMs: number) => {
    const now = Date.now()
    const mapKey = `${ip}:${key}`
    const entry = notifRateLimits.get(mapKey)
    if (!entry || now > entry.resetAt) {
      notifRateLimits.set(mapKey, { count: 1, resetAt: now + windowMs })
      return true
    }
    entry.count++
    return entry.count <= limit
  },
  logRequest: (method, path, status, ip) => logRequest(method, path, status, ip),
})

const handleGetNotifications = (req: Request, url: URL, ip: string) => notifHandlers.handleGetNotifications(req, url, ip)
const handleGetOverview = (req: Request, ip: string) => notifHandlers.handleGetOverview(req, ip)
const handleGetPreferences = (req: Request, ip: string) => notifHandlers.handleGetPreferences(req, ip)
const handlePutPreferences = (req: Request, ip: string) => notifHandlers.handlePutPreferences(req, ip)
const handleGetChannels = (req: Request, ip: string) => notifHandlers.handleGetChannels(req, ip)
const handlePostTest = (req: Request, ip: string) => notifHandlers.handlePostTest(req, ip)
const handleGetDeliveries = (req: Request, url: URL, ip: string) => notifHandlers.handleGetDeliveries(req, url, ip)
const handlePostAcknowledge = (req: Request, url: URL, ip: string) => notifHandlers.handlePostAcknowledge(req, url, ip)
const handleGetStatus = (req: Request, ip: string) => notifHandlers.handleGetStatus(req, ip)

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  maxRequestBodySize: 1024 * 1024, // 1MB max

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method
    const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '127.0.0.1'

    // CORS preflight
    if (method === 'OPTIONS') {
      const origin = req.headers.get('origin')
      return new Response(null, {
        status: 204,
        headers: { ...securityHeaders(), ...corsHeaders(origin) },
      })
    }

    // Origin check for all requests
    const origin = req.headers.get('origin')
    if (origin && !isAllowedOrigin(origin)) {
      logRequest(method, path, 403, ip)
      return errorResponse('Cross-origin request denied', 403, req)
    }

    // ── SSE: global event stream ──

    if (path === '/api/events' && method === 'GET') {
      const session = requireAuth(req)
      if (!session) return errorResponse('Unauthorized', 401, req)

      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(':ok\n\n'))
          globalSSEClients.add(controller)
          const heartbeat = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(': heartbeat\n\n'))
            } catch {
              clearInterval(heartbeat)
              globalSSEClients.delete(controller)
            }
          }, 15_000)
          const origClose = controller.close.bind(controller)
          controller.close = () => {
            clearInterval(heartbeat)
            globalSSEClients.delete(controller)
            origClose()
          }
        },
      })

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          ...securityHeaders(),
        },
      })
    }

    // ── SSE: task-specific event stream ──

    if (path.match(/^\/api\/tasks\/[^/]+\/events$/) && method === 'GET') {
      const session = requireAuth(req)
      if (!session) return errorResponse('Unauthorized', 401, req)

      const taskId = path.split('/')[3]
      const task = store.getTask(taskId)
      if (!task) return errorResponse('Task not found', 404, req)

      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(':ok\n\n'))
          // Send existing events
          const events = store.listEvents(taskId, 200)
          for (const evt of events) {
            const payload = `id: ${evt.id}\nevent: ${evt.event_type}\ndata: ${JSON.stringify(evt)}\n\n`
            controller.enqueue(encoder.encode(payload))
          }
          // Register for live updates — bridge ReadableStream controller to SSEManager's ServerResponse interface
          const mockRes = {
            write: (data: string | Buffer) => {
              controller.enqueue(typeof data === 'string' ? encoder.encode(data) : data)
            },
            on: () => {},
            writeHead: () => {},
          } as any
          sse.addClient(taskId, mockRes)
        },
      })

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          ...securityHeaders(),
        },
      })
    }

    // ── Static: serve remote.html dashboard ──

    if ((path === '/' || path === '/remote' || path === '/remote.html') && method === 'GET') {
      const indexPath = resolve(PUBLIC_DIR, 'remote.html')
      if (existsSync(indexPath)) {
        const content = readFileSync(indexPath, 'utf-8')
        logRequest(method, path, 200, ip)
        return html(content, req)
      }
      logRequest(method, path, 404, ip)
      return errorResponse('Dashboard not found', 404, req)
    }

    // ── Static files from public dir ──

    if (path.startsWith('/static/') || path.startsWith('/assets/')) {
      const filePath = resolve(PUBLIC_DIR, path.slice(1))
      if (!filePath.startsWith(PUBLIC_DIR)) {
        logRequest(method, path, 403, ip)
        return errorResponse('Forbidden', 403, req)
      }
      if (existsSync(filePath)) {
        const ext = extname(filePath)
        const contentType = MIME[ext] ?? 'application/octet-stream'
        const content = readFileSync(filePath)
        logRequest(method, path, 200, ip)
        return new Response(content, {
          status: 200,
          headers: { 'Content-Type': contentType, ...securityHeaders() },
        })
      }
    }

    // ── Health check ──

    if (path === '/api/health' && method === 'GET') {
      logRequest(method, path, 200, ip)
      return json({
        ok: true,
        status: 'healthy',
        uptime: process.uptime(),
        worker: worker.status(),
        timestamp: new Date().toISOString(),
      }, 200, req)
    }

    // ── CSRF token endpoint ──

    if (path === '/api/csrf-token' && method === 'GET') {
      const session = requireAuth(req)
      if (!session) return errorResponse('Unauthorized', 401, req)
      const token = generateCsrfToken(CSRF_SECRET)
      logRequest(method, path, 200, ip)
      return json({ ok: true, token }, 200, req)
    }

    // ── Login (auth required mode) ──

    if (path === '/api/login' && method === 'POST') {
      try {
        const body = (await req.json()) as { password?: string }
        if (!body.password) return errorResponse('Password required', 400, req)
        const expected = process.env.REMOTE_PASSWORD ?? 'opencode'
        if (body.password !== expected) {
          auditLog('login_failed', null, 'Invalid password', undefined, ip)
          return errorResponse('Invalid credentials', 401, req)
        }
        const token = createSession('operator', 'admin')
        auditLog('login_success', { userId: 'operator', role: 'admin', createdAt: Date.now() }, 'Login', undefined, ip)
        return json({ ok: true, token }, 200, req)
      } catch {
        return errorResponse('Invalid request body', 400, req)
      }
    }

    // ── Logout ──

    if (path === '/api/logout' && method === 'POST') {
      const cookie = req.headers.get('cookie') ?? ''
      const match = cookie.match(/rc_session=([a-f0-9-]+)/)
      if (match) sessions.delete(match[1])
      logRequest(method, path, 200, ip)
      return json({ ok: true }, 200, req)
    }

    // ── Read-only GET routes ──

    if (method === 'GET') {
      // Remote control status
      if (path === '/api/remote-control/status') {
        const session = requireAuth(req)
        if (!session) return errorResponse('Unauthorized', 401, req)
        const ws = worker.status()
        const queued = store.listTasks({ status: 'queued', limit: 100 }).length
        const running = store.listTasks({ status: 'running', limit: 100 }).length
        const pendingApprovals = store.pendingApprovals().length
        logRequest(method, path, 200, ip)
        return json({
          ok: true,
          data: {
            worker: ws,
            counts: { queued, running, pendingApprovals },
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
          },
        }, 200, req)
      }

      // List tasks (paginated)
      if (path === '/api/tasks') {
        const session = requireAuth(req)
        if (!session) return errorResponse('Unauthorized', 401, req)
        const status = url.searchParams.get('status') ?? undefined
        const project = url.searchParams.get('project') ?? undefined
        const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200)
        const offset = parseInt(url.searchParams.get('offset') ?? '0')
        const tasks = store.listTasks({ status, project, limit, offset })
        logRequest(method, path, 200, ip)
        return json({ ok: true, data: tasks, limit, offset }, 200, req)
      }

      // Get task details
      if (path.match(/^\/api\/tasks\/[^/]+$/) && !path.includes('/events') && !path.includes('/artifacts')) {
        const session = requireAuth(req)
        if (!session) return errorResponse('Unauthorized', 401, req)
        const taskId = path.split('/')[3]
        const task = store.getTask(taskId)
        if (!task) return errorResponse('Task not found', 404, req)
        const events = store.listEvents(taskId, 100)
        logRequest(method, path, 200, ip)
        return json({ ok: true, data: { ...task, events } }, 200, req)
      }

      // Task artifacts
      if (path.match(/^\/api\/tasks\/[^/]+\/artifacts$/)) {
        const session = requireAuth(req)
        if (!session) return errorResponse('Unauthorized', 401, req)
        const taskId = path.split('/')[3]
        const task = store.getTask(taskId)
        if (!task) return errorResponse('Task not found', 404, req)
        const artifacts = store.listEvents(taskId, 100) // Using events as placeholder
        logRequest(method, path, 200, ip)
        return json({ ok: true, data: artifacts }, 200, req)
      }

      // List pending approvals
      if (path === '/api/approvals') {
        const session = requireAuth(req)
        if (!session) return errorResponse('Unauthorized', 401, req)
        const taskId = url.searchParams.get('task_id') ?? undefined
        store.expireStaleApprovals()
        const approvals = taskId ? store.pendingApprovals(taskId) : store.pendingApprovals()
        logRequest(method, path, 200, ip)
        return json({ ok: true, data: approvals }, 200, req)
      }

      // List allowed projects
      if (path === '/api/projects') {
        const session = requireAuth(req)
        if (!session) return errorResponse('Unauthorized', 401, req)
        logRequest(method, path, 200, ip)
        return json({
          ok: true,
          data: [
            { id: '/root/projekt/akm-bridge', name: 'AKM Bridge' },
            { id: '/root/projekt/strategikon', name: 'Strategikon' },
          ],
        }, 200, req)
      }
    }

    // ── Write POST routes ──

    if (method === 'POST') {
      const session = requireAuth(req)
      if (!session) return errorResponse('Unauthorized', 401, req)

      // CSRF check — skip for notification POST paths (handled by notification-api.ts)
      if (!path.startsWith('/api/notifications/')) {
        const csrf = validateCsrf(req)
        if (!csrf.valid) {
          auditLog('csrf_rejected', session, csrf.error ?? 'Invalid CSRF', undefined, ip)
          return errorResponse(csrf.error ?? 'CSRF validation failed', 403, req)
        }
      }

      // Rate limit writes
      if (isWriteRateLimited(ip)) {
        return errorResponse('Rate limit exceeded', 429, req)
      }

      // Create task
      if (path === '/api/tasks') {
        try {
          const body = (await req.json()) as {
            project?: string
            agent?: string
            command?: string
            prompt_summary?: string
            full_prompt?: string
            priority?: string
            idempotency_key?: string
            dry_run?: boolean
            read_only?: boolean
          }

          // Idempotency check
          if (body.idempotency_key) {
            const idempotency = checkIdempotency(body.idempotency_key)
            if (idempotency.duplicate && idempotency.existingTaskId) {
              const existing = store.getTask(idempotency.existingTaskId)
              if (existing) {
                return json({ ok: true, data: existing, duplicate: true }, 200, req)
              }
            }
          }

          const validation = validateTask({
            project: body.project ?? '',
            agent: body.agent,
            cmd: body.command,
            prompt_summary: body.prompt_summary ?? '',
            full_prompt: body.full_prompt,
            created_by: session.userId,
            idempotency_key: body.idempotency_key,
          })

          if (!validation.valid) {
            return errorResponse(
              `Validation failed: ${validation.errors.join('; ')}`,
              400,
              req
            )
          }

          const taskId = randomUUID()
          const task = store.createTask({
            id: taskId,
            project: body.project!,
            agent: body.agent,
            command: body.command,
            prompt_summary: body.prompt_summary!,
            full_prompt: body.full_prompt,
            priority: body.priority ?? 'normal',
            created_by: session.userId,
            idempotency_key: body.idempotency_key,
            project_lock: body.project,
          })

          if (body.idempotency_key) {
            registerIdempotencyKey(body.idempotency_key, taskId)
          }

          store.addEvent(taskId, 'task_created', `Task created by ${session.userId}`)
          store.audit({
            action: 'task_created',
            session_id: session.userId,
            task_id: taskId,
            detail: `Project: ${body.project}, Agent: ${body.agent ?? 'default'}`,
            ip_address: ip,
          })

          broadcastGlobal('task_created', { taskId, project: body.project })
          logRequest(method, path, 201, ip)
          return json({ ok: true, data: task }, 201, req)
        } catch (err: any) {
          return errorResponse(err.message ?? 'Failed to create task', 400, req)
        }
      }

      // Cancel task
      if (path.match(/^\/api\/tasks\/[^/]+\/cancel$/)) {
        const taskId = path.split('/')[3]
        const task = store.getTask(taskId)
        if (!task) return errorResponse('Task not found', 404, req)
        if (task.status !== 'queued' && task.status !== 'running') {
          return errorResponse(`Cannot cancel task in status: ${task.status}`, 400, req)
        }
        const cancelled = await worker.cancel(taskId)
        store.audit({
          action: 'task_cancelled',
          session_id: session.userId,
          task_id: taskId,
          detail: `Status was: ${task.status}`,
          ip_address: ip,
        })
        broadcastGlobal('task_cancelled', { taskId })
        logRequest(method, path, 200, ip)
        return json({ ok: true, cancelled }, 200, req)
      }

      // Retry task
      if (path.match(/^\/api\/tasks\/[^/]+\/retry$/)) {
        const taskId = path.split('/')[3]
        const task = store.getTask(taskId)
        if (!task) return errorResponse('Task not found', 404, req)
        if (task.status !== 'failed' && task.status !== 'cancelled') {
          return errorResponse(`Cannot retry task in status: ${task.status}`, 400, req)
        }

        const newTaskId = randomUUID()
        const newTask = store.createTask({
          id: newTaskId,
          project: task.project,
          agent: task.agent ?? undefined,
          command: task.command ?? undefined,
          prompt_summary: task.prompt_summary,
          full_prompt: task.full_prompt ?? undefined,
          priority: task.priority,
          created_by: session.userId,
          project_lock: task.project_lock ?? task.project,
        })

        store.addEvent(newTaskId, 'task_created', `Retry of task ${taskId}`)
        store.audit({
          action: 'task_retried',
          session_id: session.userId,
          task_id: newTaskId,
          detail: `Original task: ${taskId}`,
          ip_address: ip,
        })

        broadcastGlobal('task_created', { taskId: newTaskId, retryOf: taskId })
        logRequest(method, path, 201, ip)
        return json({ ok: true, data: newTask, retry_of: taskId }, 201, req)
      }

      // Approve approval
      if (path.match(/^\/api\/approvals\/[^/]+\/approve$/)) {
        const approvalId = path.split('/')[3]
        try {
          const result = await approvalManager.approve(approvalId, session.userId)
          broadcastGlobal('approval_granted', { approvalId, taskId: result.approvalId })
          logRequest(method, path, 200, ip)
          return json({ ok: true, data: result }, 200, req)
        } catch (err: any) {
          return errorResponse(err.message, 400, req)
        }
      }

      // Reject approval
      if (path.match(/^\/api\/approvals\/[^/]+\/reject$/)) {
        const approvalId = path.split('/')[3]
        try {
          const result = approvalManager.reject(approvalId, session.userId)
          broadcastGlobal('approval_rejected', { approvalId, taskId: result.approvalId })
          logRequest(method, path, 200, ip)
          return json({ ok: true, data: result }, 200, req)
        } catch (err: any) {
          return errorResponse(err.message, 400, req)
        }
      }
    }

    // ── Schedule Routes ──────────────────────────────────────────────────────────
    // GET    /api/schedules                  - list schedules (paginated, filtered)
    // POST   /api/schedules                  - create schedule
    // GET    /api/schedules/:id              - get schedule details
    // PUT    /api/schedules/:id              - update schedule
    // DELETE /api/schedules/:id              - soft-delete schedule
    // POST   /api/schedules/:id/pause        - pause schedule
    // POST   /api/schedules/:id/resume       - resume schedule
    // POST   /api/schedules/:id/run-now      - trigger immediate execution
    // GET    /api/schedules/:id/history      - execution history
    // GET    /api/scheduler/status           - scheduler engine status

    // ── Schedule: GET list / scheduler status ──

    if (method === 'GET') {
      // Scheduler engine status
      if (path === '/api/scheduler/status') {
        const session = requireAuth(req)
        if (!session) return errorResponse('Unauthorized', 401, req)
        logRequest(method, path, 200, ip)
        return json({
          ok: true,
          data: {
            running: true,
            uptime: process.uptime(),
            tickInterval: parseInt(process.env.TICK_INTERVAL ?? '30'),
            timestamp: new Date().toISOString(),
          },
        }, 200, req)
      }

      // List schedules (paginated, filtered)
      if (path === '/api/schedules') {
        const session = requireAuth(req)
        if (!session) return errorResponse('Unauthorized', 401, req)
        const status = url.searchParams.get('status') ?? undefined
        const project = url.searchParams.get('project') ?? undefined
        const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200)
        const offset = parseInt(url.searchParams.get('offset') ?? '0')
        try {
          const { listSchedules } = await import('../scheduler/schedule-api.js')
          const schedules = listSchedules({ status, project, limit, offset })
          logRequest(method, path, 200, ip)
          return json({ ok: true, data: schedules, limit, offset }, 200, req)
        } catch (err: any) {
          logRequest(method, path, 500, ip)
          return errorResponse(err.message ?? 'Failed to list schedules', 500, req)
        }
      }

      // Get schedule details
      if (path.match(/^\/api\/schemas\/[^/]+$/) || path.match(/^\/api\/schedules\/[^/]+$/)) {
        const session = requireAuth(req)
        if (!session) return errorResponse('Unauthorized', 401, req)
        const scheduleId = path.split('/')[3]
        try {
          const { getSchedule } = await import('../scheduler/schedule-api.js')
          const schedule = getSchedule(scheduleId)
          if (!schedule) return errorResponse('Schedule not found', 404, req)
          logRequest(method, path, 200, ip)
          return json({ ok: true, data: schedule }, 200, req)
        } catch (err: any) {
          logRequest(method, path, 500, ip)
          return errorResponse(err.message ?? 'Failed to get schedule', 500, req)
        }
      }

      // Schedule execution history
      if (path.match(/^\/api\/schedules\/[^/]+\/history$/)) {
        const session = requireAuth(req)
        if (!session) return errorResponse('Unauthorized', 401, req)
        const scheduleId = path.split('/')[3]
        const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100)
        try {
          const { getHistory } = await import('../scheduler/schedule-api.js')
          const history = getHistory(scheduleId, limit)
          logRequest(method, path, 200, ip)
          return json({ ok: true, data: history }, 200, req)
        } catch (err: any) {
          logRequest(method, path, 500, ip)
          return errorResponse(err.message ?? 'Failed to get history', 500, req)
        }
      }
    }

    // ── Schedule: POST create ──

    if (method === 'POST' && path === '/api/schedules') {
      const session = requireAuth(req)
      if (!session) return errorResponse('Unauthorized', 401, req)

      const csrf = validateCsrf(req)
      if (!csrf.valid) {
        auditLog('csrf_rejected', session, csrf.error ?? 'Invalid CSRF', undefined, ip)
        return errorResponse(csrf.error ?? 'CSRF validation failed', 403, req)
      }
      if (isWriteRateLimited(ip)) {
        return errorResponse('Rate limit exceeded', 429, req)
      }

      try {
        const body = (await req.json()) as Record<string, unknown>
        const { createSchedule } = await import('../scheduler/schedule-api.js')
        const result = createSchedule({
          name: String(body.name ?? ''),
          project: String(body.project ?? ''),
          agent: body.agent ? String(body.agent) : undefined,
          command: body.command ? String(body.command) : undefined,
          prompt_template: String(body.prompt_template ?? ''),
          schedule_type: body.schedule_type as 'once' | 'interval' | 'cron',
          schedule_expression: String(body.schedule_expression ?? ''),
          timezone: String(body.timezone ?? 'Europe/Warsaw'),
          read_only: body.read_only !== false,
          approval_policy: body.approval_policy as string ?? 'never_write',
          priority: body.priority as string ?? 'normal',
          max_duration_seconds: body.max_duration_seconds as number,
          max_input_tokens: body.max_input_tokens as number,
          max_output_tokens: body.max_output_tokens as number,
          max_tool_calls: body.max_tool_calls as number,
          max_runs_per_day: body.max_runs_per_day as number,
          max_cost_estimate: body.max_cost_estimate as number,
          retry_max_attempts: body.retry_max_attempts as number,
          retry_on: body.retry_on as string[],
          misfire_policy: body.misfire_policy as string ?? 'skip',
          concurrency_policy: body.concurrency_policy as string ?? 'skip',
          maintenance_window_start: body.maintenance_window_start ? String(body.maintenance_window_start) : undefined,
          maintenance_window_end: body.maintenance_window_end ? String(body.maintenance_window_end) : undefined,
          created_by: session.userId,
        })

        if (result.errors.length) {
          return errorResponse(`Validation: ${result.errors.join('; ')}`, 400, req)
        }

        auditLog('schedule_created', session, `Schedule: ${result.schedule.name}`, result.schedule.id, ip)
        broadcastGlobal('schedule_created', { scheduleId: result.schedule.id, name: result.schedule.name })
        logRequest(method, path, 201, ip)
        return json({ ok: true, data: result.schedule }, 201, req)
      } catch (err: any) {
        return errorResponse(err.message ?? 'Failed to create schedule', 400, req)
      }
    }

    // ── Schedule: POST actions (pause/resume/run-now) ──

    if (method === 'POST' && path.match(/^\/api\/schedules\/[^/]+\/(pause|resume|run-now)$/)) {
      const session = requireAuth(req)
      if (!session) return errorResponse('Unauthorized', 401, req)

      const csrf = validateCsrf(req)
      if (!csrf.valid) {
        auditLog('csrf_rejected', session, csrf.error ?? 'Invalid CSRF', undefined, ip)
        return errorResponse(csrf.error ?? 'CSRF validation failed', 403, req)
      }
      if (isWriteRateLimited(ip)) {
        return errorResponse('Rate limit exceeded', 429, req)
      }

      const scheduleId = path.split('/')[3]
      const action = path.split('/')[4] as 'pause' | 'resume' | 'run-now'

      try {
        const { pauseSchedule, resumeSchedule, runNow } = await import('../scheduler/schedule-api.js')
        let result: unknown

        if (action === 'pause') {
          result = pauseSchedule(scheduleId)
        } else if (action === 'resume') {
          result = resumeSchedule(scheduleId)
        } else if (action === 'run-now') {
          result = runNow(scheduleId)
        }

        auditLog(`schedule_${action.replace('-', '_')}`, session, `Schedule: ${scheduleId}`, scheduleId, ip)
        broadcastGlobal(`schedule_${action.replace('-', '_')}`, { scheduleId })
        logRequest(method, path, 200, ip)
        return json({ ok: true, data: result }, 200, req)
      } catch (err: any) {
        return errorResponse(err.message ?? `Failed to ${action} schedule`, 400, req)
      }
    }

    // ── Schedule: PUT update ──

    if (method === 'PUT' && path.match(/^\/api\/schedules\/[^/]+$/)) {
      const session = requireAuth(req)
      if (!session) return errorResponse('Unauthorized', 401, req)

      const csrf = validateCsrf(req)
      if (!csrf.valid) {
        auditLog('csrf_rejected', session, csrf.error ?? 'Invalid CSRF', undefined, ip)
        return errorResponse(csrf.error ?? 'CSRF validation failed', 403, req)
      }
      if (isWriteRateLimited(ip)) {
        return errorResponse('Rate limit exceeded', 429, req)
      }

      const scheduleId = path.split('/')[3]
      try {
        const body = (await req.json()) as Record<string, unknown>
        const { updateSchedule } = await import('../scheduler/schedule-api.js')
        const result = updateSchedule(scheduleId, body as any)

        if (result.errors.length) {
          return errorResponse(`Validation: ${result.errors.join('; ')}`, 400, req)
        }
        if (!result.schedule) {
          return errorResponse('Schedule not found', 404, req)
        }

        auditLog('schedule_updated', session, `Schedule: ${scheduleId}`, scheduleId, ip)
        broadcastGlobal('schedule_updated', { scheduleId })
        logRequest(method, path, 200, ip)
        return json({ ok: true, data: result.schedule }, 200, req)
      } catch (err: any) {
        return errorResponse(err.message ?? 'Failed to update schedule', 400, req)
      }
    }

    // ── Schedule: DELETE soft-delete ──

    if (method === 'DELETE' && path.match(/^\/api\/schedules\/[^/]+$/)) {
      const session = requireAuth(req)
      if (!session) return errorResponse('Unauthorized', 401, req)

      const csrf = validateCsrf(req)
      if (!csrf.valid) {
        auditLog('csrf_rejected', session, csrf.error ?? 'Invalid CSRF', undefined, ip)
        return errorResponse(csrf.error ?? 'CSRF validation failed', 403, req)
      }
      if (isWriteRateLimited(ip)) {
        return errorResponse('Rate limit exceeded', 429, req)
      }

      const scheduleId = path.split('/')[3]
      try {
        const { deleteSchedule } = await import('../scheduler/schedule-api.js')
        const deleted = deleteSchedule(scheduleId)
        if (!deleted) return errorResponse('Schedule not found', 404, req)

        auditLog('schedule_deleted', session, `Schedule: ${scheduleId}`, scheduleId, ip)
        broadcastGlobal('schedule_deleted', { scheduleId })
        logRequest(method, path, 200, ip)
        return json({ ok: true, deleted: true }, 200, req)
      } catch (err: any) {
        return errorResponse(err.message ?? 'Failed to delete schedule', 400, req)
      }
    }

    // ── Notification Routes ──────────────────────────────────────────────────────
    // GET    /api/notifications              - list notifications
    // GET    /api/notifications/preferences  - get preferences
    // PUT    /api/notifications/preferences  - update preferences
    // GET    /api/notifications/channels     - channel health
    // POST   /api/notifications/test         - send test notification
    // GET    /api/notifications/deliveries   - get delivery history
    // POST   /api/notifications/:id/acknowledge - acknowledge
    // GET    /api/notifications/status       - full status

    if (method === 'GET' && path === '/api/notifications/overview') {
      return handleGetOverview(req, ip)
    }
    if (method === 'GET' && path === '/api/notifications') {
      return handleGetNotifications(req, url, ip)
    }
    if (method === 'GET' && path === '/api/notifications/preferences') {
      return handleGetPreferences(req, ip)
    }
    if (method === 'PUT' && path === '/api/notifications/preferences') {
      return handlePutPreferences(req, ip)
    }
    if (method === 'GET' && path === '/api/notifications/channels') {
      return handleGetChannels(req, ip)
    }
    if (method === 'POST' && path === '/api/notifications/test') {
      return handlePostTest(req, ip)
    }
    if (method === 'GET' && path === '/api/notifications/deliveries') {
      return handleGetDeliveries(req, url, ip)
    }
    if (method === 'POST' && path.match(/^\/api\/notifications\/[^/]+\/acknowledge$/)) {
      return handlePostAcknowledge(req, url, ip)
    }
    if (method === 'GET' && path === '/api/notifications/status') {
      return handleGetStatus(req, ip)
    }

    // Fallback
    logRequest(method, path, 404, ip)
    return errorResponse('Not found', 404, req)
  },
})

process.stderr.write(`[remote-control] OpenCode Remote Control listening on ${HOST}:${PORT}\n`)
process.stderr.write(`[remote-control] CSRF protection: enabled\n`)
process.stderr.write(`[remote-control] Auth required: ${AUTH_REQUIRED}\n`)
process.stderr.write(`[remote-control] Public dir: ${PUBLIC_DIR}\n`)

/* ── Graceful shutdown ── */

process.on('SIGINT', () => {
  process.stderr.write('[remote-control] Shutting down...\n')
  worker.stop()
  sse.closeAll()
  store.close()
  server.stop()
  process.exit(0)
})

process.on('SIGTERM', () => {
  process.stderr.write('[remote-control] SIGTERM received\n')
  worker.stop()
  sse.closeAll()
  store.close()
  server.stop()
  process.exit(0)
})
