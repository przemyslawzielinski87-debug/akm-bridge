import { execFile } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { loadConfig, type BridgeConfig } from './config.js'
import {
  type AdapterResult,
  type AkmStatus,
  type AkmSource,
  type AkmCapability,
  type AkmStats,
  type AkmSearchHit,
  type AkmResource,
  type ActivityRecord,
  type AuditEntry,
  type AkmProposal,
  type AkmProposalDiff,
  ALLOWED_OPERATIONS,
  MAX_CONTENT_LENGTH,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_RESULTS,
  MAX_QUERY_LENGTH,
  MAX_REF_LENGTH,
} from './types.js'
import { acquireWriteLock, releaseWriteLock, writeLockBusyError } from './write-lock.js'
import { appendAudit, readAudit } from './audit-log.js'
import { detectSecrets, hasSecrets } from './secret-detector.js'
import type { AgentRunRecord, AgentMode } from './types.js'

interface RawSearchHit {
  type?: string
  name?: string
  ref?: string
  source?: string
  score?: number
  snippet?: string
  modified_at?: string
  action?: string
  estimatedTokens?: number
}

interface RawSearchResult {
  hits?: RawSearchHit[]
  tip?: string
}

interface RawSourceEntry {
  name?: string
  kind?: string
  path?: string
  ref?: string
  writable?: boolean
  status?: Record<string, unknown>
}

interface RawSourceList {
  sources?: RawSourceEntry[]
  totalSources?: number
}

interface RawHealthCheck {
  ok?: boolean
  status?: string
}

interface RawInfo {
  version?: string
  assetTypes?: string[]
  searchModes?: string[]
  indexStats?: {
    entryCount?: number
    lastBuiltAt?: string
    hasEmbeddings?: boolean
    vecAvailable?: boolean
    embeddingCount?: number
  }
  sourceProviders?: Array<{
    type?: string
    name?: string
    path?: string
  }>
}

interface RawShowResult {
  type?: string
  name?: string
  origin?: string
  content?: string
  path?: string
  editable?: boolean
  related?: Record<string, unknown>
  action?: string
}

function runAkm(args: string[], timeout: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const cfg = loadConfig()
    const env = { ...process.env, AKM_VERBOSE: '' }
    // Ensure bun is in PATH (akm uses #!/usr/bin/env bun)
    const bunDir = '/root/.bun/bin'
    env.PATH = env.PATH ? `${bunDir}:${env.PATH}` : bunDir
    const child = execFile(
      cfg.akmBinary,
      args,
      {
        timeout,
        maxBuffer: MAX_CONTENT_LENGTH,
        encoding: 'utf-8',
        env,
      },
      (err, stdout, stderr) => {
        if (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(new Error(`AKM binary not found at ${loadConfig().akmBinary}`))
            return
          }
          if ((err as NodeJS.ErrnoException).killed) {
            reject(new Error('AKM process timed out'))
            return
          }
          // Exit code 4 = warn status (e.g. semantic search blocked) — accept if valid JSON
          const exitCode: number = typeof err.code === 'number' ? err.code : Number(err.code)
          if (exitCode === 4 && stdout?.trim()) {
            try {
              const parsed = JSON.parse(stdout) as Record<string, unknown>
              if (
                parsed &&
                typeof parsed === 'object' &&
                (parsed.status === 'warn' || parsed.health || parsed.checks || parsed.summary)
              ) {
                resolve({ stdout, stderr })
                return
              }
            } catch {
              // Invalid JSON — fall through to reject below
            }
          }
          reject(new Error(`AKM process failed with exit code ${String(err.code)}: ${err.message}\nstderr: ${stderr}`))
          return
        }
        resolve({ stdout, stderr })
      }
    )
  })
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/* ── Redact secrets from output ── */
function redactOutput(text: string): string {
  return text
    .replace(/(api[_-]?key|secret|password|token|credential)\s*[:=]\s*['"]?\S+/gi, '$1: ***REDACTED***')
    .replace(/(bearer\s+)\S+/gi, '$1***REDACTED***')
}

/* ── Activity telemetry ── */
const activityLog: ActivityRecord[] = []

function recordActivity(op: string, success: boolean, dur: number, extra?: Partial<ActivityRecord>) {
  activityLog.unshift({
    timestamp: new Date().toISOString(),
    operation: op,
    success,
    duration_ms: dur,
    ...extra,
  })
  const cfg = loadConfig()
  if (activityLog.length > cfg.maxActivityRecords) {
    activityLog.length = cfg.maxActivityRecords
  }
}

export function getActivity(limit = 50): ActivityRecord[] {
  return activityLog.slice(0, limit)
}

function makeMeta(op: string, dur: number, truncated = false, ver?: string): AdapterResult<unknown>['meta'] {
  return { operation: op, duration_ms: dur, truncated, akm_version: ver }
}

/* ── Audit log access ── */

export function getWriteActivity(limit = 50): AuditEntry[] {
  return readAudit(limit)
}

/* ── Write adapter helpers ── */

function recordWriteAudit(op: string, success: boolean, dur: number, extra?: Partial<AuditEntry>) {
  appendAudit({
    timestamp: new Date().toISOString(),
    operation: op,
    result: success ? 'success' : 'failure',
    duration_ms: dur,
    summary: `${op}: ${success ? 'OK' : 'FAILED'}`,
    ...extra,
  })
}

function writeTimeout(): number {
  return loadConfig().writeTimeout
}

/* ── Reindex ── */

export async function reindex(full = false): Promise<AdapterResult<{ message: string }>> {
  if (!acquireWriteLock('reindex')) return writeLockBusyError() as AdapterResult<{ message: string }>
  const t0 = Date.now()
  try {
    const args = ['index']
    if (full) args.push('--full')
    const { stdout } = await runAkm(args, writeTimeout())
    releaseWriteLock()
    recordWriteAudit('reindex', true, Date.now() - t0)
    return { ok: true, data: { message: 'Reindex completed.' }, meta: makeMeta('reindex', Date.now() - t0) }
  } catch (e) {
    releaseWriteLock()
    recordWriteAudit('reindex', false, Date.now() - t0)
    return { ok: false, data: null, meta: makeMeta('reindex', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
  }
}

/* ── Sync sources ── */

export async function syncSources(name?: string): Promise<AdapterResult<{ message: string }>> {
  if (!acquireWriteLock('sync')) return writeLockBusyError() as AdapterResult<{ message: string }>
  const t0 = Date.now()
  try {
    const args = ['sync']
    if (name) args.push(name)
    const { stdout } = await runAkm(args, writeTimeout())
    releaseWriteLock()
    recordWriteAudit('sync', true, Date.now() - t0)
    return { ok: true, data: { message: name ? `Sync completed for source: ${name}` : 'All sources synced.' }, meta: makeMeta('sync', Date.now() - t0) }
  } catch (e) {
    releaseWriteLock()
    recordWriteAudit('sync', false, Date.now() - t0)
    return { ok: false, data: null, meta: makeMeta('sync', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
  }
}

/* ── Feedback ── */

export async function submitFeedback(ref: string, positive: boolean, reason?: string): Promise<AdapterResult<{ message: string }>> {
  if (!ref || ref.length === 0) {
    return { ok: false, data: null, meta: makeMeta('feedback', 0), error: { code: 'INVALID_INPUT', message: 'Resource reference is required' } }
  }
  const t0 = Date.now()
  try {
    const args = ['feedback', ref, positive ? '--positive' : '--negative']
    if (reason) args.push('--reason', reason.slice(0, 500))
    await runAkm(args, loadConfig().processTimeout)
    recordWriteAudit('feedback', true, Date.now() - t0, { resource_ref: ref, summary: `Feedback ${positive ? 'positive' : 'negative'} on ${ref}` })
    return { ok: true, data: { message: `Feedback recorded: ${positive ? 'positive' : 'negative'}` }, meta: makeMeta('feedback', Date.now() - t0) }
  } catch (e) {
    recordWriteAudit('feedback', false, Date.now() - t0, { resource_ref: ref })
    return { ok: false, data: null, meta: makeMeta('feedback', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
  }
}

/* ── Proposal list ── */

interface RawProposalHit {
  id?: string
  name?: string
  type?: string
  status?: string
  created_at?: string
  source?: string
  summary?: string
}

export async function listProposals(status?: string): Promise<AdapterResult<AkmProposal[]>> {
  return withTiming('proposals', async () => {
    const t0 = Date.now()
    try {
      const args = ['proposal', 'list']
      if (status) args.push('--status', status)
      const { stdout } = await runAkm(args, loadConfig().processTimeout)
      const parsed = parseJson<{ proposals?: RawProposalHit[] } | RawProposalHit[]>(stdout)
      let raw: RawProposalHit[] = []
      if (Array.isArray(parsed)) raw = parsed
      else if (parsed && 'proposals' in parsed && Array.isArray(parsed.proposals)) raw = parsed.proposals
      const proposals: AkmProposal[] = raw.map(p => ({
        id: p.id ?? '',
        name: p.name ?? 'Untitled',
        type: p.type ?? 'unknown',
        status: p.status ?? 'unknown',
        created_at: p.created_at ?? null,
        source: p.source,
        summary: p.summary,
      }))
      return { ok: true, data: proposals, meta: makeMeta('proposals', Date.now() - t0) }
    } catch (e) {
      return { ok: false, data: null, meta: makeMeta('proposals', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
    }
  })
}

/* ── Proposal show ── */

export async function showProposal(id: string): Promise<AdapterResult<AkmProposalDiff>> {
  return withTiming('proposal', async () => {
    const t0 = Date.now()
    if (!id || id.length === 0) {
      return { ok: false, data: null, meta: makeMeta('proposal', 0), error: { code: 'INVALID_INPUT', message: 'Proposal ID is required' } }
    }
    try {
      let content: string | undefined
      let diff: string | undefined
      let name = ''
      let type = ''
      let status = ''
      let reason: string | undefined
      let source: string | undefined
      let createdAt: string | undefined

      try {
        const { stdout: showOut } = await runAkm(['proposal', 'show', id], loadConfig().processTimeout)
        const parsed = parseJson<{ id?: string; name?: string; type?: string; status?: string; content?: string; reason?: string; source?: string; created_at?: string }>(showOut)
        if (parsed) {
          name = parsed.name ?? ''
          type = parsed.type ?? 'unknown'
          status = parsed.status ?? 'unknown'
          content = parsed.content
          reason = parsed.reason
          source = parsed.source
          createdAt = parsed.created_at
        }
      } catch { /* diff may or may not exist */ }

      try {
        const { stdout: diffOut } = await runAkm(['proposal', 'diff', id], loadConfig().processTimeout)
        const parsed = parseJson<{ diff?: string }>(diffOut)
        if (parsed) diff = parsed.diff
      } catch { /* diff optional */ }

      return {
        ok: true,
        data: { id, name, type, status, content, diff, reason, source, created_at: createdAt },
        meta: makeMeta('proposal', Date.now() - t0),
      }
    } catch (e) {
      return { ok: false, data: null, meta: makeMeta('proposal', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
    }
  })
}

/* ── Proposal accept ── */

export async function acceptProposal(id: string): Promise<AdapterResult<{ message: string }>> {
  if (!id || id.length === 0) {
    return { ok: false, data: null, meta: makeMeta('proposal_accept', 0), error: { code: 'INVALID_INPUT', message: 'Proposal ID is required' } }
  }
  if (!acquireWriteLock('proposal_accept')) return writeLockBusyError()
  const t0 = Date.now()
  try {
    await runAkm(['proposal', 'accept', id], writeTimeout())
    releaseWriteLock()
    recordWriteAudit('proposal_accept', true, Date.now() - t0, { proposal_id: id })
    return { ok: true, data: { message: `Proposal ${id} accepted.` }, meta: makeMeta('proposal_accept', Date.now() - t0) }
  } catch (e) {
    releaseWriteLock()
    recordWriteAudit('proposal_accept', false, Date.now() - t0, { proposal_id: id })
    return { ok: false, data: null, meta: makeMeta('proposal_accept', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
  }
}

/* ── Proposal reject ── */

export async function rejectProposal(id: string, reason?: string): Promise<AdapterResult<{ message: string }>> {
  if (!id || id.length === 0) {
    return { ok: false, data: null, meta: makeMeta('proposal_reject', 0), error: { code: 'INVALID_INPUT', message: 'Proposal ID is required' } }
  }
  if (!acquireWriteLock('proposal_reject')) return writeLockBusyError()
  const t0 = Date.now()
  try {
    const args = ['proposal', 'reject', id]
    if (reason) args.push('--reason', reason.slice(0, 500))
    await runAkm(args, writeTimeout())
    releaseWriteLock()
    recordWriteAudit('proposal_reject', true, Date.now() - t0, { proposal_id: id })
    return { ok: true, data: { message: `Proposal ${id} rejected.` }, meta: makeMeta('proposal_reject', Date.now() - t0) }
  } catch (e) {
    releaseWriteLock()
    recordWriteAudit('proposal_reject', false, Date.now() - t0, { proposal_id: id })
    return { ok: false, data: null, meta: makeMeta('proposal_reject', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
  }
}

/* ── Remember ── */

export async function remember(content: string, name?: string, tag?: string): Promise<AdapterResult<{ message: string }>> {
  if (!content || content.length === 0) {
    return { ok: false, data: null, meta: makeMeta('remember', 0), error: { code: 'INVALID_INPUT', message: 'Content is required' } }
  }
  const secrets = detectSecrets(content)
  if (secrets.length > 0) {
    return {
      ok: false, data: null, meta: makeMeta('remember', 0),
      error: { code: 'SECRET_DETECTED', message: `Potential secret detected: ${secrets[0].category} at ${secrets[0].safe_location}. Content rejected.` },
    }
  }
  if (!acquireWriteLock('remember')) return writeLockBusyError()
  const t0 = Date.now()
  try {
    const args = ['remember', content]
    if (name) args.push('--name', name.slice(0, 200))
    if (tag) args.push('--tag', tag.slice(0, 100))
    await runAkm(args, writeTimeout())
    releaseWriteLock()
    recordWriteAudit('remember', true, Date.now() - t0)
    return { ok: true, data: { message: 'Content remembered.' }, meta: makeMeta('remember', Date.now() - t0) }
  } catch (e) {
    releaseWriteLock()
    recordWriteAudit('remember', false, Date.now() - t0)
    return { ok: false, data: null, meta: makeMeta('remember', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
  }
}

/* ── Lesson proposal ── */

export async function createLessonProposal(name: string, task: string): Promise<AdapterResult<{ message: string; proposal_id?: string }>> {
  if (!name || name.length === 0) {
    return { ok: false, data: null, meta: makeMeta('lesson_proposal', 0), error: { code: 'INVALID_INPUT', message: 'Lesson name is required' } }
  }
  if (!task || task.length === 0) {
    return { ok: false, data: null, meta: makeMeta('lesson_proposal', 0), error: { code: 'INVALID_INPUT', message: 'Task description is required' } }
  }
  const secrets = detectSecrets(name + ' ' + task)
  if (secrets.length > 0) {
    return {
      ok: false, data: null, meta: makeMeta('lesson_proposal', 0),
      error: { code: 'SECRET_DETECTED', message: `Potential secret detected: ${secrets[0].category} at ${secrets[0].safe_location}. Content rejected.` },
    }
  }
  if (!acquireWriteLock('lesson_proposal')) return writeLockBusyError()
  const t0 = Date.now()
  try {
    const args = ['propose', 'lesson', name, '--task', task]
    const { stdout } = await runAkm(args, writeTimeout())
    releaseWriteLock()
    const parsed = parseJson<{ id?: string }>(stdout)
    recordWriteAudit('lesson_proposal', true, Date.now() - t0, { summary: `Lesson proposal: ${name}` })
    return { ok: true, data: { message: 'Lesson proposal created.', proposal_id: parsed?.id }, meta: makeMeta('lesson_proposal', Date.now() - t0) }
  } catch (e) {
    releaseWriteLock()
    recordWriteAudit('lesson_proposal', false, Date.now() - t0)
    return { ok: false, data: null, meta: makeMeta('lesson_proposal', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
  }
}

/* ── Core adapter functions ── */

async function withTiming<T>(op: string, fn: () => Promise<AdapterResult<T>>): Promise<AdapterResult<T>> {
  const start = Date.now()
  const result = await fn()
  const dur = Date.now() - start
  recordActivity(op, result.ok, dur, 'data' in result && result.data ? { result_count: Array.isArray(result.data) ? (result.data as unknown[]).length : undefined } : undefined)
  return result
}

export async function checkHealth(): Promise<AdapterResult<{ status: string }>> {
  return withTiming('health', async () => {
    const t0 = Date.now()
    try {
      const { stdout } = await runAkm(['health'], loadConfig().processTimeout)
      const parsed = parseJson<RawHealthCheck>(stdout)
      if (!parsed) {
        return { ok: false, data: null, meta: makeMeta('health', Date.now() - t0), error: { code: 'PARSE_ERROR', message: 'Could not parse AKM health output' } }
      }
      return { ok: true, data: { status: parsed.status ?? 'unknown' }, meta: makeMeta('health', Date.now() - t0) }
    } catch (e) {
      return { ok: false, data: null, meta: makeMeta('health', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
    }
  })
}

export async function getStatus(): Promise<AdapterResult<AkmStatus>> {
  return withTiming('status', async () => {
    const t0 = Date.now()
    try {
      const [healthOut, infoOut] = await Promise.all([
        runAkm(['health'], loadConfig().processTimeout),
        runAkm(['info'], loadConfig().processTimeout),
      ])
      const health = parseJson<RawHealthCheck>(healthOut.stdout)
      const info = parseJson<RawInfo>(infoOut.stdout)
      return {
        ok: true,
        data: {
          version: info?.version ?? '0.8.1',
          binary: loadConfig().akmBinary,
          healthy: health?.ok === true || health?.status === 'pass',
          entry_count: info?.indexStats?.entryCount ?? null,
          last_index_time: info?.indexStats?.lastBuiltAt ?? null,
          config_path: '/root/.config/akm/config.json',
          data_path: '/root/.local/share/akm/',
        },
        meta: makeMeta('status', Date.now() - t0, false, info?.version),
      }
    } catch (e) {
      return { ok: false, data: null, meta: makeMeta('status', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
    }
  })
}

export async function listSources(): Promise<AdapterResult<AkmSource[]>> {
  return withTiming('sources', async () => {
    const t0 = Date.now()
    try {
      const { stdout } = await runAkm(['list'], loadConfig().processTimeout)
      const parsed = parseJson<RawSourceList>(stdout)
      if (!parsed?.sources) {
        return { ok: true, data: [], meta: makeMeta('sources', Date.now() - t0) }
      }
      const sources: AkmSource[] = parsed.sources.map((s: RawSourceEntry) => ({
        id: s.name ?? s.path ?? 'unknown',
        name: s.name ?? 'Unnamed',
        path: s.path ?? s.ref ?? '',
        type: (s.kind === 'managed' || s.kind === 'registry' ? s.kind : 'local') as 'local' | 'managed' | 'registry',
        writable: s.writable ?? false,
        entry_count: null,
        last_sync_time: null,
      }))
      return { ok: true, data: sources, meta: makeMeta('sources', Date.now() - t0) }
    } catch (e) {
      return { ok: false, data: null, meta: makeMeta('sources', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
    }
  })
}

export async function getCapabilities(): Promise<AdapterResult<AkmCapability[]>> {
  return withTiming('capabilities', async () => {
    const t0 = Date.now()
    try {
      const { stdout } = await runAkm(['info'], loadConfig().processTimeout)
      const parsed = parseJson<RawInfo>(stdout)
      const allTypes = parsed?.assetTypes ?? []
      const allModes = parsed?.searchModes ?? []

      const caps: AkmCapability[] = [
        { name: 'health', supported: true, description: 'AKM health check' },
        { name: 'search', supported: true, description: `Search ${allTypes.length} asset types across ${allModes.join(', ')} modes` },
        { name: 'show', supported: true, description: 'Display resource content' },
        { name: 'sources', supported: true, description: 'List configured sources' },
        { name: 'stats', supported: true, description: 'Index and system statistics' },
        { name: 'feedback', supported: true, description: 'Submit feedback on search results' },
        { name: 'proposals', supported: true, description: 'List and manage improvement proposals' },
        { name: 'lessons', supported: true, description: 'Coverage gap analysis' },
        { name: 'workflows', supported: true, description: 'Workflow authoring and inspection' },
        { name: 'index', supported: true, description: 'Rebuild or update search index' },
        { name: 'semantic_search', supported: parsed?.indexStats?.vecAvailable ?? false, description: 'Vector-based semantic search (dimension mismatch known issue)' },
      ]
      return { ok: true, data: caps, meta: makeMeta('capabilities', Date.now() - t0, false, parsed?.version) }
    } catch (e) {
      return { ok: false, data: null, meta: makeMeta('capabilities', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
    }
  })
}

export async function getStats(): Promise<AdapterResult<AkmStats>> {
  return withTiming('stats', async () => {
    const t0 = Date.now()
    try {
      const { stdout } = await runAkm(['info'], loadConfig().processTimeout)
      const parsed = parseJson<RawInfo>(stdout)
      return {
        ok: true,
        data: {
          total_entries: parsed?.indexStats?.entryCount ?? 0,
          total_embeddings: parsed?.indexStats?.embeddingCount ?? 0,
          vec_available: parsed?.indexStats?.vecAvailable ?? false,
          sources_count: parsed?.sourceProviders?.length ?? 0,
          asset_types: parsed?.assetTypes ?? [],
          search_modes: parsed?.searchModes ?? [],
        },
        meta: makeMeta('stats', Date.now() - t0, false, parsed?.version),
      }
    } catch (e) {
      return { ok: false, data: null, meta: makeMeta('stats', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
    }
  })
}

interface SearchOptions {
  query: string
  type?: string
  limit?: number
}

export async function search(opts: SearchOptions): Promise<AdapterResult<AkmSearchHit[]>> {
  return withTiming('search', async () => {
    const t0 = Date.now()
    const cfg = loadConfig()

    if (!opts.query || opts.query.length === 0) {
      return { ok: false, data: null, meta: makeMeta('search', Date.now() - t0), error: { code: 'INVALID_INPUT', message: 'Search query is required' } }
    }
    if (opts.query.length > cfg.maxQueryLength) {
      return { ok: false, data: null, meta: makeMeta('search', Date.now() - t0), error: { code: 'INVALID_INPUT', message: `Query exceeds ${cfg.maxQueryLength} characters` } }
    }

    const limit = Math.min(opts.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_RESULTS)
    const args = ['search', opts.query]
    if (opts.type) args.push('--type', opts.type)
    args.push('--limit', String(limit))
    args.push('--detail', 'brief')

    try {
      const { stdout } = await runAkm(args, cfg.processTimeout)
      const parsed = parseJson<RawSearchResult>(stdout)

      const hits: AkmSearchHit[] = (parsed?.hits ?? []).map((h: RawSearchHit) => ({
        ref: h.ref ?? h.name ?? '',
        title: h.name ?? 'Untitled',
        type: h.type ?? 'unknown',
        source: h.source ?? h.action?.split(' ')[1] ?? '',
        score: h.score ?? null,
        snippet: h.snippet ?? '',
        modified_at: h.modified_at ?? null,
      }))
      return { ok: true, data: hits, meta: makeMeta('search', Date.now() - t0, false) }
    } catch (e) {
      return { ok: false, data: null, meta: makeMeta('search', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
    }
  })
}

interface ShowOptions {
  ref: string
  maxChars?: number
}

export async function showResource(opts: ShowOptions): Promise<AdapterResult<AkmResource>> {
  return withTiming('show', async () => {
    const t0 = Date.now()
    const cfg = loadConfig()

    if (!opts.ref || opts.ref.length === 0) {
      return { ok: false, data: null, meta: makeMeta('show', Date.now() - t0), error: { code: 'INVALID_INPUT', message: 'Resource reference is required' } }
    }
    if (opts.ref.length > cfg.maxRefLength) {
      return { ok: false, data: null, meta: makeMeta('show', Date.now() - t0), error: { code: 'INVALID_INPUT', message: `Reference exceeds ${cfg.maxRefLength} characters` } }
    }

    const maxChars = Math.min(opts.maxChars ?? cfg.maxContentLength, cfg.maxContentLength)
    const args = ['show', opts.ref, '--shape', 'agent']

    try {
      const { stdout } = await runAkm(args, cfg.processTimeout)

      if (!stdout || stdout.trim().startsWith('{')) {
        const parsed = parseJson<RawShowResult>(stdout)
        if (!parsed) {
          return { ok: false, data: null, meta: makeMeta('show', Date.now() - t0), error: { code: 'PARSE_ERROR', message: 'Could not parse AKM show output' } }
        }
        if (parsed.type === 'error' || (parsed as Record<string, unknown>).error) {
          return { ok: false, data: null, meta: makeMeta('show', Date.now() - t0), error: { code: 'NOT_FOUND', message: `Resource not found: ${opts.ref}` } }
        }
        let content = parsed.content ?? JSON.stringify(parsed, null, 2)
        const truncated = content.length > maxChars
        if (truncated) content = content.slice(0, maxChars) + '\n... [truncated]'

        return {
          ok: true,
          data: {
            ref: opts.ref,
            title: parsed.name ?? opts.ref,
            type: parsed.type ?? 'unknown',
            source: parsed.origin ?? '',
            content,
            truncated,
            metadata: typeof parsed === 'object' && parsed !== null ? Object.fromEntries(Object.entries(parsed).filter(([k]) => !['content', 'name', 'type', 'origin', 'path', 'editable'].includes(k))) : {},
          },
          meta: makeMeta('show', Date.now() - t0, truncated),
        }
      }

      const truncated = stdout.length > maxChars
      const content = truncated ? stdout.slice(0, maxChars) + '\n... [truncated]' : stdout
      return {
        ok: true,
        data: {
          ref: opts.ref,
          title: opts.ref,
          type: 'knowledge',
          source: '',
          content,
          truncated,
          metadata: {},
        },
        meta: makeMeta('show', Date.now() - t0, truncated),
      }
    } catch (e) {
      return { ok: false, data: null, meta: makeMeta('show', Date.now() - t0), error: { code: 'AKM_ERROR', message: (e as Error).message } }
    }
  })
}

/* ── Agent run tracking ── */

const agentRunLog: AgentRunRecord[] = []

export function recordAgentRun(run: AgentRunRecord) {
  agentRunLog.unshift(run)
  const cfg = loadConfig()
  if (agentRunLog.length > cfg.maxAgentRuns) {
    agentRunLog.length = cfg.maxAgentRuns
  }
}

export function getAgentRuns(limit = 50): AgentRunRecord[] {
  return agentRunLog.slice(0, limit)
}

export function getAgentMode(): AgentMode {
  return loadConfig().agentMode
}
