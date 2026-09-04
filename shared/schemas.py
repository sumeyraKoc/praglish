"""
Ortak sozlesme: api servisi ile ai servisi arasindaki tum JSON alisverisi
bu dosyadaki modellere gore yapilir. Bu dosyayi degistirirken ikiniz de
haberdar olun, cunku her iki container da bu dosyayi kullaniyor.
"""

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class DialogueTurn(BaseModel):
    speaker: Literal["user", "npc"]
    text: str


class NPCTask(BaseModel):
    """NPC'nin senaryo boyunca yerine getirmesi gereken bir hedef."""

    id: str
    description: str


class NPCIdentity(BaseModel):
    """NPC modeline her turda verilen kimlik ve oyun baglami."""

    id: str
    name: str
    role: str
    user_role: str
    location: str
    personality: str
    tasks: list[NPCTask] = Field(default_factory=list)
    scenario_state: dict[str, Any] = Field(default_factory=dict)


class LanguageEvaluationInput(BaseModel):
    """P(U | C, S, L, G) tahmini icin evaluator girdileri."""

    utterance: str
    context: str
    speaker: str
    listener: str
    communicative_goals: list[str] = Field(default_factory=list)
    scenario_state: dict[str, Any] = Field(default_factory=dict)
    dialogue_history: list[DialogueTurn] = Field(default_factory=list)


class PlausibilityEstimate(BaseModel):
    """Gemini'nin uretecegi yapilandirilmis tahmin."""

    probability_percent: float = Field(ge=0, le=100)
    brief_reason: str


class LanguageEvaluationResult(PlausibilityEstimate):
    """Yerel threshold karari eklenmis evaluator sonucu."""

    threshold: float = Field(ge=0, le=100)
    accepted: bool


class GrammarFinding(BaseModel):
    topic_id: int = Field(ge=1, le=50)
    topic_name: str
    count: int = Field(default=1, ge=1)
    evidence: list[str] = Field(default_factory=list)
    issue: Optional[str] = None


class VocabularyFinding(BaseModel):
    lemma: str
    surface_form: str
    part_of_speech: Literal["noun", "adjective"]
    cefr_level: Literal["A1", "A2", "B1", "B2", "C1", "C2"]
    count: int = Field(default=1, ge=1)
    issue: Optional[str] = None


class IdiomFinding(BaseModel):
    idiom: str
    normalized_idiom: str
    count: int = Field(default=1, ge=1)
    issue: Optional[str] = None


class ExtractionRequest(BaseModel):
    utterance: str
    outcome: Literal["correct", "incorrect"]
    context: str
    speaker: str
    listener: str
    communicative_goals: list[str] = Field(default_factory=list)
    dialogue_history: list[DialogueTurn] = Field(default_factory=list)
    evaluation_reason: Optional[str] = None


class ExtractionResult(BaseModel):
    outcome: Literal["correct", "incorrect"]
    grammar: list[GrammarFinding] = Field(default_factory=list)
    vocabulary: list[VocabularyFinding] = Field(default_factory=list)
    idioms: list[IdiomFinding] = Field(default_factory=list)


class EvaluateRequest(BaseModel):
    location: str  # orn: "bakery"
    npc_role: str  # orn: "baker"
    scenario_state: dict = Field(default_factory=dict)
    dialogue_history: list[DialogueTurn] = Field(default_factory=list)
    user_text: str


class RewardInfo(BaseModel):
    gained_xp: int
    gained_coins: int
    total_xp: int
    total_coins: int


class EvaluateResponse(BaseModel):
    accepted: bool
    correction: Optional[str] = None
    npc_response: str
    updated_scenario_state: dict = Field(default_factory=dict)
    probability_percent: Optional[float] = Field(default=None, ge=0, le=100)
    evaluation_reason: Optional[str] = None
    rewards: Optional[RewardInfo] = None


class TTSRequest(BaseModel):
    text: str
    voice: str = "Kore"
    style: str = "Speak naturally, warmly, and at a patient conversational pace."


class TTSResponse(BaseModel):
    audio_url: str


class STTResponse(BaseModel):
    text: str
    language_code: Optional[str] = None
    mode: Literal["verbatim"] = "verbatim"
    model: str
    latency_ms: int = Field(ge=0)
