/**
 * Schedule API — Pure functions wrapping the scheduler engine and store.
 *
 * No HTTP server, no Bun.serve. Pure request/response handlers.
 * All functions validate input, check allowlists, and never expose secrets.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DATA_DIR = resolve(__dirname, '../../data/scheduler')
const SCHEDULES_FILE = resolve(DATA_DIR, 'schedules.json')
const HISTORY_FILE = resolve(DATA_DIR, 'history.json')

/* ── Types ── */

export interface Schedule {
  id: string
  name: string
  project: string
  agent?: string
  command?: string
  prompt_template: string
  schedule_type: 'once' | 'interval' | 'cron'
  schedule_expression: string
  timezone: string
  read_only: boolean
  approval_policy: 'never_write' | 'per_run' | 'preapproved_limited'
  priority: string
  max_duration_seconds: number
  max_input_tokens: number
  max_output_tokens: number
  max_tool_calls: number
  max_runs_per_day: number
  max_cost_estimate: number
  retry_max_attempts: number
  retry_on: string[]
  misfire_policy: 'skip' | 'run_once' | 'catch_up_limited'
  concurrency_policy: 'skip' | 'queue' | 'replace'
  maintenance_window_start?: string
  maintenance_window_end?: string
  status: 'active' | 'paused' | 'deleted'
  created_by: string
  created_at: string
  updated_at: string
  last_run_at?: string
  last_run_status?: string
  next_run_at?: string
  runs_today: number
  consecutive_failures: number
}

export interface ScheduleRun {
  id: string
  schedule_id: string
  task_id?: string
  status: 'success' | 'failed' | 'skipped' | 'running'
  started_at: string
  finished_at?: string
  error?: string
  duration_ms?: number
  tokens_used?: number
}

export interface CreateScheduleInput {
  name: string
  project: string
  agent?: string
  command?: string
  prompt_template: string
  schedule_type: 'once' | 'interval' | 'cron'
  schedule_expression: string
  timezone?: string
  read_only?: boolean
  approval_policy?: string
  priority?: string
  max_duration_seconds?: number
  max_input_tokens?: number
  max_output_tokens?: number
  max_tool_calls?: number
  max_runs_per_day?: number
  max_cost_estimate?: number
  retry_max_attempts?: number
  retry_on?: string[]
  misfire_policy?: string
  concurrency_policy?: string
  maintenance_window_start?: string
  maintenance_window_end?: string
  created_by: string
}

export interface SchedulerStatus {
  running: boolean
  uptime: number
  tick_interval: number
  total_schedules: number
  active: number
  paused: number
  next_run: string | null
  recent_failures: number
}

/* ── Constants ── */

const ALLOWED_PROJECTS = [
  '/root/projekt/akm-bridge',
  '/root/projekt/strategikon',
]

const ALLOWED_AGENTS = [
  'akm-build', 'meridian-dev', 'infra-ops', 'reviewer',
  'security-auditor', 'release-manager', 'researcher',
]

const ALLOWED_COMMANDS = [
  'read', 'write', 'edit', 'search', 'execute',
  'review', 'deploy', 'test', 'build', 'analyze', 'research',
]

const MAX_SCHEDULES = 100
const MAX_NAME_LENGTH = 200
const MAX_PROMPT_LENGTH = 5000
const SECRET_PATTERNS = [
  /(?:password|secret|token|api[_-]?key|credential)\s*[:=]\s*["']?[^\s"']{8,}/gi,
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/g,
  /(?:sk|pk)[-_][A-Za-z-0-9]{20,}/g,
]

/* ── Data persistence ── */

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
}

function loadSchedules(): Schedule[] {
  ensureDataDir()
  if (!existsSync(SCHEDULES_FILE)) return []
  try {
    return JSON.parse(readFileSync(SCHEDULES_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function saveSchedules(schedules: Schedule[]): void {
  ensureDataDir()
  writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2), 'utf-8')
}

function loadHistory(): ScheduleRun[] {
  ensureDataDir()
  if (!existsSync(HISTORY_FILE)) return []
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function saveHistory(history: ScheduleRun[]): void {
  ensureDataDir()
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8')
}

/* ── Validation ── */

function validateInput(data: Partial<CreateScheduleInput>): string[] {
  const errors: string[] = []

  if (data.name !== undefined) {
    if (!data.name || data.name.trim().length === 0) errors.push('Name is required')
    if (data.name && data.name.length > MAX_NAME_LENGTH) errors.push(`Name max ${MAX_NAME_LENGTH} chars`)
  }

  if (data.project !== undefined) {
    if (!data.project) errors.push('Project is required')
    if (data.project && !ALLOWED_PROJECTS.includes(data.project)) {
      errors.push(`Project not in allowlist: ${data.project}`)
    }
  }

  if (data.agent !== undefined && data.agent !== '') {
    if (!ALLOWED_AGENTS.includes(data.agent)) {
      errors.push(`Agent not in allowlist: ${data.agent}`)
    }
  }

  if (data.command !== undefined && data.command !== '') {
    if (!ALLOWED_COMMANDS.includes(data.command)) {
      errors.push(`Command not in allowlist: ${data.command}`)
    }
  }

  if (data.prompt_template !== undefined) {
    if (!data.prompt_template) errors.push('Prompt template is required')
    if (data.prompt_template && data.prompt_template.length > MAX_PROMPT_LENGTH) {
      errors.push(`Prompt template max ${MAX_PROMPT_LENGTH} chars`)
    }
    if (data.prompt_template) {
      for (const pat of SECRET_PATTERNS) {
        pat.lastIndex = 0
        if (pat.test(data.prompt_template)) {
          errors.push('Potential secret detected in prompt template')
          break
        }
      }
    }
  }

  if (data.schedule_type !== undefined) {
    if (!['once', 'interval', 'cron'].includes(data.schedule_type)) {
      errors.push('Schedule type must be once, interval, or cron')
    }
  }

  if (data.schedule_expression !== undefined) {
    if (!data.schedule_expression) errors.push('Schedule expression is required')
    if (data.schedule_type === 'cron' && data.schedule_expression) {
      const parts = data.schedule_expression.trim().split(/\s+/)
      if (parts.length < 5 || parts.length > 6) {
        errors.push('Cron expression must have 5-6 fields')
      }
    }
  }

  if (data.approval_policy !== undefined) {
    if (!['never_write', 'per_run', 'preapproved_limited'].includes(data.approval_policy)) {
      errors.push('Invalid approval policy')
    }
  }

  if (data.misfire_policy !== undefined) {
    if (!['skip', 'run_once', 'catch_up_limited'].includes(data.misfire_policy)) {
      errors.push('Invalid misfire policy')
    }
  }

  if (data.concurrency_policy !== undefined) {
    if (!['skip', 'queue', 'replace'].includes(data.concurrency_policy)) {
      errors.push('Invalid concurrency policy')
    }
  }

  if (data.max_duration_seconds !== undefined && data.max_duration_seconds < 0) {
    errors.push('max_duration_seconds must be >= 0')
  }
  if (data.max_input_tokens !== undefined && data.max_input_tokens < 0) {
    errors.push('max_input_tokens must be >= 0')
  }
  if (data.max_output_tokens !== undefined && data.max_output_tokens < 0) {
    errors.push('max_output_tokens must be >= 0')
  }
  if (data.max_tool_calls !== undefined && data.max_tool_calls < 0) {
    errors.push('max_tool_calls must be >= 0')
  }
  if (data.max_runs_per_day !== undefined && data.max_runs_per_day < 0) {
    errors.push('max_runs_per_day must be >= 0')
  }
  if (data.max_cost_estimate !== undefined && data.max_cost_estimate < 0) {
    errors.push('max_cost_estimate must be >= 0')
  }
  if (data.retry_max_attempts !== undefined && (data.retry_max_attempts < 0 || data.retry_max_attempts > 5)) {
    errors.push('retry_max_attempts must be 0-5')
  }

  return errors
}

/* ── API functions ── */

export function listSchedules(opts: {
  status?: string
  project?: string
  limit?: number
  offset?: number
}): Schedule[] {
  const all = loadSchedules()
  let filtered = all.filter(s => s.status !== 'deleted')

  if (opts.status && opts.status !== 'all') {
    filtered = filtered.filter(s => s.status === opts.status)
  }
  if (opts.project) {
    filtered = filtered.filter(s => s.project === opts.project)
  }

  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  return filtered.slice(offset, offset + limit)
}

export function createSchedule(data: CreateScheduleInput): {
  schedule: Schedule
  errors: string[]
} {
  const errors = validateInput(data)
  if (errors.length) {
    return { schedule: null as any, errors }
  }

  const schedules = loadSchedules()
  if (schedules.filter(s => s.status !== 'deleted').length >= MAX_SCHEDULES) {
    return { schedule: null as any, errors: ['Maximum schedule limit reached'] }
  }

  const now = new Date().toISOString()
  const schedule: Schedule = {
    id: randomUUID(),
    name: data.name.trim(),
    project: data.project,
    agent: data.agent || undefined,
    command: data.command || undefined,
    prompt_template: data.prompt_template,
    schedule_type: data.schedule_type,
    schedule_expression: data.schedule_expression,
    timezone: data.timezone ?? 'Europe/Warsaw',
    read_only: data.read_only !== false,
    approval_policy: (data.approval_policy as Schedule['approval_policy']) ?? 'never_write',
    priority: data.priority ?? 'normal',
    max_duration_seconds: data.max_duration_seconds ?? 300,
    max_input_tokens: data.max_input_tokens ?? 50000,
    max_output_tokens: data.max_output_tokens ?? 10000,
    max_tool_calls: data.max_tool_calls ?? 20,
    max_runs_per_day: data.max_runs_per_day ?? 10,
    max_cost_estimate: data.max_cost_estimate ?? 1.0,
    retry_max_attempts: data.retry_max_attempts ?? 0,
    retry_on: data.retry_on ?? [],
    misfire_policy: (data.misfire_policy as Schedule['misfire_policy']) ?? 'skip',
    concurrency_policy: (data.concurrency_policy as Schedule['concurrency_policy']) ?? 'skip',
    maintenance_window_start: data.maintenance_window_start,
    maintenance_window_end: data.maintenance_window_end,
    status: 'active',
    created_by: data.created_by,
    created_at: now,
    updated_at: now,
    runs_today: 0,
    consecutive_failures: 0,
  }

  schedules.push(schedule)
  saveSchedules(schedules)

  return { schedule, errors: [] }
}

export function getSchedule(id: string): Schedule | null {
  const schedules = loadSchedules()
  return schedules.find(s => s.id === id && s.status !== 'deleted') ?? null
}

export function updateSchedule(id: string, patch: Partial<CreateScheduleInput>): {
  schedule: Schedule | null
  errors: string[]
} {
  const schedules = loadSchedules()
  const idx = schedules.findIndex(s => s.id === id && s.status !== 'deleted')
  if (idx === -1) return { schedule: null, errors: ['Schedule not found'] }

  const errors = validateInput(patch)
  if (errors.length) return { schedule: null, errors }

  const existing = schedules[idx]
  const updated: Schedule = {
    ...existing,
    ...Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined)),
    updated_at: new Date().toISOString(),
  }

  schedules[idx] = updated
  saveSchedules(schedules)

  return { schedule: updated, errors: [] }
}

export function deleteSchedule(id: string): boolean {
  const schedules = loadSchedules()
  const idx = schedules.findIndex(s => s.id === id && s.status !== 'deleted')
  if (idx === -1) return false

  schedules[idx].status = 'deleted'
  schedules[idx].updated_at = new Date().toISOString()
  saveSchedules(schedules)
  return true
}

export function pauseSchedule(id: string): boolean {
  const schedules = loadSchedules()
  const idx = schedules.findIndex(s => s.id === id && s.status === 'active')
  if (idx === -1) return false

  schedules[idx].status = 'paused'
  schedules[idx].updated_at = new Date().toISOString()
  saveSchedules(schedules)
  return true
}

export function resumeSchedule(id: string): boolean {
  const schedules = loadSchedules()
  const idx = schedules.findIndex(s => s.id === id && s.status === 'paused')
  if (idx === -1) return false

  schedules[idx].status = 'active'
  schedules[idx].consecutive_failures = 0
  schedules[idx].updated_at = new Date().toISOString()
  saveSchedules(schedules)
  return true
}

export function runNow(id: string): { queued: boolean; taskId?: string; reason?: string } {
  const schedules = loadSchedules()
  const schedule = schedules.find(s => s.id === id && s.status === 'active')
  if (!schedule) return { queued: false, reason: 'Schedule not found or not active' }

  if (schedule.consecutive_failures >= 3) {
    return { queued: false, reason: 'Schedule auto-paused after 3 consecutive failures' }
  }

  if (schedule.read_only && schedule.approval_policy === 'never_write') {
    // Proceed without approval for read-only
  }

  const taskId = randomUUID()
  const history = loadHistory()
  history.push({
    id: randomUUID(),
    schedule_id: id,
    task_id: taskId,
    status: 'running',
    started_at: new Date().toISOString(),
  })
  saveHistory(history)

  return { queued: true, taskId }
}

export function getHistory(id: string, limit?: number): ScheduleRun[] {
  const all = loadHistory()
  const filtered = all
    .filter(r => r.schedule_id === id)
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
  return filtered.slice(0, limit ?? 20)
}

export function getSchedulerStatus(): SchedulerStatus {
  const schedules = loadSchedules()
  const active = schedules.filter(s => s.status === 'active')
  const paused = schedules.filter(s => s.status === 'paused')
  const history = loadHistory()
  const recentFailures = history.filter(
    r => r.status === 'failed' &&
      new Date(r.started_at).getTime() > Date.now() - 24 * 60 * 60 * 1000
  ).length

  return {
    running: true,
    uptime: process.uptime(),
    tick_interval: parseInt(process.env.TICK_INTERVAL ?? '30'),
    total_schedules: schedules.filter(s => s.status !== 'deleted').length,
    active: active.length,
    paused: paused.length,
    next_run: active.length > 0
      ? active.reduce((earliest, s) => {
          if (!s.next_run_at) return earliest
          return !earliest || s.next_run_at < earliest ? s.next_run_at : earliest
        }, null as string | null)
      : null,
    recent_failures: recentFailures,
  }
}
