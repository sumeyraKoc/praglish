import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))
os.environ.setdefault("DATABASE_URL", "sqlite://")

from core.database import Base  # noqa: E402
from models.models import (  # noqa: E402
    GameSession,
    GrammarUsageStat,
    IdiomUsageStat,
    LearningTurnEvent,
    User,
    VocabularyErrorTypeStat,
    VocabularyLevelStat,
    VocabularyProgress,
)
from services.dashboard_analytics import build_dashboard  # noqa: E402


class DashboardAnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_builds_profile_trends_and_language_statistics(self):
        user = User(username="player", password_hash="unused", xp=250, coins=17)
        self.db.add(user)
        self.db.flush()
        session = GameSession(user_id=user.id, location="bakery", npc_role="baker")
        self.db.add(session)
        self.db.flush()
        now = datetime.now(timezone.utc)
        self.db.add_all(
            [
                LearningTurnEvent(user_id=user.id, session_id=session.id, location="bakery", outcome="correct", created_at=now),
                LearningTurnEvent(user_id=user.id, session_id=session.id, location="bakery", outcome="correct", created_at=now),
                LearningTurnEvent(user_id=user.id, session_id=session.id, location="bakery", outcome="incorrect", created_at=now),
                GrammarUsageStat(user_id=user.id, outcome="correct", topic_id=4, topic_name="Present Tenses", count=3),
                GrammarUsageStat(user_id=user.id, outcome="incorrect", topic_id=4, topic_name="Present Tenses", count=1),
                VocabularyLevelStat(user_id=user.id, outcome="correct", cefr_level="B2", count=2),
                VocabularyErrorTypeStat(user_id=user.id, error_type="spelling", count=1),
                VocabularyProgress(user_id=user.id, location="bakery", concept="bread", word="loaf"),
                IdiomUsageStat(user_id=user.id, outcome="correct", normalized_idiom="piece of cake", display_idiom="a piece of cake", count=2, last_used_at=now),
                IdiomUsageStat(user_id=user.id, outcome="incorrect", normalized_idiom="piece of cake", display_idiom="piece of cake", count=1, last_used_at=now),
            ]
        )
        self.db.commit()

        result = build_dashboard(self.db, user)

        self.assertEqual(result["profile"]["level"], 3)
        self.assertEqual(result["summary"]["total_turns"], 3)
        self.assertEqual(result["summary"]["success_percent"], 66.7)
        self.assertEqual(result["summary"]["words_learned"], 1)
        self.assertEqual(result["weekly_activity"][-1]["correct"], 2)
        self.assertEqual(len(result["grammar_topics"]), 50)
        self.assertEqual(result["grammar_topics"][3]["mastery_percent"], 75.0)
        self.assertEqual(result["grammar_topics"][0]["topic_name"], "Parts of Speech")
        self.assertEqual(result["grammar_topics"][0]["correct_count"], 0)
        self.assertEqual(
            next(item for item in result["vocabulary_levels"] if item["name"] == "B2")["count"],
            2,
        )
        self.assertEqual(
            next(item for item in result["vocabulary_errors"] if item["name"] == "spelling")["count"],
            1,
        )
        self.assertEqual(result["idioms"][0]["correct_count"], 2)
        self.assertEqual(result["idioms"][0]["incorrect_count"], 1)


if __name__ == "__main__":
    unittest.main()
