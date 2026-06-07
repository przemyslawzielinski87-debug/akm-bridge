# AKM Knowledge Panel — Remote Access Security

## Authentication

- **Method:** HTTP Basic Authentication (auth_basic)
- **Credential source:** Shared `.htpasswd` file with main OpenCode installation
- **Scope:** Both `/akm/` (UI) and `/akm/api/*` (API) are protected

## Network Exposure

| Check | Result |
|---|---|
| AKM Bridge bound to loopback only | ✅ 127.0.0.1:4199 |
| Raw bridge port externally reachable | ❌ Blocked (connection refused from 10.0.0.1) |
| Nginx proxy on public port | ✅ Port 18080 (behind Coolify/Traefik on 80/443) |
| CORS wildcard | ✅ No wildcard — same-origin only |
| API authentication | ✅ auth_basic required |

## Security Test Results

### Authentication Bypass

| Test | Result |
|---|---|
| No auth → /akm/ | 401 ✅ |
| No auth → /akm/api/health | 401 ✅ |
| Wrong credentials → /akm/ | 401 ✅ |
| Encoded path bypass (/akm/%2e/api/health) without auth | 401 ✅ |
| Traversal bypass (/akm/assets/../api/health) without auth | 401 ✅ |

### Path Traversal

| Test | Result |
|---|---|
| `/akm/assets/../api/health` with auth | Normalized → API response ✅ |
| `/akm/%2e/api/health` with auth | Normalized → API response ✅ |
| `/akm/..%2fapi/health` with auth | Normalized → API response ✅ |
| Unknown route `/akm/nonexistent` | 404 ✅ |

Note: Nginx normalizes paths before location matching. With valid auth, traversal patterns resolve to the same API endpoints (expected behavior). Without auth, all paths return 401.

### Proxy Safety

- Request body size limited by `client_max_body_size 25m`
- No internal stack traces exposed
- Forwarding headers set but not trusted for authorization
- Upgrade/WebSocket headers not proxied to AKM (not needed for REST API)

## Security Headers

The panel inherits the main Nginx security headers:
- `X-Robots-Tag: noindex, nofollow, noarchive`
- Content-Security-Policy (set by OpenCode upstream, not modified)

## Threat Model

The AKM panel is read-only and exposes no write operations. The primary security concern is information disclosure of indexed knowledge entries. This is mitigated by:

1. Authentication required for all access
2. Loopback-only bridge binding
3. Same-origin API only
4. No CORS wildcard
5. Read-only panel — no write operations possible
