from __future__ import annotations

from pathlib import Path
from typing import Literal, Protocol

from shared.schemas import (
    ExtractionRequest,
    ExtractionResult,
    GrammarFinding,
    IdiomFinding,
    VocabularyFinding,
)


DEFAULT_PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "extractor.txt"

GRAMMAR_TOPICS = {
    1: "Parts of Speech",
    2: "Sentence Structure",
    3: "Word Order",
    4: "Present Tenses",
    5: "Past Tenses",
    6: "Future Forms",
    7: "Questions",
    8: "Negatives",
    9: "Modal Verbs",
    10: "Semi-modals",
    11: "Nouns",
    12: "Articles",
    13: "Determiners",
    14: "Quantifiers",
    15: "Pronouns",
    16: "Adjectives",
    17: "Comparatives & Superlatives",
    18: "Adverbs",
    19: "Prepositions",
    20: "Conjunctions",
    21: "Gerunds",
    22: "Infinitives",
    23: "Gerund vs Infinitive",
    24: "Participles",
    25: "Passive Voice",
    26: "Causatives",
    27: "Conditionals",
    28: "Relative Clauses",
    29: "Noun Clauses",
    30: "Adverb Clauses",
    31: "Reported Speech",
    32: "Direct Speech",
    33: "Imperatives",
    34: "Wish / If only",
    35: "Used to / Would",
    36: "Subject-Verb Agreement",
    37: "Possession",
    38: "There is / There are",
    39: "It structures",
    40: "Tag Questions",
    41: "Indirect Questions",
    42: "Question Forms",
    43: "Phrasal Verbs",
    44: "Multi-word Verbs",
    45: "Ellipsis & Substitution",
    46: "Emphasis",
    47: "Inversion",
    48: "Subjunctive",
    49: "Unreal / Hypothetical structures",
    50: "Linking structures",
}


class ExtractionProvider(Protocol):
    def analyze(self, request: ExtractionRequest) -> ExtractionResult: ...


class GeminiExtractionProvider:
    """Gemini structured-output adapter for linguistic extraction."""

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

    def analyze(self, request: ExtractionRequest) -> ExtractionResult:
        from google.genai import types

        response = self._client.models.generate_content(
            model=self._model,
            contents=request.model_dump_json(indent=2),
            config=types.GenerateContentConfig(
                system_instruction=self._system_instruction,
                temperature=0,
                response_mime_type="application/json",
                response_json_schema=ExtractionResult.model_json_schema(),
                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                    disable=True
                ),
            ),
        )
        if not response.text:
            raise RuntimeError("Gemini returned an empty extraction")
        return ExtractionResult.model_validate_json(response.text)


class Extractor:
    """Shared correct/incorrect extractor with deterministic normalization."""

    def __init__(
        self,
        provider: ExtractionProvider,
        outcome: Literal["correct", "incorrect"],
    ):
        self.provider = provider
        self.outcome = outcome

    def extract(self, request: ExtractionRequest) -> ExtractionResult:
        request_for_mode = request.model_copy(update={"outcome": self.outcome})
        raw = self.provider.analyze(request_for_mode)
        return self._normalize(raw)

    def _normalize(self, raw: ExtractionResult) -> ExtractionResult:
        grammar_by_id: dict[int, GrammarFinding] = {}
        for finding in raw.grammar:
            canonical_name = GRAMMAR_TOPICS[finding.topic_id]
            existing = grammar_by_id.get(finding.topic_id)
            if existing:
                existing.count += finding.count
                existing.evidence = list(
                    dict.fromkeys([*existing.evidence, *finding.evidence])
                )
                existing.issue = existing.issue or finding.issue
            else:
                grammar_by_id[finding.topic_id] = finding.model_copy(
                    update={"topic_name": canonical_name}
                )

        vocabulary_by_key: dict[tuple[str, str, str], VocabularyFinding] = {}
        for finding in raw.vocabulary:
            lemma = finding.lemma.strip().lower()
            key = (lemma, finding.part_of_speech, finding.cefr_level)
            existing = vocabulary_by_key.get(key)
            if existing:
                existing.count += finding.count
                existing.issue = existing.issue or finding.issue
            else:
                vocabulary_by_key[key] = finding.model_copy(update={"lemma": lemma})

        idioms_by_key: dict[str, IdiomFinding] = {}
        for finding in raw.idioms:
            normalized = " ".join(finding.normalized_idiom.lower().split())
            existing = idioms_by_key.get(normalized)
            if existing:
                existing.count += finding.count
                existing.issue = existing.issue or finding.issue
            else:
                idioms_by_key[normalized] = finding.model_copy(
                    update={"normalized_idiom": normalized}
                )

        return ExtractionResult(
            outcome=self.outcome,
            grammar=list(grammar_by_id.values()),
            vocabulary=list(vocabulary_by_key.values()),
            idioms=list(idioms_by_key.values()),
        )


class CorrectExtractor(Extractor):
    def __init__(self, provider: ExtractionProvider):
        super().__init__(provider=provider, outcome="correct")


class IncorrectExtractor(Extractor):
    def __init__(self, provider: ExtractionProvider):
        super().__init__(provider=provider, outcome="incorrect")
