import type { ApiResponse, AkmProposal, ConfirmationToken, WriteActivityRecord } from './types.js'

function getApiBase(): string {
  const p = window.location.pathname
  if (p.startsWith('/akm')) return '/akm/api'
  return '/api/akm'
}

const BASE = getApiBase()

async function postJson<T>(url: string, body: unknown): Promise<ApiResponse<T>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  try { return JSON.parse(text) as ApiResponse<T> } catch {
    return { ok: false, data: null, meta: { operation: 'write', duration_ms: 0, truncated: false }, error: { code: 'PARSE_ERROR', message: `HTTP ${res.status}` } } as ApiResponse<T>
  }
}

export async function prepareAction(operation: string, params?: Record<string, string>): Promise<ApiResponse<ConfirmationToken>> {
  return postJson(`${BASE}/actions/prepare`, { operation, ...params })
}

export async function reindex(token: string): Promise<ApiResponse<{ status: string }>> {
  return postJson(`${BASE}/reindex`, { confirmation_token: token })
}

export async function syncSource(sourceId: string, token: string): Promise<ApiResponse<{ status: string }>> {
  return postJson(`${BASE}/sync`, { source_id: sourceId, confirmation_token: token })
}

export async function submitFeedback(ref: string, positive: boolean, reason?: string): Promise<ApiResponse<{ status: string }>> {
  return postJson(`${BASE}/feedback`, { ref, positive, reason: reason || undefined })
}

export async function listProposals(status?: string): Promise<ApiResponse<AkmProposal[]>> {
  const params = status ? `?status=${encodeURIComponent(status)}` : ''
  const res = await fetch(`${BASE}/proposals${params}`)
  const text = await res.text()
  try { return JSON.parse(text) as ApiResponse<AkmProposal[]> } catch {
    return { ok: false, data: null, meta: { operation: 'list', duration_ms: 0, truncated: false }, error: { code: 'PARSE_ERROR', message: `HTTP ${res.status}` } } as ApiResponse<AkmProposal[]>
  }
}

export async function showProposal(id: string): Promise<ApiResponse<{ proposal: AkmProposal; content: string; diff: string | null }>> {
  const res = await fetch(`${BASE}/proposals/${encodeURIComponent(id)}`)
  const text = await res.text()
  try { return JSON.parse(text) as ApiResponse<{ proposal: AkmProposal; content: string; diff: string | null }> } catch {
    return { ok: false, data: null, meta: { operation: 'show', duration_ms: 0, truncated: false }, error: { code: 'PARSE_ERROR', message: `HTTP ${res.status}` } } as ApiResponse<{ proposal: AkmProposal; content: string; diff: string | null }>
  }
}

export async function acceptProposal(id: string, token: string): Promise<ApiResponse<{ status: string }>> {
  return postJson(`${BASE}/proposals/${encodeURIComponent(id)}/accept`, { confirmation_token: token })
}

export async function rejectProposal(id: string, reason: string, token: string): Promise<ApiResponse<{ status: string }>> {
  return postJson(`${BASE}/proposals/${encodeURIComponent(id)}/reject`, { reason, confirmation_token: token })
}

export async function remember(content: string, name?: string, tags?: string, token?: string): Promise<ApiResponse<{ status: string }>> {
  return postJson(`${BASE}/memories`, { content, name: name || undefined, tags: tags || undefined, confirmation_token: token || '' })
}

export async function createLessonProposal(data: { title: string; situation: string; cause: string; resolution: string; rule: string; scope: string }, token?: string): Promise<ApiResponse<{ status: string }>> {
  return postJson(`${BASE}/lesson-proposals`, { ...data, confirmation_token: token || '' })
}

export async function getWriteActivity(): Promise<ApiResponse<WriteActivityRecord[]>> {
  const res = await fetch(`${BASE}/write-activity`)
  const text = await res.text()
  try { return JSON.parse(text) as ApiResponse<WriteActivityRecord[]> } catch {
    return { ok: false, data: null, meta: { operation: 'write-activity', duration_ms: 0, truncated: false }, error: { code: 'PARSE_ERROR', message: `HTTP ${res.status}` } } as ApiResponse<WriteActivityRecord[]>
  }
}

export async function getCurrentOperation(): Promise<ApiResponse<{ operation: string | null; state: string | null; start_time: string | null; duration_ms: number | null }>> {
  const res = await fetch(`${BASE}/operations/current`)
  const text = await res.text()
  try { return JSON.parse(text) as ApiResponse<{ operation: string | null; state: string | null; start_time: string | null; duration_ms: number | null }> } catch {
    return { ok: false, data: null, meta: { operation: 'current-op', duration_ms: 0, truncated: false }, error: { code: 'PARSE_ERROR', message: `HTTP ${res.status}` } } as ApiResponse<{ operation: string | null; state: string | null; start_time: string | null; duration_ms: number | null }>
  }
}
