import type { View, AkmStatus, AkmSource, AkmCapability, AkmStats, AkmSearchHit, ActivityRecord, AkmProposal, WriteActivityRecord, AgentRunRecord } from './types.js'

interface AppState {
  view: View
  status: AkmStatus | null
  sources: AkmSource[]
  capabilities: AkmCapability[]
  stats: AkmStats | null
  activity: ActivityRecord[]
  searchQuery: string
  searchType: string
  searchResults: AkmSearchHit[]
  searchDuration: number | null
  previewRef: string | null
  previewContent: string | null
  previewTitle: string | null
  previewType: string | null
  previewTruncated: boolean
  proposals: AkmProposal[]
  selectedProposal: AkmProposal | null
  writeActivity: WriteActivityRecord[]
  currentOperation: string | null
  writeActivityFilter: string
  agentMode: string
  agentRuns: AgentRunRecord[]
  loading: Record<string, boolean>
  error: Record<string, string>
  lastRefresh: string | null
}

let state: AppState = {
  view: 'overview',
  status: null,
  sources: [],
  capabilities: [],
  stats: null,
  activity: [],
  searchQuery: '',
  searchType: '',
  searchResults: [],
  searchDuration: null,
  previewRef: null,
  previewContent: null,
  previewTitle: null,
  previewType: null,
  previewTruncated: false,
  proposals: [],
  selectedProposal: null,
  writeActivity: [],
  currentOperation: null,
  writeActivityFilter: 'all',
  agentMode: 'supervised',
  agentRuns: [],
  loading: {},
  error: {},
  lastRefresh: null,
}

type Listener = () => void
const listeners = new Set<Listener>()

export function getState(): AppState {
  return state
}

export function setState(partial: Partial<AppState>) {
  state = { ...state, ...partial }
  listeners.forEach(fn => fn())
}

export function setLoading(key: string, val: boolean) {
  state = { ...state, loading: { ...state.loading, [key]: val } }
  listeners.forEach(fn => fn())
}

export function setError(key: string, msg: string) {
  state = { ...state, error: { ...state.error, [key]: msg } }
  listeners.forEach(fn => fn())
}

export function clearError(key: string) {
  const next = { ...state.error }
  delete next[key]
  state = { ...state, error: next }
  listeners.forEach(fn => fn())
}

export function subscribe(fn: Listener) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
