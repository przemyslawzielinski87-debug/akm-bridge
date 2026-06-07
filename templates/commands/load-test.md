# Command: /load-test

## Purpose
Run controlled capacity tests against the OpenCode environment using fixtures and mock providers.

## Usage
```
/load-test --smoke
/load-test --burst
/load-test --sustained --duration 300
/load-test --queue
/load-test --sqlite
/load-test --mcp-mock
```

## What It Does
- Executes burst tests (10/25/50/100 concurrent requests)
- Runs sustained load tests with configurable duration
- Tests queue saturation and backpressure behavior
- Validates SQLite contention handling
- Reports throughput, latency p95, and error rates

## Agent
akm-build (admin - requires approval for sustained/production)
infra-ops (smoke tests only)

## AKM
- State: capacity tests, slo policy
- Read: yes, Write: no (fixture-only)

## Safety
- Default: --smoke only (fixture-based, no real models)
- Full tests require double confirmation
- Blocked: production load without explicit approval
- Hard timeout enforced on all tests
- No real notification delivery or model calls
- All test data cleaned up after completion