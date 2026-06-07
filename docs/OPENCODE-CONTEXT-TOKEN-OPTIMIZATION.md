# OpenCode Context & Token Optimization

## Baseline (Before)

| Metric | Value |
|--------|-------|
| Compaction | Not set (disabled) |
| Watcher ignore | Not set |
| Global AGENTS.md | 6,117 bytes / 141 lines |
| Tool definitions cost | ~29,400 tokens |
| Total startup context | ~38,700 tokens (23.6% of 163K) |
| Default model context window | 163,840 tokens |

## Optimizations Applied

### 1. Compaction

```json
{
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 20000
  }
}
```

- `auto: true` — automatic compaction when nearing limit
- `prune: true` — removes old tool outputs during compaction
- `reserved: 20000` — keeps 20K token buffer for response generation

### 2. Watcher Ignore

Added 20 patterns to reduce filesystem noise:

```
node_modules/**
vendor/**
dist/**
build/**
coverage/**
.cache/**
.tmp/**
logs/**
*.log
*.bak
*.bak.*
.git/**
wp-content/cache/**
wp-content/uploads/**
wp-content/upgrade/**
wp-content/ai1wm-backups/**
playwright-report/**
test-results/**
screenshots/**
artifacts/**
```

### 3. AGENTS.md Trim

Removed redundant lean-ctx tool mapping table (already documented in the lean-ctx skill). Retained:
- AKM usage policy
- Global workflow rules
- Context efficiency guidelines
- Safety rules

**Reduction**: 25% (6,117 → 4,585 bytes, 141 → 108 lines)

## Optimized State

| Metric | Before | After |
|--------|--------|-------|
| AGENTS.md | 6,117 B | 4,585 B |
| Compaction | disabled | auto+prune |
| Watcher ignores | none | 20 patterns |
| Tool definitions | ~29,400 | ~29,400 (no change) |
| Total startup | ~38,700 | ~31,300 (19% of 163K) |

## Not Applied (Limitations)

| Feature | Status | Reason |
|---------|--------|--------|
| Per-agent MCP scoping | Not supported | v1.16.0 has no per-agent MCP config |
| Per-agent AKM tool scoping | Not supported | AKM tools are global |
| Plugin removal | Not needed | No redundant plugins found |
| Project AGENTS.md | Not present | No project-level config exists |
| Skill reduction | Not needed | Only described skills add context tokens |

## Rollback

```bash
# Restore from backup
cp /root/.config/opencode/backup/20260607125311-context-optimization/opencode.json /root/.config/opencode/opencode.json
cp /root/.config/opencode/backup/20260607125311-context-optimization/AGENTS.md /root/.config/opencode/AGENTS.md
```

## Verification

- JSON validated: `python3 -m json.tool opencode.json`
- Compaction auto/prune enabled at startup
- Watcher ignoring 20 pattern groups
- All 12 commands functional
- All 7 MCP servers initialized
- All 7 agent permissions intact
