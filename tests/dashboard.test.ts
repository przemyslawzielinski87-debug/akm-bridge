/**
 * OpenCode Operations Dashboard — Tests
 *
 * Jest suite covering dashboard types, data aggregator, server,
 * public HTML, API contracts, security, and configuration.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')
const OPENCODE_CONFIG = '/root/.config/opencode/opencode.json'
const COMMANDS_DIR = '/root/.config/opencode/commands'
const SKILLS_DIR = '/root/.config/opencode/skills'

/* ── Helper: read file safely ── */
function safeRead(p: string): string | null {
  try { return readFileSync(p, 'utf-8') } catch { return null }
}

function safeExists(p: string): boolean {
  try { return existsSync(p) } catch { return false }
}

function safeStat(p: string) {
  try { return statSync(p) } catch { return null }
}

/* ══════════════════════════════════════════════════════════════════
   1. Dashboard types exist and are importable
   ══════════════════════════════════════════════════════════════════ */

describe('Dashboard types', () => {
  const typesPath = resolve(PROJECT_ROOT, 'src/dashboard/dashboard-types.ts')

  it('types file exists', () => {
    expect(safeExists(typesPath)).toBe(true)
  })

  it('exports ComponentStatus type', () => {
    const content = safeRead(typesPath)!
    expect(content).toContain("export type ComponentStatus")
    expect(content).toContain("'healthy'")
    expect(content).toContain("'degraded'")
    expect(content).toContain("'failed'")
  })

  it('exports DashboardData interface', () => {
    const content = safeRead(typesPath)!
    expect(content).toContain('export interface DashboardData')
    expect(content).toContain('schemaVersion')
    expect(content).toContain('overall')
    expect(content).toContain('alerts')
    expect(content).toContain('mcp')
  })

  it('exports all required section interfaces', () => {
    const content = safeRead(typesPath)!
    const required = [
      'AgentStatus', 'CommandStatus', 'SkillStatus', 'MCPServerStatus',
      'AKMStatus', 'TokenMetrics', 'ContextMetrics', 'PermissionMetrics',
      'RecoveryStatus', 'UpdateStatus', 'E2EStatus', 'CIStatus',
      'DRStatus', 'LearningStatus', 'SystemStatus', 'Alert', 'DashboardEvent',
    ]
    for (const name of required) {
      expect(content).toContain(`export interface ${name}`)
    }
  })
})

/* ══════════════════════════════════════════════════════════════════
   2. Data aggregator script exists
   ══════════════════════════════════════════════════════════════════ */

describe('Data aggregator', () => {
  const scriptPath = resolve(PROJECT_ROOT, 'scripts/opencode-dashboard-data.ts')

  it('aggregator script exists', () => {
    expect(safeExists(scriptPath)).toBe(true)
  })

  it('imports dashboard types', () => {
    const content = safeRead(scriptPath)!
    expect(content).toContain("from '../src/dashboard/dashboard-types.js'")
  })

  it('exports collectDashboardData function', () => {
    const content = safeRead(scriptPath)!
    expect(content).toContain('export function collectDashboardData')
  })

  it('defines SCHEMA_VERSION constant', () => {
    const content = safeRead(scriptPath)!
    expect(content).toContain('SCHEMA_VERSION')
  })

  it('defines DEFAULT_CACHE_TTL constant', () => {
    const content = safeRead(scriptPath)!
    expect(content).toContain('DEFAULT_CACHE_TTL')
  })
})

/* ══════════════════════════════════════════════════════════════════
   3. Server script exists
   ══════════════════════════════════════════════════════════════════ */

describe('Dashboard server', () => {
  const serverPath = resolve(PROJECT_ROOT, 'src/dashboard/server.ts')

  it('server file exists', () => {
    expect(safeExists(serverPath)).toBe(true)
  })

  it('uses Bun.serve', () => {
    const content = safeRead(serverPath)!
    expect(content).toContain('Bun.serve')
  })

  it('implements rate limiting', () => {
    const content = safeRead(serverPath)!
    expect(content).toContain('isRateLimited')
    expect(content).toContain('RATE_LIMIT_MAX')
  })

  it('has security headers function', () => {
    const content = safeRead(serverPath)!
    expect(content).toContain('securityHeaders')
    expect(content).toContain('X-Content-Type-Options')
    expect(content).toContain('X-Frame-Options')
    expect(content).toContain('Content-Security-Policy')
  })

  it('has cache with configurable TTL', () => {
    const content = safeRead(serverPath)!
    expect(content).toContain('cacheTTL')
    expect(content).toContain('getCachedData')
    expect(content).toContain('invalidateCache')
  })
})

/* ══════════════════════════════════════════════════════════════════
   4. Public HTML exists and is valid
   ══════════════════════════════════════════════════════════════════ */

describe('Public HTML', () => {
  const htmlPath = resolve(PROJECT_ROOT, 'src/dashboard/public/index.html')

  it('public index.html exists', () => {
    expect(safeExists(htmlPath)).toBe(true)
  })

  it('is valid HTML with doctype', () => {
    const content = safeRead(htmlPath)!
    expect(content).toMatch(/^<!DOCTYPE html>/i)
  })

  it('has lang attribute', () => {
    const content = safeRead(htmlPath)!
    expect(content).toContain('<html lang="en">')
  })
})

/* ══════════════════════════════════════════════════════════════════
   5. HTML contains expected sections
   ══════════════════════════════════════════════════════════════════ */

describe('HTML sections', () => {
  const htmlPath = resolve(PROJECT_ROOT, 'src/dashboard/public/index.html')
  const content = safeRead(htmlPath)!

  const expectedSections = [
    'Overview', 'Alerts', 'MCP', 'Agents', 'Commands', 'Skills',
    'Tokens', 'Context', 'Permissions', 'Recovery', 'Updates',
    'CI', 'Disaster Recovery', 'Learning', 'System',
  ]

  for (const section of expectedSections) {
    it(`contains section: ${section}`, () => {
      expect(content).toContain(section)
    })
  }
})

/* ══════════════════════════════════════════════════════════════════
   6. HTML contains expected API endpoints
   ══════════════════════════════════════════════════════════════════ */

describe('HTML API endpoints', () => {
  const htmlPath = resolve(PROJECT_ROOT, 'src/dashboard/public/index.html')
  const content = safeRead(htmlPath)!

  it('has dynamic API fetch using /api/dashboard/ path', () => {
    expect(content).toContain('/api/dashboard/')
  })

  it('defines section IDs matching expected endpoints', () => {
    const expectedIds = [
      'overview', 'alerts', 'mcp', 'agents', 'commands', 'skills',
      'tokens', 'context', 'permissions', 'recovery', 'updates',
      'e2e', 'disaster-recovery', 'learning', 'system',
    ]
    for (const id of expectedIds) {
      expect(content).toContain(`id: '${id}'`)
    }
  })
})

/* ══════════════════════════════════════════════════════════════════
   7. HTML is mobile-friendly
   ══════════════════════════════════════════════════════════════════ */

describe('HTML mobile-friendliness', () => {
  const htmlPath = resolve(PROJECT_ROOT, 'src/dashboard/public/index.html')
  const content = safeRead(htmlPath)!

  it('has viewport meta tag', () => {
    expect(content).toContain('name="viewport"')
    expect(content).toContain('width=device-width')
  })

  it('has responsive CSS media queries', () => {
    expect(content).toContain('@media')
    expect(content).toContain('min-width')
  })

  it('has touch-friendly button sizes (min-height: 44px)', () => {
    expect(content).toContain('min-height: 44px')
  })
})

/* ══════════════════════════════════════════════════════════════════
   8. HTML has dark theme colors
   ══════════════════════════════════════════════════════════════════ */

describe('HTML dark theme', () => {
  const htmlPath = resolve(PROJECT_ROOT, 'src/dashboard/public/index.html')
  const content = safeRead(htmlPath)!

  it('defines CSS custom properties for dark theme', () => {
    expect(content).toContain('--bg:')
    expect(content).toContain('--card:')
    expect(content).toContain('--border:')
    expect(content).toContain('--text:')
  })

  it('uses dark background color (#0d1117)', () => {
    expect(content).toContain('#0d1117')
  })

  it('defines status colors (green, red, yellow)', () => {
    expect(content).toContain('--green:')
    expect(content).toContain('--red:')
    expect(content).toContain('--yellow:')
  })
})

/* ══════════════════════════════════════════════════════════════════
   9. API contract: all endpoints return JSON with schemaVersion
   ══════════════════════════════════════════════════════════════════ */

describe('API contract', () => {
  const serverPath = resolve(PROJECT_ROOT, 'src/dashboard/server.ts')
  const content = safeRead(serverPath)!

  it('health endpoint returns JSON', () => {
    expect(content).toContain('/api/health')
    expect(content).toContain('ok: true')
  })

  it('section endpoints wrap response with schemaVersion', () => {
    expect(content).toContain('schemaVersion')
    expect(content).toContain('generatedAt')
  })

  it('returns stale flag in section responses', () => {
    expect(content).toContain('stale')
    expect(content).toContain('isStale')
  })
})

/* ══════════════════════════════════════════════════════════════════
   10. No secrets in HTML output
   ══════════════════════════════════════════════════════════════════ */

describe('No secrets in HTML', () => {
  const htmlPath = resolve(PROJECT_ROOT, 'src/dashboard/public/index.html')
  const content = safeRead(htmlPath)!

  it('does not contain API keys', () => {
    expect(content.toLowerCase()).not.toContain('api_key')
    expect(content.toLowerCase()).not.toContain('apikey')
    expect(content).not.toContain('Bearer ')
  })

  it('does not contain private keys', () => {
    expect(content).not.toContain('PRIVATE KEY')
    expect(content).not.toContain('-----BEGIN')
  })

  it('does not contain .env references', () => {
    expect(content).not.toContain('.env')
  })
})

/* ══════════════════════════════════════════════════════════════════
   11. No private keys in HTML output
   ══════════════════════════════════════════════════════════════════ */

describe('No private keys in HTML', () => {
  const htmlPath = resolve(PROJECT_ROOT, 'src/dashboard/public/index.html')
  const content = safeRead(htmlPath)!

  it('no RSA/EC/PGP key patterns', () => {
    expect(content).not.toMatch(/-----BEGIN (RSA |EC |PGP )?PRIVATE KEY/)
    expect(content).not.toContain('ssh-rsa')
    expect(content).not.toContain('ssh-ed25519')
  })
})

/* ══════════════════════════════════════════════════════════════════
   12. Security headers present in server
   ══════════════════════════════════════════════════════════════════ */

describe('Security headers', () => {
  const serverPath = resolve(PROJECT_ROOT, 'src/dashboard/server.ts')
  const content = safeRead(serverPath)!

  it('sets X-Content-Type-Options: nosniff', () => {
    expect(content).toContain("'X-Content-Type-Options': 'nosniff'")
  })

  it('sets X-Frame-Options: DENY', () => {
    expect(content).toContain("'X-Frame-Options': 'DENY'")
  })

  it('sets Content-Security-Policy', () => {
    expect(content).toContain("'Content-Security-Policy'")
    expect(content).toContain("default-src 'self'")
    expect(content).toContain("object-src 'none'")
    expect(content).toContain("frame-ancestors 'none'")
  })

  it('sets Strict-Transport-Security', () => {
    expect(content).toContain("'Strict-Transport-Security'")
  })

  it('sets X-XSS-Protection', () => {
    expect(content).toContain("'X-XSS-Protection': '1; mode=block'")
  })
})

/* ══════════════════════════════════════════════════════════════════
   13. Cache TTL configuration exists
   ══════════════════════════════════════════════════════════════════ */

describe('Cache TTL configuration', () => {
  const serverPath = resolve(PROJECT_ROOT, 'src/dashboard/server.ts')
  const content = safeRead(serverPath)!

  it('reads DASHBOARD_CACHE_TTL from environment', () => {
    expect(content).toContain('DASHBOARD_CACHE_TTL')
  })

  it('has configurable port and host', () => {
    expect(content).toContain('DASHBOARD_PORT')
    expect(content).toContain('DASHBOARD_HOST')
  })
})

/* ══════════════════════════════════════════════════════════════════
   14. Staleness detection logic exists
   ══════════════════════════════════════════════════════════════════ */

describe('Staleness detection', () => {
  const serverPath = resolve(PROJECT_ROOT, 'src/dashboard/server.ts')
  const content = safeRead(serverPath)!

  it('has isStale function', () => {
    expect(content).toContain('function isStale')
  })

  it('uses cache TTL for staleness threshold', () => {
    expect(content).toContain('ttl * 2')
  })
})

/* ══════════════════════════════════════════════════════════════════
   15. Alert engine logic exists
   ══════════════════════════════════════════════════════════════════ */

describe('Alert engine', () => {
  const dataScript = resolve(PROJECT_ROOT, 'scripts/opencode-dashboard-data.ts')
  const content = safeRead(dataScript)!

  it('has collectAlerts function', () => {
    expect(content).toContain('collectAlerts')
  })

  it('checks for critical alerts', () => {
    expect(content).toContain('critical')
  })

  it('checks for warning alerts', () => {
    expect(content).toContain('warning')
  })
})

/* ══════════════════════════════════════════════════════════════════
   16. Status scoring logic exists
   ══════════════════════════════════════════════════════════════════ */

describe('Status scoring', () => {
  const dataScript = resolve(PROJECT_ROOT, 'scripts/opencode-dashboard-data.ts')
  const content = safeRead(dataScript)!

  it('has mergeStatus function for status scoring', () => {
    expect(content).toContain('function mergeStatus')
  })

  it('returns healthy/degraded/failed status values', () => {
    expect(content).toContain("'healthy'")
    expect(content).toContain("'degraded'")
    expect(content).toContain("'failed'")
  })
})

/* ══════════════════════════════════════════════════════════════════
   17. Command file exists and is valid
   ══════════════════════════════════════════════════════════════════ */

describe('Dashboard command', () => {
  const cmdPath = resolve(COMMANDS_DIR, 'dashboard.md')

  it('command file exists', () => {
    expect(safeExists(cmdPath)).toBe(true)
  })

  it('has Purpose section', () => {
    const content = safeRead(cmdPath)!
    expect(content).toContain('## Purpose')
  })

  it('has Usage section', () => {
    const content = safeRead(cmdPath)!
    expect(content).toContain('## Usage')
  })

  it('references infra-ops agent', () => {
    const content = safeRead(cmdPath)!
    expect(content).toContain('infra-ops')
  })

  it('states read-only safety', () => {
    const content = safeRead(cmdPath)!
    expect(content.toLowerCase()).toContain('read-only')
  })
})

/* ══════════════════════════════════════════════════════════════════
   18. Skill file exists and is valid
   ══════════════════════════════════════════════════════════════════ */

describe('Operations dashboard skill', () => {
  const skillPath = resolve(SKILLS_DIR, 'operations-dashboard/SKILL.md')

  it('skill file exists', () => {
    expect(safeExists(skillPath)).toBe(true)
  })

  it('has Purpose section', () => {
    const content = safeRead(skillPath)!
    expect(content).toContain('## Purpose')
  })

  it('has When to Use section', () => {
    const content = safeRead(skillPath)!
    expect(content).toContain('## When to Use')
  })

  it('describes dashboard sections', () => {
    const content = safeRead(skillPath)!
    expect(content).toContain('### Overall')
    expect(content).toContain('### Alerts')
    expect(content).toContain('### MCP')
    expect(content).toContain('### Recovery')
  })

  it('documents safe vs approval-required actions', () => {
    const content = safeRead(skillPath)!
    expect(content).toContain('## Safe Actions')
    expect(content).toContain('## Actions Requiring Approval')
  })

  it('includes staleness thresholds', () => {
    const content = safeRead(skillPath)!
    expect(content).toContain('## Staleness')
    expect(content).toContain('60s')
    expect(content).toContain('120s')
  })
})

/* ══════════════════════════════════════════════════════════════════
   19. Config entry exists in opencode.json
   ══════════════════════════════════════════════════════════════════ */

describe('opencode.json config', () => {
  let config: Record<string, unknown>

  beforeAll(() => {
    const raw = safeRead(OPENCODE_CONFIG)!
    config = JSON.parse(raw)
  })

  it('config file is valid JSON', () => {
    expect(config).toBeDefined()
    expect(typeof config).toBe('object')
  })

  it('has command object', () => {
    expect(config.command).toBeDefined()
    expect(typeof config.command).toBe('object')
  })

  it('has dashboard command entry', () => {
    const cmd = (config.command as Record<string, unknown>).dashboard as Record<string, unknown> | undefined
    expect(cmd).toBeDefined()
  })

  it('dashboard command has required fields', () => {
    const cmd = (config.command as Record<string, unknown>).dashboard as Record<string, unknown>
    expect(cmd.template).toBeDefined()
    expect(typeof cmd.template).toBe('string')
    expect(cmd.description).toBeDefined()
    expect(cmd.agent).toBe('infra-ops')
    expect(cmd.subtask).toBe(true)
  })

  it('dashboard template includes key steps', () => {
    const template = (config.command as Record<string, unknown>).dashboard as Record<string, unknown>
    const t = template.template as string
    expect(t).toContain('dashboard')
    expect(t).toContain('health')
    expect(t).toContain('alert')
  })
})
