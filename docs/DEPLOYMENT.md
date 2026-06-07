# Deployment — akm-bridge

## Prerequisites

- **Node.js** ≥ 22.x
- **Bun** ≥ 1.3.14 (`/root/.bun/bin/bun`)
- **AKM** ≥ 0.8.1 (`/root/.bun/bin/akm`)
- **OpenCode** ≥ 1.16.0

## Deployment Steps

### 1. Clone / Copy the Bridge

```bash
cp -r /path/to/akm-bridge /target/deploy/akm-bridge
cd /target/deploy/akm-bridge
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Run Tests

```bash
bun test
```

### 4. Build

```bash
bun run build
```

### 5. Configure MCP

Add or update the `akm-bridge` entry in `opencode.json`:

```json
{
  "mcp": {
    "servers": {
      "akm-bridge": {
        "command": "/root/.bun/bin/bun",
        "args": ["run", "/path/to/akm-bridge/dist/mcp-server.js"],
        "enabled": true,
        "env": {
          "PATH": "/root/.bun/bin:/usr/local/bin:/usr/bin:/bin"
        }
      }
    }
  }
}
```

### 6. Restart OpenCode

```bash
# Depends on deployment — close and reopen the OpenCode session
# or restart the OpenCode service/process
```

### 7. Verify MCP Tools

Check that all 14 `akm-bridge_*` tools are available in the agent tool list.

### 8. Smoke Test

```bash
akm --version
akm info
akm health
akm search --query deploy --limit 3
```

## Rollback

```bash
# Revert to previous adapter.ts version from backup
cp src/adapter.ts.bak.<TIMESTAMP> src/adapter.ts
bun run build

# Or revert git commit
git revert HEAD
bun run build
```

See `docs/RECOVERY.md` for detailed recovery procedures.
