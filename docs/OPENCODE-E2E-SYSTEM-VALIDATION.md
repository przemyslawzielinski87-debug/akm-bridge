# OpenCode End-to-End System Validation

## Architecture

The E2E validation system provides three levels of testing:

### 1. Static Tests (file-level)
No OpenCode runtime needed. Checks file existence, syntax, and structure.

- `opencode-version` — Binary exists
- `contract-agents` — All 7 agent files present
- `contract-commands` — All 14 command files present  
- `contract-skills` — All 19 skill SKILL.md files present
- `contract-mcp` — All MCP entries in config are valid
- `permission-yaml` — YAML frontmatter on agent files
- `recovery-templates` — .systemd/ templates exist
- `observability-scripts` — Scripts directory integrity
- `config-syntax` — opencode.json validates

### 2. Smoke Runtime Tests (read-only)
Checks agent registration, permissions, and config references.

### 3. Full E2E
All static + smoke tests.

## Usage

### Runner
```bash
bun run scripts/opencode-e2e.ts          # default: smoke --no-write
bun run scripts/opencode-e2e.ts --full   # all tests
bun run scripts/opencode-e2e.ts --static # file-level only
bun run scripts/opencode-e2e.ts --json   # JSON output
bun run scripts/opencode-e2e.ts --report path/to/report.json
```

### OpenCode Command
```bash
/system-check        # smoke mode (default)
/system-check --full # full validation
/system-check --json # JSON output
```

## Contract Manifest

`tests/e2e/opencode-contract.json` is the source of truth for expected components.

| Component | Expected Count |
|-----------|---------------|
| Custom Agents | 7 |
| Commands | 14 (+ 1 /system-check = 15) |
| Skills | 19 (+ 1 system-validation = 20) |
| Enabled MCP | 7 |
| Critical Plugins | 8 |

## Test Results Interpretation

| Overall | Meaning |
|---------|---------|
| PASS | All tests green |
| PARTIAL | Some non-critical tests failed or degraded |
| FAIL | Critical component missing or broken |

## CI Integration

Only static E2E tests run in GitHub CI (no runtime, no MCP, no secrets).
Runtime tests require the local server environment.

## Fixtures

Test fixtures for agent/command/skill/permission validation live in `tests/e2e/fixtures/`.

## Rollback

```bash
git revert HEAD  # reverts last commit
```
