---
name: slo-capacity-planning
description: SLO definition, error budgets, capacity model, load testing, circuit breakers, backpressure, and graceful degradation for the OpenCode environment
---
# SLO & Capacity Planning

## Overview
Defines, measures, and enforces service level objectives, error budgets, capacity limits, backpressure, circuit breakers, and graceful degradation.

## Available For
- akm-build (full access)
- infra-ops (smoke tests, monitoring)
- reviewer (read-only analysis)
- release-manager (capacity impact assessment)

## When to Use
- Setting SLO targets for new or existing services
- Investigating latency, availability, or correctness regressions
- Planning capacity for new projects or workloads
- Tuning resource limits and error budgets
- Investigating backpressure or circuit breaker events
- Before scaling or infrastructure changes

## When NOT to Use
- Simple configuration changes
- Cosmetic UI adjustments
- Tasks with an approved implementation plan

## Workflow

1. **Read current state** — load SLO policy, capacity baseline, and current metrics
2. **Check AKM** — search for prior SLO decisions, capacity lessons, and incident history
3. **Summarize understanding** — confirm SLIs, SLOs, error budgets, and capacity state
4. **Ask one question at a time** — prioritize by impact on SLO compliance
5. **Propose 2-3 approaches** with trade-offs for any SLO/capacity change
6. **Build SLO document** in sections:
   - SLI definitions
   - SLO targets and budgets
   - Capacity limits and model
   - Backpressure and circuit breaker configuration
   - Testing methodology (burst, sustained, contention)
   - Graceful degradation plan
   - Monitoring and alerts
   - Rollout and rollback
7. **Approval gate** — user must accept, revise, or reject
8. **Handoff** — concise handoff for the implementing agent

## Prohibitions
- No code or config changes during brainstorming
- No editing SLO policies without approval
- No modifying capacity limits without validation
- No running production load tests without explicit double confirmation
- No commits, push, or deploy
- No restarting services
- No writing lessons to AKM without separate learning gate

## AKM Integration
- Search project: read SLO decisions, capacity issues, lessons
- Search global: read architecture constraints and platform limits
- Use `akm-bridge_akm_search` and `akm-bridge_akm_show`

## Handoff Template
```
BRAINSTORM_STATUS=APPROVED
TITLE=
PROBLEM=
GOALS=
NON_GOALS=
RECOMMENDED_APPROACH=
ALTERNATIVES_REJECTED=
SLI_DEFINITIONS=
SLO_TARGETS=
ERROR_BUDGETS=
CAPACITY_LIMITS=
BACKPRESSURE_CONFIG=
CIRCUIT_BREAKER_CONFIG=
GRACEFUL_DEGRADATION=
TEST_METHODOLOGY=
ROLLOUT_PLAN=
ROLLBACK_PLAN=
SECURITY_CONSTRAINTS=
IMPLEMENTATION_PHASES=
TARGET_AGENT=
AKM_RESOURCES_USED=
OPEN_DECISIONS=
```