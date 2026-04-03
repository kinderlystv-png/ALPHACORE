---
description: Quick capture — rapidly log a thought, task, or observation into ALPHACORE
mode: agent
tools:
  - run_in_terminal
---

# Quick Capture

Interpret what the user said and route it to the right ALPHACORE domain.

## Routing rules

| Signal | Command |
|--------|---------|
| Sounds like a task / todo / action item | `npm run alpha -- task add "..." --priority p2` |
| Sounds like a reflection / feeling / observation | `npm run alpha -- journal add "..." --tags ...` |
| Sounds like a note / idea / reference | `npm run alpha -- note add "..." --body "..."` |
| Mentions a project status change | `npm run alpha -- project status <name> <color>` |
| Mentions completing something physical | `npm run alpha -- habit check <id>` |
| Medical results | `npm run alpha -- medical add "..."  --category ... --date ... --params "..."` |

## Guidelines

- Default priority for tasks: p2 unless urgency is clear
- Default author for journal: assistant
- Infer tags from context (e.g. "пробежал 5km" → tags: run,health)
- If ambiguous, ask the user which domain fits best
- After logging, briefly confirm what was captured
