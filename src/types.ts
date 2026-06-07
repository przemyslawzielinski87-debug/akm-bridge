/* ── Normalized AKM response contracts ── */

export interface AdapterMeta {
  operation: string
  duration_ms: number
  truncated: boolean
  akm_version?: string
}

export interface AdapterSuccess<T> {
  ok: true
  data: T
  meta: AdapterMeta
  error?: null | undefined
}

export interface AdapterError {
  ok: false
  data: null
  meta: AdapterMeta
  error: {
    code: string
    message: string
    details?: string
  }
}

export type AdapterResult<T> = AdapterSuccess<T> | AdapterError

/* ── Domain models ── */

export interface AkmStatus {
  version: string
  binary: string
  healthy: boolean
  entry_count: number | null
  last_index_time: string | null
  config_path: string | null
  data_path: string | null
}

export interface AkmSource {
  id: string
  name: string
  path: string
  type: 'local' | 'managed' | 'registry'
  writable: boolean
  entry_count: number | null
  last_sync_time: string | null
}

export interface AkmCapability {
  name: string
  supported: boolean
  description: string
}

export interface AkmStats {
  total_entries: number
  total_embeddings: number
  vec_available: boolean
  sources_count: number
  asset_types: string[]
  search_modes: string[]
}

export interface AkmSearchHit {
  ref: string
  title: string
  type: string
  source: string
  score: number | null
  snippet: string
  modified_at: string | null
}

export interface AkmResource {
  ref: string
  title: string
  type: string
  source: string
  content: string
  truncated: boolean
  metadata: Record<string, unknown>
}

export interface ActivityRecord {
  timestamp: string
  operation: string
  success: boolean
  duration_ms: number
  result_count?: number
  resource_ref?: string
}

/* ── Proposal and Feedback models ── */

export interface AkmProposal {
  id: string
  name: string
  type: string
  status: string
  created_at: string | null
  source?: string
  summary?: string
}

export interface AkmProposalDiff {
  id: string
  name: string
  type: string
  status: string
  content?: string
  diff?: string
  reason?: string
  source?: string
  created_at?: string
}

export interface AuditEntry {
  timestamp: string
  operation: string
  result: 'success' | 'failure' | 'cancelled'
  duration_ms: number
  resource_ref?: string
  proposal_id?: string
  error_code?: string
  summary: string
}

/* ── Allowlisted operations ── */

export const ALLOWED_OPERATIONS = new Set([
  'health',
  'status',
  'sources',
  'stats',
  'search',
  'show',
  'capabilities',
  'reindex',
  'sync',
  'feedback',
  'proposals',
  'proposal',
  'proposal_accept',
  'proposal_reject',
  'remember',
  'lesson_proposal',
] as const)

export type AllowedOperation = 'health' | 'status' | 'sources' | 'stats' | 'search' | 'show' | 'capabilities'
  | 'reindex' | 'sync' | 'feedback' | 'proposals' | 'proposal'
  | 'proposal_accept' | 'proposal_reject' | 'remember' | 'lesson_proposal'

/* ── Agent mode ── */

export type AgentMode = 'off' | 'manual' | 'supervised'

export interface AgentRunRecord {
  run_id: string
  timestamp: string
  akm_decision: 'required' | 'optional' | 'skipped' | null
  queries_count: number
  selected_refs: string[]
  loaded_refs: string[]
  feedback_count: number
  lesson_proposal_created: boolean
  memory_proposal_created: boolean
  fallback_used: boolean
  duration_ms: number
  completed_at?: string
}

/* ── Max output sizes ── */

export const MAX_CONTENT_LENGTH = 500_000    // characters
export const MAX_SEARCH_RESULTS = 25
export const DEFAULT_SEARCH_LIMIT = 10
export const MAX_QUERY_LENGTH = 300
export const MAX_REF_LENGTH = 500
export const PROCESS_TIMEOUT = 15_000        // ms
export const MAX_ACTIVITY_RECORDS = 50

/* ── AKM binary ── */

export const AKM_BINARY = '/root/.bun/bin/akm'
