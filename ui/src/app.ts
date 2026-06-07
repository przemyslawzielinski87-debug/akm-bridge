import './views/overview.js'
import './views/search.js'
import './views/sources.js'
import './views/activity.js'
import './views/capabilities.js'
import './views/proposals.js'
import './views/agent-usage.js'
import { getState, setState, subscribe, setLoading, setError, clearError } from './state.js'
import { getHealth, getStatus, getSources, getCapabilities, getStats, getActivity, getAgentMode, getAgentRuns } from './api.js'
import { escape, formatTime } from './render.js'
import type { ApiResponse, View } from './types.js'

const ROOT = '#akm-knowledge-panel-root'
const VIEWS = ['overview', 'search', 'sources', 'proposals', 'agent-usage', 'activity', 'capabilities'] as const

function renderLayout() {
  const root = document.querySelector(ROOT)
  if (!root) return

  const view = getState().view
  const st = getState().status

  root.innerHTML = `
    <div class="akm-panel">
      <header class="akm-panel-header">
        <div class="akm-panel-header-left">
          <svg class="akm-panel-logo" width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect x="2" y="2" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.5" fill="none"/>
            <path d="M6 10h8M10 6v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <h1 class="akm-panel-title">AKM Knowledge</h1>
          ${st ? `<span class="akm-panel-version">v${escape(st.version)}</span>` : ''}
          ${st ? `<span class="akm-panel-health-dot ${st.healthy ? 'akm-panel-health-ok' : 'akm-panel-health-err'}"></span>` : ''}
        </div>
        <div class="akm-panel-header-right">
          <span class="akm-panel-refresh-time">${getState().lastRefresh ? formatTime(getState().lastRefresh) : ''}</span>
          <button class="akm-panel-btn akm-panel-btn-icon" id="akm-panel-refresh" title="Refresh" aria-label="Refresh">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 8a6 6 0 0 1 10.47-3.97M14 8a6 6 0 0 1-10.47 3.97" stroke-linecap="round"/>
              <path d="M14 2v4h-4M2 14v-4h4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </header>
      <nav class="akm-panel-nav" role="tablist">
        ${VIEWS.map(v => `
          <button class="akm-panel-nav-item ${view === v ? 'akm-panel-nav-active' : ''}"
                  data-view="${v}" role="tab" aria-selected="${view === v}">
            ${capitalize(v)}
          </button>
        `).join('')}
      </nav>
      <main class="akm-panel-main">
        <div class="akm-panel-view" id="akm-panel-view-content"></div>
      </main>
      <div class="akm-panel-readonly-banner">Read-only mode</div>
    </div>
  `

  document.querySelectorAll('.akm-panel-nav-item').forEach(el => {
    el.addEventListener('click', () => {
      const v = (el as HTMLElement).dataset.view as typeof VIEWS[number]
      setState({ view: v })
      dispatchEvent(new CustomEvent('akm-nav', { detail: v }))
    })
  })

  document.getElementById('akm-panel-refresh')?.addEventListener('click', refreshAll)
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

async function refreshAll() {
  setLoading('refresh', true)
  clearError('refresh')
  const results = await Promise.allSettled([
    getHealth(), getStatus(), getSources(), getCapabilities(), getStats(), getActivity(), getAgentMode(), getAgentRuns(),
  ])
  const errors: string[] = []
  const updates: Record<string, unknown> = {}
  const extract = (r: PromiseSettledResult<unknown>, key: string, fn: (d: unknown) => unknown) => {
    if (r.status === 'fulfilled') {
      const resp = r.value as ApiResponse<unknown>
      if (resp.ok && resp.data != null) updates[key] = fn(resp.data)
      else errors.push(`${key}: ${resp.error?.message ?? 'empty response'}`)
    } else {
      errors.push(`${key}: ${(r.reason as Error).message}`)
    }
  }
  extract(results[1], 'status', d => ({ ...(d as object), healthy: (d as any)?.status === 'pass' || (d as any)?.healthy }))
  extract(results[4], 'stats', d => d)
  extract(results[2], 'sources', d => d)
  extract(results[3], 'capabilities', d => d)
  extract(results[5], 'activity', d => d)
  extract(results[6], 'agentMode', d => (d as any)?.mode ?? 'supervised')
  extract(results[7], 'agentRuns', d => d)

  if (errors.length > 0) setError('refresh', errors.join('; '))
  setLoading('refresh', false)
  renderLayout()
  setState({ ...updates as any, lastRefresh: new Date().toISOString() })
  dispatchEvent(new CustomEvent('akm-nav', { detail: getState().view }))
}

subscribe(() => {
  const appRoot = document.querySelector(ROOT)
  if (appRoot && !appRoot.querySelector('.akm-panel')) {
    renderLayout()
  }
})

document.addEventListener('DOMContentLoaded', () => {
  renderLayout()
  refreshAll()
})

document.addEventListener('akm-refresh', () => {
  refreshAll()
})

export function navigateTo(view: View) {
  setState({ view })
  renderLayout()
  dispatchEvent(new CustomEvent('akm-nav', { detail: view }))
}

export { escape, formatTime, datum, statusBadge, typeBadge, spinner, errorBox, truncate } from './render.js'
