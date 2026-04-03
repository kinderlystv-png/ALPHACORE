---
description: Morning brief — get today's focus areas and action items from ALPHACORE
mode: agent
tools:
  - run_in_terminal
  - read_file
---

# Morning Brief

Read the current ALPHACORE attention snapshot and produce a morning brief.

## Steps

1. Run `npm run alpha -- brief` in the ALPHACORE workspace
2. Read the output and identify:
   - Critical and watch areas
   - Top 3 priorities with actions
   - Balance score trend
3. Present the brief to the user in Russian
4. Ask if they want to adjust today's focus or add a journal entry

## Context

The brief pulls live data from Postgres via `/api/agent-snapshot?mode=brief`.
The dev server must be running at port 3004.
