---
description: ALPHACORE — agent-first life operating system
applyTo: '**/*'
---

# ALPHACORE — AI Core Instructions

> Ответы по-русски, код на английском.

## Product philosophy

ALPHACORE — **не трекер и не задачник**. Это панель управления вниманием и
приоритетами, которую формируют агенты (Copilot, Codex, Claude, ChatGPT/OpenAI)
на основе
диалога с пользователем.

**Основной сценарий**: пользователь общается с агентом в среде разработки
(VS Code, Codex, ChatGPT с доступом к репозиторию, browser/OpenAI workflow).
Агент интерпретирует сказанное и обновляет данные ALPHACORE через CLI или API.
Пользователь видит результат на панели управления в браузере. Ручной ввод в UI
— fallback, а не основной путь.

**Важно**: инструкции и workflow в этом репозитории должны быть нейтральны к
конкретному агенту. Если агент умеет работать с файлами/терминалом или может
вызвать CLI/API, он должен использовать один и тот же operational path:
`npm run alpha -- ...` и `/api/storage` / `/api/agent-snapshot`.

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

# Deploy (push code changes to production)
npm run alpha -- deploy --message "описание изменений"
```

## Two sync paths — important!

ALPHACORE has two independent data paths. Agents must understand the difference:

| What changes | How it syncs | Agent action |
|--------------|-------------|--------------|
| **Data** (tasks, journal, notes, projects, habits, medical, schedule) | CLI → PostgreSQL → PWA polls every ~5s | Use `npm run alpha -- ...`. **No push needed.** |
| **Code** (UI, components, API routes, styles) | Push → GitHub Actions → Docker build → YC deploy ~3 min | Run `npm run alpha -- deploy --message "..."` after code changes. |

**Key rule**: after modifying source code files, the agent must run
`npm run alpha -- deploy --message "..."` to push changes to production.
For data-only operations through CLI — no deploy is needed, data reaches the
phone instantly via PostgreSQL cloud sync.

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
8. **After code changes** agent must run `npm run alpha -- deploy` to push to
   production so the user sees updates on the phone PWA.
9. **Data-only changes** (via CLI) don't need deploy — they sync to PostgreSQL
   instantly and the PWA picks them up within ~5 seconds.

## Smart scheduling rules for agents

The weekly calendar is the primary visual on the main screen. When an agent
creates or moves tasks and schedule events, it should follow these rules:

### Life area colours

Every item on the calendar is colour-coded by life area:

| Area | Color | Tones/projects mapped |
|------|-------|-----------------------|
| 💼 Работа | sky | kinderly, heys, work |
| 🫀 Здоровье | emerald | health (run, stretch) |
| 🏡 Семья | fuchsia | family |
| 🧹 Операционка | rose | cleanup |
| 🧠 Осмысление | amber | review |
| 🌙 Восстановление | violet | personal |

### Schedule template conventions

- **Пробежки (run)** — всегда утром **08:00–09:00**, каждый день кроме среды.
  Агент не должен двигать пробежку на вечер.
- **Уборка студии** — после каждого праздника:
  - Праздник вечером → уборка **на следующий день 11:00–15:00** (утром пробежка).
  - Если утром уже стоит следующий праздник → ранняя уборка **06:00–09:00**.
- **Среда** — лёгкий день, вечером барабаны/репетиция.
- **Воскресенье** — семья и восстановление, подготовка к неделе.

### Drag-and-drop

Users can drag tasks between days (changes `dueDate`) and custom events between
days (changes `date`). Template/studio/derived slots are read-only.
Agent can achieve the same via CLI:

```bash
# Move task to a specific day
npm run alpha -- task update <id> --due 2026-04-07

# Create a custom calendar event
npm run alpha -- schedule add "Встреча" --date 2026-04-07 --start 14:00 --end 15:30 --tone work
```

### Smart task placement

When creating tasks with dates, the agent should consider the schedule context:
- Don't pile tasks on days that already have parties + cleanup.
- Prefer distributing across the week evenly.
- P1 tasks go to the nearest available day; P3 can be placed further out.

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
- `src/lib/life-areas.ts` — life area → colour mapping for calendar & tasks
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
- `npm run alpha -- deploy --message "..."` — type-check + commit + push to production
- `npm run type-check` — TypeScript validation
- `npm run lint` — ESLint
