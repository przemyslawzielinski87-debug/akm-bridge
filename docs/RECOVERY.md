# Recovery — akm-bridge

## Failed MCP Connection

If the `akm-bridge` MCP server fails to start:

1. Check the OpenCode log for MCP errors
2. Verify the bridge binary path in `opencode.json`
3. Verify Bun is available at the configured path
4. Test the bridge directly:

```bash
/path/to/bun run /path/to/akm-bridge/dist/mcp-server.js
```

If the process starts and waits on stdin, MCP is working.

## AKM Not Found

If `akm` commands fail with "command not found":

```bash
# Ensure AKM is installed
/root/.bun/bin/bun global list | grep akm

# If missing, reinstall
/root/.bun/bin/bun global add akm-cli@0.8.1

# Verify PATH for the OpenCode process
# The MCP env should include:
export PATH="/root/.bun/bin:$PATH"
```

## Exit Code 4 Errors

If `akm_health` MCP tool returns an error instead of status:warn:

1. Check that `src/adapter.ts` contains the exit code 4 hardening logic
2. Without the fix, `akm health` exit code 4 is treated as a failure
3. Rebuild: `bun run build`
4. Verify: `akm health; echo $?` — should print 4

## Rebuild from Source

```bash
cd /root/projekt/akm-bridge
bun install        # Ensure dependencies
bun test           # Run the full test suite
bun run build      # Compile to dist/
```

## Revert to Backup

```bash
# List backups
ls -la src/adapter.ts.bak.*

# Restore
cp src/adapter.ts.bak.20260607111458 src/adapter.ts
bun run build
```

## Full Re-Installation

```bash
# Remove and reinstall
rm -rf /root/projekt/akm-bridge/node_modules
bun install
bun run build
bun test
```
