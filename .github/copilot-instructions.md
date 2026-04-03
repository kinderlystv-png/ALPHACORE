---
description: ALPHACORE — agent-first life operating system
applyTo: '**/*'
---

# ALPHACORE — AI Core Instructions

> Ответы по-русски, код на английском.

## Product philosophy

ALPHACORE — **не трекер и не задачник**. Это панель управления вниманием и
приоритетами, которую формируют агенты (Copilot, Codex, Claude) на основе
диалога с пользователем.

**Основной сценарий**: пользователь общается с агентом в среде разработки
(VS Code, Codex). Агент интерпретирует сказанное и обновляет данные ALPHACORE
через CLI или API. Пользователь видит результат на панели управления в
браузере. Ручной ввод в UI — fallback, а не основной путь.

**Аналогия**: колесо жизни + radar слепых зон. Система должна помогать видеть
жизнь наглядно и распределять внимание равномерно.

## Agent CLI — `npm run alpha`

Основной инструмент агента для работы с данными. Требует запущенный
dev server (`npm run dev`, порт 3004).

```bash
# Tasks
npm run alpha -- task add "Название" --priority p1 --due 2026-04-05 --project kinderly
npm run alpha -- task list --status active --limit 5
npm run alpha -- task done <id>

# Journal
npm run alpha -- journal add "Пробежал 5 км, чувствую прилив энергии" --tags run,health
npm run alpha -- journal list --limit 3

# Notes
npm run alpha -- note add "Заголовок" --body "Текст заметки" --tags tag1,tag2

# Projects
npm run alpha -- project list
npm run alpha -- project status <id> yellow
npm run alpha -- project next-step <id> "Собрать структуру лендинга"

# Habits
npm run alpha -- habit check sleep
npm run alpha -- habit status

# Medical
npm run alpha -- medical add "ОАК" --category blood --date 2026-04-03 --params "Гемоглобин:145:г/л:120:160,Лейкоциты:6.2:×10⁹/л:4:9"

# Schedule (custom events)
npm run alpha -- schedule add "Встреча с дизайнером" --date 2026-04-05 --start 14:00 --end 15:30 --tone work --tags meeting
npm run alpha -- schedule list --date 2026-04-05
npm run alpha -- schedule remove <id>

# Snapshots & briefs
npm run alpha -- snapshot
npm run alpha -- brief
npm run alpha -- review
```

## Data domains

| Domain | Storage key | CRUD module | Types |
|--------|------------|-------------|-------|
| Tasks | `alphacore_tasks` | `src/lib/tasks.ts` | `Task` (id, title, project?, projectId?, priority, status, dueDate?, completedAt?, focusHistory?) |
| Journal | `alphacore_journal` | `src/lib/journal.ts` | `JournalEntry` (id, author: "user"\|"assistant", text, tags[], createdAt) |
| Notes | `alphacore_notes` | `src/lib/notes.ts` | `Note` (id, title, body, tags[], pinned, createdAt, updatedAt) |
| Projects | `alphacore_projects` | `src/lib/projects.ts` | `Project` (id, name, description, status, accent, kpis[], deliverables[], nextStep) |
| Habits | `alphacore_habits` | `src/lib/habits.ts` | `Habit` (id, name, emoji, frequency, days?, category) — checks stored as `{habitId}:{date}` map |
| Medical | `alphacore_medical` | `src/lib/medical.ts` | `MedEntry` (id, date, category, name, params[], notes) |
| Schedule | `alphacore_schedule_custom` | `src/lib/schedule.ts` | `CustomEvent` (id, date, start, end, title, tone, tags[]) — agent-managed calendar events |
| Pomodoro | `alphacore_pomodoro` | `src/components/pomodoro.tsx` | Selected task preference |

## Agent control snapshot

`src/lib/agent-control.ts` → `getAgentControlSnapshot()` — read-only synthesized
view of life balance:

- 6 attention areas: work, health, family, operations, reflection, recovery
- Each area: score 0–100, level (good/watch/critical), summary, insight, evidence
- Top 3 agent priorities with recommended actions
- Balance score, narrative, mode statement

Server-side endpoint: `GET /api/agent-snapshot` — same data from Postgres.

## API routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/storage` | GET | Full cloud snapshot (all storage keys) |
| `/api/storage` | PUT | Upsert single key: `{ key, value }` |
| `/api/storage` | POST | Bulk upsert: `{ items: {...}, mode: "merge"\|"replace" }` |
| `/api/storage` | DELETE | Delete key: `{ key }` |
| `/api/agent-snapshot` | GET | Agent control snapshot from Postgres |
| `/api/health` | GET | Health check |

## Canonical patterns for agents

### Adding data
Always use CLI (`npm run alpha -- ...`) or HTTP API. Never edit lib modules
to insert data — lib modules use browser localStorage.

### Reading current state
```bash
npm run alpha -- snapshot     # Balance score + areas + priorities
npm run alpha -- task list    # Current tasks
npm run alpha -- journal list # Recent journal entries
```

### Morning workflow
```bash
npm run alpha -- brief        # Get morning brief with today's focus areas
```

### Evening workflow
```bash
npm run alpha -- review       # Get evening review of the day
```

### Updating project status after discussion
```bash
npm run alpha -- project status kinderly yellow
npm run alpha -- project next-step kinderly "Финализировать pricing-лендинг"
npm run alpha -- journal add "Обсудили Kinderly: определили структуру лендинга, решили начать с pricing" --tags kinderly,planning
```

## Rules

1. **Never edit seed data in source code** to add user content — use CLI/API.
2. **Journal entries from agent** should use `--author assistant`.
3. **Priority levels**: p1 = critical/today, p2 = important/this week, p3 = backlog.
4. **Project status**: green = on track, yellow = needs attention, red = blocked/urgent.
5. **Habit IDs**: sleep, run, stretch, projects_upd, review, drums.
6. **Don't restart dev server** unless explicitly asked.
7. **Don't run build** unless before commit or explicitly asked.

## Stack

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4
- PostgreSQL (Yandex Cloud) for cloud sync
- localStorage for client cache, synced via `/api/storage`
- Deploy: Yandex Serverless Containers (Docker)

## Key files

- `src/lib/agent-control.ts` — attention/balance model
- `src/lib/agent-brief.ts` — morning brief & evening review generators
- `src/lib/tasks.ts`, `src/lib/journal.ts`, `src/lib/projects.ts`,
  `src/lib/notes.ts`, `src/lib/medical.ts`, `src/lib/habits.ts` — data domains
- `src/lib/storage.ts` — localStorage + cloud sync engine
- `src/lib/cloud-store-server.ts` — Postgres server-side store
- `src/lib/schedule.ts` — weekly schedule (template + studio + derived)
- `src/lib/productivity.ts` — aggregated stats / focus reports
- `src/app/api/storage/route.ts` — cloud storage REST endpoint
- `src/app/api/agent-snapshot/route.ts` — agent control snapshot endpoint
- `scripts/alpha.mjs` — agent CLI tool
- `src/components/alphacore-dashboard.tsx` — main dashboard
- `src/components/agent-control-panel.tsx` — agent cockpit UI

## Commands

- `npm run dev` — dev server on port 3004
- `npm run build` — production build
- `npm run alpha -- <command>` — agent CLI
- `npm run type-check` — TypeScript validation
- `npm run lint` — ESLint
