import { getState, setState, subscribe, setLoading, clearError, setError } from '../state.js'
import { escape, spinner, errorBox, formatTime, formatDuration } from '../render.js'

function renderAgentUsage() {
  const container = document.getElementById('akm-panel-view-content')
  if (!container) return

  const runs = getState().agentRuns
  const mode = getState().agentMode
  const err = getState().error['agent_usage']

  container.innerHTML = `
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Agent Mode</h2>
      <div class="akm-panel-grid akm-panel-grid-4">
        <div class="akm-panel-datum">
          <span class="akm-panel-datum-label">Mode</span>
          <span class="akm-panel-datum-value">
            <span class="akm-panel-badge ${mode === 'supervised' ? 'akm-panel-badge-info' : 'akm-panel-badge-muted'}">
              ${escape(mode ?? '?')}
            </span>
          </span>
        </div>
        <div class="akm-panel-datum">
          <span class="akm-panel-datum-label">Supervision</span>
          <span class="akm-panel-datum-value">
            <span class="akm-panel-badge ${mode === 'supervised' ? 'akm-panel-badge-info' : 'akm-panel-badge-muted'}">
              ${mode === 'supervised' ? 'Active' : 'Inactive'}
            </span>
          </span>
        </div>
        <div class="akm-panel-datum">
          <span class="akm-panel-datum-label">Recent Runs</span>
          <span class="akm-panel-datum-value">${runs.length}</span>
        </div>
        <div class="akm-panel-datum">
          <span class="akm-panel-datum-label">AKM Used</span>
          <span class="akm-panel-datum-value">
            ${runs.some(r => r.akm_decision === 'required' || r.akm_decision === 'optional')
              ? '<span class="akm-panel-badge akm-panel-badge-ok">Yes</span>'
              : '<span class="akm-panel-badge akm-panel-badge-muted">No recent usage</span>'}
          </span>
        </div>
      </div>
    </section>

    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Recent Agent Runs</h2>
      ${err ? errorBox('AGENT_USAGE', err) : ''}
      ${runs.length > 0 ? `
        <div class="akm-panel-table-wrap">
          <table class="akm-panel-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Decision</th>
                <th>Searches</th>
                <th>Selected</th>
                <th>Loaded</th>
                <th>Feedback</th>
                <th>Lesson</th>
                <th>Memory</th>
                <th>Fallback</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              ${runs.map(r => `
                <tr>
                  <td>${formatTime(r.timestamp)}</td>
                  <td>
                    <span class="akm-panel-badge ${r.akm_decision === 'required' ? 'akm-panel-badge-info' : 'akm-panel-badge-muted'}">
                      ${escape(r.akm_decision ?? '-')}
                    </span>
                  </td>
                  <td>${r.queries_count}</td>
                  <td class="akm-panel-cell-ref">${r.selected_refs.length > 0 ? r.selected_refs.map(s => escape(s)).join(', ') : '-'}</td>
                  <td class="akm-panel-cell-ref">${r.loaded_refs.length > 0 ? r.loaded_refs.map(s => escape(s)).join(', ') : '-'}</td>
                  <td>${r.feedback_count}</td>
                  <td>${r.lesson_proposal_created ? '<span class="akm-panel-badge akm-panel-badge-info">Yes</span>' : '-'}</td>
                  <td>${r.memory_proposal_created ? '<span class="akm-panel-badge akm-panel-badge-info">Yes</span>' : '-'}</td>
                  <td>${r.fallback_used ? '<span class="akm-panel-badge akm-panel-badge-err">Yes</span>' : '-'}</td>
                  <td>${formatDuration(r.duration_ms)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<p class="akm-panel-muted">No agent run data yet. Agent runs are recorded when the agent starts a supervised task.</p>'}
    </section>
  `
}

subscribe(() => {
  if (getState().view === 'agent-usage') renderAgentUsage()
})

document.addEventListener('akm-nav', ((e: CustomEvent) => {
  if (e.detail === 'agent-usage') renderAgentUsage()
}) as EventListener)
