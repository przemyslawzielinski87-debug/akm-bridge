import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// ── Types ───────────────────────────────────────────────────────────────────

export interface ExecutionResult {
  sessionId: string
  status: 'completed' | 'failed' | 'cancelled'
  output: string
  summary: string
  toolCalls: ToolCallSummary[]
  tokenUsage: { input: number; output: number; cached: number }
  permissionRequests: PermissionRequest[]
  error?: string
}

export interface ToolCallSummary {
  tool: string
  status: 'success' | 'failed'
  summary: string
  duration_ms: number
}

export interface PermissionRequest {
  id: string
  tool: string
  operationClass: string
  summary: string
  risk: string
}

interface AdapterOptions {
  opencodeBin?: string
  serverUrl?: string
  timeoutMs?: number
}

// ── Redaction ───────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /(?:password|secret|token|api[_-]?key|credential)\s*[:=]\s*["']?[^\s"']+/gi,
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/g,
  /(?:sk|pk)[-_][A-Za-z0-9]{20,}/g,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /(?:0x)?[A-Fa-f0-9]{64}/g,
]

function redact(text: string): string {
  let result = text
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (m) => {
      const parts = m.split(/[:=]/)
      if (parts.length >= 2) {
        return `${parts[0]}${parts[1]}[REDACTED]`
      }
      return '[REDACTED]'
    })
  }
  return result
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export class OpenCodeExecutionAdapter {
  private bin: string
  private serverUrl: string
  private timeoutMs: number
  private sessions = new Map<string, ChildProcess>()

  constructor(opts: AdapterOptions = {}) {
    this.bin = opts.opencodeBin ?? 'opencode'
    this.serverUrl = opts.serverUrl ?? 'http://127.0.0.1:4096'
    this.timeoutMs = opts.timeoutMs ?? 300_000
  }

  async listSessions(): Promise<Array<{ id: string; name: string; status: string }>> {
    const out = await this.runCommand(['session', 'list', '--format', 'json'])
    try {
      return JSON.parse(out)
    } catch {
      return []
    }
  }

  async attachOrCreateSession(
    sessionId?: string
  ): Promise<string> {
    if (sessionId) return sessionId

    const sessions = await this.listSessions()
    const existing = sessions.find((s) => s.status === 'active')
    if (existing) return existing.id

    return randomUUID()
  }

  async execute(opts: {
    prompt: string
    sessionId?: string
    project?: string
    timeoutMs?: number
    cancellationSignal?: AbortSignal
  }): Promise<ExecutionResult> {
    const sessionId = await this.attachOrCreateSession(opts.sessionId)
    const effectiveTimeout = opts.timeoutMs ?? this.timeoutMs

    const args = [
      'run',
      '--attach', this.serverUrl,
      '--session', sessionId,
      '--format', 'json',
    ]

    if (opts.project) {
      args.push('--project', opts.project)
    }

    args.push(opts.prompt)

    try {
      const output = await this.runCommandWithTimeout(
        args,
        effectiveTimeout,
        opts.cancellationSignal
      )
      return this.parseOutput(sessionId, output)
    } catch (err: unknown) {
      const isCancellation =
        err instanceof Error && err.name === 'AbortError'
      const isTimeout =
        err instanceof Error && err.message.includes('timeout')

      return {
        sessionId,
        status: isCancellation ? 'cancelled' : 'failed',
        output: '',
        summary: isCancellation
          ? 'Task cancelled by user'
          : isTimeout
            ? `Execution timed out after ${effectiveTimeout}ms`
            : `Execution failed: ${err instanceof Error ? err.message : String(err)}`,
        toolCalls: [],
        tokenUsage: { input: 0, output: 0, cached: 0 },
        permissionRequests: [],
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async exportSession(sessionId: string): Promise<string> {
    return this.runCommand(['export', sessionId, '--sanitize'])
  }

  async cancelExecution(sessionId: string): Promise<void> {
    const proc = this.sessions.get(sessionId)
    if (proc) {
      proc.kill('SIGTERM')
      this.sessions.delete(sessionId)
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private runCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' },
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout)
        } else {
          reject(new Error(`Exit ${code}: ${stderr.slice(0, 500)}`))
        }
      })

      proc.on('error', reject)
    })
  }

  private runCommandWithTimeout(
    args: string[],
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' },
      })

      let stdout = ''
      let stderr = ''
      let finished = false

      const timer = setTimeout(() => {
        if (!finished) {
          finished = true
          proc.kill('SIGTERM')
          reject(new Error(`Command timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)

      const onAbort = () => {
        if (!finished) {
          finished = true
          clearTimeout(timer)
          proc.kill('SIGTERM')
          const err = new Error('Cancelled')
          err.name = 'AbortError'
          reject(err)
        }
      }

      signal?.addEventListener('abort', onAbort)

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      proc.on('close', (code) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)

        if (code === 0) {
          resolve(stdout)
        } else {
          reject(new Error(`Exit ${code}: ${stderr.slice(0, 500)}`))
        }
      })

      proc.on('error', (err) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(err)
      })
    })
  }

  private parseOutput(sessionId: string, raw: string): ExecutionResult {
    const redacted = redact(raw)
    const toolCalls = this.extractToolCalls(redacted)
    const permissionRequests = this.extractPermissionRequests(redacted)
    const tokenUsage = this.extractTokenUsage(redacted)
    const summary = this.generateSummary(redacted, toolCalls)

    return {
      sessionId,
      status: 'completed',
      output: redacted,
      summary,
      toolCalls,
      tokenUsage,
      permissionRequests,
    }
  }

  private extractToolCalls(text: string): ToolCallSummary[] {
    const calls: ToolCallSummary[] = []
    const pattern = /Tool\s+(?:call|invocation):\s*(\w+).*?status[=:]\s*(success|failed|error)/gs
    let match: RegExpExecArray | null

    while ((match = pattern.exec(text)) !== null) {
      calls.push({
        tool: match[1],
        status: match[2] === 'success' ? 'success' : 'failed',
        summary: text.slice(match.index, Math.min(match.index + 120, text.length)).replace(/\n/g, ' ').trim(),
        duration_ms: 0,
      })
    }

    return calls
  }

  private extractPermissionRequests(text: string): PermissionRequest[] {
    const requests: PermissionRequest[] = []
    const pattern = /permission[_ ]request.*?tool[=:]\s*(\w+).*?class[=:]\s*(\w+)/gis
    let match: RegExpExecArray | null

    while ((match = pattern.exec(text)) !== null) {
      requests.push({
        id: randomUUID(),
        tool: match[1],
        operationClass: match[2],
        summary: text.slice(match.index, Math.min(match.index + 100, text.length)).replace(/\n/g, ' ').trim(),
        risk: 'medium',
      })
    }

    return requests
  }

  private extractTokenUsage(text: string): {
    input: number
    output: number
    cached: number
  } {
    const input = text.match(/(?:input|prompt)[_ ]tokens?[=:]\s*(\d+)/i)
    const output = text.match(/(?:output|completion)[_ ]tokens?[=:]\s*(\d+)/i)
    const cached = text.match(/(?:cached|cache)[_ ]tokens?[=:]\s*(\d+)/i)

    return {
      input: input ? parseInt(input[1], 10) : 0,
      output: output ? parseInt(output[1], 10) : 0,
      cached: cached ? parseInt(cached[1], 10) : 0,
    }
  }

  private generateSummary(text: string, toolCalls: ToolCallSummary[]): string {
    const lines = text.split('\n').filter((l) => l.trim().length > 0)
    const relevant = lines.slice(0, 5).join(' ').slice(0, 300)
    const toolCount = toolCalls.length
    const failed = toolCalls.filter((t) => t.status === 'failed').length

    let summary = relevant || 'Task completed'
    if (toolCount > 0) {
      summary += ` [${toolCount} tool call${toolCount > 1 ? 's' : ''}`
      if (failed > 0) summary += `, ${failed} failed`
      summary += ']'
    }

    return summary
  }
}
