from __future__ import annotations

from pathlib import Path
from typing import Protocol

from shared.schemas import (
    LanguageEvaluationInput,
    LanguageEvaluationResult,
    PlausibilityEstimate,
)


DEFAULT_PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "evaluator.txt"


class PlausibilityEstimator(Protocol):
    def estimate(self, evaluation_input: LanguageEvaluationInput) -> PlausibilityEstimate: ...


class GeminiPlausibilityEstimator:
    """Gemini Flash-Lite ile P(U | C, S, L, G) makulluk tahmini uretir."""

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
                "Gemini dependency is missing. Run 'pip install -r ai/requirements.txt' to install it."
            ) from exc

        self._client = genai.Client(api_key=api_key)
        self._model = model
        self._system_instruction = prompt_path.read_text(encoding="utf-8")

    def estimate(self, evaluation_input: LanguageEvaluationInput) -> PlausibilityEstimate:
        from google.genai import types

        response = self._client.models.generate_content(
            model=self._model,
            contents=evaluation_input.model_dump_json(indent=2),
            config=types.GenerateContentConfig(
                system_instruction=self._system_instruction,
                temperature=0,
                response_mime_type="application/json",
                response_json_schema=PlausibilityEstimate.model_json_schema(),
                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                    disable=True
                ),
            ),
        )
        if not response.text:
            raise RuntimeError("Gemini returned an empty language evaluation")
        return PlausibilityEstimate.model_validate_json(response.text)


class LanguageEvaluator:
    """Model tahminini ayarlanabilir ve deterministik bir threshold'a cevirir."""

    def __init__(self, estimator: PlausibilityEstimator, threshold: float = 98):
        if not 0 <= threshold <= 100:
            raise ValueError("threshold must be between 0 and 100")
        self.estimator = estimator
        self.threshold = threshold

    def evaluate(self, evaluation_input: LanguageEvaluationInput) -> LanguageEvaluationResult:
        estimate = self.estimator.estimate(evaluation_input)
        return LanguageEvaluationResult(
            probability_percent=estimate.probability_percent,
            brief_reason=estimate.brief_reason,
            threshold=self.threshold,
            accepted=estimate.probability_percent >= self.threshold,
        )
