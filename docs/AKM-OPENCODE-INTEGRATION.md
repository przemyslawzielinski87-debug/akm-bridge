# AKM — OpenCode Integration Architecture

## Overview

AKM (Agent Kit Manager) v0.8.1 is integrated with OpenCode through three
independent, composable layers. No single layer is required — they reinforce
each other.

## Architecture

```
OpenCode
├── CLI shell ──────→ akm (via PATH or absolute path)
│                       e.g. akm search --query deploy --limit 3
│
├── MCP bridge ────→ akm-bridge (stdio JSON-RPC)
│   │                   bun run /path/to/akm-bridge/dist/mcp-server.js
│   │
│   └── 14 MCP tools:
│       ├── akm_health          ├── akm_feedback
│       ├── akm_status          ├── akm_proposal_list
│       ├── akm_search          ├── akm_proposal_show
│       ├── akm_show            ├── akm_capabilities
│       ├── akm_sources         ├── akm_agent_runs
│       ├── akm_stats           ├── akm_agent_mode
│       └── akm_agent_run_start └── akm_agent_run_complete
│
└── AGENTS.md ───→ Supervised workflow instructions
                       (read by agent at session start)
```

## Layer Details

### 1. CLI Shell

AKM CLI at `/root/.bun/bin/akm` (v0.8.1, installed via `bun global install`).

```bash
akm --version
akm info
akm health
akm search --query <term> --limit <N>
akm list
```

The CLI is available inside OpenCode sessions when PATH includes `/root/.bun/bin`
(configured via MCP environment in `opencode.json` or system PATH).

### 2. MCP Bridge (akm-bridge)

A read-only adapter that wraps AKM CLI calls into JSON-RPC tools.

- **Source**: `/root/projekt/akm-bridge/`
- **Runtime**: Bun (tsx for dev, compiled tsc for production)
- **Protocol**: stdio JSON-RPC (OpenCode MCP format)
- **Entry point**: `src/mcp-server.ts` → compiled to `dist/mcp-server.js`
- **Production command**: `bun run dist/mcp-server.js`

### 3. AGENTS.md

Located at `/root/.config/opencode/AGENTS.md`. The `akm-supervised` section
instructs agents to:
- Classify AKM usage before non-trivial tasks
- Select resources from AKM index
- Verify AKM guidance against runtime state
- Record feedback after task completion

## Architectural Decision

> **akm-opencode plugin is intentionally not installed.**
>
> The supported production integration is:
> **CLI + MCP bridge + AGENTS.md**
>
> The `akm-opencode` npm plugin (v0.8.2, by itlackey) adds auto-loading,
> session harvesting, and feedback hooks. These are useful but not critical.
> The MCP bridge already provides 14 AKM tools directly. Installing the
> plugin would add complexity without proportional benefit.

## Exit Code 4 Handling

`akm health` exits with code 4 when the service is healthy but in a
degraded state (e.g., semantic search blocked due to missing API key).

The bridge (`src/adapter.ts`) handles this precisely:

| Condition | Behavior |
|-----------|----------|
| Exit 0, any stdout | Success — resolved |
| Exit 4, valid JSON with `status:warn` or `health`/`checks`/`summary` keys | Accepted — resolved with stdout |
| Exit 4, empty stdout | Rejected |
| Exit 4, invalid JSON | Rejected |
| Exit 4, JSON missing health/warn/checks/summary | Rejected |
| Any other non-zero exit code | Rejected with stderr message |

## Test Commands

```bash
# Source-level
cd /root/projekt/akm-bridge
bun run dev:mcp          # Run MCP server from source (tsx)
bun run dev:http         # Run HTTP API from source (tsx)

# Build & production
bun run build            # Compile TypeScript → dist/
bun run start            # Run compiled MCP server
bun run start:http       # Run compiled HTTP API

# Tests
bun test                 # Jest test suite (21+ tests)
bun run test:injection   # Injection security tests

# AKM CLI smoke tests
akm --version
akm info
akm health
akm search --query deploy --limit 3
```

## Directory Layout

```
akm-bridge/
├── src/               # TypeScript source
│   ├── adapter.ts     # Core AKM binary wrapper
│   ├── mcp-server.ts  # MCP JSON-RPC over stdio
│   ├── http-server.ts # REST API
│   ├── types.ts       # Response contracts
│   └── config.ts      # Binary path, timeouts
├── tests/             # Test suite
│   ├── adapter.test.ts
│   └── test-runner.ts
├── fixtures/          # Test fixtures
│   └── fake-akm.sh    # Mock AKM binary for tests
├── docs/              # Documentation
├── scripts/           # Deployment scripts
├── dist/              # Compiled output (gitignored)
├── package.json
├── tsconfig.json
└── .gitignore
```
