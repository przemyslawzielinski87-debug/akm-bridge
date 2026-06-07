# OpenCode Brainstorming Skill

A lightweight, selectively loaded brainstorming workflow for refining ideas before implementation.

## When to Use

- New features with multiple possible approaches
- Architecture changes
- Unclear requirements needing exploration
- New products or major workflows
- Decisions with several viable alternatives

## When NOT to Use

- Typo fixes
- Simple bugfixes
- Read-only information requests
- Unambiguous config changes
- Tasks with an already-approved plan
- Incidents requiring immediate diagnosis

## Workflow

1. **Context Loading** — reads project context, AGENTS.md, README
2. **AKM Search** — searches for prior decisions, lessons, constraints
3. **Understanding Summary** — restates the idea back to the user
4. **One Question at a Time** — clarifies requirements progressively
5. **Approach Presentation** — 2-3 options with trade-offs
6. **Design Document** — structured sections (goal, scope, architecture, etc.)
7. **Approval Gate** — accept / revise / reject
8. **Handoff** — structured template for target agent

## AKM Integration

Before brainstorming, the skill searches AKM for:

| Type | Purpose |
|------|---------|
| `decision` | Prior architectural or design decisions |
| `lesson` | Lessons learned from similar work |
| `architecture` | Existing system architecture facts |
| `constraint` | Known limitations or requirements |

Consulted resources are documented in the handoff.

## Handoff Format

After approval, the skill generates:

```
BRAINSTORM_STATUS=APPROVED
TITLE=
PROBLEM=
GOALS=
NON_GOALS=
RECOMMENDED_APPROACH=
ALTERNATIVES_REJECTED=
ARCHITECTURE=
SECURITY_CONSTRAINTS=
IMPLEMENTATION_PHASES=
TEST_STRATEGY=
ROLLBACK=
TARGET_AGENT=
AKM_RESOURCES_USED=
OPEN_DECISIONS=
```

The handoff is passed to the planning or implementation phase. The brainstorming skill does NOT start implementation.

## Permissions

- **Read-only** — no file edits, commits, push, deploy
- **No service restarts** — no destructive commands
- **No branch creation** — no git operations beyond reading
- **No auto-implementation** — strict gate before any code changes

## Examples

### Example 1: New Feature
```
User: /brainstorm I want to add cost comparison to the OpenCode panel
Agent: [loads skill, reads context, searches AKM]
Agent: I understand you want to compare model costs in the panel.
       Question: Should this be a real-time calculation or a static reference table?
       A) Real-time — calculates from current usage data
       B) Static — pre-configured pricing reference
       C) Hybrid — static base with real-time adjustments
```

### Example 2: Architecture Change
```
User: /brainstorm How should we restructure the plugin system?
Agent: [loads skill, reads context, searches AKM]
Agent: I see the current plugin system uses X pattern.
       Question: What's the primary motivation for restructuring?
       A) Performance — plugins are slow
       B) Maintainability — hard to add new plugins
       C) Security — need better isolation
```

### Example 3: Trivial Task (Skill Not Loaded)
```
User: Fix the typo in README.md
Agent: [does NOT load brainstorming skill — this is a trivial fix]
```

## Testing

| Test | Input | Expected |
|------|-------|----------|
| A — New feature | `/brainstorm add cost comparison` | Skill loads, reads context, asks 1 question |
| B — Vague idea | `/brainstorm automate The Meridian` | Narrows problem, doesn't invent implementation |
| C — Trivial bug | "Fix typo in README" | Skill NOT loaded |
| D — Post-acceptance | After user accepts | Handoff generated, no re-brainstorm |
| E — Edit attempt | Agent tries to edit | Blocked by read-only constraint |

## Integration with Existing System

- Uses existing `explore` agent for read-only context gathering
- Respects `production-safety` skill rules
- Does not conflict with any existing skill (26 skills audited, no collision)
- Does not modify existing commands (27 commands audited, no collision)
- Selectively loaded — does not add startup context overhead

## Files

| File | Purpose |
|------|---------|
| `~/.config/opencode/skills/brainstorming/SKILL.md` | Skill definition |
| `~/.config/opencode/commands/brainstorm.md` | Command definition |
| `docs/OPENCODE-BRAINSTORMING-SKILL.md` | This documentation |
| `docs/examples/skills/brainstorming/SKILL.md` | Anonymized template |
