# Test Baseline

## Overview

Zero-red deterministic test baseline. All supported suites pass across 3 runners.

## Runners

| Runner | Config | Suites | Tests |
|--------|--------|--------|-------|
| Jest | `jest.config.json` | 7 | 229 |
| Vitest | `vitest.config.ts` | 2 | 161 |
| Bun test | CLI args | 2 | 72 |
| **Total** | | **11** | **462** |

## Suite Matrix

| Suite | Runner | Required | Status |
|-------|--------|----------|--------|
| adapter | Jest | yes | passing |
| agent-workflow | Jest | yes | passing |
| bootstrap | Jest | yes | passing |
| dashboard | Jest | yes | passing |
| mcp-contract | Jest | yes | passing |
| observability | Jest | yes | passing |
| version-management | Jest | yes | passing |
| remote-control | Vitest | yes | passing |
| scheduler | Vitest | yes | passing |
| notifications | Bun | yes | passing |
| safe-recovery | Bun | yes | passing |

## Commands

```
npm run test          # Jest only (legacy)
npm run test:jest     # All 7 Jest suites
npm run test:vitest   # Vitest (scheduler + remote-control)
npm run test:bun      # Bun test (notifications + safe-recovery)
npm run test:all      # All 3 runners (fails if any fails)
npm run test:matrix   # Orchestrator with --ci/--local/--json
```

## Isolation Rules

1. Each runner uses a separate process — no global state leaks between runners
2. Jest excludes bun/vitest suites via `testPathIgnorePatterns`
3. Vitest config only includes scheduler + remote-control
4. Bun runs only notifications + safe-recovery explicitly
5. Each SQLite test creates its own temp database file
6. `afterAll` callbacks close handles, remove temp files
7. Jest `--forceExit` prevents handle leaks from hanging the process
8. Env vars saved/restored per test suite via `beforeAll`/`afterAll`

## Cleanup Requirements

Before suite: clear temp dirs, set known env
After suite: close DB, remove temp files, restore env, clear timers

## Quarantine Policy

Only suites that require unavailable systemd, isolated VM, or manual credentials may be quarantined. Currently no suites are quarantined.

The legacy `tests/test-runner.ts` is a non-required suite that duplicates the adapter Jest tests. It is quarantined with an expiry review date.

## CI Behavior

- `test-jest`, `test-vitest`, `test-bun` run in parallel
- `quality` and `e2e-static` depend on all 3 passing first
- Matrix runner validates all suites in CI mode
- Any required suite failure = red CI

## Troubleshooting

### Flaky tests
None known. All 462 tests pass deterministically in repeated runs.

### Isolated test fail
```
npm run test:jest -- --testPathPatterns=bootstrap --forceExit --no-cache
npx vitest run tests/scheduler.test.ts
bun test tests/notifications.test.ts
```

### Full suite with timings
```
npm run test:matrix -- --ci --json
```

### Order independence check
```
npm run test:matrix -- --repeat=3 --random-order --local
```

### Leak detection
Check open handles after `npm run test:jest`:
- Ignored: `(node:NNNN) ExperimentalWarning: VM Modules` (Node.js feature warning, not a leak)
- Any other open handle message indicates a missing cleanup in the suite