import os
from collections import Counter

from dotenv import load_dotenv

from ai.modules import (
    CorrectionModule,
    CorrectExtractor,
    GeminiCorrectionProvider,
    GeminiCorrectExtractionProvider,
    GeminiIncorrectExtractionProvider,
    GeminiPlausibilityEstimator,
    GeminiTextGenerator,
    LanguageEvaluator,
    IncorrectExtractor,
    NpcModule,
    TextSpeechModule,
)
from shared.schemas import (
    CorrectionInput,
    ExtractionRequest,
    ExtractionResult,
    LanguageEvaluationInput,
    NPCIdentity,
    NPCTask,
)


def create_barista() -> NPCIdentity:
    return NPCIdentity(
        id="barista_01",
        name="Mia",
        role="barista",
        user_role="customer",
        location="cafe",
        personality="Friendly, patient, and concise",
        tasks=[
            NPCTask(id="drink", description="Learn which drink the customer wants"),
            NPCTask(id="size", description="Ask which drink size the customer wants"),
            NPCTask(id="milk", description="Ask whether the customer wants regular or lactose-free milk"),
        ],
        scenario_state={"drink": None, "size": None, "milk": None},
    )


def print_extraction(result: ExtractionResult) -> None:
    grammar = ", ".join(
        f"{item.topic_name}×{item.count}" for item in result.grammar
    ) or "none"
    vocabulary_counts = Counter()
    if result.outcome == "correct":
        for item in result.vocabulary:
            vocabulary_counts[item.cefr_level] += item.count
        vocabulary = ", ".join(
            f"{level}×{vocabulary_counts[level]}"
            for level in ("A1", "A2", "B1", "B2", "C1", "C2")
            if vocabulary_counts[level]
        ) or "none"
    else:
        for item in result.vocabulary:
            vocabulary_counts[item.error_type] += item.count
        vocabulary = ", ".join(
            f"{error_type}×{vocabulary_counts[error_type]}"
            for error_type in (
                "spelling",
                "word_form",
                "lexical_choice",
                "sense",
                "collocation",
            )
            if vocabulary_counts[error_type]
        ) or "none"
    idioms = ", ".join(
        f"{item.normalized_idiom}×{item.count}" for item in result.idioms
    ) or "none"
    print(
        f"Extractor ({result.outcome}): grammar=[{grammar}] "
        f"vocabulary=[{vocabulary}] idioms=[{idioms}]"
    )


def run() -> None:
    load_dotenv()

    speech = TextSpeechModule()
    api_key = os.getenv("GEMINI_API_KEY", "")
    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    correction = CorrectionModule(
        GeminiCorrectionProvider(
            api_key=api_key,
            model=os.getenv("CORRECTION_MODEL", model),
        )
    )
    evaluator = LanguageEvaluator(
        estimator=GeminiPlausibilityEstimator(api_key=api_key, model=model),
        threshold=float(os.getenv("LANGUAGE_ACCEPTANCE_THRESHOLD", "90")),
    )
    correct_extractor = CorrectExtractor(
        GeminiCorrectExtractionProvider(api_key=api_key, model=model)
    )
    incorrect_extractor = IncorrectExtractor(
        GeminiIncorrectExtractionProvider(api_key=api_key, model=model)
    )
    generator = GeminiTextGenerator(
        api_key=api_key,
        model=model,
    )
    npc = NpcModule(identity=create_barista(), generator=generator)

    print("Cafe role-play başladı. Çıkmak için 'quit' yazın.")
    print(f"NPC: Hi! I'm {npc.identity.name}. What can I get for you?")

    while True:
        terminal_input = input("You: ")
        if terminal_input.strip().lower() in {"quit", "exit"}:
            break

        transcript = speech.speech_to_text(terminal_input)
        evaluation = evaluator.evaluate(
            LanguageEvaluationInput(
                utterance=transcript,
                context=f"{npc.identity.location} role-play",
                speaker=npc.identity.user_role,
                listener=npc.identity.role,
                communicative_goals=[task.description for task in npc.identity.tasks],
                scenario_state=npc.identity.scenario_state,
                dialogue_history=npc.dialogue_history,
            )
        )
        print(
            "Evaluator: "
            f"P(U | C,S,L,G) = {evaluation.probability_percent:.1f}% "
            f"| threshold = {evaluation.threshold:.1f}% "
            f"| accepted = {evaluation.accepted}"
        )

        extraction_request = ExtractionRequest(
            utterance=transcript,
        )
        extractor = correct_extractor if evaluation.accepted else incorrect_extractor
        print_extraction(extractor.extract(extraction_request))

        if not evaluation.accepted:
            correction_result = correction.correct(
                CorrectionInput(
                    utterance=transcript,
                    dialogue_history=npc.dialogue_history,
                )
            )
            print(f"Corrected: {correction_result.corrected_utterance}")
            print(
                "Coach: "
                f"{speech.text_to_speech(correction_result.coach_response)}"
            )
            continue

        npc_reply = npc.respond(transcript)
        print(f"NPC: {speech.text_to_speech(npc_reply)}")


if __name__ == "__main__":
    run()
