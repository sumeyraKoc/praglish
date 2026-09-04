from __future__ import annotations

from pathlib import Path
from typing import Protocol

from shared.schemas import CorrectionInput, CorrectionResult


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


class CorrectionModule:
    def __init__(self, provider: CorrectionProvider):
        self.provider = provider

    def correct(self, correction_input: CorrectionInput) -> CorrectionResult:
        return self.provider.correct(correction_input)
