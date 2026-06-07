export interface ApiResponse<T> {
  ok: boolean
  data: T | null
  meta: {
    operation: string
    duration_ms: number
    truncated: boolean
    akm_version?: string
  }
  error: { code: string; message: string; details?: string } | null
}

export interface AkmStatus {
  version: string
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

export interface AkmProposal {
  id: string
  title: string
  type: string
  status: string
  created_at: string | null
  source: string
  summary: string
  content?: string
  existing?: string
  diff?: string
  reason?: string
}

export interface ConfirmationToken {
  confirmation_token: string
  expires_at: string
  summary: string
}

export interface WriteActivityRecord {
  timestamp: string
  operation: string
  result: string
  duration_ms: number
  resource_ref?: string
  summary?: string
  error_code?: string
}

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
  completed_at: string | null
}

export type View = 'overview' | 'search' | 'sources' | 'activity' | 'capabilities' | 'proposals' | 'agent-usage'
