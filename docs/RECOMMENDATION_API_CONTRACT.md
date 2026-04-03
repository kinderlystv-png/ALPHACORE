# Recommendation API Contract (MVP)

## 🟩 USER NOTES
- Нужен понятный контракт, чтобы быстро реализовать кнопки в интерфейсе и связать их с логикой рекомендаций.

## 🟦 ASSISTANT NOTES

## Цель
Определить минимальный API-контур для:
1. выдачи рекомендаций,
2. фиксации действий (`copy`, `dislike`, `implemented`),
3. просмотра архива.

## Endpoint 1: Получить ленту рекомендаций
`GET /api/v1/recommendations?scope=work&limit=20`

### Response 200
```json
{
  "items": [
    {
      "id": "REC-KINDERLY-NEXT-STEP-001",
      "title": "Защитить следующий шаг по Kinderly",
      "context": "Нужен ясный next step...",
      "prompt_for_agent": "Разверни следующий рычаг...",
      "tags": ["kinderly", "operations"],
      "impact": "high",
      "effort": "M",
      "status": "new",
      "score": 12.34
    }
  ],
  "meta": {
    "generated_at": "2026-04-03T10:00:00Z",
    "model": "recommendation_ranker_v2"
  }
}
```

## Endpoint 2: Событие по карточке
`POST /api/v1/recommendations/{id}/events`

### Request
```json
{
  "action": "copied_prompt",
  "source": "mobile_home",
  "reason": "подходит по текущему фокусу"
}
```

`action` enum:
- `copied_prompt`
- `implemented`
- `disliked`
- `archived`

### Response 201
```json
{
  "ok": true,
  "recommendation_id": "REC-KINDERLY-NEXT-STEP-001",
  "action": "copied_prompt",
  "saved_at": "2026-04-03T10:01:00Z"
}
```

## Endpoint 3: Архив рекомендаций
`GET /api/v1/recommendations/archive?action=disliked&tag=kinderly`

### Response 200
```json
{
  "items": [
    {
      "id": "REC-REVIEW-SHORT-001",
      "action": "disliked",
      "archived_at": "2026-04-03T11:10:00Z",
      "tags": ["review", "planning"]
    }
  ]
}
```

## Endpoint 4: Повторный показ из архива (опционально)
`POST /api/v1/recommendations/{id}/restore`

### Response 200
```json
{
  "ok": true,
  "id": "REC-REVIEW-SHORT-001",
  "status": "new"
}
```

## Технические правила
- Все даты храним в UTC ISO-8601.
- `id` рекомендации — стабильный string.
- События неизменяемые (append-only), статусы считаем проекцией.
- Валидация action обязательна на сервере.

## Минимальные ошибки
- `400` — неверный action/параметры.
- `404` — карточка не найдена.
- `409` — конфликт состояния (например, повторный restore при статусе `new`).

## Связь с текущими файлами MVP
- source cards: `docs/RECOMMENDATION_CARDS_SEED.json`
- source events: `docs/RECOMMENDATION_EVENTS.json`
- ranked output: `docs/RECOMMENDATION_RANKED.json`
