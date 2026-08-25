from __future__ import annotations

from typing import Protocol

from shared.schemas import DialogueTurn, NPCIdentity


class TextGenerator(Protocol):
    def generate(
        self,
        identity: NPCIdentity,
        dialogue_history: list[DialogueTurn],
    ) -> str: ...


class GeminiTextGenerator:
    """Google Gemini API adapter

    Since NpcModule only knows the TextGenerator protocol,
    the model or provider can be changed later without changing the pipeline.

    """

    def __init__(self, api_key: str, model: str = "gemini-3.5-flash-lite"):
        if not api_key:
            raise ValueError("GEMINI_API_KEY is not defined")

        try:
            from google import genai
        except ImportError as exc:
            raise RuntimeError(
                "Gemini dependency is missing. Run 'pip install -r ai/requirements.txt' to install it."
            ) from exc

        self._client = genai.Client(api_key=api_key)
        self._model = model

    def generate(
        self,
        identity: NPCIdentity,
        dialogue_history: list[DialogueTurn],
    ) -> str:
        from google.genai import types

        system_instruction = (
            "You are an NPC in an English-learning role-play game. "
            "Stay strictly in character. Continue the scenario naturally and concisely. "
            "Do not evaluate or correct the user's English; the language evaluator has "
            "already accepted every user turn you receive. Ask at most one question per turn.\n\n"
            f"NPC identity and scenario data:\n{identity.model_dump_json(indent=2)}"
        )
        conversation = "\n".join(
            f"{turn.speaker.upper()}: {turn.text}" for turn in dialogue_history
        )
        response = self._client.models.generate_content(
            model=self._model,
            contents=conversation,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.7,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                    disable=True
                ),
            ),
        )
        reply = (response.text or "").strip()
        if not reply:
            raise RuntimeError("Gemini returned an empty response")
        return reply


class NpcModule:
    """NPC identity, roles, and only approved dialogues are managed."""

    def __init__(self, identity: NPCIdentity, generator: TextGenerator):
        self.identity = identity
        self.generator = generator
        self.dialogue_history: list[DialogueTurn] = []

    def respond(self, accepted_user_text: str) -> str:
        candidate_history = [
            *self.dialogue_history,
            DialogueTurn(speaker="user", text=accepted_user_text),
        ]
        npc_reply = self.generator.generate(self.identity, candidate_history)

        # API call is successful, so save both sides of the conversation. This ensures
        # that an incomplete turn doesn't corrupt the permanent conversation history.
        self.dialogue_history.extend(
            [
                DialogueTurn(speaker="user", text=accepted_user_text),
                DialogueTurn(speaker="npc", text=npc_reply),
            ]
        )
        return npc_reply
