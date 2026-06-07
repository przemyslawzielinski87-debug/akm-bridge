import { randomBytes, createHmac } from 'node:crypto'

// ── Config ──────────────────────────────────────────────────────────────────

const TOKEN_LENGTH = 32
const TIMESTAMP_TTL_MS = 300_000 // 5 min
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60

// ── Token Generation ────────────────────────────────────────────────────────

export function generateCsrfToken(secret: string): string {
  const nonce = randomBytes(TOKEN_LENGTH).toString('hex')
  const timestamp = Date.now().toString()
  const payload = `${nonce}:${timestamp}`
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}:${signature}`
}

// ── Token Validation ────────────────────────────────────────────────────────

export function validateCsrfToken(
  token: string,
  secret: string
): { valid: boolean; error?: string } {
  const parts = token.split(':')
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid token format' }
  }

  const [nonce, timestamp, signature] = parts
  const payload = `${nonce}:${timestamp}`
  const expected = createHmac('sha256', secret).update(payload).digest('hex')

  if (signature !== expected) {
    return { valid: false, error: 'Invalid signature' }
  }

  const ts = parseInt(timestamp, 10)
  if (isNaN(ts)) {
    return { valid: false, error: 'Invalid timestamp' }
  }

  const age = Date.now() - ts
  if (age > TIMESTAMP_TTL_MS) {
    return { valid: false, error: 'Token expired' }
  }
  if (age < -TIMESTAMP_TTL_MS) {
    return { valid: false, error: 'Token from the future' }
  }

  return { valid: true }
}

// ── Nonce Tracking ──────────────────────────────────────────────────────────

const usedNonces = new Map<string, number>()

export function isNonceUsed(nonce: string): boolean {
  return usedNonces.has(nonce)
}

export function markNonceUsed(nonce: string): void {
  usedNonces.set(nonce, Date.now())
  cleanupNonces()
}

function cleanupNonces(): void {
  if (usedNonces.size < 10_000) return
  const cutoff = Date.now() - TIMESTAMP_TTL_MS
  for (const [n, ts] of usedNonces) {
    if (ts < cutoff) usedNonces.delete(n)
  }
}

// ── Replay Prevention ───────────────────────────────────────────────────────

const seenTokens = new Map<string, number>()

export function checkReplay(token: string): boolean {
  const existing = seenTokens.get(token)
  if (existing !== undefined) {
    return Date.now() - existing < TIMESTAMP_TTL_MS
  }
  return false
}

export function recordToken(token: string): void {
  seenTokens.set(token, Date.now())
  if (seenTokens.size > 50_000) {
    const cutoff = Date.now() - TIMESTAMP_TTL_MS
    for (const [t, ts] of seenTokens) {
      if (ts < cutoff) seenTokens.delete(t)
    }
  }
}

// ── Rate Limiting ───────────────────────────────────────────────────────────

const rateLimits = new Map<string, number[]>()

export function isRateLimited(clientIp: string): boolean {
  const now = Date.now()
  const timestamps = rateLimits.get(clientIp) ?? []
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)

  if (recent.length >= RATE_LIMIT_MAX) return true

  recent.push(now)
  rateLimits.set(clientIp, recent)
  return false
}

// ── Combined Validation ─────────────────────────────────────────────────────

export function validateRequest(opts: {
  token?: string
  secret: string
  clientIp: string
  nonce?: string
  idempotencyKey?: string
}): { valid: boolean; error?: string } {
  if (isRateLimited(opts.clientIp)) {
    return { valid: false, error: 'Rate limit exceeded' }
  }

  if (!opts.token) {
    return { valid: false, error: 'CSRF token required' }
  }

  if (checkReplay(opts.token)) {
    return { valid: false, error: 'Replay detected' }
  }

  const result = validateCsrfToken(opts.token, opts.secret)
  if (!result.valid) {
    return result
  }

  if (opts.nonce && isNonceUsed(opts.nonce)) {
    return { valid: false, error: 'Nonce already used' }
  }

  recordToken(opts.token)
  if (opts.nonce) markNonceUsed(opts.nonce)

  return { valid: true }
}
