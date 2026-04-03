---
description: >-
  ALPHACORE data operations — add tasks, journal entries, notes, update projects,
  check habits, add medical records. USE FOR: any request to create, update, or
  query ALPHACORE data domains (tasks, journal, notes, projects, habits, medical).
  DO NOT USE FOR: UI/component changes, build/deploy, general coding questions.
---

# ALPHACORE Data Operations

## When to use

Use this skill when the user asks to:
- Add, complete, or list tasks
- Add journal entries or notes
- Update project status or next steps
- Check habits
- Add medical records
- Query current data state

## How it works

All data operations go through the Agent CLI:

```bash
npm run alpha -- <command> [args]
```

The CLI talks to the running dev server at `localhost:3004` via HTTP.
**The dev server must be running** (`npm run dev`).

## Commands reference

### Tasks
```bash
npm run alpha -- task add "Title" --priority p1 --due 2026-04-05 --project kinderly
npm run alpha -- task list --status active --limit 5
npm run alpha -- task done <id>
```

### Journal
```bash
npm run alpha -- journal add "Текст записи" --tags tag1,tag2
npm run alpha -- journal list --limit 3
```
Journal entries from agent should default to `--author assistant`.

### Notes
```bash
npm run alpha -- note add "Заголовок" --body "Текст заметки" --tags tag1,tag2
```

### Projects
```bash
npm run alpha -- project list
npm run alpha -- project status <id|name> green|yellow|red
npm run alpha -- project next-step <id|name> "Step text"
```

### Habits
```bash
npm run alpha -- habit check sleep
npm run alpha -- habit status
```
Known habit IDs: sleep, run, stretch, projects_upd, review, drums.

### Medical
```bash
npm run alpha -- medical add "ОАК" --category blood --date 2026-04-03 --params "Гемоглобин:145:г/л:120:160,Лейкоциты:6.2:×10⁹/л:4:9"
```

## Priority levels
- **p1** = critical / today
- **p2** = important / this week (default)
- **p3** = backlog

## Project status
- **green** = on track
- **yellow** = needs attention
- **red** = blocked / urgent

## Important rules
1. Never edit lib modules to insert data — always use CLI or API.
2. Journal entries from agent use `--author assistant`.
3. Dev server must be running for CLI to work.
