import { getState, subscribe, setLoading, clearError, setError } from '../state.js'
import { datum, escape, statusBadge, spinner, errorBox } from '../render.js'
import { reindex, prepareAction, getCurrentOperation } from '../write-api.js'

let reindexInProgress = false

function renderOverview() {
  const container = document.getElementById('akm-panel-view-content')
  if (!container) return
  const st = getState().status
  const si = getState().stats
  const err = getState().error['refresh']
  const loading = getState().loading['refresh']
  const reindexErr = getState().error['reindex']
  const reindexLoading = getState().loading['reindex']

  if (loading && !st) {
    container.innerHTML = `<div class="akm-panel-center">${spinner()}<p>Loading…</p></div>`
    return
  }

  if (err && !st) {
    container.innerHTML = `<div class="akm-panel-center">${errorBox('CONNECTION', err)}<p class="akm-panel-muted">AKM bridge is unavailable. Check the akm-bridge service.</p></div>`
    return
  }

  container.innerHTML = `
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Status</h2>
      <div class="akm-panel-grid akm-panel-grid-4">
        ${datum('Health', st ? (st.healthy ? 'Healthy' : 'Unhealthy') : null)}
        ${datum('AKM Version', st?.version ?? null)}
        ${datum('Entries', si?.total_entries ?? null)}
        ${datum('Sources', si?.sources_count ?? null)}
        ${datum('Embeddings', si?.total_embeddings ?? null)}
        ${datum('Vector Search', si?.vec_available ? 'Available' : 'Unavailable')}
        ${datum('Last Index', st?.last_index_time ? new Date(st.last_index_time).toLocaleString() : null)}
        ${datum('Asset Types', si?.asset_types?.length ?? null)}
      </div>
    </section>
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Search Modes</h2>
      <div class="akm-panel-tag-list">
        ${(si?.search_modes ?? []).map(m => `<span class="akm-panel-tag">${escape(m)}</span>`).join('')}
      </div>
    </section>
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Management</h2>
      ${reindexErr ? errorBox('REINDEX', reindexErr) : ''}
      ${reindexLoading ? `<p class="akm-panel-muted">${spinner()} Reindexing… Search may be temporarily unavailable.</p>` : ''}
      ${!reindexLoading ? `
        <button class="akm-panel-btn" id="akm-panel-reindex-btn" ${reindexInProgress ? 'disabled' : ''}>
          Rebuild Index
        </button>
        <p class="akm-panel-hint">Rebuild the AKM knowledge index from all configured sources.</p>
      ` : ''}
    </section>
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Recent Activity</h2>
      <div class="akm-panel-activity-mini">
        ${(getState().activity?.slice(0, 5) ?? []).length > 0
          ? getState().activity.slice(0, 5).map(a =>
              `<div class="akm-panel-activity-row">
                <span class="akm-panel-activity-op ${a.success ? '' : 'akm-panel-activity-fail'}">${escape(a.operation)}</span>
                <span class="akm-panel-activity-time">${new Date(a.timestamp).toLocaleTimeString()}</span>
                <span class="akm-panel-activity-dur">${a.duration_ms}ms</span>
              </div>`
            ).join('')
          : '<p class="akm-panel-muted">No recent activity</p>'}
      </div>
    </section>
  `

  document.getElementById('akm-panel-reindex-btn')?.addEventListener('click', handleReindex)
}

async function handleReindex() {
  if (reindexInProgress) return
  const reason = window.prompt('Rebuilding the AKM index may temporarily make search unavailable. Type "reindex" to confirm:')
  if (reason?.toLowerCase() !== 'reindex') return

  setLoading('reindex', true)
  reindexInProgress = true

  const prep = await prepareAction('reindex')
  if (!prep.ok || !prep.data) {
    setError('reindex', prep.error?.message ?? 'Failed to prepare reindex')
    setLoading('reindex', false)
    reindexInProgress = false
    return
  }

  const result = await reindex(prep.data.confirmation_token)
  setLoading('reindex', false)
  reindexInProgress = false

  if (result.ok) {
    dispatchEvent(new CustomEvent('akm-refresh'))
  } else {
    setError('reindex', result.error?.message ?? 'Reindex failed')
  }
}

subscribe(() => {
  if (getState().view === 'overview') renderOverview()
})

document.addEventListener('akm-nav', ((e: CustomEvent) => {
  if (e.detail === 'overview') renderOverview()
}) as EventListener)
