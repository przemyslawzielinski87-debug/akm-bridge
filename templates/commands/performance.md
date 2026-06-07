# Command: /performance

## Purpose
Run performance benchmarks and compare against baseline thresholds.

## Usage
```
/performance                    — show current baseline status
/performance --status           — show baseline status and last run
/performance --smoke            — run quick smoke benchmarks
/performance --full             — run all benchmarks
/performance --compare          — compare results against baseline
/performance --component mcp    — run benchmarks for one component
```

## What It Does
- Runs repeatable benchmarks (startup, MCP, SQLite, dashboard, scheduler, memory)
- Reports median, p95, min, max, std deviation
- Compares against thresholds and detects regressions
- Supports CI mode with relaxed thresholds
- Generates JSON report for comparison

## Agent
- `infra-ops` for analysis
- `reviewer` for read-only status check

## AKM
- Skill: `performance-profiling`
- Knowledge: baseline thresholds, known regressions

## Safety
- Read-only for status and analysis
- Does not restart services or modify production data
- Uses isolated fixtures and mock data
- No network calls to external services
- Does not impact running tasks or schedules