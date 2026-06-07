import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfig } from './config.js'
import type { AuditEntry } from './types.js'

function ensureDataDir(): string {
  const dir = loadConfig().dataDir
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

const AUDIT_FILE = () => resolve(ensureDataDir(), 'write-audit.jsonl')

function redactSensitive(summary: string): string {
  return summary
    .replace(/(ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{36,}/g, '***TOKEN***')
    .replace(/(sk-|nvapi-)[A-Za-z0-9_\-]{20,}/g, '***SECRET***')
    .replace(/(password|token|secret|key)\s*[:=]\s*['"]?\S+/gi, '$1: ***REDACTED***')
}

export function appendAudit(entry: AuditEntry) {
  try {
    const line = JSON.stringify({
      ...entry,
      summary: redactSensitive(entry.summary),
    }) + '\n'
    appendFileSync(AUDIT_FILE(), line, 'utf-8')
  } catch {
    // Silently fail — audit is best-effort
  }
}

export function readAudit(limit = 50): AuditEntry[] {
  try {
    const file = AUDIT_FILE()
    if (!existsSync(file)) return []
    const content = readFileSync(file, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    const entries: AuditEntry[] = []
    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
      try {
        entries.push(JSON.parse(lines[i]))
      } catch { /* skip malformed */ }
    }
    return entries
  } catch {
    return []
  }
}

export function trimAudit() {
  try {
    const max = loadConfig().maxAuditRecords
    const file = AUDIT_FILE()
    if (!existsSync(file)) return
    const content = readFileSync(file, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    if (lines.length > max * 2) {
      const trimmed = lines.slice(lines.length - max).join('\n') + '\n'
      appendFileSync(file, '', 'utf-8')
    }
  } catch { /* silent */ }
}
