import { getState, setState, subscribe, setLoading, clearError, setError } from '../state.js'
import { escape, spinner, errorBox } from '../render.js'
import { syncSource, prepareAction } from '../write-api.js'

let syncInProgress = false

function renderSources() {
  const container = document.getElementById('akm-panel-view-content')
  if (!container) return

  const sr = getState().sources
  const err = getState().error['refresh']
  const syncErr = getState().error['sync']
  const syncLoading = getState().loading['sync']

  if (!sr && getState().loading['refresh']) {
    container.innerHTML = `<div class="akm-panel-center">${spinner()}</div>`
    return
  }

  if (sr.length === 0 && !err) {
    container.innerHTML = '<div class="akm-panel-center"><p class="akm-panel-muted">No sources configured.</p></div>'
    return
  }

  if (sr.length === 0 && err) {
    container.innerHTML = `<div class="akm-panel-center">${errorBox('ERROR', err)}</div>`
    return
  }

  container.innerHTML = `
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Sources (${sr.length})</h2>
      ${syncErr ? errorBox('SYNC', syncErr) : ''}
      <div class="akm-panel-source-list">
        ${sr.map(s => `
          <div class="akm-panel-source">
            <div class="akm-panel-source-header">
              <strong>${escape(s.name)}</strong>
              <span class="akm-panel-badge ${s.writable ? 'akm-panel-badge-ok' : 'akm-panel-badge-muted'}">${s.writable ? 'Writable' : 'Read-only'}</span>
              <span class="akm-panel-badge akm-panel-badge-info">${escape(s.type)}</span>
            </div>
            <div class="akm-panel-source-path">${escape(s.path)}</div>
            <div class="akm-panel-source-meta">
              ${s.id ? `<span>ID: ${escape(s.id)}</span>` : ''}
              ${s.last_sync_time ? `<span>Last sync: ${new Date(s.last_sync_time).toLocaleString()}</span>` : ''}
            </div>
            ${s.writable ? `
              <button class="akm-panel-btn akm-panel-btn-sm akm-panel-source-sync"
                      data-source-id="${escape(s.id || s.name)}"
                      ${syncInProgress ? 'disabled' : ''}>
                ${syncInProgress ? 'Syncing…' : 'Sync'}
              </button>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </section>
  `

  document.querySelectorAll('.akm-panel-source-sync').forEach(el => {
    el.addEventListener('click', () => {
      const sourceId = (el as HTMLElement).dataset.sourceId
      if (sourceId) handleSync(sourceId)
    })
  })
}

async function handleSync(sourceId: string) {
  if (syncInProgress) return
  const reason = window.prompt(`Sync source "${sourceId}"? Type "sync" to confirm:`)
  if (reason?.toLowerCase() !== 'sync') return

  setLoading('sync', true)
  syncInProgress = true
  clearError('sync')

  const prep = await prepareAction('sync', { source_id: sourceId })
  if (!prep.ok || !prep.data) {
    setError('sync', prep.error?.message ?? 'Failed to prepare sync')
    setLoading('sync', false)
    syncInProgress = false
    return
  }

  const result = await syncSource(sourceId, prep.data.confirmation_token)
  setLoading('sync', false)
  syncInProgress = false

  if (result.ok) {
    dispatchEvent(new CustomEvent('akm-refresh'))
  } else {
    setError('sync', result.error?.message ?? 'Sync failed')
  }
}

subscribe(() => {
  if (getState().view === 'sources') renderSources()
})

document.addEventListener('akm-nav', ((e: CustomEvent) => {
  if (e.detail === 'sources') renderSources()
}) as EventListener)
