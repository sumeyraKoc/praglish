import os
from collections import Counter

from dotenv import load_dotenv

from ai.modules import (
    CorrectionModule,
    CorrectExtractor,
    GeminiExtractionProvider,
    GeminiPlausibilityEstimator,
    GeminiTextGenerator,
    LanguageEvaluator,
    IncorrectExtractor,
    NpcModule,
    TextSpeechModule,
)
from shared.schemas import (
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
    vocabulary_levels = Counter()
    for item in result.vocabulary:
        vocabulary_levels[item.cefr_level] += item.count
    vocabulary = ", ".join(
        f"{level}×{vocabulary_levels[level]}"
        for level in ("A1", "A2", "B1", "B2", "C1", "C2")
        if vocabulary_levels[level]
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
    correction = CorrectionModule()
    api_key = os.getenv("GEMINI_API_KEY", "")
    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    evaluator = LanguageEvaluator(
        estimator=GeminiPlausibilityEstimator(api_key=api_key, model=model),
        threshold=float(os.getenv("LANGUAGE_ACCEPTANCE_THRESHOLD", "90")),
    )
    extraction_provider = GeminiExtractionProvider(api_key=api_key, model=model)
    correct_extractor = CorrectExtractor(extraction_provider)
    incorrect_extractor = IncorrectExtractor(extraction_provider)
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
            outcome="correct" if evaluation.accepted else "incorrect",
            context=f"{npc.identity.location} role-play",
            speaker=npc.identity.user_role,
            listener=npc.identity.role,
            communicative_goals=[task.description for task in npc.identity.tasks],
            dialogue_history=npc.dialogue_history,
            evaluation_reason=evaluation.brief_reason,
        )
        extractor = correct_extractor if evaluation.accepted else incorrect_extractor
        print_extraction(extractor.extract(extraction_request))

        if not evaluation.accepted:
            feedback = correction.create_feedback(transcript)
            print(f"Coach: {speech.text_to_speech(feedback)}")
            continue

        npc_reply = npc.respond(transcript)
        print(f"NPC: {speech.text_to_speech(npc_reply)}")


if __name__ == "__main__":
    run()
