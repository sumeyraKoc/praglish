import os

from dotenv import load_dotenv

from ai.modules import (
    CorrectionModule,
    GeminiPlausibilityEstimator,
    GeminiTextGenerator,
    LanguageEvaluator,
    NpcModule,
    TextSpeechModule,
)
from shared.schemas import LanguageEvaluationInput, NPCIdentity, NPCTask


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


def run() -> None:
    load_dotenv()

    speech = TextSpeechModule()
    correction = CorrectionModule()
    api_key = os.getenv("GEMINI_API_KEY", "")
    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    evaluator = LanguageEvaluator(
        estimator=GeminiPlausibilityEstimator(api_key=api_key, model=model),
        threshold=float(os.getenv("LANGUAGE_ACCEPTANCE_THRESHOLD", "50")),
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

        if not evaluation.accepted:
            feedback = correction.create_feedback(transcript)
            print(f"Coach: {speech.text_to_speech(feedback)}")
            continue

        npc_reply = npc.respond(transcript)
        print(f"NPC: {speech.text_to_speech(npc_reply)}")


if __name__ == "__main__":
    run()
