---
name: brainstorming
description: Use when the user wants to brainstorm, design, explore alternatives, or refine an idea before implementation. Triggers on keywords: brainstorm, design, think through, consider alternatives, explore options, plan a new feature, architect, prototype idea.
---

# Brainstorming

Guided brainstorming workflow for refining ideas before implementation. Enforces a strict design-before-code discipline.

## HARD GATE

**No implementation until the user explicitly approves the design.** If you find yourself writing code, editing files, or creating commits during brainstorming, stop immediately.

## Activation Checklist

1. Read the current project context (AGENTS.md, README, recent changes)
2. Search AKM for:
   - Prior decisions related to this topic
   - Similar ideas explored before
   - Constraints, lessons, or architecture facts
3. Summarize your understanding of the idea back to the user
4. Proceed to the question flow

## Question Flow

- Ask exactly **one question at a time**
- Prefer multiple choice (2-4 options) but allow free-form answers
- Never ask questions whose answers are already in the repository, AKM, or conversation
- Continue until you have enough information to propose approaches

## Approach Presentation

After gathering sufficient context, present **2-3 approaches**. For each:

- **Pros** — what it gains
- **Cons** — what it costs
- **Complexity** — low / medium / high
- **Risk** — what could go wrong
- **System impact** — how it affects existing code
- **Maintenance burden** — ongoing cost

Recommend one approach and explain why.

## Design Document

After the user selects an approach, prepare a design in short sections:

1. **Goal** — what we are solving
2. **Scope** — what is in and out
3. **Architecture** — high-level structure
4. **Data Flow** — how data moves
5. **UX** — user-facing behavior (if applicable)
6. **Security** — constraints and risks
7. **Tests** — verification strategy
8. **Rollout** — deployment plan
9. **Rollback** — recovery plan

After each major section, pause and let the user correct direction.

## Approval Gate

At the end, present exactly three options:

- **Accept** — proceed to implementation
- **Revise** — modify the design
- **Reject** — discard the idea

Do not proceed to implementation until the user selects **Accept**.

## Handoff

After acceptance, generate a structured handoff:

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

Do not start implementation. The handoff is for the target agent or planning phase.

## Prohibitions

During brainstorming, you must NEVER:

- Edit, create, or delete files
- Commit, push, or deploy
- Create branches or worktrees
- Restart services
- Run destructive commands
- Ask multiple questions at once
- Auto-transition to implementation
- Force TDD for every idea
- Write lessons to AKM without a separate learning gate

## When to Skip

Do NOT load this skill for:

- Typo fixes
- Simple bugfixes
- Read-only information requests
- Unambiguous config changes
- Tasks with an already-approved plan
- Incidents requiring immediate diagnosis

## AKM Integration

Before brainstorming, search AKM for:

- `decision` — prior architectural or design decisions
- `lesson` — lessons learned from similar work
- `architecture` — existing system architecture facts
- `constraint` — known limitations or requirements

Document which AKM resources were consulted in the handoff.

## Safety

This skill is read-only. It does not modify the system. All file changes happen in the implementation phase after approval.
