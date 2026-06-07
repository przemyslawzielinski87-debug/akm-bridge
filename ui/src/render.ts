export function escape(str: string): string {
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}

export function datum(label: string, value: string | number | null | undefined, unit?: string): string {
  const v = value != null ? `${escape(String(value))}${unit ? ` <span class="akm-panel-unit">${escape(unit)}</span>` : ''}` : '<span class="akm-panel-unavailable">Unavailable</span>'
  return `<div class="akm-panel-datum"><span class="akm-panel-datum-label">${escape(label)}</span><span class="akm-panel-datum-value">${v}</span></div>`
}

export function statusBadge(healthy: boolean): string {
  return healthy
    ? '<span class="akm-panel-badge akm-panel-badge-ok">● Healthy</span>'
    : '<span class="akm-panel-badge akm-panel-badge-err">● Unhealthy</span>'
}

export function typeBadge(type: string): string {
  const cls = `akm-panel-type-badge akm-panel-type-${type.replace(/[^a-z0-9]/g, '-')}`
  return `<span class="${cls}">${escape(type)}</span>`
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return escape(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function spinner(): string {
  return '<div class="akm-panel-spinner"><div class="akm-panel-spinner-ring"></div></div>'
}

export function errorBox(code: string, message: string): string {
  return `<div class="akm-panel-error-box"><strong>${escape(code)}</strong>: ${escape(message)}</div>`
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + '…'
}
