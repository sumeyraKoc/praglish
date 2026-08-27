from collections import Counter

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from models.models import (
    GrammarUsageStat,
    IdiomUsageStat,
    LearningExtractionEvent,
    VocabularyLevelStat,
)
from shared.schemas import ExtractionResult


class LearningAnalyticsService:
    @staticmethod
    def record_extraction(
        db: Session,
        *,
        user_id: int,
        session_id: int,
        dialogue_id: int,
        utterance: str,
        result: ExtractionResult,
    ) -> bool:
        """Persist one event and atomically increment its aggregate counters.

        dialogue_id is the idempotency key. Retrying the same turn therefore does
        not double-count any grammar, vocabulary, or idiom statistic.
        """

        event_statement = (
            insert(LearningExtractionEvent)
            .values(
                dialogue_id=dialogue_id,
                session_id=session_id,
                user_id=user_id,
                outcome=result.outcome,
                utterance=utterance,
                raw_result=result.model_dump(),
            )
            .on_conflict_do_nothing(index_elements=["dialogue_id"])
            .returning(LearningExtractionEvent.id)
        )
        event_id = db.execute(event_statement).scalar_one_or_none()
        if event_id is None:
            return False

        for finding in result.grammar:
            statement = insert(GrammarUsageStat).values(
                user_id=user_id,
                outcome=result.outcome,
                topic_id=finding.topic_id,
                topic_name=finding.topic_name,
                count=finding.count,
            )
            db.execute(
                statement.on_conflict_do_update(
                    index_elements=["user_id", "outcome", "topic_id"],
                    set_={
                        "topic_name": finding.topic_name,
                        "count": GrammarUsageStat.count + finding.count,
                    },
                )
            )

        vocabulary_counts = Counter()
        for finding in result.vocabulary:
            vocabulary_counts[finding.cefr_level] += finding.count
        for cefr_level, count in vocabulary_counts.items():
            statement = insert(VocabularyLevelStat).values(
                user_id=user_id,
                outcome=result.outcome,
                cefr_level=cefr_level,
                count=count,
            )
            db.execute(
                statement.on_conflict_do_update(
                    index_elements=["user_id", "outcome", "cefr_level"],
                    set_={"count": VocabularyLevelStat.count + count},
                )
            )

        for finding in result.idioms:
            statement = insert(IdiomUsageStat).values(
                user_id=user_id,
                outcome=result.outcome,
                normalized_idiom=finding.normalized_idiom,
                display_idiom=finding.idiom,
                count=finding.count,
            )
            db.execute(
                statement.on_conflict_do_update(
                    index_elements=["user_id", "outcome", "normalized_idiom"],
                    set_={
                        "display_idiom": finding.idiom,
                        "count": IdiomUsageStat.count + finding.count,
                        "last_used_at": func.now(),
                    },
                )
            )

        return True
