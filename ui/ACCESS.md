# AKM Knowledge Panel — Access Guide

## Canonical URL

```
https://opencode.themeridian.com.pl/akm/
```

## Authentication

The panel is protected by HTTP Basic Authentication (auth_basic) at the Nginx reverse-proxy level, shared with the main OpenCode interface.

- Unauthenticated requests return HTTP 401.
- Credentials are the same as the main OpenCode installation.
- Both the UI and API endpoints are authenticated.

## Internal Bridge

| Property | Value |
|---|---|
| Internal address | `http://127.0.0.1:4199` |
| Loopback-only | Yes (not reachable from external IPs) |
| Direct access | Blocked — Nginx proxies all external requests |

## Route Map

| Path | Authentication | Upstream | Purpose |
|---|---|---|---|
| `/` | auth_basic | OpenCode Go (4097) | OpenCode SPA + API |
| `/akm/` | auth_basic | AKM Bridge (4199) | AKM Knowledge Panel UI |
| `/akm/api/*` | auth_basic | AKM Bridge (4199) | AKM Knowledge API |
| `/api/mcp-status` | auth_basic | OpenCode Go (4097) | MCP status endpoint |
| `/api/mcp-control/` | auth_basic | MCP Control (4198) | MCP control panel |

## Browser Access

1. Open `https://opencode.themeridian.com.pl/akm/` in any browser.
2. Authenticate with your OpenCode credentials when prompted.
3. All five tabs (Overview, Search, Sources, Activity, Capabilities) work.

## API Access

The AKM API is available at the authenticated path:

```
https://opencode.themeridian.com.pl/akm/api/health
https://opencode.themeridian.com.pl/akm/api/status
https://opencode.themeridian.com.pl/akm/api/sources
https://opencode.themeridian.com.pl/akm/api/stats
https://opencode.themeridian.com.pl/akm/api/capabilities
https://opencode.themeridian.com.pl/akm/api/search?q=...
https://opencode.themeridian.com.pl/akm/api/resource?ref=...
https://opencode.themeridian.com.pl/akm/api/activity
```

All API requests require the same Basic Authentication credentials.

## "Back to OpenCode" Link

The panel header includes a "Back to OpenCode" link pointing to `https://opencode.themeridian.com.pl/`. This is a same-origin link that preserves your authentication session.

## Launcher

From within the OpenCode interface, send the `/akm` command in any conversation to receive a status summary and clickable link to the panel.
