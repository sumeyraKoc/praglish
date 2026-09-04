from __future__ import annotations

from pathlib import Path
from typing import Protocol

from shared.schemas import (
    CorrectExtractionResult,
    ExtractionRequest,
    ExtractionResult,
    GrammarFinding,
    IdiomFinding,
    IncorrectExtractionResult,
    VocabularyErrorFinding,
    VocabularyFinding,
)


CORRECT_PROMPT_PATH = (
    Path(__file__).resolve().parents[1] / "prompts" / "correct_extractor.txt"
)
INCORRECT_PROMPT_PATH = (
    Path(__file__).resolve().parents[1] / "prompts" / "incorrect_extractor.txt"
)

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


class _GeminiExtractionProvider:
    """Gemini structured-output adapter for linguistic extraction."""

    def __init__(
        self,
        api_key: str,
        prompt_path: Path,
        result_type: type[CorrectExtractionResult] | type[IncorrectExtractionResult],
        model: str = "gemini-3.5-flash-lite",
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
        self._result_type = result_type

    def analyze(self, request: ExtractionRequest) -> ExtractionResult:
        from google.genai import types

        response = self._client.models.generate_content(
            model=self._model,
            contents=request.model_dump_json(indent=2),
            config=types.GenerateContentConfig(
                system_instruction=self._system_instruction,
                temperature=0,
                response_mime_type="application/json",
                response_json_schema=self._result_type.model_json_schema(),
                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                    disable=True
                ),
            ),
        )
        if not response.text:
            raise RuntimeError("Gemini returned an empty extraction")
        return self._result_type.model_validate_json(response.text)


class GeminiCorrectExtractionProvider(_GeminiExtractionProvider):
    """Gemini adapter that can only use the correct-usage prompt."""

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-3.5-flash-lite",
    ):
        super().__init__(
            api_key=api_key,
            prompt_path=CORRECT_PROMPT_PATH,
            result_type=CorrectExtractionResult,
            model=model,
        )


class GeminiIncorrectExtractionProvider(_GeminiExtractionProvider):
    """Gemini adapter that can only use the incorrect-usage prompt."""

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-3.5-flash-lite",
    ):
        super().__init__(
            api_key=api_key,
            prompt_path=INCORRECT_PROMPT_PATH,
            result_type=IncorrectExtractionResult,
            model=model,
        )


def _normalize_grammar(findings: list[GrammarFinding]) -> list[GrammarFinding]:
    grammar_by_id: dict[int, GrammarFinding] = {}
    for finding in findings:
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
    return list(grammar_by_id.values())


def _normalize_idioms(findings: list[IdiomFinding]) -> list[IdiomFinding]:
    idioms_by_key: dict[str, IdiomFinding] = {}
    for finding in findings:
        normalized = " ".join(finding.normalized_idiom.lower().split())
        existing = idioms_by_key.get(normalized)
        if existing:
            existing.count += finding.count
            existing.issue = existing.issue or finding.issue
        else:
            idioms_by_key[normalized] = finding.model_copy(
                update={"normalized_idiom": normalized}
            )
    return list(idioms_by_key.values())


class CorrectExtractor:
    def __init__(self, provider: ExtractionProvider):
        self.provider = provider

    def extract(self, request: ExtractionRequest) -> CorrectExtractionResult:
        raw = self.provider.analyze(request)
        if not isinstance(raw, CorrectExtractionResult):
            raise TypeError("CorrectExtractor requires a correct extraction result")

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

        return CorrectExtractionResult(
            grammar=_normalize_grammar(raw.grammar),
            vocabulary=list(vocabulary_by_key.values()),
            idioms=_normalize_idioms(raw.idioms),
        )


class IncorrectExtractor:
    def __init__(self, provider: ExtractionProvider):
        self.provider = provider

    def extract(self, request: ExtractionRequest) -> IncorrectExtractionResult:
        raw = self.provider.analyze(request)
        if not isinstance(raw, IncorrectExtractionResult):
            raise TypeError("IncorrectExtractor requires an incorrect extraction result")

        vocabulary_by_key: dict[
            tuple[str, str, str], VocabularyErrorFinding
        ] = {}
        for finding in raw.vocabulary:
            lemma = finding.lemma.strip().lower()
            key = (lemma, finding.part_of_speech, finding.error_type)
            existing = vocabulary_by_key.get(key)
            if existing:
                existing.count += finding.count
            else:
                vocabulary_by_key[key] = finding.model_copy(update={"lemma": lemma})

        return IncorrectExtractionResult(
            grammar=_normalize_grammar(raw.grammar),
            vocabulary=list(vocabulary_by_key.values()),
            idioms=_normalize_idioms(raw.idioms),
        )
