# AKM Bridge

Controlled, read-only adapter for AKM v0.8.1 in OpenCode v1.16.0.

## Components

| Component | Path | Purpose |
|-----------|------|---------|
| Adapter library | `src/adapter.ts` | Core AKM binary wrapper with exit code 4 hardening |
| MCP server | `src/mcp-server.ts` | JSON-RPC over stdio — 14 AKM tools for OpenCode |
| HTTP API | `src/http-server.ts` | REST API on `127.0.0.1:4199` |
| Types | `src/types.ts` | Normalized response contracts |
| Config | `src/config.ts` | Binary path, timeouts, limits |

## Quick Start

```bash
cd /root/projekt/akm-bridge
bun install
bun run build
bun test
bun run start          # MCP server (stdio)
bun run start:http     # HTTP API
bun run dev:mcp        # MCP from source (tsx)
```

## MiniMax Setup (Cursor Cloud)

If your local machine already uses MiniMax but the cloud agent does not:

1. Copy `.env.example` to `.env`
2. Set `MINIMAX_API_KEY` (or `OPENAI_API_KEY`)
3. Keep `OPENAI_BASE_URL=https://api.minimax.io/v1`
4. Run:

```bash
bash scripts/apply-minimax-env.sh
```

The repository also includes `.cursor/environment.json` so cloud sessions get
the MiniMax base URL and default model (`MiniMax-M3`).

## Architecture

```
OpenCode
├── CLI shell ──────→ akm
├── MCP ───────────→ akm-bridge ──→ akm CLI
└── AGENTS.md ─────→ supervised workflow instructions
```

**Plugin decision**: `akm-opencode` is intentionally **not installed**.
The production integration is **CLI + MCP bridge + AGENTS.md**.
See `docs/AKM-OPENCODE-INTEGRATION.md` for full rationale.

## Exit Code 4 Note

`akm health` exits with code 4 (warn status). The adapter accepts this
only when stdout is valid JSON containing a health/warn response.
All other non-zero exit codes are rejected. See `docs/AKM-OPENCODE-INTEGRATION.md`.

## Documentation

| File | Content |
|------|---------|
| `docs/AKM-OPENCODE-INTEGRATION.md` | Full architecture, exit code 4 handling, test commands |
| `docs/DEPLOYMENT.md` | Deployment steps and prerequisites |
| `docs/RECOVERY.md` | Recovery procedures |
| `docs/examples/opencode-akm-mcp.example.json` | MCP config template |
| `scripts/deploy-akm-bridge.sh` | Automated deployment script |
