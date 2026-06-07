# Security — AKM Knowledge Panel

## XSS Prevention

All user-controlled content is rendered via `textContent` — never `innerHTML`.

```typescript
// render.ts — all output goes through escape()
function escape(s: string): string {
  const el = document.createElement('span')
  el.textContent = s
  return el.innerHTML  // HTML-escaped string
}
```

Tested XSS vectors (all safely rendered as text):
- `<script>globalThis.__AKM_XSS__=true</script>`
- `<img src=x onerror="...">`
- `<a href="javascript:...">`
- `<iframe src="...">`
- `<svg onload="...">`

## Static File Security

- Path traversal blocked by `fullPath.startsWith(UI_DIR)` check
- Directory traversal patterns return 404:
  - `/assets/../src/http-server.ts` → 404
  - URL-encoded traversal (`%2e%2e`, double encoding) → 404
- Hidden files (`.env`) not served
- Source maps not exposed
- Unknown asset paths return 404

## Network Security

- Loopback-only: `127.0.0.1:4199` (configurable via `httpHost`)
- No CORS wildcard — origin checked against `127.0.0.1` / `localhost`
- API endpoints same-origin only
- Authentication provided by upstream proxy if required

## CSP Compatibility

Panel does not use inline event handlers or `eval`. Compatible with strict CSP policies.
