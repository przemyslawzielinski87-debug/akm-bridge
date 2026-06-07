---
name: secret-safe-audit
description: Use when scanning for secrets, tokens, credentials, or sensitive data in code or config. Triggers on keywords: secret, token, api key, credential, auth, password, .env, ssh, key, certificate, rotate.
---

# Secret Safe Audit

Scan and protect secrets in the repository.

## AKM Integration
Search AKM for: secret audit, credential scan, security lessons

## Scanning Scope
- Working tree (unstaged changes)
- Staged diff
- Last 5 commits
- git remote URLs
- Configuration files
- Log files
- .env metadata only

## Patterns to Detect
- AWS keys: AKIA...
- GitHub tokens: ghp_, gho_, ghu_
- JWT tokens
- Private keys: BEGIN PRIVATE KEY
- Connection strings
- Passwords in config
- NVIDIA/OpenAI/Anthropic keys

## Rules
- NEVER display full secret values
- Mask: show first 4 + last 4 chars
- Do NOT read content of private keys
- Distinguish placeholders from real secrets
- Check remote URLs for embedded credentials

## If a Secret is Found
1. Remove from staging: git restore --staged
2. Recommend rotation
3. Do NOT copy the secret into the report

## Report
SECRET_SCAN=CLEAN|ISSUES_FOUND
FILES_SCANNED=<count>
SECRETS_MASKED=<count>
ROTATION_RECOMMENDED=<list>
