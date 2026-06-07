---
name: post-task-learning
description: Use after completing a significant task, fixing an incident, or discovering a reusable pattern. Saves knowledge to AKM. Triggers on keywords: lesson learned, root cause, recurring, pattern, workflow, procedure, automate, document, knowledge.
---

# Post-Task Learning

Persist reusable knowledge after completing a task.

## AKM Integration
This skill writes to AKM. Search first to avoid duplicates.

## Decision: Should Knowledge Be Saved?
Only save if the task produced:
- Confirmed root cause of an incident
- Effective fix for a recurring problem
- New reusable workflow or procedure
- Pattern that applies to multiple contexts
- Non-obvious gotcha or constraint

Do NOT save:
- Secrets or credentials
- Raw logs
- One-time values or temporary workarounds
- Unverified hypotheses
- Complete conversation transcripts
- Trivial changes

## Flow

### 1. Search AKM First
Check if similar knowledge already exists

### 2. Update Existing or Create New
If a similar resource exists, update it
Otherwise create new lesson or workflow
Keep it concise (5-15 steps)
Include: trigger, diagnosis, fix, verification, rollback

### 3. Save to AKM
- Use AKM knowledge tools
- Add tags: project, technology, severity
- Reference specific files and line numbers
- Include the working test command

### 4. Report
POST_TASK_LEARNING=SAVED|UPDATED|SKIPPED
AKM_RESOURCE=<ref>
ACTION=<created|updated|skipped>
REASON=<why>
