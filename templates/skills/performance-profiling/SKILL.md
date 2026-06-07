---
name: performance-profiling
description: "Run performance benchmarks, detect regressions, profile hotspots. Triggers on: benchmark, performance, profile, regression, latency, throughput, memory leak."
---

# Performance Profiling

Run repeatable benchmarks across the OpenCode stack and compare against baseline thresholds.

## When to Use
- Before/after deploying changes that may affect performance
- Investigating latency, memory, or CPU issues
- Validating SQLite query performance
- Checking scheduler scan overhead
- Setting up a new environment

## When NOT to Use
- During production incidents (use recovery instead)
- For simple configuration changes with no performance impact
- When the environment is under active load

## Workflow

1. **Environment check** — confirm OS, CPU, RAM, Bun/Node versions
2. **Warm-up** — 2 warm-up runs before measurement
3. **Measurement** — run benchmarks with repeatable fixtures
4. **Statistics** — compute median, p95, min, max, std deviation
5. **Comparison** — compare against baseline thresholds
6. **Report** — generate report with PASS/WARN/FAIL per benchmark
7. **CI gate** — required benchmarks must pass

## Benchmarks

| Category | Component | What It Measures |
|----------|-----------|-----------------|
| startup | typescript | tsc --noEmit compile time |
| startup | tsx | module import overhead |
| startup | build | full tsc build duration |
| sqlite | insert | 1000-row insert performance |
| sqlite | lookup | indexed lookup across 10k rows |
| sqlite | concurrent | 10 concurrent readers |
| dashboard | data | dashboard data generation |
| dashboard | e2e | E2E data generation |
| scheduler | scan-100 | 100 schedule scan |
| scheduler | scan-1000 | 1000 schedule scan |
| memory | allocation | 1000-object alloc + serialize |
| memory | leak-check | GC leak detection after allocation |
| mcp | http | HTTP MCP tools/list latency |
| runtime | startup | bare Node.js process startup |

## Thresholds
- Latency regression: 20% warn, 50% fail
- Memory regression: 20% warn, 50% fail
- Startup regression: 25% warn, 50% fail
- CPU regression: 25% warn, 50% fail
- Absolute limits defined per benchmark in baseline.json

## Prohibitions
- No modification of production data
- No restart of running services
- No external network calls during measurement
- No running benchmarks under debug logging

## Output
- Baseline saved to `performance/baseline.json`
- JSON report for CI consumption
- Human-readable table with PASS/WARN/FAIL

## Handoff
```
PERFORMANCE_STATUS=completed
BASELINE_FILE=performance/baseline.json
BENCHMARKS_PASSED=
BENCHMARKS_WARNED=
BENCHMARKS_FAILED=
REGRESSIONS_FOUND=
TARGET_AGENT=infra-ops
```

## AKM
- Lessons: store benchmark results and regression patterns
- Decisions: log when thresholds are adjusted
- Architecture: track which components need optimization