# ALPHACORE — Architecture Guide

## 1) Архитектурные принципы
1. Явные границы слоёв: API -> Service -> Repository
2. Минимум бизнес-логики в transport-слое
3. Тонкие контроллеры, толстые сервисы
4. Контракты через схемы/DTO
5. Тестируемость как обязательное требование

## 2) Слои
- **API layer**: маршруты, валидация входа/выхода, коды ошибок
- **Service layer**: use-cases, правила домена, транзакции
- **Repository layer**: SQL/ORM доступ
- **Core layer**: конфиг, логирование, интеграции

## 3) Ошибки и контракты
- Единый формат ошибки (code/message/details)
- Маппинг доменных ошибок в HTTP-коды
- Correlation ID в каждом запросе/ответе (через middleware)

## 4) Тестовая стратегия
- Unit: чистая бизнес-логика
- Integration: БД, внешние зависимости через тестовые инстансы
- E2E: критические пользовательские сценарии

## 5) Версионирование API
- v1 в URL
- breaking changes только в новой версии
- deprecation policy документируется отдельно

## 6) Frontend — Dashboard

### Структура
- `src/components/alphacore-dashboard.tsx` — главный экран, компонует все секции
- `src/components/habit-tracker.tsx` — трекер привычек с чекбоксами, прогресс-кольцом и недельным графиком
- `src/components/pwa-install-card.tsx` — PWA-установка и SW-регистрация
- `src/lib/habits.ts` — модель данных привычек и localStorage-персистенция

### Секции дашборда (с цветовой дифференциацией)
1. **Трекер привычек** (emerald) — чекбоксы дневных привычек, SVG progress ring, bar chart за неделю, streak
2. **Фокус** (amber) — приоритеты на сегодня / неделю, переключатель вкладок
3. **Проекты** (sky / orange / violet) — 3 цветных карточки проектов со статусом и следующим шагом
4. **Календарь** (violet) — ближайшие семейные даты с обратным отсчётом
5. **PWA-установка** — внизу, минимальный footprint

### Трекер привычек
- Конфиг привычек: `src/lib/habits.ts` → `DEFAULT_HABITS`
- Каждая привычка имеет `frequency` (daily / custom) и список активных дней
- Данные хранятся в `localStorage` под ключом `alphacore_habits`
- Формат записи: `{habitId}:{YYYY-MM-DD}` → `boolean`
- Стрик считается с вчерашнего дня назад (чтобы незавершённый сегодня не ломал серию)
- Категории: `health`, `work`, `personal` — визуально маркированы цветными бейджами

### Layout
- Desktop: sidebar (240px) + main content grid via AppShell
- Mobile: вертикальный поток карточек + fixed bottom nav (6 routes)
- Responsive breakpoint: `lg` (1024px)

### Навигация (AppShell)
- `src/components/app-shell.tsx` — единый layout: desktop sidebar + mobile bottom nav
- Routes: `/` (Дом), `/tasks` (Задачи), `/calendar` (Неделя), `/projects` (Проекты), `/notes` (Заметки), `/routines` (Ритм)
- Active route подсвечивается через `usePathname()`

## 7) Функциональные экраны

### Задачи — `/tasks`
- `src/app/tasks/page.tsx` — Inbox/Tasks с kanban-фильтрами (все/входящие/в работе/готово)
- `src/lib/tasks.ts` — CRUD: addTask, getTasks, activateTask, toggleDone, deleteTask
- localStorage key: `alphacore_tasks`
- Приоритеты P1/P2/P3, статусы TaskStatus, проект (опционально)

### Календарь — `/calendar`
- `src/app/calendar/page.tsx` — недельное планирование с расписанием из WEEKLY_SCHEDULE.md
- Заблокированный слот: среда вечер (барабаны 🥁)
- Семейные события с обратным отсчётом

### Проекты — `/projects`
- `src/app/projects/page.tsx` — рестер проектов (Kinderly/HEYS/ДР Minecraft)
- Раскрываемые карточки, deliverables, KPI-метрики, статус-бейджи

### Заметки — `/notes`
- `src/app/notes/page.tsx` — полноценный блокнот с CRUD, тегами, закреплением, поиском
- `src/lib/notes.ts` — CRUD: addNote, getNotes, updateNote, deleteNote, togglePin
- localStorage key: `alphacore_notes`

### Ритм и напоминания — `/routines`
- `src/app/routines/page.tsx` — интегрирует HabitTracker + недельный ритм + семейные напоминания
- Правила из WEEKLY_SCHEDULE.md, обратный отсчёт до семейных дат
