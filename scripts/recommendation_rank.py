#!/usr/bin/env python3
"""Recommendation ranker v2: time decay + dislike penalties + implemented boosts."""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

BASE_WEIGHTS = {
    "implemented": 5.0,
    "copied_prompt": 2.0,
    "disliked": -4.0,
    "archived": -3.0,
}

DISLIKE_THRESHOLD = 2
DISLIKE_PENALTY = -2.5
IMPLEMENTED_TAG_BOOST = 1.5


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def parse_day(raw: str) -> date:
    return datetime.strptime(raw, "%Y-%m-%d").date()


def decay_factor(created_at: str, today: date, half_life_days: int) -> float:
    age_days = max((today - parse_day(created_at)).days, 0)
    return math.exp(-math.log(2) * age_days / half_life_days)


def event_weight(event: dict[str, Any], today: date, half_life_days: int) -> float:
    base = BASE_WEIGHTS.get(event.get("action", ""), 0.0)
    created_at = event.get("created_at")
    if not created_at:
        return base
    return base * decay_factor(created_at, today, half_life_days)


def build_tag_scores(events: list[dict[str, Any]], today: date, half_life_days: int) -> Counter:
    scores: Counter = Counter()
    for event in events:
        weighted = event_weight(event, today, half_life_days)
        for tag in event.get("tags", []):
            scores[tag] += weighted
    return scores


def dislike_penalty_for_card(tags: list[str], tag_action_counts: dict[str, Counter]) -> float:
    penalty = 0.0
    for tag in tags:
        dislikes = tag_action_counts.get(tag, Counter()).get("disliked", 0)
        if dislikes >= DISLIKE_THRESHOLD:
            penalty += DISLIKE_PENALTY
    return penalty


def implemented_similarity_boost(tags: list[str], implemented_cards_tags: list[set[str]]) -> float:
    boost = 0.0
    tags_set = set(tags)
    for impl_tags in implemented_cards_tags:
        overlap = len(tags_set.intersection(impl_tags))
        if overlap >= 2:
            boost += IMPLEMENTED_TAG_BOOST * overlap
    return boost


def build_tag_action_counts(events: list[dict[str, Any]]) -> dict[str, Counter]:
    output: dict[str, Counter] = defaultdict(Counter)
    for event in events:
        action = event.get("action", "unknown")
        for tag in event.get("tags", []):
            output[tag][action] += 1
    return output


def build_implemented_tags_map(cards: list[dict[str, Any]], events: list[dict[str, Any]]) -> list[set[str]]:
    card_tags = {card.get("id"): set(card.get("tags", [])) for card in cards}
    implemented_ids = {
        event.get("recommendation_id")
        for event in events
        if event.get("action") == "implemented"
    }
    return [card_tags[cid] for cid in implemented_ids if cid in card_tags]


def build_card_scores(
    cards: list[dict[str, Any]],
    events: list[dict[str, Any]],
    today: date,
    half_life_days: int,
) -> list[dict[str, Any]]:
    tag_scores = build_tag_scores(events, today, half_life_days)
    tag_action_counts = build_tag_action_counts(events)
    implemented_tags = build_implemented_tags_map(cards, events)

    card_event_score: Counter = Counter()
    for event in events:
        recommendation_id = event.get("recommendation_id")
        card_event_score[recommendation_id] += event_weight(event, today, half_life_days)

    ranked_cards: list[dict[str, Any]] = []
    for card in cards:
        cid = card.get("id")
        tags = card.get("tags", [])

        event_score = card_event_score.get(cid, 0.0)
        tag_score = sum(tag_scores.get(tag, 0.0) for tag in tags)
        penalty = dislike_penalty_for_card(tags, tag_action_counts)
        boost = implemented_similarity_boost(tags, implemented_tags)
        total = event_score + tag_score + penalty + boost

        ranked = dict(card)
        ranked["score"] = round(total, 3)
        ranked["reasons"] = {
            "event_score": round(event_score, 3),
            "tag_score": round(tag_score, 3),
            "dislike_penalty": round(penalty, 3),
            "implemented_similarity_boost": round(boost, 3),
            "tags_snapshot": {tag: round(tag_scores.get(tag, 0.0), 3) for tag in tags},
        }
        ranked_cards.append(ranked)

    ranked_cards.sort(key=lambda item: item.get("score", 0.0), reverse=True)
    return ranked_cards


def summarize(events: list[dict[str, Any]]) -> dict[str, Any]:
    action_counts = Counter(event.get("action", "unknown") for event in events)
    tag_action_map = build_tag_action_counts(events)
    return {
        "events_total": len(events),
        "actions": dict(action_counts),
        "tag_actions": {tag: dict(counter) for tag, counter in tag_action_map.items()},
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rank recommendation cards by feedback events")
    parser.add_argument("--cards", default="docs/RECOMMENDATION_CARDS_SEED.json", help="cards json path")
    parser.add_argument("--events", default="docs/RECOMMENDATION_EVENTS.json", help="events json path")
    parser.add_argument("--output", default="docs/RECOMMENDATION_RANKED.json", help="output json path")
    parser.add_argument("--today", default=date.today().isoformat(), help="today date in YYYY-MM-DD")
    parser.add_argument("--half-life-days", type=int, default=14, help="half life for event decay")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cards = load_json(Path(args.cards))
    events = load_json(Path(args.events))
    today = parse_day(args.today)

    ranked_cards = build_card_scores(cards, events, today=today, half_life_days=args.half_life_days)
    payload = {
        "model": {
            "name": "recommendation_ranker_v2",
            "today": today.isoformat(),
            "half_life_days": args.half_life_days,
            "dislike_threshold": DISLIKE_THRESHOLD,
            "dislike_penalty": DISLIKE_PENALTY,
            "implemented_tag_boost": IMPLEMENTED_TAG_BOOST,
        },
        "summary": summarize(events),
        "ranked_cards": ranked_cards,
    }

    with Path(args.output).open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")

    print(f"Ranked {len(ranked_cards)} cards using {len(events)} events -> {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
