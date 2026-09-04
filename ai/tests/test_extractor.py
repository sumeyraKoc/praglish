import unittest

from pydantic import ValidationError

from ai.modules.extractor import (
    CORRECT_PROMPT_PATH,
    INCORRECT_PROMPT_PATH,
    CorrectExtractor,
    IncorrectExtractor,
)
from shared.schemas import (
    CorrectExtractionResult,
    ExtractionRequest,
    ExtractionResult,
    GrammarFinding,
    IdiomFinding,
    IncorrectExtractionResult,
    VocabularyErrorFinding,
    VocabularyFinding,
)


class FakeExtractionProvider:
    def __init__(self, result: ExtractionResult):
        self.result = result
        self.received_request = None

    def analyze(self, request):
        self.received_request = request
        return self.result


def make_request():
    return ExtractionRequest(
        utterance="Could I get a strong coffee to break the ice?",
    )


class ExtractorTests(unittest.TestCase):
    def test_extraction_request_rejects_context_and_other_extra_input(self):
        with self.assertRaises(ValidationError):
            ExtractionRequest(
                utterance="Could I get a coffee?",
                context="cafe role-play",
            )

    def test_correct_extractor_forces_mode_and_normalizes_duplicates(self):
        provider = FakeExtractionProvider(
            CorrectExtractionResult(
                grammar=[
                    GrammarFinding(
                        topic_id=12,
                        topic_name="Wrong model name",
                        count=1,
                        evidence=["a strong coffee"],
                    ),
                    GrammarFinding(
                        topic_id=12,
                        topic_name="Articles",
                        count=2,
                        evidence=["a strong coffee"],
                    ),
                ],
                vocabulary=[
                    VocabularyFinding(
                        lemma="Coffee",
                        surface_form="coffee",
                        part_of_speech="noun",
                        cefr_level="A1",
                        count=1,
                    ),
                    VocabularyFinding(
                        lemma="coffee",
                        surface_form="coffee",
                        part_of_speech="noun",
                        cefr_level="A1",
                        count=1,
                    ),
                ],
                idioms=[
                    IdiomFinding(
                        idiom="break the ice",
                        normalized_idiom=" Break   The Ice ",
                        count=1,
                    ),
                    IdiomFinding(
                        idiom="break the ice",
                        normalized_idiom="break the ice",
                        count=1,
                    ),
                ],
            )
        )

        result = CorrectExtractor(provider).extract(make_request())

        self.assertEqual(
            provider.received_request.model_dump(),
            {"utterance": "Could I get a strong coffee to break the ice?"},
        )
        self.assertEqual(result.outcome, "correct")
        self.assertEqual(result.grammar[0].topic_name, "Articles")
        self.assertEqual(result.grammar[0].count, 3)
        self.assertEqual(result.vocabulary[0].lemma, "coffee")
        self.assertEqual(result.vocabulary[0].count, 2)
        self.assertEqual(result.idioms[0].normalized_idiom, "break the ice")
        self.assertEqual(result.idioms[0].count, 2)

    def test_incorrect_extractor_forces_incorrect_mode(self):
        provider = FakeExtractionProvider(
            IncorrectExtractionResult(
                vocabulary=[
                    VocabularyErrorFinding(
                        lemma="umbrella",
                        surface_form="umbrela",
                        part_of_speech="noun",
                        error_type="spelling",
                        issue='"umbrela" should be spelled "umbrella"',
                    ),
                    VocabularyErrorFinding(
                        lemma="Umbrella",
                        surface_form="umbrela",
                        part_of_speech="noun",
                        error_type="spelling",
                        issue='"umbrela" should be spelled "umbrella"',
                    ),
                ]
            )
        )

        result = IncorrectExtractor(provider).extract(make_request())

        self.assertEqual(
            provider.received_request.model_dump(),
            {"utterance": "Could I get a strong coffee to break the ice?"},
        )
        self.assertEqual(result.outcome, "incorrect")
        self.assertEqual(result.vocabulary[0].error_type, "spelling")
        self.assertEqual(result.vocabulary[0].count, 2)
        self.assertNotIn("cefr_level", result.vocabulary[0].model_dump())

    def test_correct_and_incorrect_prompts_are_independent(self):
        correct_prompt = CORRECT_PROMPT_PATH.read_text(encoding="utf-8")
        incorrect_prompt = INCORRECT_PROMPT_PATH.read_text(encoding="utf-8")

        self.assertNotEqual(CORRECT_PROMPT_PATH, INCORRECT_PROMPT_PATH)
        self.assertIn('Always return "outcome": "correct"', correct_prompt)
        self.assertNotIn('Always return "outcome": "incorrect"', correct_prompt)
        self.assertIn('Always return "outcome": "incorrect"', incorrect_prompt)
        self.assertNotIn('Always return "outcome": "correct"', incorrect_prompt)
        self.assertIn("five error_type values", incorrect_prompt)
        self.assertIn("Do not assign or return a CEFR level", incorrect_prompt)

        correct_schema = CorrectExtractionResult.model_json_schema()
        incorrect_schema = IncorrectExtractionResult.model_json_schema()
        self.assertIn("cefr_level", str(correct_schema))
        self.assertNotIn("cefr_level", str(incorrect_schema))
        self.assertIn("error_type", str(incorrect_schema))


if __name__ == "__main__":
    unittest.main()
