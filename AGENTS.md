<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ALPHACORE — Agent Notes

> Ответы по-русски, код на английском.

## Product intent

ALPHACORE — agent-first панель управления вниманием и приоритетами. Не трекер.
Основной сценарий: пользователь разговаривает с агентом, агент обновляет
ALPHACORE через CLI / API, пользователь видит результат на панели.

## Preferred workflow

1. Прочитай `.github/copilot-instructions.md` — там полная карта данных, API и
   CLI-команды.
2. Используй `npm run alpha -- <command>` для всех data-операций.
3. Не редактируй lib-модули для вставки пользовательских данных.
4. Для morning/evening workflows: `npm run alpha -- brief` / `review`.
5. Для текущего snapshot: `npm run alpha -- snapshot`.

## Key files

- `.github/copilot-instructions.md` — полные agent instructions
- `scripts/alpha.mjs` — CLI tool
- `src/lib/agent-control.ts` — computed attention/balance model
- `src/lib/agent-brief.ts` — brief/review generators
- `src/app/api/storage/route.ts` — cloud storage REST API
- `src/app/api/agent-snapshot/route.ts` — agent snapshot endpoint

## Style

- Prefer practical, focused changes over large refactors.
- Tailwind CSS v4 syntax (e.g. `bg-linear-to-br`, not `bg-gradient-to-br`).
- Don't add features or refactor beyond what's asked.
- `console.log` is forbidden; use `console.info/warn/error` if needed.
