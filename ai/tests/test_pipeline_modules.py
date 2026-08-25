import unittest

from ai.modules.correction import CorrectionModule
from ai.modules.language_evaluator import LanguageEvaluator
from ai.modules.npc import NpcModule
from ai.modules.speech import TextSpeechModule
from shared.schemas import (
    DialogueTurn,
    LanguageEvaluationInput,
    NPCIdentity,
    NPCTask,
    PlausibilityEstimate,
)


class FakePlausibilityEstimator:
    def __init__(self, probability_percent: float):
        self.probability_percent = probability_percent
        self.received_input = None

    def estimate(self, evaluation_input):
        self.received_input = evaluation_input
        return PlausibilityEstimate(
            probability_percent=self.probability_percent,
            brief_reason="Fake estimate for deterministic testing.",
        )


class FakeTextGenerator:
    def __init__(self):
        self.received_history: list[DialogueTurn] = []

    def generate(self, identity, dialogue_history):
        self.received_history = list(dialogue_history)
        return f"Welcome to {identity.location}. What size would you like?"


class FailingTextGenerator:
    def generate(self, identity, dialogue_history):
        raise RuntimeError("API unavailable")


def make_identity() -> NPCIdentity:
    return NPCIdentity(
        id="barista_01",
        name="Mia",
        role="barista",
        user_role="customer",
        location="cafe",
        personality="friendly",
        tasks=[NPCTask(id="size", description="Ask for a drink size")],
    )


def make_evaluation_input() -> LanguageEvaluationInput:
    return LanguageEvaluationInput(
        utterance="Could I get a coffee please?",
        context="cafe role-play",
        speaker="customer",
        listener="barista",
        communicative_goals=["Order a drink"],
    )


class PipelineModuleTests(unittest.TestCase):
    def test_speech_module_is_text_in_text_out(self):
        speech = TextSpeechModule()
        self.assertEqual(speech.speech_to_text("  hello world  "), "hello world")
        self.assertEqual(speech.text_to_speech("hello world"), "hello world")

    def test_evaluator_rejects_probability_below_threshold(self):
        evaluator = LanguageEvaluator(FakePlausibilityEstimator(49.9), threshold=50)

        result = evaluator.evaluate(make_evaluation_input())

        self.assertFalse(result.accepted)
        self.assertEqual(result.probability_percent, 49.9)

    def test_evaluator_accepts_probability_at_threshold(self):
        estimator = FakePlausibilityEstimator(50)
        evaluator = LanguageEvaluator(estimator, threshold=50)

        result = evaluator.evaluate(make_evaluation_input())

        self.assertTrue(result.accepted)
        self.assertEqual(estimator.received_input.speaker, "customer")

    def test_evaluator_rejects_invalid_threshold(self):
        with self.assertRaisesRegex(ValueError, "between 0 and 100"):
            LanguageEvaluator(FakePlausibilityEstimator(50), threshold=101)

    def test_correction_message(self):
        self.assertEqual(
            CorrectionModule().create_feedback("too short"),
            "Please provide a more detailed response.",
        )

    def test_npc_saves_only_complete_successful_turn(self):
        generator = FakeTextGenerator()
        npc = NpcModule(make_identity(), generator)

        reply = npc.respond("Could I get a coffee please")

        self.assertIn("What size", reply)
        self.assertEqual(len(generator.received_history), 1)
        self.assertEqual(len(npc.dialogue_history), 2)
        self.assertEqual(npc.dialogue_history[0].speaker, "user")
        self.assertEqual(npc.dialogue_history[1].speaker, "npc")

    def test_npc_does_not_save_partial_turn_when_generation_fails(self):
        npc = NpcModule(make_identity(), FailingTextGenerator())

        with self.assertRaisesRegex(RuntimeError, "API unavailable"):
            npc.respond("Could I get a coffee please")

        self.assertEqual(npc.dialogue_history, [])


if __name__ == "__main__":
    unittest.main()
