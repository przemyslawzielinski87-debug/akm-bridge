/**
 * OpenCode Operations Dashboard — HTTP Server
 *
 * Lightweight Bun.serve-based API server. Read-only, CORS-restricted,
 * security headers, rate limiting, cache with configurable TTL.
 *
 * Usage:
 *   bun run src/dashboard/server.ts
 *   PORT=4200 HOST=127.0.0.1 bun run src/dashboard/server.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectDashboardData } from '../../scripts/opencode-dashboard-data.js'
import type { DashboardData, DashboardConfig } from './dashboard-types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PUBLIC_DIR = resolve(__dirname, 'public')

/* ── Config ── */

const config: DashboardConfig = {
  port: parseInt(process.env.DASHBOARD_PORT ?? '4200'),
  host: process.env.DASHBOARD_HOST ?? '127.0.0.1',
  cacheTTL: parseInt(process.env.DASHBOARD_CACHE_TTL ?? '30'),
  authRequired: process.env.DASHBOARD_AUTH === 'true',
}

/* ── Cache ── */

let cache: { data: DashboardData; ts: number } | null = null

function getCachedData(): DashboardData {
  const now = Date.now()
  if (cache && (now - cache.ts) < config.cacheTTL * 1000) {
    return cache.data
  }
  const data = collectDashboardData()
  cache = { data, ts: now }
  return data
}

function invalidateCache(): void {
  cache = null
}

/* ── Rate limiter ── */

const rateLimits = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW = 60_000
const RATE_LIMIT_MAX = 120

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimits.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT_MAX
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(ip)
  }
}, 300_000)

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
    origin === `http://${config.host}:${config.port}`
  )
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin || !isAllowedOrigin(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
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
}

/* ── Helpers ── */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...securityHeaders(),
    },
  })
}

function html(content: string): Response {
  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...securityHeaders(),
      'Cache-Control': 'no-cache',
    },
  })
}

function wrapResponse(data: unknown, req: Request): Response {
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin)
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...securityHeaders(),
      ...cors,
    },
  })
}

function errorResponse(message: string, status = 500): Response {
  return json({ ok: false, error: message, timestamp: new Date().toISOString() }, status)
}

function extractSection(data: DashboardData, section: string): unknown {
  const map: Record<string, () => unknown> = {
    overview: () => ({
      status: data.overall.status,
      summary: data.overall.summary,
      schemaVersion: data.schemaVersion,
      generatedAt: data.generatedAt,
      components: data.overall.details,
      alertCount: data.alerts.length,
    }),
    agents: () => data.agents,
    commands: () => data.commands,
    skills: () => data.skills,
    mcp: () => data.mcp,
    akm: () => data.akm,
    tokens: () => data.tokens,
    context: () => data.context,
    permissions: () => data.permissions,
    recovery: () => data.recovery,
    updates: () => data.updates,
    e2e: () => data.e2e,
    ci: () => data.ci,
    'disaster-recovery': () => data.disasterRecovery,
    learning: () => data.learning,
    system: () => data.system,
    alerts: () => data.alerts,
    events: () => data.events,
  }
  const fn = map[section]
  return fn ? fn() : null
}

/* ── Request logging (no secrets) ── */

function logRequest(method: string, path: string, status: number, ip: string): void {
  process.stderr.write(
    `[dashboard] ${new Date().toISOString()} ${method} ${path} ${status} ${ip}\n`
  )
}

/* ── Server ── */

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  maxRequestBodySize: 0,

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
        headers: {
          ...securityHeaders(),
          ...corsHeaders(origin),
        },
      })
    }

    // Only GET allowed
    if (method !== 'GET') {
      logRequest(method, path, 405, ip)
      return errorResponse('Method not allowed', 405)
    }

    // Rate limit
    if (isRateLimited(ip)) {
      logRequest(method, path, 429, ip)
      return errorResponse('Rate limit exceeded', 429)
    }

    // Origin check
    const origin = req.headers.get('origin')
    if (origin && !isAllowedOrigin(origin)) {
      logRequest(method, path, 403, ip)
      return errorResponse('Cross-origin request denied', 403)
    }

    // ── Routes ──

    try {
      // Static HTML dashboard
      if (path === '/' || path === '/index.html') {
        const indexPath = resolve(PUBLIC_DIR, 'index.html')
        if (existsSync(indexPath)) {
          const content = readFileSync(indexPath, 'utf-8')
          logRequest(method, path, 200, ip)
          return html(content)
        }
        logRequest(method, path, 404, ip)
        return errorResponse('Dashboard not found', 404)
      }

      // Health check
      if (path === '/api/health') {
        logRequest(method, path, 200, ip)
        return wrapResponse({
          ok: true,
          status: 'healthy',
          uptime: process.uptime(),
          cacheTTL: config.cacheTTL,
          timestamp: new Date().toISOString(),
        }, req)
      }

      // Cache invalidation
      if (path === '/api/dashboard/cache/invalidate') {
        invalidateCache()
        logRequest(method, path, 200, ip)
        return wrapResponse({ ok: true, message: 'Cache invalidated' }, req)
      }

      // Dashboard API endpoints
      if (path.startsWith('/api/dashboard/')) {
        const section = path.slice('/api/dashboard/'.length).replace(/\/$/, '')
        const data = getCachedData()
        const sectionData = extractSection(data, section)

        if (sectionData === null) {
          logRequest(method, path, 404, ip)
          return errorResponse(`Unknown section: ${section}`, 404)
        }

        logRequest(method, path, 200, ip)
        return wrapResponse({
          ok: true,
          schemaVersion: data.schemaVersion,
          generatedAt: data.generatedAt,
          stale: isStale(data.generatedAt, config.cacheTTL),
          data: sectionData,
        }, req)
      }

      // Static files from public dir
      if (path.startsWith('/static/') || path.startsWith('/assets/')) {
        const filePath = resolve(PUBLIC_DIR, path.slice(1))
        if (!filePath.startsWith(PUBLIC_DIR)) {
          logRequest(method, path, 403, ip)
          return errorResponse('Forbidden', 403)
        }
        if (existsSync(filePath)) {
          const ext = extname(filePath)
          const contentType = MIME[ext] ?? 'application/octet-stream'
          const content = readFileSync(filePath)
          logRequest(method, path, 200, ip)
          return new Response(content, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              ...securityHeaders(),
            },
          })
        }
        logRequest(method, path, 404, ip)
        return errorResponse('Not found', 404)
      }

      logRequest(method, path, 404, ip)
      return errorResponse('Not found', 404)

    } catch (err: any) {
      logRequest(method, path, 500, ip)
      return errorResponse(err.message ?? 'Internal server error', 500)
    }
  },
})

function isStale(generatedAt: string, ttl: number): boolean {
  const age = (Date.now() - new Date(generatedAt).getTime()) / 1000
  return age > ttl * 2
}

process.stderr.write(`[dashboard] OpenCode Ops Dashboard listening on ${config.host}:${config.port}\n`)
process.stderr.write(`[dashboard] Cache TTL: ${config.cacheTTL}s\n`)
process.stderr.write(`[dashboard] Public dir: ${PUBLIC_DIR}\n`)
