# GitHub CI & Quality Gates

## Authentication

The repo uses HTTPS with `gh` credential helper for push access.
No SSH key or long-lived token is stored in the repository.

```bash
# Auth method
gh auth status
# Remote
git remote -v
```

## Workflows

### CI (`.github/workflows/ci.yml`)

Triggers on push/PR to `main` or manual dispatch.

Gate sequence:
1. Checkout repo
2. Setup Bun (latest stable)
3. Cache `node_modules`
4. `bun install --frozen-lockfile`
5. `bun run lint` — TypeScript type-check (noEmit)
6. `bun run build` — TypeScript compilation
7. `bun run validate:docs` — doc template validation
8. `bun run test:mcp-contract` — MCP JSON-RPC protocol tests
9. `bun run test` — full Jest test suite

All gates must pass. No `continue-on-error`.

### Secret Scan (`.github/workflows/secret-scan.yml`)

Uses Gitleaks to scan push/PR payloads for credentials and tokens.

Triggers on push/PR to `main` or manual dispatch.

### Dependabot (`.github/dependabot.yml`)

Weekly updates for:
- GitHub Actions
- npm/Bun dependencies (versioning-strategy: increase)

No auto-merge. All updates reviewed via Dependabot PRs.

## Validation Scripts

### `scripts/validate-docs.ts`

Automated in CI. Checks:
- All required documentation files exist (6 files)
- Example JSON templates are valid JSON
- Skill/agent markdown files have valid YAML frontmatter
- No secrets (GitHub tokens, API keys, private keys) in docs/templates
- No absolute private paths (`/root/`, `/home/`) unless `placeholder` marked

## MCP Contract Tests

### `tests/mcp-contract.test.ts`

Verifies JSON-RPC protocol compliance using `fixtures/fake-akm.sh`:

- `search` returns valid JSON with hits
- `search` with "noresults" returns empty `hits` array
- `health` returns valid JSON with `ok` and `status`
- `health` exit code 4 returns `warn` status
- `info` returns version and sources
- `list` returns sources array
- `show` with valid/invalid refs returns correct responses
- `search` with empty query returns error
- No stdout contamination from stderr
- `--version` returns version string

## Branch Protection (Recommended)

For `main` branch:

| Setting | Value |
|---------|-------|
| Require status checks | true |
| Required checks | CI, Secret Scan |
| Block force pushes | true |
| Block branch deletion | true |
| Require up-to-date | true |
| Require PR review | optional (single-contributor repo) |

Configuration not applied automatically — requires repo admin access.

## Debugging Failed CI

```bash
# View recent workflow runs
gh run list --limit 10

# Watch a specific run
gh run watch <run-id>

# View logs
gh run view <run-id> --log
```

## Rollback

```bash
# Revert last CI commit
git revert HEAD
git push
```
