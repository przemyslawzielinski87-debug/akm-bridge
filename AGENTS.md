# AGENTS.md

## Cursor Cloud specific instructions

This repo is **akm-bridge**: a controlled, read-mostly adapter for the external `akm`
CLI, exposed to OpenCode. Standard commands live in `package.json` (`scripts`),
`README.md`, `ui/README.md`, and `docs/DEPLOYMENT.md` — refer to those rather than
duplicating them. The notes below are the non-obvious caveats for this environment.

### Runtime / package manager
- Package manager is **Bun** (lockfile is `bun.lock`). Install deps with `bun install`.
  The startup update script already runs this.
- `bun install --frozen-lockfile` (what CI uses) currently reports "lockfile had
  changes" against the installed Bun and fails. For local dev, use plain `bun install`.
  Don't commit the re-saved `bun.lock`.
- Node 22 + `tsx` run the TypeScript directly; `npm run build` (`tsc`) emits to `dist/`.

### The `akm` binary is not installed — always stub it
- The real `akm` CLI is **not present** here. The adapter defaults to
  `/root/.bun/bin/akm` and is overridable via the `AKM_BINARY` env var (`src/config.ts`).
- For every run/test of AKM-backed functionality, point it at the bundled fake:
  `export AKM_BINARY="$PWD/fixtures/fake-akm.sh"`. This returns canned JSON for
  health/info/status/capabilities/list/search/show and is exactly what CI uses.
- Without the stub, the servers still **start**, but AKM-dependent endpoints/tools
  return a clean "AKM binary not found" error.

### Bun path quirk
- The `test:bun` npm script hardcodes `/root/.bun/bin/bun`. A symlink
  `/root/.bun -> ~/.bun` is created during environment setup so the script resolves;
  it persists in the VM snapshot. If `npm run test:bun` ever reports
  `bun: not found`, re-create that symlink or run `bun test ...` directly.

### Expected test failures in a fresh checkout
- jest, vitest, and bun suites contain integration assertions that check for a
  **provisioned OpenCode host** — files under `/root/.config/opencode/` (commands,
  skills, `opencode.json`) and live services via the recovery controller. These
  ~33 tests fail in a plain dev checkout and are **expected**; they only pass on a
  host provisioned by `scripts/bootstrap-opencode-environment.ts`. The core bridge
  unit tests pass. Don't treat these path/host failures as regressions.

### Services
- **MCP server** (primary product, stdio): `npm run dev:mcp` (source) or
  `npm start` after build. Exposes 14 `akm_*` tools. Verify with
  `AKM_BINARY=$PWD/fixtures/fake-akm.sh npm run check:mcp-health`.
- **HTTP API + Web UI**: `npm run dev:http` → `http://127.0.0.1:4199/`
  (port/host hardcoded in `src/config.ts`). UI assets in `ui/assets/` are
  pre-built; rebuild per `ui/README.md` if you change `ui/src`. Set
  `AKM_WRITE_ENABLED=true` to exercise write/CSRF routes.
- **Optional (require the Bun runtime, use `bun:sqlite`)**: ops dashboard
  `bun run src/dashboard/server.ts` (127.0.0.1:4200) and remote-control
  `bun run src/remote-control/server.ts` (127.0.0.1:4201). Not needed to test the
  core bridge.
