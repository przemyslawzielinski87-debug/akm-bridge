# OpenCode Performance Baseline

## Overview
Repeatable performance benchmarks for the entire OpenCode stack: startup, MCP, SQLite, dashboard, scheduler, notification worker, memory, and CPU profiling.

## When to Use
- After significant infrastructure changes
- Before deployment to verify no regressions
- When investigating latency or memory issues
- After adding new MCP servers or heavy features
- To validate optimizer changes

## When NOT to Use
- During production incidents
- Under active system load (results will be invalid)
- After trivial configuration-only changes

## Baseline Methodology

### Environment
All benchmarks capture the environment (OS, CPU cores, RAM, Bun/Node versions) to ensure comparability between runs.

### Warm-Up
Every benchmark runs 2 warm-up iterations before measurement begins. This ensures JIT compilation and module caching don't skew results.

### Measurement
- Minimum 4 measurement runs per benchmark
- Heavy benchmarks (build, long SQLite) use 2 runs
- All benchmarks run in isolated processes with dedicated fixtures

### Statistics
- **Median**: primary metric (robust to outliers)
- **P95**: tail latency indicator
- **Min/Max**: range visibility
- **StdDev**: stability indicator

### Cold vs Warm Start
- Cold start: first invocation after process start
- Warm start: subsequent invocations (cached modules)
- Both are measured separately where applicable

## Thresholds

### Relative Thresholds
| Metric | Warn | Fail |
|--------|------|------|
| Latency regression | +20% | +50% |
| Memory regression | +20% | +50% |
| Startup regression | +25% | +50% |
| CPU regression | +25% | +50% |

### Absolute Limits
Each benchmark has absolute limits in `performance/baseline.json`. These prevent wildly out-of-spec results even if relative comparison is unavailable.

## Benchmark Catalog

### Startup
- `startup-tsc`: tsc --noEmit compile time
- `startup-tsx-import`: TSX module import overhead
- `startup-build`: full tsc build time
- `startup-node-require`: bare Node.js process startup

### SQLite
- `sqlite-insert-1000`: insert 1000 rows into in-memory database
- `sqlite-lookup-indexed`: indexed lookup across 10k rows
- `sqlite-concurrent-reads`: 10 concurrent readers on separate databases

### Dashboard
- `dashboard-data-import`: import and call dashboard data generation
- `dashboard-e2e-import`: import and call E2E data generation

### Scheduler
- `scheduler-scan-100`: scan 100 mock schedules
- `scheduler-scan-1000`: scan 1000 mock schedules

### Memory
- `memory-alloc-1000`: allocate and serialize 1000 objects
- `memory-gc-leak-check`: verify no significant RSS growth after GC

### MCP
- `mcp-http-tools-list`: HTTP GET /mcp/tools (server-required, skipped in CI)

## Running Benchmarks

```bash
# Quick smoke test (CI-compatible)
tsx scripts/run-performance-baseline.ts --ci

# Full benchmark suite
tsx scripts/run-performance-baseline.ts --all

# Compare against baseline
tsx scripts/run-performance-baseline.ts --compare performance/baseline.json

# Update baseline after verified improvement
tsx scripts/run-performance-baseline.ts --update-baseline

# Run only one component
tsx scripts/run-performance-baseline.ts --component sqlite

# JSON output
tsx scripts/run-performance-baseline.ts --json
```

## CI Integration

### Fast Smoke Job
Runs in GitHub-hosted CI:
- startup benchmarks (tsc, build)
- SQLite benchmarks
- memory smoke test
- Thresholds are relaxed in CI mode

### Full Server Benchmarks
Run on production-equivalent hardware:
- MCP latency
- Long session stability
- Systemd profiling
- Watcher performance

## Baseline Management
- Baseline is committed to `performance/baseline.json`
- Update only after verified improvement on comparable hardware
- Never update baseline to hide a regression
- Document the reason for any threshold change

## Regression Response
1. Identify the regression from CI or manual run
2. Pinpoint the commit that caused it (`git bisect`)
3. Profile the hotspot (`Bun.nanoseconds()`, `process.cpuUsage()`)
4. Apply minimal fix
5. Re-run benchmarks to confirm recovery
6. Update baseline if performance is intentionally changed

## /performance Command
```
/performance               — show baseline status
/performance --smoke       — run quick smoke test
/performance --full        — run all benchmarks
/performance --compare     — compare against baseline
/performance --component mcp — specific component
```

## Skill: performance-profiling
Loaded automatically for benchmark-related tasks. Covers baseline methodology, profiling, threshold enforcement, and optimization workflows.

## Profiling Hotspots
Use `Bun.nanoseconds()` and `process.memoryUsage()` for micro-benchmarks. For macro-level profiling, use the full benchmark suite and compare against baseline.

## Troubleshooting
- **Benchmarks timeout**: increase timeout in benchmark call or check for infinite loops
- **High variance**: ensure sufficient warm-up runs and isolated fixtures
- **CI failures**: check environment parity (CPU, RAM, Node version)
- **Memory leaks**: run memory benchmarks in isolation and compare RSS before/after GC