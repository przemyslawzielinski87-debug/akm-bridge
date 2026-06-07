# Command: /slo

## Purpose
View SLO status, error budgets, and capacity metrics for the OpenCode environment.

## Usage
```
/slo
/slo --status
/slo --budgets
/slo --capacity
/slo --violations
```

## What It Does
- Displays current SLO targets and compliance status
- Shows error budget consumption per SLO
- Reports capacity saturation levels (queue, CPU, RAM, disk)
- Lists recent violations and warning thresholds

## Agent
explore (read-only)
akm-build (admin - for baseline updates)

## AKM
- State: slo-policy, capacity-baseline
- Read-only: yes for default usage

## Safety
- Read-only by default
- No write operations without admin approval
- No capacity limit modifications without validation
- Errors are reported, not hidden