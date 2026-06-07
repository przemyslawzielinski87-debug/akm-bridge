---
name: safe-git-release
description: Use when preparing a git commit, release, push, or changelog. Covers safe commit workflow with verification. Triggers on keywords: commit, release, push, changelog, pr, pull request, merge, staging, git add.
---

# Safe Git Release

Safe commit and release workflow.

## AKM Integration
Search AKM for: git workflow, release procedure, deploy checklist

## Procedure

### 1. Pre-Checks
- git status, git branch --show-current
- git diff --stat, git diff --cached --stat
- Check for unstaged changes

### 2. Verification
- Run tests
- Run lint/typecheck
- Run build (if applicable)
- Secret scan on all changed files

### 3. Unwanted File Detection
- Check for: *.bak, .env, *.log, node_modules, large binaries
- Check for credentials, tokens, keys in diff
- Remove any detected secrets from staging

### 4. Staging
- Stage only intended files (no git add .)
- git add <specific files>
- Verify git diff --cached --stat

### 5. Commit
- Generate conventional commit message
- git commit -m "type(scope): description"
- Verify git log --oneline -1

### 6. Push (only with --push or explicit consent)
- git push origin <branch>
- Never git push --force
- Confirm target remote and branch

## Safety Rules
- No git add .
- No force push
- No commit of secrets, backups, .env
- No push without approval
- Verify git diff --staged before commit
