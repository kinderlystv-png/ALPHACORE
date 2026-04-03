# ALPHACORE

Персональный помощник-секретарь. PWA на Next.js, PostgreSQL на Yandex Cloud.

## Стек
- **Frontend**: Next.js 16 (App Router) + Tailwind CSS
- **PWA**: manifest.json + Service Worker (offline shell)
- **DB**: Yandex Cloud Managed PostgreSQL (общий кластер с HEYS/Kinderly)
- **Deploy**: Yandex Serverless Container (Docker)
- **CI**: GitHub Actions (lint + type-check + build)
- **AI**: работает через Codex / VS Code агентов, не встроен в приложение

## Product principle
- **Главный интерфейс — разговор с агентами**, а не ручное заполнение десятков форм.
- `ALPHACORE` должен собирать из этих разговоров **панель управления вниманием, приоритетами и балансом жизни**.
- Дашборд — это не очередной мёртвый трекер, а **наглядный радар**, который помогает понять, что сейчас важно, что выпадает из фокуса и где жизнь стала неравномерной.

## Быстрый старт
```bash
npm ci
cp .env.example .env   # заполнить DB_USER, DB_PASSWORD
npm run dev             # http://localhost:3004
```

## Команды
- `npm run dev` — dev server (port 3004)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run type-check` — TypeScript check

## Deploy
Push в main -> GitHub Actions -> Docker build -> YCPush в main -> GitHub Actions -> Docker build -> YCPush мPush в main -> GitHubocs/ — архитектура, workflow, delivery plan, runbook и пр.
