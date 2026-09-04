from __future__ import annotations

from pathlib import Path
from typing import Protocol

from shared.schemas import CorrectionInput, CorrectionResult

from .groq_client import (
    DEFAULT_GROQ_MODEL,
    build_groq_client,
    groq_chat_json,
    json_schema_instruction,
)


DEFAULT_PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "correction.txt"


class CorrectionProvider(Protocol):
    def correct(self, correction_input: CorrectionInput) -> CorrectionResult: ...


class GeminiCorrectionProvider:
    """Gemini structured-output adapter for contextual language correction."""

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-3.5-flash-lite",
        prompt_path: Path = DEFAULT_PROMPT_PATH,
    ):
        if not api_key:
            raise ValueError("GEMINI_API_KEY is not defined")

        try:
            from google import genai
        except ImportError as exc:
            raise RuntimeError(
                "Gemini dependency is missing. Run 'pip install -r ai/requirements.txt'."
            ) from exc

        self._client = genai.Client(api_key=api_key)
        self._model = model
        self._system_instruction = prompt_path.read_text(encoding="utf-8")

    def correct(self, correction_input: CorrectionInput) -> CorrectionResult:
        from google.genai import types

        response = self._client.models.generate_content(
            model=self._model,
            contents=correction_input.model_dump_json(indent=2),
            config=types.GenerateContentConfig(
                system_instruction=self._system_instruction,
                temperature=0,
                response_mime_type="application/json",
                response_json_schema=CorrectionResult.model_json_schema(),
                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                    disable=True
                ),
            ),
        )
        if not response.text:
            raise RuntimeError("Gemini returned an empty correction")
        return CorrectionResult.model_validate_json(response.text)


class GroqCorrectionProvider:
    """Groq (OpenAI-compatible chat-completions) adapter for the same task.

    Same prompt file and output schema as `GeminiCorrectionProvider` - only
    the transport and JSON-enforcement mechanism differ (see
    `groq_client.groq_chat_json`).
    """

    def __init__(
        self,
        api_key: str,
        model: str = DEFAULT_GROQ_MODEL,
        prompt_path: Path = DEFAULT_PROMPT_PATH,
    ):
        self._client = build_groq_client(api_key)
        self._model = model
        self._system_instruction = prompt_path.read_text(
            encoding="utf-8"
        ) + json_schema_instruction(CorrectionResult.model_json_schema())

    def correct(self, correction_input: CorrectionInput) -> CorrectionResult:
        content = groq_chat_json(
            self._client,
            model=self._model,
            system_instruction=self._system_instruction,
            user_content=correction_input.model_dump_json(indent=2),
        )
        return CorrectionResult.model_validate_json(content)


class CorrectionModule:
    def __init__(self, provider: CorrectionProvider):
        self.provider = provider

    def correct(self, correction_input: CorrectionInput) -> CorrectionResult:
        return self.provider.correct(correction_input)
