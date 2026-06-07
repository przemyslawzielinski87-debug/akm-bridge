import { randomUUID } from 'node:crypto'
import { loadConfig } from './config.js'

interface TokenData {
  token: string
  operation: string
  params: Record<string, string>
  expiresAt: number
  used: boolean
}

const store = new Map<string, TokenData>()

export function createConfirmationToken(operation: string, params: Record<string, string> = {}): { token: string; expires_at: string } {
  const cfg = loadConfig()
  const now = Date.now()
  const token = randomUUID()
  store.set(token, {
    token,
    operation,
    params,
    expiresAt: now + cfg.confirmationTokenExpiryMs,
    used: false,
  })
  setTimeout(() => store.delete(token), cfg.confirmationTokenExpiryMs + 5000)
  return {
    token,
    expires_at: new Date(now + cfg.confirmationTokenExpiryMs).toISOString(),
  }
}

export function consumeConfirmationToken(
  token: string,
  operation: string,
  params?: Record<string, string>,
): { valid: boolean; error?: string } {
  const data = store.get(token)
  if (!data) return { valid: false, error: 'Invalid or expired confirmation token.' }
  if (data.used) return { valid: false, error: 'Confirmation token has already been used.' }
  if (Date.now() > data.expiresAt) {
    store.delete(token)
    return { valid: false, error: 'Confirmation token has expired.' }
  }
  if (data.operation !== operation) return { valid: false, error: 'Confirmation token is for a different operation.' }
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (data.params[key] !== value) {
        return { valid: false, error: 'Confirmation token parameters do not match.' }
      }
    }
  }
  data.used = true
  store.delete(token)
  return { valid: true }
}
