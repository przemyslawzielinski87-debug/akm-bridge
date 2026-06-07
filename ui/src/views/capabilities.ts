import { getState, subscribe } from '../state.js'
import { escape, spinner, errorBox } from '../render.js'

function renderCapabilities() {
  const container = document.getElementById('akm-panel-view-content')
  if (!container) return

  const caps = getState().capabilities
  const stats = getState().stats
  const err = getState().error['refresh']

  if (!caps.length && getState().loading['refresh']) {
    container.innerHTML = `<div class="akm-panel-center">${spinner()}</div>`
    return
  }

  if (!caps.length && err) {
    container.innerHTML = `<div class="akm-panel-center">${errorBox('ERROR', err)}</div>`
    return
  }

  container.innerHTML = `
    <div class="akm-panel-section">
      <h2 class="akm-panel-section-title">Read-Only Mode</h2>
      <p class="akm-panel-muted">Write actions will be introduced in a later controlled stage.</p>
    </div>
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">AKM v0.8.1 Capabilities</h2>
      <div class="akm-panel-table-wrap">
        <table class="akm-panel-table">
          <thead>
            <tr>
              <th>Operation</th>
              <th>Status</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            ${caps.filter(c => c.supported).map(c => `
              <tr>
                <td><code>${escape(c.name)}</code></td>
                <td><span class="akm-panel-badge akm-panel-badge-ok">Available</span></td>
                <td>${escape(c.description)}</td>
              </tr>
            `).join('')}
            ${caps.filter(c => !c.supported).map(c => `
              <tr>
                <td><code>${escape(c.name)}</code></td>
                <td><span class="akm-panel-badge akm-panel-badge-err">Unavailable</span></td>
                <td>${escape(c.description)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Asset Types (${stats?.asset_types?.length ?? 0})</h2>
      <div class="akm-panel-tag-list">
        ${(stats?.asset_types ?? []).map(t => `<span class="akm-panel-tag">${escape(t)}</span>`).join('')}
      </div>
    </section>
  `
}

subscribe(() => {
  if (getState().view === 'capabilities') renderCapabilities()
})

document.addEventListener('akm-nav', ((e: CustomEvent) => {
  if (e.detail === 'capabilities') renderCapabilities()
}) as EventListener)
