import { getState, setState, subscribe, setLoading, clearError, setError } from '../state.js'
import { search, showResource } from '../api.js'
import { submitFeedback } from '../write-api.js'
import { escape, typeBadge, spinner, errorBox, formatTime, truncate } from '../render.js'

let abortController: AbortController | null = null

function renderSearch() {
  const container = document.getElementById('akm-panel-view-content')
  if (!container) return

  const st = getState()
  const err = st.error['search']
  const loading = st.loading['search']
  const allTypes = st.capabilities?.length > 0
    ? st.capabilities.filter(c => ['search', 'show'].includes(c.name)).map(c => c.name)
    : (st.stats?.asset_types ?? [])

  container.innerHTML = `
    <div class="akm-panel-search-container">
      <div class="akm-panel-search-bar">
        <svg class="akm-panel-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l4 4" stroke-linecap="round"/>
        </svg>
        <input type="text" class="akm-panel-search-input"
               id="akm-panel-search-input"
               value="${escape(st.searchQuery)}"
               placeholder="Search knowledge, skills, workflows, lessons…"
               aria-label="Search AKM knowledge">
        <button class="akm-panel-btn akm-panel-btn-clear" id="akm-panel-search-clear"
                ${st.searchQuery ? '' : 'style="display:none"'} aria-label="Clear search">&times;</button>
      </div>
      <div class="akm-panel-search-filters">
        <button class="akm-panel-filter ${!st.searchType ? 'akm-panel-filter-active' : ''}"
                data-filter="" role="tab">All</button>
        ${allTypes.slice(0, 12).map(t =>
          `<button class="akm-panel-filter ${st.searchType === t ? 'akm-panel-filter-active' : ''}"
                   data-filter="${escape(t)}" role="tab">${escape(capitalize(t))}</button>`
        ).join('')}
      </div>
      ${err ? errorBox('SEARCH_ERROR', err) : ''}
      <div class="akm-panel-search-results" id="akm-panel-search-results">
        ${renderResults()}
      </div>
    </div>
    <div class="akm-panel-preview" id="akm-panel-preview" style="${st.previewRef ? '' : 'display:none'}">
      ${st.previewRef ? renderPreview() : ''}
    </div>
  `

  setupSearchHandlers()
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function renderResults(): string {
  const st = getState()
  if (st.loading['search']) return `<div class="akm-panel-center">${spinner()}</div>`
  if (st.searchResults.length === 0 && st.error['search']) return ''
  if (st.searchResults.length === 0 && st.searchQuery) {
    return '<div class="akm-panel-center"><p class="akm-panel-muted">No results found for this query.</p></div>'
  }
  if (st.searchResults.length === 0) {
    return '<div class="akm-panel-center"><p class="akm-panel-muted">Enter a search query to find knowledge.</p></div>'
  }

  return `
    <div class="akm-panel-results-meta">${st.searchResults.length} result(s)${st.searchDuration != null ? ` · ${st.searchDuration}ms` : ''}</div>
    ${st.searchResults.map(r => `
      <div class="akm-panel-result" data-ref="${escape(r.ref)}" tabindex="0" role="button">
        <div class="akm-panel-result-header">
          <span class="akm-panel-result-title">${escape(truncate(r.title, 100))}</span>
          ${typeBadge(r.type)}
        </div>
        <div class="akm-panel-result-meta">
          <span>${escape(r.source)}</span>
          ${r.score != null ? `<span>score: ${r.score.toFixed(3)}</span>` : ''}
          ${r.modified_at ? `<span>${formatTime(r.modified_at)}</span>` : ''}
        </div>
        <div class="akm-panel-result-snippet">${escape(truncate(r.snippet || '(no preview)', 200))}</div>
        <div class="akm-panel-result-ref">${escape(r.ref)}</div>
      </div>
    `).join('')}
  `
}

function renderPreview(): string {
  const st = getState()
  if (!st.previewContent && st.loading['preview']) return `<div class="akm-panel-preview-inner">${spinner()}<p>Loading…</p></div>`
  if (!st.previewContent && st.error['preview']) {
    return `<div class="akm-panel-preview-inner">${errorBox('PREVIEW_ERROR', st.error['preview'])}</div>`
  }
  if (!st.previewContent) return ''

  return `
    <div class="akm-panel-preview-inner">
      <div class="akm-panel-preview-header">
        <div>
          <h3 class="akm-panel-preview-title">${escape(st.previewTitle ?? '')}</h3>
          <div class="akm-panel-preview-meta">
            ${typeBadge(st.previewType ?? '')}
            <span class="akm-panel-preview-ref">${escape(st.previewRef ?? '')}</span>
          </div>
        </div>
        <button class="akm-panel-btn akm-panel-btn-icon" id="akm-panel-preview-close" aria-label="Close preview">&times;</button>
      </div>
      ${st.previewTruncated ? '<div class="akm-panel-warning">This resource preview was truncated by the safety limit.</div>' : ''}
      <div class="akm-panel-preview-content">
        <pre class="akm-panel-preview-text">${escape(st.previewContent)}</pre>
      </div>
      <div class="akm-panel-preview-actions">
        <button class="akm-panel-btn" id="akm-panel-copy-ref">Copy reference</button>
        <button class="akm-panel-btn" id="akm-panel-copy-content">Copy content</button>
      </div>
      <div class="akm-panel-feedback" id="akm-panel-feedback-area">
        <span class="akm-panel-feedback-label">Was this helpful?</span>
        <button class="akm-panel-btn akm-panel-btn-sm akm-panel-feedback-btn" id="akm-panel-feedback-yes" data-positive="true">&#x1F44D; Helpful</button>
        <button class="akm-panel-btn akm-panel-btn-sm akm-panel-feedback-btn" id="akm-panel-feedback-no" data-positive="false">&#x1F44E; Not helpful</button>
        <span class="akm-panel-feedback-result" id="akm-panel-feedback-result"></span>
      </div>
    </div>
  `
}

function setupSearchHandlers() {
  const input = document.getElementById('akm-panel-search-input') as HTMLInputElement
  const clear = document.getElementById('akm-panel-search-clear')
  const results = document.getElementById('akm-panel-search-results')

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch()
  })

  clear?.addEventListener('click', () => {
    if (input) { input.value = ''; input.focus() }
    setState({ searchQuery: '', searchResults: [] })
    clear!.style.display = 'none'
    const resultsEl = document.getElementById('akm-panel-search-results')
    if (resultsEl) resultsEl.innerHTML = '<div class="akm-panel-center"><p class="akm-panel-muted">Enter a search query to find knowledge.</p></div>'
  })

  document.querySelectorAll('.akm-panel-filter').forEach(el => {
    el.addEventListener('click', () => {
      const filter = (el as HTMLElement).dataset.filter ?? ''
      setState({ searchType: filter })
      document.querySelectorAll('.akm-panel-filter').forEach(b => b.classList.remove('akm-panel-filter-active'))
      el.classList.add('akm-panel-filter-active')
      if (getState().searchQuery) doSearch()
    })
  })

  results?.addEventListener('click', (e) => {
    const resultEl = (e.target as HTMLElement).closest('.akm-panel-result') as HTMLElement
    if (!resultEl) return
    const ref = resultEl.dataset.ref
    if (ref) openPreview(ref)
  })

  document.getElementById('akm-panel-preview-close')?.addEventListener('click', closePreview)
  document.getElementById('akm-panel-copy-ref')?.addEventListener('click', () => {
    const ref = getState().previewRef
    if (ref) navigator.clipboard.writeText(ref).catch(() => {})
  })
  document.getElementById('akm-panel-copy-content')?.addEventListener('click', () => {
    const content = getState().previewContent
    if (content) navigator.clipboard.writeText(content).catch(() => {})
  })

  document.getElementById('akm-panel-feedback-yes')?.addEventListener('click', () => handleFeedback(true))
  document.getElementById('akm-panel-feedback-no')?.addEventListener('click', () => handleFeedback(false))
}

async function handleFeedback(positive: boolean) {
  const ref = getState().previewRef
  if (!ref) return

  const resultEl = document.getElementById('akm-panel-feedback-result')
  if (resultEl) resultEl.textContent = 'Submitting…'
  const yesBtn = document.getElementById('akm-panel-feedback-yes') as HTMLButtonElement
  const noBtn = document.getElementById('akm-panel-feedback-no') as HTMLButtonElement
  if (yesBtn) yesBtn.disabled = true
  if (noBtn) noBtn.disabled = true

  let reason: string | undefined
  if (!positive) {
    reason = window.prompt('Optional reason (what could be improved?):') || undefined
  }

  const result = await submitFeedback(ref, positive, reason)

  if (resultEl) {
    if (result.ok) {
      resultEl.textContent = positive ? 'Thanks for the positive feedback!' : 'Thanks for the feedback.'
    } else {
      resultEl.textContent = 'Feedback submission failed.'
      if (yesBtn) yesBtn.disabled = false
      if (noBtn) noBtn.disabled = false
    }
  }
}

async function doSearch() {
  const input = document.getElementById('akm-panel-search-input') as HTMLInputElement
  if (!input) return
  const q = input.value.trim()
  if (!q) return

  abortController?.abort()
  abortController = new AbortController()
  const signal = abortController.signal

  setState({ searchQuery: q })
  setLoading('search', true)
  clearError('search')

  const t0 = performance.now()
  const result = await search(q, getState().searchType || undefined, 25, signal)
  const dur = performance.now() - t0

  if (signal.aborted) return
  setLoading('search', false)

  if (!result.ok) {
    setError('search', result.error?.message ?? 'Search failed')
    setState({ searchResults: [], searchDuration: dur })
  } else {
    setState({ searchResults: result.data ?? [], searchDuration: Math.round(dur) })
  }

  document.getElementById('akm-panel-search-clear')!.style.display = q ? '' : 'none'
  const resultsEl = document.getElementById('akm-panel-search-results')
  if (resultsEl) resultsEl.innerHTML = renderResults()
}

async function openPreview(ref: string) {
  setState({ previewRef: ref, previewContent: null, previewTitle: null, previewType: null, previewTruncated: false })
  setLoading('preview', true)
  clearError('preview')

  const result = await showResource(ref)
  setLoading('preview', false)

  if (!result.ok) {
    setError('preview', result.error?.message ?? 'Resource unavailable')
  } else if (result.data) {
    setState({
      previewTitle: result.data.title,
      previewType: result.data.type,
      previewContent: result.data.content,
      previewTruncated: result.data.truncated,
    })
  }

  const container = document.getElementById('akm-panel-view-content')
  if (container) {
    container.classList.add('akm-panel-split')
    const preview = document.getElementById('akm-panel-preview')
    if (preview) {
      preview.style.display = ''
      preview.innerHTML = renderPreview()
      setupSearchHandlers()
    }
  }
}

function closePreview() {
  setState({ previewRef: null, previewContent: null })
  const container = document.getElementById('akm-panel-view-content')
  container?.classList.remove('akm-panel-split')
  const preview = document.getElementById('akm-panel-preview')
  if (preview) preview.style.display = 'none'
}

subscribe(() => {
  if (getState().view === 'search') renderSearch()
})

document.addEventListener('akm-nav', ((e: CustomEvent) => {
  if (e.detail === 'search') renderSearch()
}) as EventListener)

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && getState().view === 'search' && getState().previewRef) {
    closePreview()
  }
})
