import unittest

from ai.modules.extractor import CorrectExtractor, IncorrectExtractor
from shared.schemas import (
    ExtractionRequest,
    ExtractionResult,
    GrammarFinding,
    IdiomFinding,
    VocabularyFinding,
)


class FakeExtractionProvider:
    def __init__(self, result: ExtractionResult):
        self.result = result
        self.received_request = None

    def analyze(self, request):
        self.received_request = request
        return self.result


def make_request(outcome="incorrect"):
    return ExtractionRequest(
        utterance="Could I get a strong coffee to break the ice?",
        outcome=outcome,
        context="cafe role-play",
        speaker="customer",
        listener="barista",
        communicative_goals=["Order a drink"],
    )


class ExtractorTests(unittest.TestCase):
    def test_correct_extractor_forces_mode_and_normalizes_duplicates(self):
        provider = FakeExtractionProvider(
            ExtractionResult(
                outcome="incorrect",
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

        self.assertEqual(provider.received_request.outcome, "correct")
        self.assertEqual(result.outcome, "correct")
        self.assertEqual(result.grammar[0].topic_name, "Articles")
        self.assertEqual(result.grammar[0].count, 3)
        self.assertEqual(result.vocabulary[0].lemma, "coffee")
        self.assertEqual(result.vocabulary[0].count, 2)
        self.assertEqual(result.idioms[0].normalized_idiom, "break the ice")
        self.assertEqual(result.idioms[0].count, 2)

    def test_incorrect_extractor_forces_incorrect_mode(self):
        provider = FakeExtractionProvider(ExtractionResult(outcome="correct"))

        result = IncorrectExtractor(provider).extract(make_request(outcome="correct"))

        self.assertEqual(provider.received_request.outcome, "incorrect")
        self.assertEqual(result.outcome, "incorrect")


if __name__ == "__main__":
    unittest.main()
