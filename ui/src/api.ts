import type {
  ApiResponse, AkmStatus, AkmSource, AkmCapability,
  AkmStats, AkmSearchHit, AkmResource, ActivityRecord, AgentRunRecord,
} from './types.js'

function getApiBase(): string {
  const p = window.location.pathname
  if (p.startsWith('/akm')) return '/akm/api'
  return '/api/akm'
}

const BASE = getApiBase()

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<ApiResponse<T>> {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    const body = await res.text()
    try { return JSON.parse(body) as ApiResponse<T> } catch {
      return { ok: false, data: null, meta: { operation: 'fetch', duration_ms: 0, truncated: false }, error: { code: 'HTTP_ERROR', message: `HTTP ${res.status}` } }
    }
  }
  return (await res.json()) as ApiResponse<T>
}

export async function getHealth(signal?: AbortSignal): Promise<ApiResponse<{ status: string }>> {
  return fetchJson(`${BASE}/health`, signal)
}

export async function getStatus(signal?: AbortSignal): Promise<ApiResponse<AkmStatus>> {
  return fetchJson(`${BASE}/status`, signal)
}

export async function getSources(signal?: AbortSignal): Promise<ApiResponse<AkmSource[]>> {
  return fetchJson(`${BASE}/sources`, signal)
}

export async function getCapabilities(signal?: AbortSignal): Promise<ApiResponse<AkmCapability[]>> {
  return fetchJson(`${BASE}/capabilities`, signal)
}

export async function getStats(signal?: AbortSignal): Promise<ApiResponse<AkmStats>> {
  return fetchJson(`${BASE}/stats`, signal)
}

export async function getActivity(signal?: AbortSignal): Promise<ApiResponse<ActivityRecord[]>> {
  return fetchJson(`${BASE}/activity`, signal)
}

export async function search(
  query: string,
  type?: string,
  limit?: number,
  signal?: AbortSignal,
): Promise<ApiResponse<AkmSearchHit[]>> {
  const params = new URLSearchParams({ q: query })
  if (type) params.set('type', type)
  if (limit) params.set('limit', String(limit))
  return fetchJson(`${BASE}/search?${params}`, signal)
}

export async function showResource(ref: string, signal?: AbortSignal): Promise<ApiResponse<AkmResource>> {
  return fetchJson(`${BASE}/resource?ref=${encodeURIComponent(ref)}`, signal)
}

export async function getAgentMode(signal?: AbortSignal): Promise<ApiResponse<{ mode: string }>> {
  return fetchJson(`${BASE}/agent/mode`, signal)
}

export async function getAgentRuns(signal?: AbortSignal): Promise<ApiResponse<AgentRunRecord[]>> {
  return fetchJson(`${BASE}/agent/runs`, signal)
}
