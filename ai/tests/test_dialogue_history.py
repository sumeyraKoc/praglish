import unittest
from types import SimpleNamespace

from api.services.dialogue_history import build_evaluator_history


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


if __name__ == "__main__":
    unittest.main()
