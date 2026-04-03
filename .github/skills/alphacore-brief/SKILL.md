---
description: >-
  ALPHACORE attention snapshot, morning brief, and evening review. USE FOR: when
  the user asks for a life balance overview, current priorities, morning planning,
  or evening reflection/review. DO NOT USE FOR: data mutations (use alphacore-data
  skill instead), UI changes, coding questions.
---

# ALPHACORE Brief & Review

## When to use

Use this skill when the user asks to:
- See current life balance / attention distribution
- Get a morning brief or daily plan
- Do an evening review
- Understand which life areas need attention
- Get agent-recommended priorities

## Commands

```bash
# Full attention snapshot — balance score, 6 areas, top 3 priorities
npm run alpha -- snapshot

# Morning brief — focused summary with today's action items
npm run alpha -- brief

# Evening review — day's results, area states, carry-over priorities
npm run alpha -- review
```

## What the snapshot contains

The snapshot computes a **balance score (0–100)** across 6 attention areas:

| Area | Key | What it tracks |
|------|-----|----------------|
| Работа | work | Active tasks, focus time, project health |
| Здоровье | health | Habits, medical flags, health schedule |
| Семья | family | Family vs studio events ratio |
| Операционка | operations | Inbox count, overdue tasks, cleanup slots |
| Осмысление | reflection | Journal entries, review schedule |
| Восстановление | recovery | Personal time, sleep habit |

Each area has:
- **Score** (0–100)
- **Level**: good / watch / critical
- **Summary**: one-line stats
- **Insight**: actionable recommendation
- **Evidence**: supporting data points

Plus **top 3 priorities** ranked by urgency with concrete actions.

## API endpoint

For programmatic access (no CLI needed):

```
GET http://localhost:3004/api/agent-snapshot
GET http://localhost:3004/api/agent-snapshot?mode=brief
GET http://localhost:3004/api/agent-snapshot?mode=review
```

## Typical workflows

### Morning start
```bash
npm run alpha -- brief
# Read the brief, then:
npm run alpha -- journal add "Утренний план: [what you decided]" --tags planning,morning
```

### Evening wrap-up
```bash
npm run alpha -- review
# Reflect, then:
npm run alpha -- journal add "Итоги дня: [observations]" --tags review,evening
npm run alpha -- habit check review  # if it's Friday
```

### Quick check during the day
```bash
npm run alpha -- snapshot
```
