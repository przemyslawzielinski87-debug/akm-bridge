# OpenCode Post-Task Learning Loop

Persist reusable knowledge to AKM after significant tasks.

## Architecture

- **Read/Search**: AKM MCP bridge (`akm_search`, `akm_show`, `akm_proposal_list`)
- **Write**: AKM CLI ONLY (`akm import`, `akm propose`, `akm proposal accept`)
- No write tools exposed through MCP bridge

## Qualification

| Criteria | Required |
|----------|----------|
| Root cause confirmed | Yes |
| Fix tested | Yes |
| Rollback known | Yes or N/A |
| No secrets | Yes |

## Confidence Gate

| Level | Criteria | Action |
|-------|----------|--------|
| high | All criteria met, tested | Auto-save |
| medium | Partially confirmed | Draft + approval |
| low | Hypothesis only | Skip |

## Commands

- `/learn` — evaluate current task and persist knowledge
- `/learn --dry-run` — evaluate only, no write

## Write Flow (CLI)

1. Write temp markdown file
2. `akm import /tmp/lesson-*.md`
3. `akm sync`
4. Clean up temp file
5. Verify with `akm search`

## Duplicate Detection

1. Search AKM for root cause, project, component
2. Top 5 results evaluated
3. If relevant match: propose update instead of create

## Secret Redaction

Scans for: tokens, passwords, API keys, private keys, Bearer auth.
Block write if found. Report SECRET_SCAN=failed.

## Agents

| Agent | Can write? | Notes |
|-------|-----------|-------|
| akm-build | Yes (after gate) | Primary learning agent |
| meridian-dev | Yes (after gate) | WordPress fixes |
| infra-ops | Yes (after gate) | Infrastructure incidents |
| reviewer | No | Recommendations only |
| security-auditor | Yes (with approval) | Security lessons |
| release-manager | Yes (after gate) | Release failures |
| researcher | No | Drafts only |

## Rollback

```bash
# Remove imported lesson
akm search "<title>" | grep ref | akm proposal reject <id>
```

Or restore from:
`/root/.config/opencode/backup/20260607133450-post-task-learning/`
