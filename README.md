# ALPHACORE

Документальная подготовка + **Implementation Kickoff** для backend.

## Что уже реализовано
- FastAPI приложение с endpoint `GET /health`
- Базовый тест на health-check
- Локальные команды: lint/test/run
- CI: Ruff + Pytest + repo checks

## Быстрый старт
```bash
python -m pip install --upgrade pip
pip install -r requirements-dev.txt

make lint
make test
make run
make recommend-rank
```

## Документация
- [`docs/STACK_BLUEPRINT.md`](docs/STACK_BLUEPRINT.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/DELIVERY_PLAN.md`](docs/DELIVERY_PLAN.md)
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
- [`docs/WORKFLOW.md`](docs/WORKFLOW.md)
- [`docs/PROJECTS_REGISTER.md`](docs/PROJECTS_REGISTER.md)
- [`docs/SECRETARY_HANDBOOK.md`](docs/SECRETARY_HANDBOOK.md)
- [`docs/PROJECT_UPDATE_TEMPLATE.md`](docs/PROJECT_UPDATE_TEMPLATE.md)
- [`docs/AGENT_MODES.md`](docs/AGENT_MODES.md)
- [`docs/NOTES_CONVENTION.md`](docs/NOTES_CONVENTION.md)
- [`docs/KPI_DASHBOARD.md`](docs/KPI_DASHBOARD.md)
- [`docs/WEEKLY_REVIEW_TEMPLATE.md`](docs/WEEKLY_REVIEW_TEMPLATE.md)
- [`docs/WEEKLY_REVIEW_2026-04-02.md`](docs/WEEKLY_REVIEW_2026-04-02.md)
- [`docs/LOG.md`](docs/LOG.md)
- [`docs/PERSONAL_NOTES.md`](docs/PERSONAL_NOTES.md)
- [`docs/BDAY_MINECRAFT_CHECKLIST.md`](docs/BDAY_MINECRAFT_CHECKLIST.md)
- [`docs/MINECRAFT_QUEST_SCENARIO.md`](docs/MINECRAFT_QUEST_SCENARIO.md)
- [`docs/BDAY_TIMING_DRAFT.md`](docs/BDAY_TIMING_DRAFT.md)
- [`docs/WEEKLY_SCHEDULE.md`](docs/WEEKLY_SCHEDULE.md)

## Новые документы по рекомендациям
- `docs/AGENT_RECOMMENDATION_TOOLS.md` — инструменты рекомендаций (Copy Prompt / Dislike / Archive)
- `docs/RECOMMENDATION_PROMPTS_LIBRARY.md` — готовые промпты для кнопки «Скопировать промпт»
- `docs/RECOMMENDATION_FEEDBACK_LOG.md` — лог обратной связи по рекомендациям
- `docs/RECOMMENDATION_UI_SPEC.md` — мобильная UI-спека карточек рекомендаций
- `docs/RECOMMENDATION_CARDS_SEED.json` — стартовый набор recommendation cards
- `docs/RECOMMENDATION_EVENTS.json` — seed событий copy/dislike/implemented
- `docs/RECOMMENDATION_API_CONTRACT.md` — API-контракт для интеграции copy/dislike/archive
