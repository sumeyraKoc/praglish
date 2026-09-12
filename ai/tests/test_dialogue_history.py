
import unittest


class DialogueHistoryTestsMoved(unittest.TestCase):
    def test_see_api_tests_test_dialogue_history(self) -> None:
        raise unittest.SkipTest(
            "Moved to api/tests/test_dialogue_history.py. This test covers "
            "api/services/dialogue_history.py and cannot run in the AI container, "
            "which does not include the API source."
        )


if __name__ == "__main__":
    unittest.main()
