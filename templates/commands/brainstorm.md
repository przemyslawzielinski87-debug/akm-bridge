# Command: /brainstorm

## Purpose
Launch the brainstorming skill to refine an idea before implementation.

## Usage
```
/brainstorm <topic>
```

Examples:
```
/brainstorm I want to add cost comparison to the OpenCode panel
/brainstorm How to better automate The Meridian
/brainstorm New automatic publishing system
/brainstorm Redesign the plugin architecture
```

## What It Does
1. Loads the `brainstorming` skill
2. Reads current project context (AGENTS.md, README, recent changes)
3. Searches AKM for prior decisions, lessons, and constraints related to the topic
4. Summarizes understanding of the idea
5. Asks one question at a time to clarify requirements
6. Presents 2-3 approaches with trade-offs
7. Prepares a design document in sections
8. Requests approval before any implementation

## Agent
Use `explore` agent for read-only context gathering. Do NOT use agents that can edit files.

## AKM
Search AKM before brainstorming for:
- Prior decisions on similar topics
- Lessons from related work
- Architecture constraints
- Existing design patterns

## Safety
Read-only — no file edits, no commits, no deploy, no service restarts during brainstorming. All changes happen only after explicit user approval and handoff to an implementation agent.
