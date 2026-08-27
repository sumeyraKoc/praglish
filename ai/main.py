import os
from functools import lru_cache

from fastapi import FastAPI, UploadFile
from dotenv import load_dotenv

from modules import (
    CorrectionModule,
    CorrectExtractor,
    GeminiExtractionProvider,
    GeminiPlausibilityEstimator,
    GeminiTextGenerator,
    IncorrectExtractor,
    LanguageEvaluator,
    NpcModule,
)

from shared.schemas import (
    EvaluateRequest,
    EvaluateResponse,
    ExtractionRequest,
    ExtractionResult,
    LanguageEvaluationInput,
    NPCIdentity,
    NPCTask,
    STTResponse,
    TTSRequest,
    TTSResponse,
)

load_dotenv()

app = FastAPI(title="English World - AI Service")


@app.get("/health")
def health():
    return {"status": "ok", "service": "ai"}


@lru_cache
def get_extraction_provider() -> GeminiExtractionProvider:
    return GeminiExtractionProvider(
        api_key=os.getenv("GEMINI_API_KEY", ""),
        model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
    )


@lru_cache
def get_language_evaluator() -> LanguageEvaluator:
    return LanguageEvaluator(
        estimator=GeminiPlausibilityEstimator(
            api_key=os.getenv("GEMINI_API_KEY", ""),
            model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        ),
        threshold=float(os.getenv("LANGUAGE_ACCEPTANCE_THRESHOLD", "90")),
    )


@lru_cache
def get_npc_generator() -> GeminiTextGenerator:
    return GeminiTextGenerator(
        api_key=os.getenv("GEMINI_API_KEY", ""),
        model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
    )


@app.post("/extract", response_model=ExtractionResult)
def extract_language_features(payload: ExtractionRequest):
    provider = get_extraction_provider()
    extractor = (
        CorrectExtractor(provider)
        if payload.outcome == "correct"
        else IncorrectExtractor(provider)
    )
    return extractor.extract(payload)


@app.post("/evaluate-and-respond", response_model=EvaluateResponse)
def evaluate_and_respond(payload: EvaluateRequest):
    history = list(payload.dialogue_history)
    if history and history[-1].speaker == "user" and history[-1].text == payload.user_text:
        history = history[:-1]

    goals = [
        f"Learn or confirm the value of: {field}"
        for field, value in payload.scenario_state.items()
        if value is None
    ]
    evaluation = get_language_evaluator().evaluate(
        LanguageEvaluationInput(
            utterance=payload.user_text,
            context=f"{payload.location} role-play",
            speaker="player",
            listener=payload.npc_role,
            communicative_goals=goals,
            scenario_state=payload.scenario_state,
            dialogue_history=history,
        )
    )

    if not evaluation.accepted:
        feedback = CorrectionModule().create_feedback(payload.user_text)
        return EvaluateResponse(
            accepted=False,
            correction=feedback,
            npc_response=feedback,
            updated_scenario_state=payload.scenario_state,
            probability_percent=evaluation.probability_percent,
            evaluation_reason=evaluation.brief_reason,
        )

    identity = NPCIdentity(
        id=f"{payload.location}_{payload.npc_role}",
        name=payload.npc_role.replace("_", " ").title(),
        role=payload.npc_role,
        user_role="player",
        location=payload.location,
        personality="Friendly, patient, and concise",
        tasks=[
            NPCTask(id=f"task_{index}", description=goal)
            for index, goal in enumerate(goals, start=1)
        ],
        scenario_state=payload.scenario_state,
    )
    npc = NpcModule(identity=identity, generator=get_npc_generator())
    npc.dialogue_history = history
    npc_reply = npc.respond(payload.user_text)
    return EvaluateResponse(
        accepted=True,
        correction=None,
        npc_response=npc_reply,
        updated_scenario_state=payload.scenario_state,
        probability_percent=evaluation.probability_percent,
        evaluation_reason=evaluation.brief_reason,
    )


@app.post("/stt", response_model=STTResponse)
async def speech_to_text(audio: UploadFile):
    """
    TODO(Sumeyra):
    - faster-whisper (self-hosted, ucretsiz, sinirsiz) veya Groq Whisper entegrasyonu
    - ONEMLI: STT'nin bozuk gramerli cumleleri sessizce "duzeltip duzeltmedigini"
      erken test et - evaluator'in dogrulugu buna bagli
    """
    _ = await audio.read()
    return STTResponse(text="placeholder transcript")


@app.post("/tts", response_model=TTSResponse)
def text_to_speech(payload: TTSRequest):
    """
    TODO(Sumeyra):
    - Demo icin: Web Speech API (client tarafinda, backend'e hic ugramadan) da secenek
    - Ticari/kalici cozum icin: Piper TTS (self-hosted, $0, resmi risk yok)
    - edge-tts KULLANMA: resmi olmayan, dokumante olmayan bir kutuphane, her an bozulabilir
    """
    return TTSResponse(audio_url="placeholder.mp3")
