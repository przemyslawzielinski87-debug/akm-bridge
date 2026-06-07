# AKM Knowledge Panel — OpenCode Launcher

## Method: Direct Route + Command

ETAP 4A implements two launcher methods:

### 1. Direct Authenticated Route

The primary access method is the authenticated route:

```
https://opencode.themeridian.com.pl/akm/
```

This is a same-origin path protected by the existing Nginx `auth_basic`. No SPA patching, DOM injection, or bundle modification was needed.

### 2. /akm Command

Sending `/akm` in any OpenCode conversation returns:

```
AKM Knowledge is available at:
https://opencode.themeridian.com.pl/akm/

Status: healthy
Indexed entries: 1866
Mode: read-only
```

## Launcher Options Investigated

| Option | Status | Reason |
|---|---|---|
| A — Navigation/command API | Implemented | `/akm` command works via direct route |
| B — MCP resource/prompt | Not used | The AKM MCP server already exposes tools; a resource link adds no significant value over the direct route |
| C — MCP Control navigation | Not used | MCP Control already has its own nav; adding a cross-section link would couple two independent features |
| D — Bookmarked/direct route | Primary | The direct authenticated route is the recommended access method |

## What Was NOT Done

- No SPA bundle patched
- No `node_modules` file changed
- No DOM injection or observer
- No CSS/JS orphan files in the OpenCode config root
- No native sidebar modification
- No hamburger menu modification

## Rationale

The authenticated reverse-proxy route is the simplest, most maintainable, and most secure option. It requires zero modification to the OpenCode SPA or Go server. The `/akm` command provides discoverability from within the chat interface.
