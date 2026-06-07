# OpenCode SLO & Capacity Planning

## Overview

Service Level Objectives (SLOs) and capacity planning for the OpenCode infrastructure environment (`akm-bridge`). Defines measurable targets for availability, latency, correctness, and saturation, with error budgets, capacity limits, backpressure, and load testing.

## Components

- **SLIs** — raw measurements (availability, p95 latency, success rate, throughput)
- **SLOs** — targets derived from SLIs (e.g., 99.5% dashboard availability)
- **Error budgets** — allowable failure within an SLO window
- **Capacity model** — soft/hard limits for queues, scheduler, notifications, dashboard, MCP, SQLite
- **Load tests** — burst, sustained, queue saturation, contention
- **Backpressure** — 429 Retry-After, queue pause, producer slowdown, circuit breaker
- **Load shedding** — priority-based degradation (noncritical first)
- **Resource guards** — CPU, RAM, disk, queue, WAL thresholds

## SLIs and SLOs

| SLI | Description | Environment | SLO Target |
|-----|-------------|-------------|------------|
| dashboard-availability | Dashboard API uptime | all | 99.5% |
| dashboard-latency | Dashboard p95 response time | all | 95% within 500ms |
| task-create-latency | Task creation p95 | all | 95% within 500ms |
| queue-pickup-latency | Queue pickup p95 | all | 95% within 5s |
| mcp-success-rate | MCP tool call success | all | 99.0% |
| mcp-latency | MCP tool call p95 | all | 95% within 3s |
| scheduler-scan-latency | Schedule scan p95 | all | 95% within 200ms |
| notification-dispatch-latency | Notification dispatch p95 | all | 95% within 1s |
| permission-correctness | Permission bypass rate | all | 0 allowed |
| duplicate-task-rate | Duplicate task rate | all | 0 allowed |

## Error Budgets

Each SLO has a budget_percent_per_window (default 5%). Budget is consumed when SLO is violated. Warning at 70% consumption, exhausted at 100%.

## Capacity Limits

| Component | Soft Limit | Hard Limit | Unit |
|-----------|-----------|-----------|------|
| Max queued tasks | 500 | 1000 | count |
| Concurrent read tasks | 10 | 20 | count |
| Concurrent write tasks | 3 | 5 | count |
| Scheduler entries | 5000 | 10000 | count |
| Notification backlog | 10000 | 20000 | count |
| SSE clients | 50 | 100 | count |
| Dashboard req/s | 20 | 50 | req/s |
| MCP calls/s | 10 | 25 | calls/s |
| SQLite writes/s | 50 | 100 | tx/s |
| Safe CPU | 80 | 90 | % |
| Safe RAM | 80 | 90 | % |
| Safe disk | 80 | 90 | % |

## Backpressure

- Task creation returns 429 Retry-After when queue exceeds soft limit
- Scheduler pauses task creation at queue hard limit
- Dashboard caches coalesce concurrent refresh requests
- SSE clients are rejected at max limit
- MCP tool calls are throttled per-second

## Circuit Breakers

| Service | Failure Threshold | Window | Cooldown |
|---------|------------------|--------|----------|
| MCP (per server) | 5 failures | 60s | 30s |
| SMTP | 3 failures | 300s | 120s |
| Telegram | 3 failures | 300s | 120s |
| Webhook | 3 failures | 300s | 120s |
| AKM semantic | 3 failures | 60s | 30s |

## Load Tests

### CI Smoke (GitHub Actions)
- Burst 10/25/100 concurrent requests
- SQLite 1-writer + 20-reader contention
- Scheduler scan 100/1000 entries
- Notification batch 100
- Dashboard concurrency 5 clients
- Backpressure simulation

### Server Tests (controlled environment)
- Sustained 30-minute load
- Real process RSS/CPU monitoring
- systemd health checks
- Real MCP stack
- Long OpenCode session

## Commands

- `/slo` — view SLO status, error budgets, capacity
- `/load-test` — run controlled capacity tests (smoke by default)

## Skill

- `slo-capacity-planning` — guided SLO/capacity workflow

## Usage

```bash
# View SLO status
/slo

# Run smoke capacity tests
/load-test --smoke

# Run full capacity tests (admin approval required)
/load-test --all

# Calculate error budget for 24h window
bun run scripts/calculate-error-budget.ts --window 24h

# Run CI smoke tests
bun run scripts/run-capacity-tests.ts --smoke
```

## Troubleshooting

- **Capacity exceeded**: Check queue depth, circuit breaker status, resource guards
- **Error budget exhausted**: Review SLO violations, adjust targets or fix root cause
- **Circuit breaker open**: Check service health, manual half-open after cooldown
- **SQLite contention**: Reduce write concurrency, check WAL size, busy timeout
- **Dashboard slow**: Check cache hit ratio, SSE client count, request rate