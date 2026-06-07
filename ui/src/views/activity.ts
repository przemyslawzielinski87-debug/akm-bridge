import { getState, setState, subscribe, setLoading, clearError, setError } from '../state.js'
import { escape, spinner, errorBox, formatTime, formatDuration } from '../render.js'
import { getWriteActivity } from '../write-api.js'

function renderActivity() {
  const container = document.getElementById('akm-panel-view-content')
  if (!container) return

  const act = getState().activity
  const writeAct = getState().writeActivity
  const err = getState().error['refresh']
  const writeErr = getState().error['write_activity']

  if (!act && getState().loading['refresh']) {
    container.innerHTML = `<div class="akm-panel-center">${spinner()}</div>`
    return
  }

  container.innerHTML = `
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Recent Read Operations (${act.length})</h2>
      <div class="akm-panel-table-wrap">
        <table class="akm-panel-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Operation</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Results</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            ${act.length > 0 ? act.map(a => `
              <tr class="${a.success ? '' : 'akm-panel-row-err'}">
                <td>${formatTime(a.timestamp)}</td>
                <td><code>${escape(a.operation)}</code></td>
                <td>${a.success ? '<span class="akm-panel-badge akm-panel-badge-ok">OK</span>' : '<span class="akm-panel-badge akm-panel-badge-err">FAIL</span>'}</td>
                <td>${a.duration_ms}ms</td>
                <td>${a.result_count != null ? String(a.result_count) : '-'}</td>
                <td class="akm-panel-cell-ref">${a.resource_ref ? escape(a.resource_ref) : '-'}</td>
              </tr>
            `).join('') : '<tr><td colspan="6" class="akm-panel-center"><p class="akm-panel-muted">No read activity</p></td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Write Operations</h2>
      ${writeErr ? errorBox('WRITE_ACTIVITY', writeErr) : ''}
      <button class="akm-panel-btn akm-panel-btn-sm" id="akm-panel-load-write-activity">Load write activity</button>
      <div class="akm-panel-table-wrap" id="akm-panel-write-activity-table" style="display:none">
        <table class="akm-panel-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Operation</th>
              <th>Result</th>
              <th>Duration</th>
              <th>Reference</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody id="akm-panel-write-activity-body">
          </tbody>
        </table>
      </div>
    </section>
  `

  if (writeAct.length > 0) renderWriteActivityTable()

  document.getElementById('akm-panel-load-write-activity')?.addEventListener('click', loadWriteActivity)
}

async function loadWriteActivity() {
  setLoading('write_activity', true)
  clearError('write_activity')

  const result = await getWriteActivity()
  setLoading('write_activity', false)

  if (result.ok) {
    setState({ writeActivity: result.data ?? [] })
    const table = document.getElementById('akm-panel-write-activity-table')
    if (table) table.style.display = ''
    renderWriteActivityTable()
  } else {
    setError('write_activity', result.error?.message ?? 'Failed to load write activity')
  }
}

function renderWriteActivityTable() {
  const tbody = document.getElementById('akm-panel-write-activity-body')
  if (!tbody) return

  const wa = getState().writeActivity
  if (wa.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="akm-panel-center"><p class="akm-panel-muted">No write activity recorded.</p></td></tr>'
    return
  }

  tbody.innerHTML = wa.map(a => `
    <tr class="${a.result === 'success' ? '' : 'akm-panel-row-err'}">
      <td>${formatTime(a.timestamp)}</td>
      <td><code>${escape(a.operation)}</code></td>
      <td>${a.result === 'success' ? '<span class="akm-panel-badge akm-panel-badge-ok">OK</span>' : '<span class="akm-panel-badge akm-panel-badge-err">FAIL</span>'}</td>
      <td>${formatDuration(a.duration_ms)}</td>
      <td class="akm-panel-cell-ref">${a.resource_ref ? escape(a.resource_ref) : '-'}</td>
      <td>${a.summary ? escape(a.summary) : '-'}</td>
    </tr>
  `).join('')
}

subscribe(() => {
  if (getState().view === 'activity') renderActivity()
})

document.addEventListener('akm-nav', ((e: CustomEvent) => {
  if (e.detail === 'activity') renderActivity()
}) as EventListener)
