from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from models.models import (
    GrammarUsageStat,
    IdiomUsageStat,
    LearningTurnEvent,
    User,
    VocabularyErrorTypeStat,
    VocabularyLevelStat,
    VocabularyProgress,
)
from shared.grammar_taxonomy import GRAMMAR_TOPICS


CEFR_LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
VOCABULARY_ERROR_TYPES = (
    "spelling",
    "word_form",
    "lexical_choice",
    "sense",
    "collocation",
)


def build_dashboard(db: Session, user: User) -> dict:
    turn_events = (
        db.query(LearningTurnEvent)
        .filter(LearningTurnEvent.user_id == user.id)
        .order_by(LearningTurnEvent.created_at.asc(), LearningTurnEvent.id.asc())
        .all()
    )
    correct_turns = sum(1 for event in turn_events if event.outcome == "correct")
    incorrect_turns = len(turn_events) - correct_turns

    today = datetime.now(timezone.utc).date()
    days = [today - timedelta(days=offset) for offset in range(6, -1, -1)]
    daily_counts = {day: {"correct": 0, "incorrect": 0} for day in days}
    location_counts: dict[str, int] = defaultdict(int)
    for event in turn_events:
        location_counts[event.location] += 1
        created_at = event.created_at
        if created_at is None:
            continue
        event_day = created_at.date()
        if event_day in daily_counts:
            daily_counts[event_day][event.outcome] += 1

    grammar_rows = (
        db.query(GrammarUsageStat)
        .filter(GrammarUsageStat.user_id == user.id)
        .order_by(GrammarUsageStat.topic_id.asc())
        .all()
    )
    grammar_by_topic: dict[int, dict] = {
        topic_id: {
            "topic_id": topic_id,
            "topic_name": topic_name,
            "correct_count": 0,
            "incorrect_count": 0,
        }
        for topic_id, topic_name in GRAMMAR_TOPICS.items()
    }
    for row in grammar_rows:
        topic = grammar_by_topic.get(row.topic_id)
        if topic is not None and row.outcome in {"correct", "incorrect"}:
            topic[f"{row.outcome}_count"] = row.count
    grammar_topics = []
    for topic in grammar_by_topic.values():
        total = topic["correct_count"] + topic["incorrect_count"]
        topic["mastery_percent"] = round(100 * topic["correct_count"] / total, 1) if total else 0.0
        grammar_topics.append(topic)

    vocabulary_levels = {level: 0 for level in CEFR_LEVELS}
    for row in db.query(VocabularyLevelStat).filter(VocabularyLevelStat.user_id == user.id).all():
        if row.cefr_level in vocabulary_levels:
            vocabulary_levels[row.cefr_level] += row.count

    vocabulary_errors = {error_type: 0 for error_type in VOCABULARY_ERROR_TYPES}
    for row in (
        db.query(VocabularyErrorTypeStat)
        .filter(VocabularyErrorTypeStat.user_id == user.id)
        .all()
    ):
        if row.error_type in vocabulary_errors:
            vocabulary_errors[row.error_type] += row.count

    idiom_by_name: dict[str, dict] = {}
    idiom_rows = (
        db.query(IdiomUsageStat)
        .filter(IdiomUsageStat.user_id == user.id)
        .order_by(IdiomUsageStat.last_used_at.desc())
        .all()
    )
    for row in idiom_rows:
        idiom = idiom_by_name.setdefault(
            row.normalized_idiom,
            {
                "normalized_idiom": row.normalized_idiom,
                "display_idiom": row.display_idiom,
                "correct_count": 0,
                "incorrect_count": 0,
                "last_used_at": row.last_used_at,
            },
        )
        idiom[f"{row.outcome}_count"] = row.count
        if row.last_used_at and (
            idiom["last_used_at"] is None or row.last_used_at > idiom["last_used_at"]
        ):
            idiom["last_used_at"] = row.last_used_at

    total_turns = len(turn_events)
    return {
        "profile": {
            "user_id": user.id,
            "username": user.username,
            "xp": user.xp,
            "coins": user.coins,
            "level": 1 + user.xp // 100,
        },
        "summary": {
            "total_turns": total_turns,
            "correct_turns": correct_turns,
            "incorrect_turns": incorrect_turns,
            "success_percent": round(100 * correct_turns / total_turns, 1) if total_turns else 0.0,
            "words_learned": db.query(VocabularyProgress)
            .filter(VocabularyProgress.user_id == user.id)
            .count(),
            "idioms_discovered": len(idiom_by_name),
        },
        "weekly_activity": [
            {
                "date": day.isoformat(),
                "correct": daily_counts[day]["correct"],
                "incorrect": daily_counts[day]["incorrect"],
            }
            for day in days
        ],
        "locations": [
            {"name": name, "turn_count": count}
            for name, count in sorted(location_counts.items())
        ],
        "grammar_topics": grammar_topics,
        "vocabulary_levels": [
            {"name": level, "count": vocabulary_levels[level]} for level in CEFR_LEVELS
        ],
        "vocabulary_errors": [
            {"name": error_type, "count": vocabulary_errors[error_type]}
            for error_type in VOCABULARY_ERROR_TYPES
        ],
        "idioms": list(idiom_by_name.values()),
    }
