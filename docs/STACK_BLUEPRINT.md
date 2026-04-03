# ALPHACORE — Stack Blueprint

## 1) Цель
Собрать практичный и поддерживаемый production-ready стек, который:
- быстро стартует в разработке,
- масштабируется по модулям,
- легко поддерживается командой.

## 2) Рекомендованный baseline (по умолчанию)

### Backend
- **Python 3.12 + FastAPI**
- Причины: быстрый time-to-market, сильная экосистема, простая типизация/валидация.

### Data layer
- **PostgreSQL** как основная БД
- **SQLAlchemy 2.x + Alembic** для ORM и миграций
- **Redis** для кэша/очередей/локов

### Async jobs
- **Celery + Redis** (или RQ на раннем этапе)

### API contracts
- REST (OpenAPI из FastAPI)
- Версионирование API: `/api/v1/...`

### Frontend (если нужен web)
- **Next.js (TypeScript)**
- UI: Tailwind + компонентный подход

## 3) Альтернативы (если приоритеты другие)
- **Node.js + NestJS + PostgreSQL** — если команда сильнее в TS full-stack.
- **Go + Fiber/Chi + PostgreSQL** — если приоритет: производительность и минимальный runtime overhead.

## 4) Критерии выбора стека
Оценивай каждый стек по 1–5:
1. Скорость разработки
2. Простота найма и onboarding
3. Наблюдаемость и эксплуатация
4. Производительность под ожидаемую нагрузку
5. Стоимость поддержки

## 5) Целевая структура репозитория

```text
ALPHACORE/
  src/
    app/
      api/
      domain/
      services/
      repositories/
      schemas/
      core/
    main.py
  tests/
    unit/
    integration/
    e2e/
  docs/
    STACK_BLUEPRINT.md
    ARCHITECTURE.md
    DELIVERY_PLAN.md
    RUNBOOK.md
```

## 6) Non-functional requirements (по умолчанию)
- P95 latency: целевое значение фиксируем после первой нагрузочной сессии
- Error rate: < 1% для критичных endpoint
- Uptime: целевой SLA фиксируем после запуска MVP
- Все изменения через CI + code review

## 7) Security baseline
- Secret management только через env/secret store
- Не хранить ключи в git
- Минимальные привилегии сервисных аккаунтов
- Dependency scanning в CI

## 8) Observability baseline
- Структурированные логи (JSON)
- Метрики (Prometheus/OpenTelemetry)
- Трассировка запросов (OTel)
- Алерты на 5xx, latency, saturation

## 9) Release strategy
- trunk-based development
- feature flags для рискованных фич
- миграции БД backward-compatible по возможности
- релиз через теги + changelog
