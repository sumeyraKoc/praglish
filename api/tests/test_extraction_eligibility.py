import os
import sys
import unittest
from pathlib import Path


API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))
os.environ.setdefault("DATABASE_URL", "sqlite://")

from services.extraction_eligibility import should_extract_after_turn  # noqa: E402


class ExtractionEligibilityTests(unittest.TestCase):
    def test_first_user_turn_is_extracted(self):
        self.assertTrue(should_extract_after_turn(None))

    def test_user_turn_after_npc_is_extracted(self):
        self.assertTrue(should_extract_after_turn("correct"))

    def test_user_turn_after_coach_is_not_extracted(self):
        self.assertFalse(should_extract_after_turn("incorrect"))


if __name__ == "__main__":
    unittest.main()
