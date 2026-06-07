import { existsSync, statSync } from 'node:fs'
import { normalize, resolve } from 'node:path'

// ── Allowlists ──────────────────────────────────────────────────────────────

const ALLOWED_PROJECTS = [
  '/root/projekt/akm-bridge',
  '/root/projekt/strategikon',
]

const ALLOWED_AGENTS = [
  'akm-build',
  'meridian-dev',
  'infra-ops',
  'reviewer',
  'security-auditor',
  'release-manager',
  'researcher',
]

const FORBIDDEN_OPERATIONS = [
  'force push',
  'reboot',
  'shutdown',
  'prune',
  'rm -rf',
  'docker system prune',
  'npm install -g',
  'deploy production',
]

const SECRET_PATTERNS = [
  /(?:password|secret|token|api[_-]?key|credential)\s*[:=]\s*["']?[^\s"']{8,}/gi,
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/g,
  /(?:sk|pk)[-_][A-Za-z0-9]{20,}/g,
]

const MAX_PROMPT_LENGTH = 50_000
const MAX_SUMMARY_LENGTH = 500

// ── Types ───────────────────────────────────────────────────────────────────

export interface ValidationInput {
  project: string
  agent?: string
  command?: string
  prompt_summary: string
  full_prompt?: string
  created_by?: string
  idempotency_key?: string
  path?: string
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

// ── Validator ───────────────────────────────────────────────────────────────

export function validateTask(input: ValidationInput): ValidationResult {
  const errors: string[] = []

  validateProject(input.project, errors)
  validateAgent(input.agent, errors)
  validateCommand(input.command, errors)
  validatePrompt(input.prompt_summary, input.full_prompt, errors)
  validatePath(input.path, input.project, errors)
  validateForbidden(input.prompt_summary, input.full_prompt, errors)
  validateCreatedBy(input.created_by, errors)

  return { valid: errors.length === 0, errors }
}

function validateProject(project: string, errors: string[]): void {
  if (!project || project.trim().length === 0) {
    errors.push('Project is required')
    return
  }

  const normalized = normalize(project)
  const isAllowed = ALLOWED_PROJECTS.some(
    (p) => normalized === p || normalized.startsWith(p + '/')
  )

  if (!isAllowed) {
    errors.push(`Project "${project}" is not on the allowlist`)
  }
}

function validateAgent(agent: string | undefined, errors: string[]): void {
  if (!agent || agent.trim().length === 0) return

  if (!ALLOWED_AGENTS.includes(agent)) {
    errors.push(`Agent "${agent}" is not valid. Allowed: ${ALLOWED_AGENTS.join(', ')}`)
  }
}

function validateCommand(command: string | undefined, errors: string[]): void {
  if (!command || command.trim().length === 0) return

  const knownCommands = [
    'read', 'write', 'edit', 'search', 'execute', 'review',
    'deploy', 'test', 'build', 'analyze', 'research',
  ]

  if (!knownCommands.includes(command)) {
    errors.push(`Command "${command}" is not recognized`)
  }
}

function validatePrompt(
  summary: string,
  fullPrompt: string | undefined,
  errors: string[]
): void {
  if (!summary || summary.trim().length === 0) {
    errors.push('Prompt summary is required')
    return
  }

  if (summary.length > MAX_SUMMARY_LENGTH) {
    errors.push(`Prompt summary exceeds ${MAX_SUMMARY_LENGTH} characters`)
  }

  if (fullPrompt && fullPrompt.length > MAX_PROMPT_LENGTH) {
    errors.push(`Full prompt exceeds ${MAX_PROMPT_LENGTH} characters`)
  }

  const target = `${summary} ${fullPrompt ?? ''}`
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(target)) {
      errors.push('Prompt contains potential secrets — remove sensitive data')
      break
    }
  }
}

function validatePath(
  path: string | undefined,
  project: string,
  errors: string[]
): void {
  if (!path || path.trim().length === 0) return

  const resolved = resolve(project, path)
  const normalizedProject = normalize(project)

  if (!resolved.startsWith(normalizedProject)) {
    errors.push(`Path "${path}" is outside the project directory`)
  }
}

function validateForbidden(
  summary: string,
  fullPrompt: string | undefined,
  errors: string[]
): void {
  const target = `${summary} ${fullPrompt ?? ''}`.toLowerCase()

  for (const op of FORBIDDEN_OPERATIONS) {
    if (target.includes(op)) {
      errors.push(`Prompt contains forbidden operation: "${op}"`)
    }
  }
}

function validateCreatedBy(createdBy: string | undefined, errors: string[]): void {
  if (!createdBy || createdBy.trim().length === 0) return

  const validUsers = ['dashboard', 'api', 'system', 'cron']
  if (!validUsers.includes(createdBy)) {
    errors.push(`Created_by "${createdBy}" is not a recognized user`)
  }
}

// ── Idempotency Dedup ───────────────────────────────────────────────────────

const seenIdempotencyKeys = new Map<string, number>()
const IDEMPOTENCY_TTL = 3600_000

export function checkIdempotency(key: string | undefined): {
  duplicate: boolean
  existingTaskId: string | null
} {
  if (!key) return { duplicate: false, existingTaskId: null }

  const existing = seenIdempotencyKeys.get(key)
  if (existing !== undefined) {
    return { duplicate: true, existingTaskId: String(existing) }
  }

  return { duplicate: false, existingTaskId: null }
}

export function registerIdempotencyKey(key: string, taskId: string): void {
  if (!key) return

  // Cleanup expired keys
  const now = Date.now()
  for (const [k, ts] of seenIdempotencyKeys) {
    if (now - ts > IDEMPOTENCY_TTL) seenIdempotencyKeys.delete(k)
  }

  seenIdempotencyKeys.set(key, now)
}
