# AKM Knowledge Panel — Rollback Guide

## Scope of ETAP 4A

ETAP 4A adds:
1. Nginx location blocks for `/akm/` and `/akm/api/`
2. Base-path support in the UI (`<base>` tag, dynamic API base)
3. Documentation files

## Rollback Procedure

### 1. Remove Nginx Proxy Configuration

Restore the previous Nginx config:

```bash
cp /etc/nginx/sites-available/opencode-web-local.conf.bak-<TIMESTAMP> \
   /etc/nginx/sites-available/opencode-web-local.conf
cp /etc/nginx/sites-available/opencode-web-local.conf \
   /etc/nginx/sites-enabled/opencode-web-local.conf
nginx -s reload
```

### 2. Verify OpenCode Still Works

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:18080/
# Expected: 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:18080/api/mcp-status
# Expected: 200
```

### 3. Verify AKM Bridge Still Works (Direct)

```bash
curl -s http://127.0.0.1:4199/api/akm/health
# Expected: {"ok":true,"data":{"status":"pass"},...}
```

### 4. Preserved After Rollback

- ✅ AKM Bridge HTTP server (loopback, port 4199)
- ✅ All ETAP 2 API endpoints
- ✅ All 7 MCP tools
- ✅ All indexed AKM data
- ✅ ETAP 3 UI files in `ui/` directory
- ✅ `ui/index.html`, `ui/assets/`, `ui/src/`

### 5. Restoration

To restore the ETAP 4A configuration:

```bash
# Re-apply Nginx location blocks from the active config
# (or restore from version control)
git checkout -- akm-bridge/ui/index.html
git checkout -- akm-bridge/ui/src/api.ts
# Rebuild UI
cd /root/projekt/akm-bridge && npx esbuild ui/src/app.ts --bundle --outfile=ui/assets/app.js --format=esm --target=es2020
```

## What Rollback Does NOT Affect

- AKM Bridge bound to `127.0.0.1:4199` — unchanged
- MCP tool registration — unchanged
- AKM indexed entries — unchanged
- ETAP 2 tests — unchanged
- ETAP 3 UI implementation — unchanged
- Documentation files in `ui/` directory — remain available
