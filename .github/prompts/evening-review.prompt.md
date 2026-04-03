---
description: Evening review — reflect on the day and set carry-over priorities
mode: agent
tools:
  - run_in_terminal
  - read_file
---

# Evening Review

Generate an evening review from ALPHACORE data and help the user reflect.

## Steps

1. Run `npm run alpha -- review` in the ALPHACORE workspace
2. Present the review: area states, what moved, carry-over priorities
3. Ask the user what went well and what didn't
4. Log a journal entry with their reflections:
   ```bash
   npm run alpha -- journal add "Итоги дня: ..." --tags review,evening --author assistant
   ```
5. If it's Friday, check the review habit:
   ```bash
   npm run alpha -- habit check review
   ```

## Context

Uses `/api/agent-snapshot?mode=review` from Postgres.
Dev server must be running at port 3004.
