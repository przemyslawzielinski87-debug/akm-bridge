import { getState, setState, subscribe, setLoading, clearError, setError } from '../state.js'
import { listProposals, showProposal, acceptProposal, rejectProposal, prepareAction } from '../write-api.js'
import { escape, typeBadge, spinner, errorBox, formatTime, truncate } from '../render.js'

function renderProposals() {
  const container = document.getElementById('akm-panel-view-content')
  if (!container) return

  const st = getState()
  const loading = st.loading['proposals']
  const err = st.error['proposals']
  const sel = st.selectedProposal

  container.innerHTML = `
    <div class="akm-panel-proposals-container${sel ? ' akm-panel-split' : ''}">
      <div class="akm-panel-proposals-list">
        <div class="akm-panel-proposals-header">
          <h2 class="akm-panel-section-title">Proposals</h2>
          <div class="akm-panel-proposals-filter">
            <button class="akm-panel-filter ${(!st.writeActivityFilter || st.writeActivityFilter === 'all') ? 'akm-panel-filter-active' : ''}" data-status="">All</button>
            <button class="akm-panel-filter ${st.writeActivityFilter === 'pending' ? 'akm-panel-filter-active' : ''}" data-status="pending">Pending</button>
            <button class="akm-panel-filter ${st.writeActivityFilter === 'accepted' ? 'akm-panel-filter-active' : ''}" data-status="accepted">Accepted</button>
            <button class="akm-panel-filter ${st.writeActivityFilter === 'rejected' ? 'akm-panel-filter-active' : ''}" data-status="rejected">Rejected</button>
          </div>
        </div>
        ${loading ? `<div class="akm-panel-center">${spinner()}</div>` : ''}
        ${err && !loading ? errorBox('PROPOSALS', err) : ''}
        ${!loading ? renderProposalList() : ''}
      </div>
      <div class="akm-panel-proposal-detail" id="akm-panel-proposal-detail" ${sel ? '' : 'style="display:none"'}>
        ${sel ? renderProposalDetail(sel) : ''}
      </div>
    </div>
  `

  document.querySelectorAll('.akm-panel-proposals-filter .akm-panel-filter').forEach(el => {
    el.addEventListener('click', () => {
      const status = (el as HTMLElement).dataset.status ?? ''
      setState({ writeActivityFilter: status || 'all' })
      document.querySelectorAll('.akm-panel-proposals-filter .akm-panel-filter').forEach(b => b.classList.remove('akm-panel-filter-active'))
      el.classList.add('akm-panel-filter-active')
      loadProposals()
    })
  })
}

function renderProposalList(): string {
  const st = getState()
  if (st.proposals.length === 0) {
    return '<div class="akm-panel-center"><p class="akm-panel-muted">No proposals found.</p></div>'
  }

  return st.proposals.map(p => `
    <div class="akm-panel-proposal-card${st.selectedProposal?.id === p.id ? ' akm-panel-proposal-card-active' : ''}"
         data-proposal-id="${escape(p.id)}" tabindex="0" role="button">
      <div class="akm-panel-proposal-card-header">
        <span class="akm-panel-proposal-card-title">${escape(truncate(p.title, 80))}</span>
        <span class="akm-panel-proposal-status akm-panel-proposal-status-${escape(p.status)}">${escape(p.status)}</span>
      </div>
      <div class="akm-panel-proposal-card-meta">
        ${typeBadge(p.type)} <span>${escape(p.source)}</span>
        ${p.created_at ? `<span>${formatTime(p.created_at)}</span>` : ''}
      </div>
      <div class="akm-panel-proposal-card-summary">${escape(truncate(p.summary || '(no summary)', 120))}</div>
    </div>
  `).join('')
}

function renderProposalDetail(p: AkmProposal): string {
  return `
    <div class="akm-panel-preview-inner">
      <div class="akm-panel-preview-header">
        <div>
          <h3 class="akm-panel-preview-title">${escape(p.title)}</h3>
          <div class="akm-panel-preview-meta">
            ${typeBadge(p.type)}
            <span class="akm-panel-proposal-status akm-panel-proposal-status-${escape(p.status)}">${escape(p.status)}</span>
            <span>${escape(p.source)}</span>
            ${p.created_at ? `<span>${formatTime(p.created_at)}</span>` : ''}
          </div>
        </div>
        <button class="akm-panel-btn akm-panel-btn-icon" id="akm-panel-proposal-close" aria-label="Close proposal">&times;</button>
      </div>
      <div class="akm-panel-preview-content akm-panel-proposal-content">
        ${p.content ? `<h4>Proposed Content</h4><pre class="akm-panel-preview-text">${escape(p.content)}</pre>` : ''}
        ${p.diff ? `<h4>Diff</h4><pre class="akm-panel-preview-text">${escape(p.diff)}</pre>` : ''}
        ${p.reason ? `<h4>Reason</h4><p>${escape(p.reason)}</p>` : ''}
      </div>
      <div class="akm-panel-preview-actions">
        ${p.status === 'pending' ? `
          <button class="akm-panel-btn akm-panel-btn-primary" id="akm-panel-proposal-accept">Accept</button>
          <button class="akm-panel-btn akm-panel-btn-danger" id="akm-panel-proposal-reject">Reject</button>
        ` : ''}
      </div>
    </div>
  `
}

function setupProposalDetailHandlers() {
  document.getElementById('akm-panel-proposal-close')?.addEventListener('click', closeProposalDetail)
  document.getElementById('akm-panel-proposal-accept')?.addEventListener('click', handleAccept)
  document.getElementById('akm-panel-proposal-reject')?.addEventListener('click', handleReject)
}

async function handleAccept() {
  const p = getState().selectedProposal
  if (!p) return

  const reason = window.prompt('Accept proposal "' + p.title + '"? Type "yes" to confirm:')
  if (reason?.toLowerCase() !== 'yes') return

  setLoading('proposal_accept', true)
  clearError('proposal_accept')

  const prep = await prepareAction('proposal_accept', { proposal_id: p.id })
  if (!prep.ok || !prep.data) {
    setError('proposal_accept', prep.error?.message ?? 'Failed to prepare acceptance')
    setLoading('proposal_accept', false)
    return
  }

  const result = await acceptProposal(p.id, prep.data.confirmation_token)
  setLoading('proposal_accept', false)

  if (result.ok) {
    setState({ selectedProposal: null })
    loadProposals()
  } else {
    setError('proposal_accept', result.error?.message ?? 'Acceptance failed')
  }
}

async function handleReject() {
  const p = getState().selectedProposal
  if (!p) return

  const reason = window.prompt('Reason for rejecting "' + p.title + '":')
  if (!reason?.trim()) return

  setLoading('proposal_reject', true)
  clearError('proposal_reject')
  const result = await rejectProposal(p.id, reason.trim())
  setLoading('proposal_reject', false)

  if (result.ok) {
    setState({ selectedProposal: null })
    loadProposals()
  } else {
    setError('proposal_reject', result.error?.message ?? 'Rejection failed')
  }
}

function closeProposalDetail() {
  setState({ selectedProposal: null })
  const container = document.getElementById('akm-panel-view-content')
  container?.classList.remove('akm-panel-split')
}

async function loadProposals() {
  setLoading('proposals', true)
  clearError('proposals')

  const status = getState().writeActivityFilter === 'all' ? undefined : getState().writeActivityFilter
  const result = await listProposals(status)
  setLoading('proposals', false)

  if (result.ok) {
    setState({ proposals: result.data ?? [] })
  } else {
    setError('proposals', result.error?.message ?? 'Failed to load proposals')
  }
}

async function openProposalDetail(id: string) {
  setLoading('proposal_detail', true)
  clearError('proposal_detail')

  const result = await showProposal(id)
  setLoading('proposal_detail', false)

  if (result.ok && result.data) {
    setState({ selectedProposal: result.data })
  } else {
    setError('proposal_detail', result.error?.message ?? 'Failed to load proposal')
  }
}

subscribe(() => {
  if (getState().view === 'proposals') {
    if (getState().proposals.length === 0) loadProposals()
    renderProposals()
  }
})

document.addEventListener('akm-nav', ((e: CustomEvent) => {
  if (e.detail === 'proposals') {
    renderProposals()
  }
}) as EventListener)

document.getElementById('akm-panel-view-content')?.addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest('.akm-panel-proposal-card') as HTMLElement
  if (!card) return
  const id = card.dataset.proposalId
  if (id) openProposalDetail(id)
})
