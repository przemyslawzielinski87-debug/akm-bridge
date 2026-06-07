# Command: /projects

## Purpose
List and inspect project profiles, their status, budgets, locks, and environments.

## Usage
```
/projects
/projects --list
/projects --status
/projects --show <project-id>
/projects --budget <project-id>
/projects --locks
```

Examples:
```
/projects
/projects --status
/projects --show the-meridian
/projects --budget akm-bridge
/projects --locks
```

## What It Does
1. Reads all configured project profiles from the registry
2. Queries each profile's status (enabled/disabled, agents, environments)
3. Checks budget status (daily/weekly read/write, soft warning at 80%)
4. Checks active project locks (write locks, environment locks)
5. Displays a summary table or detail view
6. Supports filtering by project ID

## Agent
Use `explore` agent for read-only queries. Use `akm-build` when creating or modifying profiles (requires admin permissions).

## AKM
Search AKM for:
- Project profile definitions
- Environment configurations
- Budget limits and policies
- Lock and queue policies

## Safety
Read-only for list/status/show/budget/locks. Profile modification requires admin session, CSRF token, double confirmation, and security audit trail.