import type { ServerResponse } from 'node:http'

// ── Types ───────────────────────────────────────────────────────────────────

export interface SSEEvent {
  type: string
  taskId: string
  [key: string]: unknown
}

interface ClientConnection {
  res: ServerResponse
  taskId: string
  connectedAt: number
  lastEventId: number
}

// ── Redaction ───────────────────────────────────────────────────────────────

const REDACT_KEYS = ['full_prompt', 'token', 'secret', 'password', 'api_key']

function redactEvent(event: SSEEvent): SSEEvent {
  const copy = { ...event }
  for (const key of REDACT_KEYS) {
    if (key in copy) {
      ;(copy as Record<string, unknown>)[key] = '[REDACTED]'
    }
  }
  return copy
}

// ── SSE Manager ─────────────────────────────────────────────────────────────

export class SSEManager {
  private clients = new Map<string, ClientConnection[]>()
  private eventCounter = 0
  private rateLimiter = new Map<string, number[]>()

  constructor(private rateLimitWindowMs = 60_000, private rateLimitMax = 30) {}

  addClient(taskId: string, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    res.write(':ok\n\n')

    const conn: ClientConnection = {
      res,
      taskId,
      connectedAt: Date.now(),
      lastEventId: 0,
    }

    const existing = this.clients.get(taskId) ?? []
    existing.push(conn)
    this.clients.set(taskId, existing)

    res.on('close', () => {
      this.removeClient(taskId, conn)
    })
  }

  send(taskId: string, event: SSEEvent): void {
    const conns = this.clients.get(taskId)
    if (!conns || conns.length === 0) return

    const redacted = redactEvent(event)
    const eventId = ++this.eventCounter
    const data = JSON.stringify(redacted)

    const payload = [
      `id: ${eventId}`,
      `event: ${event.type}`,
      `data: ${data}`,
      '',
      '',
    ].join('\n')

    const dead: ClientConnection[] = []

    for (const conn of conns) {
      try {
        conn.res.write(payload)
        conn.lastEventId = eventId
      } catch {
        dead.push(conn)
      }
    }

    for (const conn of dead) {
      this.removeClient(taskId, conn)
    }
  }

  broadcast(event: SSEEvent): void {
    for (const taskId of this.clients.keys()) {
      this.send(taskId, event)
    }
  }

  sendRetry(taskId: string, lastEventId: number): void {
    const conns = this.clients.get(taskId)
    if (!conns) return

    for (const conn of conns) {
      if (conn.lastEventId < lastEventId) {
        try {
          conn.res.write(`retry: 3000\n\n`)
        } catch {
          this.removeClient(taskId, conn)
        }
      }
    }
  }

  isRateLimited(clientIp: string): boolean {
    const now = Date.now()
    const timestamps = this.rateLimiter.get(clientIp) ?? []
    const recent = timestamps.filter((t) => now - t < this.rateLimitWindowMs)

    if (recent.length >= this.rateLimitMax) return true

    recent.push(now)
    this.rateLimiter.set(clientIp, recent)
    return false
  }

  connectionCount(taskId: string): number {
    return this.clients.get(taskId)?.length ?? 0
  }

  totalConnections(): number {
    let total = 0
    for (const conns of this.clients.values()) {
      total += conns.length
    }
    return total
  }

  closeAll(): void {
    for (const [taskId, conns] of this.clients) {
      for (const conn of conns) {
        try {
          conn.res.end()
        } catch {
          // ignore
        }
      }
      this.clients.delete(taskId)
    }
  }

  // ── Internals ──────────────────────────────────────────────────────

  private removeClient(taskId: string, conn: ClientConnection): void {
    const conns = this.clients.get(taskId)
    if (!conns) return

    const idx = conns.indexOf(conn)
    if (idx >= 0) conns.splice(idx, 1)

    if (conns.length === 0) this.clients.delete(taskId)
  }
}
