@AGENTS.md

# ALPHACORE — Quick Rules for Claude/Codex

> Ответы по-русски, код на английском.

Основные правила находятся в `.github/copilot-instructions.md`.

## Quick rules

1. Не делать rollback-команды без явного запроса.
2. Не перезапускать dev server без необходимости.
3. Для работы с данными использовать CLI: `npm run alpha -- <command>`.
4. Не редактировать seed-данные в исходниках — работать через CLI/API.
5. Journal entries от агента: `--author assistant`.
6. Tailwind CSS v4 syntax.

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
```

## Useful commands

- `npm run dev` — dev server on port 3004
- `npm run build` — production build
- `npm run type-check` — TypeScript validation
