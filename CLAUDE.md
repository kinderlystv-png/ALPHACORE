@AGENTS.md

# ALPHACORE — Quick Rules for Claude/Codex/ChatGPT

> Ответы по-русски, код на английском.

Основные правила находятся в `.github/copilot-instructions.md`.

Несмотря на имя файла, эти quick rules подходят не только для Claude. Их можно
применять и для Codex, ChatGPT/OpenAI и других агентов, которые работают с
этим репозиторием.

## Quick rules

1. Не делать rollback-команды без явного запроса.
2. Не перезапускать dev server без необходимости.
3. Для работы с данными использовать CLI: `npm run alpha -- <command>`.
4. Не редактировать seed-данные в исходниках — работать через CLI/API.
5. Journal entries от агента: `--author assistant`.
6. Tailwind CSS v4 syntax.
7. **После правок кода**: `npm run alpha -- deploy --message "описание"` —
   type-check + commit + push в production.
8. **Data-only changes** через CLI не требуют deploy — данные синкаются
   через PostgreSQL мгновенно (~5 сек).

## CLI reference

```bash
npm run alpha -- task add "Title" --priority p1 --due 2026-04-05
npm run alpha -- task list --status active
npm run alpha -- task done <id>
npm run alpha -- journal add "Text" --tags tag1,tag2
npm run alpha -- project status <id> yellow
npm run alpha -- project next-step <id> "Step text"
npm run alpha -- habit check sleep
npm run alpha -- snapshot
npm run alpha -- brief
npm run alpha -- review
npm run alpha -- deploy --message "description of changes"
```

## Useful commands

- `npm run dev` — dev server on port 3004
- `npm run build` — production build
- `npm run type-check` — TypeScript validation
