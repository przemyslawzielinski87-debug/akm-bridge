// state.ts
var state = {
  view: "overview",
  status: null,
  sources: [],
  capabilities: [],
  stats: null,
  activity: [],
  searchQuery: "",
  searchType: "",
  searchResults: [],
  searchDuration: null,
  previewRef: null,
  previewContent: null,
  previewTitle: null,
  previewType: null,
  previewTruncated: !1,
  proposals: [],
  selectedProposal: null,
  writeActivity: [],
  currentOperation: null,
  writeActivityFilter: "all",
  agentMode: "supervised",
  agentRuns: [],
  loading: {},
  error: {},
  lastRefresh: null
}, listeners = /* @__PURE__ */ new Set();
function getState() {
  return state;
}
function setState(partial) {
  state = { ...state, ...partial }, listeners.forEach((fn) => fn());
}
function setLoading(key, val) {
  state = { ...state, loading: { ...state.loading, [key]: val } }, listeners.forEach((fn) => fn());
}
function setError(key, msg) {
  state = { ...state, error: { ...state.error, [key]: msg } }, listeners.forEach((fn) => fn());
}
function clearError(key) {
  let next = { ...state.error };
  delete next[key], state = { ...state, error: next }, listeners.forEach((fn) => fn());
}
function subscribe(fn) {
  return listeners.add(fn), () => listeners.delete(fn);
}

// render.ts
function escape(str) {
  let d = document.createElement("div");
  return d.textContent = str, d.innerHTML;
}
function datum(label, value, unit) {
  let v = value != null ? `${escape(String(value))}${unit ? ` <span class="akm-panel-unit">${escape(unit)}</span>` : ""}` : '<span class="akm-panel-unavailable">Unavailable</span>';
  return `<div class="akm-panel-datum"><span class="akm-panel-datum-label">${escape(label)}</span><span class="akm-panel-datum-value">${v}</span></div>`;
}
function statusBadge(healthy) {
  return healthy ? '<span class="akm-panel-badge akm-panel-badge-ok">\u25CF Healthy</span>' : '<span class="akm-panel-badge akm-panel-badge-err">\u25CF Unhealthy</span>';
}
function typeBadge(type) {
  return `<span class="${`akm-panel-type-badge akm-panel-type-${type.replace(/[^a-z0-9]/g, "-")}`}">${escape(type)}</span>`;
}
function formatTime(iso) {
  if (!iso) return "";
  let d = new Date(iso);
  return isNaN(d.getTime()) ? escape(iso) : d.toLocaleString(void 0, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatDuration(ms) {
  return ms < 1e3 ? `${ms}ms` : `${(ms / 1e3).toFixed(1)}s`;
}
function spinner() {
  return '<div class="akm-panel-spinner"><div class="akm-panel-spinner-ring"></div></div>';
}
function errorBox(code, message) {
  return `<div class="akm-panel-error-box"><strong>${escape(code)}</strong>: ${escape(message)}</div>`;
}
function truncate(str, max) {
  return str.length <= max ? str : str.slice(0, max) + "\u2026";
}

// write-api.ts
function getApiBase() {
  return window.location.pathname.startsWith("/akm") ? "/akm/api" : "/api/akm";
}
var BASE = getApiBase();
async function postJson(url, body) {
  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }), text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: !1, data: null, meta: { operation: "write", duration_ms: 0, truncated: !1 }, error: { code: "PARSE_ERROR", message: `HTTP ${res.status}` } };
  }
}
async function prepareAction(operation, params) {
  return postJson(`${BASE}/actions/prepare`, { operation, ...params });
}
async function reindex(token) {
  return postJson(`${BASE}/reindex`, { confirmation_token: token });
}
async function syncSource(sourceId, token) {
  return postJson(`${BASE}/sync`, { source_id: sourceId, confirmation_token: token });
}
async function submitFeedback(ref, positive, reason) {
  return postJson(`${BASE}/feedback`, { ref, positive, reason: reason || void 0 });
}
async function listProposals(status) {
  let params = status ? `?status=${encodeURIComponent(status)}` : "", res = await fetch(`${BASE}/proposals${params}`), text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: !1, data: null, meta: { operation: "list", duration_ms: 0, truncated: !1 }, error: { code: "PARSE_ERROR", message: `HTTP ${res.status}` } };
  }
}
async function showProposal(id) {
  let res = await fetch(`${BASE}/proposals/${encodeURIComponent(id)}`), text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: !1, data: null, meta: { operation: "show", duration_ms: 0, truncated: !1 }, error: { code: "PARSE_ERROR", message: `HTTP ${res.status}` } };
  }
}
async function getWriteActivity() {
  let res = await fetch(`${BASE}/write-activity`), text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: !1, data: null, meta: { operation: "write-activity", duration_ms: 0, truncated: !1 }, error: { code: "PARSE_ERROR", message: `HTTP ${res.status}` } };
  }
}

// views/overview.ts
var reindexInProgress = !1;
function renderOverview() {
  let container = document.getElementById("akm-panel-view-content");
  if (!container) return;
  let st = getState().status, si = getState().stats, err = getState().error.refresh, loading = getState().loading.refresh, reindexErr = getState().error.reindex, reindexLoading = getState().loading.reindex;
  if (loading && !st) {
    container.innerHTML = `<div class="akm-panel-center">${spinner()}<p>Loading\u2026</p></div>`;
    return;
  }
  if (err && !st) {
    container.innerHTML = `<div class="akm-panel-center">${errorBox("CONNECTION", err)}<p class="akm-panel-muted">AKM bridge is unavailable. Check the akm-bridge service.</p></div>`;
    return;
  }
  container.innerHTML = `
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Status</h2>
      <div class="akm-panel-grid akm-panel-grid-4">
        ${datum("Health", st ? st.healthy ? "Healthy" : "Unhealthy" : null)}
        ${datum("AKM Version", st?.version ?? null)}
        ${datum("Entries", si?.total_entries ?? null)}
        ${datum("Sources", si?.sources_count ?? null)}
        ${datum("Embeddings", si?.total_embeddings ?? null)}
        ${datum("Vector Search", si?.vec_available ? "Available" : "Unavailable")}
        ${datum("Last Index", st?.last_index_time ? new Date(st.last_index_time).toLocaleString() : null)}
        ${datum("Asset Types", si?.asset_types?.length ?? null)}
      </div>
    </section>
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Search Modes</h2>
      <div class="akm-panel-tag-list">
        ${(si?.search_modes ?? []).map((m) => `<span class="akm-panel-tag">${escape(m)}</span>`).join("")}
      </div>
    </section>
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Management</h2>
      ${reindexErr ? errorBox("REINDEX", reindexErr) : ""}
      ${reindexLoading ? `<p class="akm-panel-muted">${spinner()} Reindexing\u2026 Search may be temporarily unavailable.</p>` : ""}
      ${reindexLoading ? "" : `
        <button class="akm-panel-btn" id="akm-panel-reindex-btn" ${reindexInProgress ? "disabled" : ""}>
          Rebuild Index
        </button>
        <p class="akm-panel-hint">Rebuild the AKM knowledge index from all configured sources.</p>
      `}
    </section>
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Recent Activity</h2>
      <div class="akm-panel-activity-mini">
        ${(getState().activity?.slice(0, 5) ?? []).length > 0 ? getState().activity.slice(0, 5).map(
    (a) => `<div class="akm-panel-activity-row">
                <span class="akm-panel-activity-op ${a.success ? "" : "akm-panel-activity-fail"}">${escape(a.operation)}</span>
                <span class="akm-panel-activity-time">${new Date(a.timestamp).toLocaleTimeString()}</span>
                <span class="akm-panel-activity-dur">${a.duration_ms}ms</span>
              </div>`
  ).join("") : '<p class="akm-panel-muted">No recent activity</p>'}
      </div>
    </section>
  `, document.getElementById("akm-panel-reindex-btn")?.addEventListener("click", handleReindex);
}
async function handleReindex() {
  if (reindexInProgress || window.prompt('Rebuilding the AKM index may temporarily make search unavailable. Type "reindex" to confirm:')?.toLowerCase() !== "reindex") return;
  setLoading("reindex", !0), reindexInProgress = !0;
  let prep = await prepareAction("reindex");
  if (!prep.ok || !prep.data) {
    setError("reindex", prep.error?.message ?? "Failed to prepare reindex"), setLoading("reindex", !1), reindexInProgress = !1;
    return;
  }
  let result = await reindex(prep.data.confirmation_token);
  setLoading("reindex", !1), reindexInProgress = !1, result.ok ? dispatchEvent(new CustomEvent("akm-refresh")) : setError("reindex", result.error?.message ?? "Reindex failed");
}
subscribe(() => {
  getState().view === "overview" && renderOverview();
});
document.addEventListener("akm-nav", ((e) => {
  e.detail === "overview" && renderOverview();
}));

// api.ts
function getApiBase2() {
  return window.location.pathname.startsWith("/akm") ? "/akm/api" : "/api/akm";
}
var BASE2 = getApiBase2();
async function fetchJson(url, signal) {
  let res = await fetch(url, { signal });
  if (!res.ok) {
    let body = await res.text();
    try {
      return JSON.parse(body);
    } catch {
      return { ok: !1, data: null, meta: { operation: "fetch", duration_ms: 0, truncated: !1 }, error: { code: "HTTP_ERROR", message: `HTTP ${res.status}` } };
    }
  }
  return await res.json();
}
async function getHealth(signal) {
  return fetchJson(`${BASE2}/health`, signal);
}
async function getStatus(signal) {
  return fetchJson(`${BASE2}/status`, signal);
}
async function getSources(signal) {
  return fetchJson(`${BASE2}/sources`, signal);
}
async function getCapabilities(signal) {
  return fetchJson(`${BASE2}/capabilities`, signal);
}
async function getStats(signal) {
  return fetchJson(`${BASE2}/stats`, signal);
}
async function getActivity(signal) {
  return fetchJson(`${BASE2}/activity`, signal);
}
async function search(query, type, limit, signal) {
  let params = new URLSearchParams({ q: query });
  return type && params.set("type", type), limit && params.set("limit", String(limit)), fetchJson(`${BASE2}/search?${params}`, signal);
}
async function showResource(ref, signal) {
  return fetchJson(`${BASE2}/resource?ref=${encodeURIComponent(ref)}`, signal);
}
async function getAgentMode(signal) {
  return fetchJson(`${BASE2}/agent/mode`, signal);
}
async function getAgentRuns(signal) {
  return fetchJson(`${BASE2}/agent/runs`, signal);
}

// views/search.ts
var abortController = null;
function renderSearch() {
  let container = document.getElementById("akm-panel-view-content");
  if (!container) return;
  let st = getState(), err = st.error.search, loading = st.loading.search, allTypes = st.capabilities?.length > 0 ? st.capabilities.filter((c) => ["search", "show"].includes(c.name)).map((c) => c.name) : st.stats?.asset_types ?? [];
  container.innerHTML = `
    <div class="akm-panel-search-container">
      <div class="akm-panel-search-bar">
        <svg class="akm-panel-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l4 4" stroke-linecap="round"/>
        </svg>
        <input type="text" class="akm-panel-search-input"
               id="akm-panel-search-input"
               value="${escape(st.searchQuery)}"
               placeholder="Search knowledge, skills, workflows, lessons\u2026"
               aria-label="Search AKM knowledge">
        <button class="akm-panel-btn akm-panel-btn-clear" id="akm-panel-search-clear"
                ${st.searchQuery ? "" : 'style="display:none"'} aria-label="Clear search">&times;</button>
      </div>
      <div class="akm-panel-search-filters">
        <button class="akm-panel-filter ${st.searchType ? "" : "akm-panel-filter-active"}"
                data-filter="" role="tab">All</button>
        ${allTypes.slice(0, 12).map(
    (t) => `<button class="akm-panel-filter ${st.searchType === t ? "akm-panel-filter-active" : ""}"
                   data-filter="${escape(t)}" role="tab">${escape(capitalize(t))}</button>`
  ).join("")}
      </div>
      ${err ? errorBox("SEARCH_ERROR", err) : ""}
      <div class="akm-panel-search-results" id="akm-panel-search-results">
        ${renderResults()}
      </div>
    </div>
    <div class="akm-panel-preview" id="akm-panel-preview" style="${st.previewRef ? "" : "display:none"}">
      ${st.previewRef ? renderPreview() : ""}
    </div>
  `, setupSearchHandlers();
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function renderResults() {
  let st = getState();
  return st.loading.search ? `<div class="akm-panel-center">${spinner()}</div>` : st.searchResults.length === 0 && st.error.search ? "" : st.searchResults.length === 0 && st.searchQuery ? '<div class="akm-panel-center"><p class="akm-panel-muted">No results found for this query.</p></div>' : st.searchResults.length === 0 ? '<div class="akm-panel-center"><p class="akm-panel-muted">Enter a search query to find knowledge.</p></div>' : `
    <div class="akm-panel-results-meta">${st.searchResults.length} result(s)${st.searchDuration != null ? ` \xB7 ${st.searchDuration}ms` : ""}</div>
    ${st.searchResults.map((r) => `
      <div class="akm-panel-result" data-ref="${escape(r.ref)}" tabindex="0" role="button">
        <div class="akm-panel-result-header">
          <span class="akm-panel-result-title">${escape(truncate(r.title, 100))}</span>
          ${typeBadge(r.type)}
        </div>
        <div class="akm-panel-result-meta">
          <span>${escape(r.source)}</span>
          ${r.score != null ? `<span>score: ${r.score.toFixed(3)}</span>` : ""}
          ${r.modified_at ? `<span>${formatTime(r.modified_at)}</span>` : ""}
        </div>
        <div class="akm-panel-result-snippet">${escape(truncate(r.snippet || "(no preview)", 200))}</div>
        <div class="akm-panel-result-ref">${escape(r.ref)}</div>
      </div>
    `).join("")}
  `;
}
function renderPreview() {
  let st = getState();
  return !st.previewContent && st.loading.preview ? `<div class="akm-panel-preview-inner">${spinner()}<p>Loading\u2026</p></div>` : !st.previewContent && st.error.preview ? `<div class="akm-panel-preview-inner">${errorBox("PREVIEW_ERROR", st.error.preview)}</div>` : st.previewContent ? `
    <div class="akm-panel-preview-inner">
      <div class="akm-panel-preview-header">
        <div>
          <h3 class="akm-panel-preview-title">${escape(st.previewTitle ?? "")}</h3>
          <div class="akm-panel-preview-meta">
            ${typeBadge(st.previewType ?? "")}
            <span class="akm-panel-preview-ref">${escape(st.previewRef ?? "")}</span>
          </div>
        </div>
        <button class="akm-panel-btn akm-panel-btn-icon" id="akm-panel-preview-close" aria-label="Close preview">&times;</button>
      </div>
      ${st.previewTruncated ? '<div class="akm-panel-warning">This resource preview was truncated by the safety limit.</div>' : ""}
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
  ` : "";
}
function setupSearchHandlers() {
  let input = document.getElementById("akm-panel-search-input"), clear = document.getElementById("akm-panel-search-clear"), results = document.getElementById("akm-panel-search-results");
  input?.addEventListener("keydown", (e) => {
    e.key === "Enter" && doSearch();
  }), clear?.addEventListener("click", () => {
    input && (input.value = "", input.focus()), setState({ searchQuery: "", searchResults: [] }), clear.style.display = "none";
    let resultsEl = document.getElementById("akm-panel-search-results");
    resultsEl && (resultsEl.innerHTML = '<div class="akm-panel-center"><p class="akm-panel-muted">Enter a search query to find knowledge.</p></div>');
  }), document.querySelectorAll(".akm-panel-filter").forEach((el) => {
    el.addEventListener("click", () => {
      let filter = el.dataset.filter ?? "";
      setState({ searchType: filter }), document.querySelectorAll(".akm-panel-filter").forEach((b) => b.classList.remove("akm-panel-filter-active")), el.classList.add("akm-panel-filter-active"), getState().searchQuery && doSearch();
    });
  }), results?.addEventListener("click", (e) => {
    let resultEl = e.target.closest(".akm-panel-result");
    if (!resultEl) return;
    let ref = resultEl.dataset.ref;
    ref && openPreview(ref);
  }), document.getElementById("akm-panel-preview-close")?.addEventListener("click", closePreview), document.getElementById("akm-panel-copy-ref")?.addEventListener("click", () => {
    let ref = getState().previewRef;
    ref && navigator.clipboard.writeText(ref).catch(() => {
    });
  }), document.getElementById("akm-panel-copy-content")?.addEventListener("click", () => {
    let content = getState().previewContent;
    content && navigator.clipboard.writeText(content).catch(() => {
    });
  }), document.getElementById("akm-panel-feedback-yes")?.addEventListener("click", () => handleFeedback(!0)), document.getElementById("akm-panel-feedback-no")?.addEventListener("click", () => handleFeedback(!1));
}
async function handleFeedback(positive) {
  let ref = getState().previewRef;
  if (!ref) return;
  let resultEl = document.getElementById("akm-panel-feedback-result");
  resultEl && (resultEl.textContent = "Submitting\u2026");
  let yesBtn = document.getElementById("akm-panel-feedback-yes"), noBtn = document.getElementById("akm-panel-feedback-no");
  yesBtn && (yesBtn.disabled = !0), noBtn && (noBtn.disabled = !0);
  let reason;
  positive || (reason = window.prompt("Optional reason (what could be improved?):") || void 0);
  let result = await submitFeedback(ref, positive, reason);
  resultEl && (result.ok ? resultEl.textContent = positive ? "Thanks for the positive feedback!" : "Thanks for the feedback." : (resultEl.textContent = "Feedback submission failed.", yesBtn && (yesBtn.disabled = !1), noBtn && (noBtn.disabled = !1)));
}
async function doSearch() {
  let input = document.getElementById("akm-panel-search-input");
  if (!input) return;
  let q = input.value.trim();
  if (!q) return;
  abortController?.abort(), abortController = new AbortController();
  let signal = abortController.signal;
  setState({ searchQuery: q }), setLoading("search", !0), clearError("search");
  let t0 = performance.now(), result = await search(q, getState().searchType || void 0, 25, signal), dur = performance.now() - t0;
  if (signal.aborted) return;
  setLoading("search", !1), result.ok ? setState({ searchResults: result.data ?? [], searchDuration: Math.round(dur) }) : (setError("search", result.error?.message ?? "Search failed"), setState({ searchResults: [], searchDuration: dur })), document.getElementById("akm-panel-search-clear").style.display = q ? "" : "none";
  let resultsEl = document.getElementById("akm-panel-search-results");
  resultsEl && (resultsEl.innerHTML = renderResults());
}
async function openPreview(ref) {
  setState({ previewRef: ref, previewContent: null, previewTitle: null, previewType: null, previewTruncated: !1 }), setLoading("preview", !0), clearError("preview");
  let result = await showResource(ref);
  setLoading("preview", !1), result.ok ? result.data && setState({
    previewTitle: result.data.title,
    previewType: result.data.type,
    previewContent: result.data.content,
    previewTruncated: result.data.truncated
  }) : setError("preview", result.error?.message ?? "Resource unavailable");
  let container = document.getElementById("akm-panel-view-content");
  if (container) {
    container.classList.add("akm-panel-split");
    let preview = document.getElementById("akm-panel-preview");
    preview && (preview.style.display = "", preview.innerHTML = renderPreview(), setupSearchHandlers());
  }
}
function closePreview() {
  setState({ previewRef: null, previewContent: null }), document.getElementById("akm-panel-view-content")?.classList.remove("akm-panel-split");
  let preview = document.getElementById("akm-panel-preview");
  preview && (preview.style.display = "none");
}
subscribe(() => {
  getState().view === "search" && renderSearch();
});
document.addEventListener("akm-nav", ((e) => {
  e.detail === "search" && renderSearch();
}));
document.addEventListener("keydown", (e) => {
  e.key === "Escape" && getState().view === "search" && getState().previewRef && closePreview();
});

// views/sources.ts
var syncInProgress = !1;
function renderSources() {
  let container = document.getElementById("akm-panel-view-content");
  if (!container) return;
  let sr = getState().sources, err = getState().error.refresh, syncErr = getState().error.sync, syncLoading = getState().loading.sync;
  if (!sr && getState().loading.refresh) {
    container.innerHTML = `<div class="akm-panel-center">${spinner()}</div>`;
    return;
  }
  if (sr.length === 0 && !err) {
    container.innerHTML = '<div class="akm-panel-center"><p class="akm-panel-muted">No sources configured.</p></div>';
    return;
  }
  if (sr.length === 0 && err) {
    container.innerHTML = `<div class="akm-panel-center">${errorBox("ERROR", err)}</div>`;
    return;
  }
  container.innerHTML = `
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Sources (${sr.length})</h2>
      ${syncErr ? errorBox("SYNC", syncErr) : ""}
      <div class="akm-panel-source-list">
        ${sr.map((s) => `
          <div class="akm-panel-source">
            <div class="akm-panel-source-header">
              <strong>${escape(s.name)}</strong>
              <span class="akm-panel-badge ${s.writable ? "akm-panel-badge-ok" : "akm-panel-badge-muted"}">${s.writable ? "Writable" : "Read-only"}</span>
              <span class="akm-panel-badge akm-panel-badge-info">${escape(s.type)}</span>
            </div>
            <div class="akm-panel-source-path">${escape(s.path)}</div>
            <div class="akm-panel-source-meta">
              ${s.id ? `<span>ID: ${escape(s.id)}</span>` : ""}
              ${s.last_sync_time ? `<span>Last sync: ${new Date(s.last_sync_time).toLocaleString()}</span>` : ""}
            </div>
            ${s.writable ? `
              <button class="akm-panel-btn akm-panel-btn-sm akm-panel-source-sync"
                      data-source-id="${escape(s.id || s.name)}"
                      ${syncInProgress ? "disabled" : ""}>
                ${syncInProgress ? "Syncing\u2026" : "Sync"}
              </button>
            ` : ""}
          </div>
        `).join("")}
      </div>
    </section>
  `, document.querySelectorAll(".akm-panel-source-sync").forEach((el) => {
    el.addEventListener("click", () => {
      let sourceId = el.dataset.sourceId;
      sourceId && handleSync(sourceId);
    });
  });
}
async function handleSync(sourceId) {
  if (syncInProgress || window.prompt(`Sync source "${sourceId}"? Type "sync" to confirm:`)?.toLowerCase() !== "sync") return;
  setLoading("sync", !0), syncInProgress = !0, clearError("sync");
  let prep = await prepareAction("sync", { source_id: sourceId });
  if (!prep.ok || !prep.data) {
    setError("sync", prep.error?.message ?? "Failed to prepare sync"), setLoading("sync", !1), syncInProgress = !1;
    return;
  }
  let result = await syncSource(sourceId, prep.data.confirmation_token);
  setLoading("sync", !1), syncInProgress = !1, result.ok ? dispatchEvent(new CustomEvent("akm-refresh")) : setError("sync", result.error?.message ?? "Sync failed");
}
subscribe(() => {
  getState().view === "sources" && renderSources();
});
document.addEventListener("akm-nav", ((e) => {
  e.detail === "sources" && renderSources();
}));

// views/activity.ts
function renderActivity() {
  let container = document.getElementById("akm-panel-view-content");
  if (!container) return;
  let act = getState().activity, writeAct = getState().writeActivity, err = getState().error.refresh, writeErr = getState().error.write_activity;
  if (!act && getState().loading.refresh) {
    container.innerHTML = `<div class="akm-panel-center">${spinner()}</div>`;
    return;
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
            ${act.length > 0 ? act.map((a) => `
              <tr class="${a.success ? "" : "akm-panel-row-err"}">
                <td>${formatTime(a.timestamp)}</td>
                <td><code>${escape(a.operation)}</code></td>
                <td>${a.success ? '<span class="akm-panel-badge akm-panel-badge-ok">OK</span>' : '<span class="akm-panel-badge akm-panel-badge-err">FAIL</span>'}</td>
                <td>${a.duration_ms}ms</td>
                <td>${a.result_count != null ? String(a.result_count) : "-"}</td>
                <td class="akm-panel-cell-ref">${a.resource_ref ? escape(a.resource_ref) : "-"}</td>
              </tr>
            `).join("") : '<tr><td colspan="6" class="akm-panel-center"><p class="akm-panel-muted">No read activity</p></td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Write Operations</h2>
      ${writeErr ? errorBox("WRITE_ACTIVITY", writeErr) : ""}
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
  `, writeAct.length > 0 && renderWriteActivityTable(), document.getElementById("akm-panel-load-write-activity")?.addEventListener("click", loadWriteActivity);
}
async function loadWriteActivity() {
  setLoading("write_activity", !0), clearError("write_activity");
  let result = await getWriteActivity();
  if (setLoading("write_activity", !1), result.ok) {
    setState({ writeActivity: result.data ?? [] });
    let table = document.getElementById("akm-panel-write-activity-table");
    table && (table.style.display = ""), renderWriteActivityTable();
  } else
    setError("write_activity", result.error?.message ?? "Failed to load write activity");
}
function renderWriteActivityTable() {
  let tbody = document.getElementById("akm-panel-write-activity-body");
  if (!tbody) return;
  let wa = getState().writeActivity;
  if (wa.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="akm-panel-center"><p class="akm-panel-muted">No write activity recorded.</p></td></tr>';
    return;
  }
  tbody.innerHTML = wa.map((a) => `
    <tr class="${a.result === "success" ? "" : "akm-panel-row-err"}">
      <td>${formatTime(a.timestamp)}</td>
      <td><code>${escape(a.operation)}</code></td>
      <td>${a.result === "success" ? '<span class="akm-panel-badge akm-panel-badge-ok">OK</span>' : '<span class="akm-panel-badge akm-panel-badge-err">FAIL</span>'}</td>
      <td>${formatDuration(a.duration_ms)}</td>
      <td class="akm-panel-cell-ref">${a.resource_ref ? escape(a.resource_ref) : "-"}</td>
      <td>${a.summary ? escape(a.summary) : "-"}</td>
    </tr>
  `).join("");
}
subscribe(() => {
  getState().view === "activity" && renderActivity();
});
document.addEventListener("akm-nav", ((e) => {
  e.detail === "activity" && renderActivity();
}));

// views/capabilities.ts
function renderCapabilities() {
  let container = document.getElementById("akm-panel-view-content");
  if (!container) return;
  let caps = getState().capabilities, stats = getState().stats, err = getState().error.refresh;
  if (!caps.length && getState().loading.refresh) {
    container.innerHTML = `<div class="akm-panel-center">${spinner()}</div>`;
    return;
  }
  if (!caps.length && err) {
    container.innerHTML = `<div class="akm-panel-center">${errorBox("ERROR", err)}</div>`;
    return;
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
            ${caps.filter((c) => c.supported).map((c) => `
              <tr>
                <td><code>${escape(c.name)}</code></td>
                <td><span class="akm-panel-badge akm-panel-badge-ok">Available</span></td>
                <td>${escape(c.description)}</td>
              </tr>
            `).join("")}
            ${caps.filter((c) => !c.supported).map((c) => `
              <tr>
                <td><code>${escape(c.name)}</code></td>
                <td><span class="akm-panel-badge akm-panel-badge-err">Unavailable</span></td>
                <td>${escape(c.description)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Asset Types (${stats?.asset_types?.length ?? 0})</h2>
      <div class="akm-panel-tag-list">
        ${(stats?.asset_types ?? []).map((t) => `<span class="akm-panel-tag">${escape(t)}</span>`).join("")}
      </div>
    </section>
  `;
}
subscribe(() => {
  getState().view === "capabilities" && renderCapabilities();
});
document.addEventListener("akm-nav", ((e) => {
  e.detail === "capabilities" && renderCapabilities();
}));

// views/proposals.ts
function renderProposals() {
  let container = document.getElementById("akm-panel-view-content");
  if (!container) return;
  let st = getState(), loading = st.loading.proposals, err = st.error.proposals, sel = st.selectedProposal;
  container.innerHTML = `
    <div class="akm-panel-proposals-container${sel ? " akm-panel-split" : ""}">
      <div class="akm-panel-proposals-list">
        <div class="akm-panel-proposals-header">
          <h2 class="akm-panel-section-title">Proposals</h2>
          <div class="akm-panel-proposals-filter">
            <button class="akm-panel-filter ${!st.writeActivityFilter || st.writeActivityFilter === "all" ? "akm-panel-filter-active" : ""}" data-status="">All</button>
            <button class="akm-panel-filter ${st.writeActivityFilter === "pending" ? "akm-panel-filter-active" : ""}" data-status="pending">Pending</button>
            <button class="akm-panel-filter ${st.writeActivityFilter === "accepted" ? "akm-panel-filter-active" : ""}" data-status="accepted">Accepted</button>
            <button class="akm-panel-filter ${st.writeActivityFilter === "rejected" ? "akm-panel-filter-active" : ""}" data-status="rejected">Rejected</button>
          </div>
        </div>
        ${loading ? `<div class="akm-panel-center">${spinner()}</div>` : ""}
        ${err && !loading ? errorBox("PROPOSALS", err) : ""}
        ${loading ? "" : renderProposalList()}
      </div>
      <div class="akm-panel-proposal-detail" id="akm-panel-proposal-detail" ${sel ? "" : 'style="display:none"'}>
        ${sel ? renderProposalDetail(sel) : ""}
      </div>
    </div>
  `, document.querySelectorAll(".akm-panel-proposals-filter .akm-panel-filter").forEach((el) => {
    el.addEventListener("click", () => {
      let status = el.dataset.status ?? "";
      setState({ writeActivityFilter: status || "all" }), document.querySelectorAll(".akm-panel-proposals-filter .akm-panel-filter").forEach((b) => b.classList.remove("akm-panel-filter-active")), el.classList.add("akm-panel-filter-active"), loadProposals();
    });
  });
}
function renderProposalList() {
  let st = getState();
  return st.proposals.length === 0 ? '<div class="akm-panel-center"><p class="akm-panel-muted">No proposals found.</p></div>' : st.proposals.map((p) => `
    <div class="akm-panel-proposal-card${st.selectedProposal?.id === p.id ? " akm-panel-proposal-card-active" : ""}"
         data-proposal-id="${escape(p.id)}" tabindex="0" role="button">
      <div class="akm-panel-proposal-card-header">
        <span class="akm-panel-proposal-card-title">${escape(truncate(p.title, 80))}</span>
        <span class="akm-panel-proposal-status akm-panel-proposal-status-${escape(p.status)}">${escape(p.status)}</span>
      </div>
      <div class="akm-panel-proposal-card-meta">
        ${typeBadge(p.type)} <span>${escape(p.source)}</span>
        ${p.created_at ? `<span>${formatTime(p.created_at)}</span>` : ""}
      </div>
      <div class="akm-panel-proposal-card-summary">${escape(truncate(p.summary || "(no summary)", 120))}</div>
    </div>
  `).join("");
}
function renderProposalDetail(p) {
  return `
    <div class="akm-panel-preview-inner">
      <div class="akm-panel-preview-header">
        <div>
          <h3 class="akm-panel-preview-title">${escape(p.title)}</h3>
          <div class="akm-panel-preview-meta">
            ${typeBadge(p.type)}
            <span class="akm-panel-proposal-status akm-panel-proposal-status-${escape(p.status)}">${escape(p.status)}</span>
            <span>${escape(p.source)}</span>
            ${p.created_at ? `<span>${formatTime(p.created_at)}</span>` : ""}
          </div>
        </div>
        <button class="akm-panel-btn akm-panel-btn-icon" id="akm-panel-proposal-close" aria-label="Close proposal">&times;</button>
      </div>
      <div class="akm-panel-preview-content akm-panel-proposal-content">
        ${p.content ? `<h4>Proposed Content</h4><pre class="akm-panel-preview-text">${escape(p.content)}</pre>` : ""}
        ${p.diff ? `<h4>Diff</h4><pre class="akm-panel-preview-text">${escape(p.diff)}</pre>` : ""}
        ${p.reason ? `<h4>Reason</h4><p>${escape(p.reason)}</p>` : ""}
      </div>
      <div class="akm-panel-preview-actions">
        ${p.status === "pending" ? `
          <button class="akm-panel-btn akm-panel-btn-primary" id="akm-panel-proposal-accept">Accept</button>
          <button class="akm-panel-btn akm-panel-btn-danger" id="akm-panel-proposal-reject">Reject</button>
        ` : ""}
      </div>
    </div>
  `;
}
async function loadProposals() {
  setLoading("proposals", !0), clearError("proposals");
  let status = getState().writeActivityFilter === "all" ? void 0 : getState().writeActivityFilter, result = await listProposals(status);
  setLoading("proposals", !1), result.ok ? setState({ proposals: result.data ?? [] }) : setError("proposals", result.error?.message ?? "Failed to load proposals");
}
async function openProposalDetail(id) {
  setLoading("proposal_detail", !0), clearError("proposal_detail");
  let result = await showProposal(id);
  setLoading("proposal_detail", !1), result.ok && result.data ? setState({ selectedProposal: result.data }) : setError("proposal_detail", result.error?.message ?? "Failed to load proposal");
}
subscribe(() => {
  getState().view === "proposals" && (getState().proposals.length === 0 && loadProposals(), renderProposals());
});
document.addEventListener("akm-nav", ((e) => {
  e.detail === "proposals" && renderProposals();
}));
document.getElementById("akm-panel-view-content")?.addEventListener("click", (e) => {
  let card = e.target.closest(".akm-panel-proposal-card");
  if (!card) return;
  let id = card.dataset.proposalId;
  id && openProposalDetail(id);
});

// views/agent-usage.ts
function renderAgentUsage() {
  let container = document.getElementById("akm-panel-view-content");
  if (!container) return;
  let runs = getState().agentRuns, mode = getState().agentMode, err = getState().error.agent_usage;
  container.innerHTML = `
    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Agent Mode</h2>
      <div class="akm-panel-grid akm-panel-grid-4">
        <div class="akm-panel-datum">
          <span class="akm-panel-datum-label">Mode</span>
          <span class="akm-panel-datum-value">
            <span class="akm-panel-badge ${mode === "supervised" ? "akm-panel-badge-info" : "akm-panel-badge-muted"}">
              ${escape(mode ?? "?")}
            </span>
          </span>
        </div>
        <div class="akm-panel-datum">
          <span class="akm-panel-datum-label">Supervision</span>
          <span class="akm-panel-datum-value">
            <span class="akm-panel-badge ${mode === "supervised" ? "akm-panel-badge-info" : "akm-panel-badge-muted"}">
              ${mode === "supervised" ? "Active" : "Inactive"}
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
            ${runs.some((r) => r.akm_decision === "required" || r.akm_decision === "optional") ? '<span class="akm-panel-badge akm-panel-badge-ok">Yes</span>' : '<span class="akm-panel-badge akm-panel-badge-muted">No recent usage</span>'}
          </span>
        </div>
      </div>
    </section>

    <section class="akm-panel-section">
      <h2 class="akm-panel-section-title">Recent Agent Runs</h2>
      ${err ? errorBox("AGENT_USAGE", err) : ""}
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
              ${runs.map((r) => `
                <tr>
                  <td>${formatTime(r.timestamp)}</td>
                  <td>
                    <span class="akm-panel-badge ${r.akm_decision === "required" ? "akm-panel-badge-info" : "akm-panel-badge-muted"}">
                      ${escape(r.akm_decision ?? "-")}
                    </span>
                  </td>
                  <td>${r.queries_count}</td>
                  <td class="akm-panel-cell-ref">${r.selected_refs.length > 0 ? r.selected_refs.map((s) => escape(s)).join(", ") : "-"}</td>
                  <td class="akm-panel-cell-ref">${r.loaded_refs.length > 0 ? r.loaded_refs.map((s) => escape(s)).join(", ") : "-"}</td>
                  <td>${r.feedback_count}</td>
                  <td>${r.lesson_proposal_created ? '<span class="akm-panel-badge akm-panel-badge-info">Yes</span>' : "-"}</td>
                  <td>${r.memory_proposal_created ? '<span class="akm-panel-badge akm-panel-badge-info">Yes</span>' : "-"}</td>
                  <td>${r.fallback_used ? '<span class="akm-panel-badge akm-panel-badge-err">Yes</span>' : "-"}</td>
                  <td>${formatDuration(r.duration_ms)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : '<p class="akm-panel-muted">No agent run data yet. Agent runs are recorded when the agent starts a supervised task.</p>'}
    </section>
  `;
}
subscribe(() => {
  getState().view === "agent-usage" && renderAgentUsage();
});
document.addEventListener("akm-nav", ((e) => {
  e.detail === "agent-usage" && renderAgentUsage();
}));

// app.ts
var ROOT = "#akm-knowledge-panel-root", VIEWS = ["overview", "search", "sources", "proposals", "agent-usage", "activity", "capabilities"];
function renderLayout() {
  let root = document.querySelector(ROOT);
  if (!root) return;
  let view = getState().view, st = getState().status;
  root.innerHTML = `
    <div class="akm-panel">
      <header class="akm-panel-header">
        <div class="akm-panel-header-left">
          <svg class="akm-panel-logo" width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect x="2" y="2" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.5" fill="none"/>
            <path d="M6 10h8M10 6v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <h1 class="akm-panel-title">AKM Knowledge</h1>
          ${st ? `<span class="akm-panel-version">v${escape(st.version)}</span>` : ""}
          ${st ? `<span class="akm-panel-health-dot ${st.healthy ? "akm-panel-health-ok" : "akm-panel-health-err"}"></span>` : ""}
        </div>
        <div class="akm-panel-header-right">
          <span class="akm-panel-refresh-time">${getState().lastRefresh ? formatTime(getState().lastRefresh) : ""}</span>
          <button class="akm-panel-btn akm-panel-btn-icon" id="akm-panel-refresh" title="Refresh" aria-label="Refresh">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 8a6 6 0 0 1 10.47-3.97M14 8a6 6 0 0 1-10.47 3.97" stroke-linecap="round"/>
              <path d="M14 2v4h-4M2 14v-4h4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </header>
      <nav class="akm-panel-nav" role="tablist">
        ${VIEWS.map((v) => `
          <button class="akm-panel-nav-item ${view === v ? "akm-panel-nav-active" : ""}"
                  data-view="${v}" role="tab" aria-selected="${view === v}">
            ${capitalize2(v)}
          </button>
        `).join("")}
      </nav>
      <main class="akm-panel-main">
        <div class="akm-panel-view" id="akm-panel-view-content"></div>
      </main>
      <div class="akm-panel-readonly-banner">Read-only mode</div>
    </div>
  `, document.querySelectorAll(".akm-panel-nav-item").forEach((el) => {
    el.addEventListener("click", () => {
      let v = el.dataset.view;
      setState({ view: v }), dispatchEvent(new CustomEvent("akm-nav", { detail: v }));
    });
  }), document.getElementById("akm-panel-refresh")?.addEventListener("click", refreshAll);
}
function capitalize2(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
async function refreshAll() {
  setLoading("refresh", !0), clearError("refresh");
  let results = await Promise.allSettled([
    getHealth(),
    getStatus(),
    getSources(),
    getCapabilities(),
    getStats(),
    getActivity(),
    getAgentMode(),
    getAgentRuns()
  ]), errors = [], updates = {}, extract = (r, key, fn) => {
    if (r.status === "fulfilled") {
      let resp = r.value;
      resp.ok && resp.data != null ? updates[key] = fn(resp.data) : errors.push(`${key}: ${resp.error?.message ?? "empty response"}`);
    } else
      errors.push(`${key}: ${r.reason.message}`);
  };
  extract(results[1], "status", (d) => ({ ...d, healthy: d?.status === "pass" || d?.healthy })), extract(results[4], "stats", (d) => d), extract(results[2], "sources", (d) => d), extract(results[3], "capabilities", (d) => d), extract(results[5], "activity", (d) => d), extract(results[6], "agentMode", (d) => d?.mode ?? "supervised"), extract(results[7], "agentRuns", (d) => d), errors.length > 0 && setError("refresh", errors.join("; ")), setLoading("refresh", !1), renderLayout(), setState({ ...updates, lastRefresh: (/* @__PURE__ */ new Date()).toISOString() }), dispatchEvent(new CustomEvent("akm-nav", { detail: getState().view }));
}
subscribe(() => {
  let appRoot = document.querySelector(ROOT);
  appRoot && !appRoot.querySelector(".akm-panel") && renderLayout();
});
document.addEventListener("DOMContentLoaded", () => {
  renderLayout(), refreshAll();
});
document.addEventListener("akm-refresh", () => {
  refreshAll();
});
function navigateTo(view) {
  setState({ view }), renderLayout(), dispatchEvent(new CustomEvent("akm-nav", { detail: view }));
}
export {
  datum,
  errorBox,
  escape,
  formatTime,
  navigateTo,
  spinner,
  statusBadge,
  truncate,
  typeBadge
};
