import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))
os.environ.setdefault("DATABASE_URL", "sqlite://")

from services.dialogue_history import build_evaluator_history  # noqa: E402


def dialogue(speaker: str, text: str, is_natural: bool | None = None):
    return SimpleNamespace(
        speaker=speaker,
        text=text,
        is_natural=is_natural,
    )


class DialogueHistoryTests(unittest.TestCase):
    def test_keeps_all_npc_and_only_accepted_user_messages(self):
        history = build_evaluator_history(
            [
                dialogue("npc", "Welcome."),
                dialogue("user", "A correct request.", True),
                dialogue("npc", "What size?"),
                dialogue("user", "An incorrect request.", False),
                dialogue("coach", "Please try again."),
                dialogue("npc", "Anything else?"),
            ]
        )

        self.assertEqual(
            [(item.speaker, item.text) for item in history],
            [
                ("npc", "Welcome."),
                ("user", "A correct request."),
                ("npc", "What size?"),
                ("npc", "Anything else?"),
            ],
        )

    def test_filters_legacy_coach_saved_as_npc_after_rejected_user(self):
        history = build_evaluator_history(
            [
                dialogue("user", "An incorrect request.", False),
                dialogue("npc", "Please try again."),
            ]
        )

        self.assertEqual(history, [])

    def test_keeps_the_full_eligible_history_without_a_turn_limit(self):
        dialogues = []
        for index in range(10):
            dialogues.extend(
                [
                    dialogue("user", f"Accepted message {index}.", True),
                    dialogue("npc", f"NPC response {index}."),
                ]
            )

        history = build_evaluator_history(dialogues)

        self.assertEqual(len(history), 20)
        self.assertEqual(history[0].text, "Accepted message 0.")
        self.assertEqual(history[-1].text, "NPC response 9.")


if __name__ == "__main__":
    unittest.main()
