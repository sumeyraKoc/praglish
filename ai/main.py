import os
from functools import lru_cache

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from dotenv import load_dotenv

from modules import (
    CorrectionModule,
    CorrectionProvider,
    CorrectExtractor,
    ExtractionProvider,
    GeminiCorrectionProvider,
    GeminiCorrectExtractionProvider,
    GeminiIncorrectExtractionProvider,
    GeminiPlausibilityEstimator,
    GeminiSpeechToTextProvider,
    GeminiTextToSpeechProvider,
    GeminiTextGenerator,
    GroqCorrectionProvider,
    GroqCorrectExtractionProvider,
    GroqIncorrectExtractionProvider,
    GroqPlausibilityEstimator,
    GroqSpeechToTextProvider,
    GroqTextToSpeechProvider,
    GroqTextGenerator,
    IncorrectExtractor,
    LanguageEvaluator,
    NpcModule,
    PlausibilityEstimator,
    SpeechToTextProvider,
    TextGenerator,
    TextToSpeechProvider,
)

from shared.schemas import (
    CorrectionInput,
    CorrectionResult,
    CorrectExtractionResult,
    EvaluateRequest,
    EvaluateResponse,
    ExtractionRequest,
    IncorrectExtractionResult,
    LanguageEvaluationInput,
    NPCIdentity,
    NPCTask,
    STTResponse,
    TTSRequest,
)

load_dotenv()

app = FastAPI(title="English World - AI Service")

NPC_PROFILES = {
    ("bakery", "baker"): {
        "name": "Maya",
        "personality": "Warm, cheerful, patient, and concise",
    },
    ("library", "librarian"): {
        "name": "Lina",
        "personality": "Warm, knowledgeable, patient, and concise",
    },
}


@app.get("/health")
def health():
    try:
        ai_provider = _active_ai_provider()
    except RuntimeError:
        # Keep /health itself green even with no key configured yet - it's a
        # liveness probe, not a config check. The concrete error still
        # surfaces the first time an actual AI endpoint is called below.
        ai_provider = "unconfigured"
    return {"status": "ok", "service": "ai", "ai_provider": ai_provider}


def _active_ai_provider() -> str:
    """Pick which AI backend to use, based on which API key is configured.

    Gemini and Groq are wired as interchangeable implementations of the same
    Protocols (see ai/modules/*.py), so the whole service can run on either
    one without any other code changing. GEMINI_API_KEY wins when both are
    set - the historical default behaviour of this service - so an existing
    .env with only a Gemini key keeps working exactly as before. Setting
    GROQ_API_KEY instead (e.g. because Gemini is down or rate-limited) is
    enough to move every AI call over to Groq. This selection happens once
    per process (the results are cached via @lru_cache below); switching
    providers means changing .env and restarting the ai container.
    """

    if _env("GEMINI_API_KEY"):
        return "gemini"
    if _env("GROQ_API_KEY"):
        return "groq"
    raise RuntimeError(
        "No AI provider is configured. Set GEMINI_API_KEY or GROQ_API_KEY in .env."
    )


def _env(key: str, default: str = "") -> str:
    """os.getenv, but treats an EMPTY string the same as unset.

    docker-compose's `${VAR:-default}` substitution only kicks in when VAR is
    unset on the host - if .env sets `SOME_KEY=` (present but blank, e.g. an
    optional override nobody filled in) or the container is run without
    Compose at all, `os.getenv("SOME_KEY", default)` would return "" instead
    of `default`, silently passing an empty model name straight to Gemini/Groq.
    Using this helper for every model/config lookup avoids that trap.
    """

    return os.getenv(key, "").strip() or default


@lru_cache
def get_correct_extraction_provider() -> ExtractionProvider:
    if _active_ai_provider() == "gemini":
        return GeminiCorrectExtractionProvider(
            api_key=_env("GEMINI_API_KEY"),
            model=_env("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        )
    return GroqCorrectExtractionProvider(
        api_key=_env("GROQ_API_KEY"),
        model=_env("GROQ_MODEL", "llama-3.3-70b-versatile"),
    )


@lru_cache
def get_incorrect_extraction_provider() -> ExtractionProvider:
    if _active_ai_provider() == "gemini":
        return GeminiIncorrectExtractionProvider(
            api_key=_env("GEMINI_API_KEY"),
            model=_env("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        )
    return GroqIncorrectExtractionProvider(
        api_key=_env("GROQ_API_KEY"),
        model=_env("GROQ_MODEL", "llama-3.3-70b-versatile"),
    )


@lru_cache
def get_language_evaluator() -> LanguageEvaluator:
    # Evaluator ve correction (asagida) her turda oyuncunun BEKLEDIGI kritik
    # yolda calisiyor (bkz. evaluate_and_respond) - extractor'lar gibi arka
    # planda degil. Bu yuzden varsayilan olarak Groq'ta "instant" (kucuk,
    # dusuk gecikmeli) modeli kullaniyoruz; NPC diyalogu (get_npc_generator)
    # karakter kalitesi icin buyuk modelde kaliyor. Gemini tarafinda hangi
    # modelin daha hizli oldugunu varsaymiyoruz - GEMINI_EVALUATOR_MODEL
    # ayarlanmadigi surece GEMINI_MODEL ile ayni davranis (once oldugu gibi).
    estimator: PlausibilityEstimator
    if _active_ai_provider() == "gemini":
        estimator = GeminiPlausibilityEstimator(
            api_key=_env("GEMINI_API_KEY"),
            model=_env("GEMINI_EVALUATOR_MODEL", _env("GEMINI_MODEL", "gemini-3.5-flash-lite")),
        )
    else:
        from modules.groq_client import DEFAULT_GROQ_FAST_MODEL

        estimator = GroqPlausibilityEstimator(
            api_key=_env("GROQ_API_KEY"),
            model=_env("GROQ_EVALUATOR_MODEL", DEFAULT_GROQ_FAST_MODEL),
        )
    return LanguageEvaluator(
        estimator=estimator,
        threshold=float(_env("LANGUAGE_ACCEPTANCE_THRESHOLD", "90")),
    )


@lru_cache
def get_correction_module() -> CorrectionModule:
    provider: CorrectionProvider
    if _active_ai_provider() == "gemini":
        provider = GeminiCorrectionProvider(
            api_key=_env("GEMINI_API_KEY"),
            model=_env("CORRECTION_MODEL", _env("GEMINI_MODEL", "gemini-3.5-flash-lite")),
        )
    else:
        from modules.groq_client import DEFAULT_GROQ_FAST_MODEL

        provider = GroqCorrectionProvider(
            api_key=_env("GROQ_API_KEY"),
            model=_env("GROQ_CORRECTION_MODEL", DEFAULT_GROQ_FAST_MODEL),
        )
    return CorrectionModule(provider)


@lru_cache
def get_npc_generator() -> TextGenerator:
    if _active_ai_provider() == "gemini":
        return GeminiTextGenerator(
            api_key=_env("GEMINI_API_KEY"),
            model=_env("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        )
    return GroqTextGenerator(
        api_key=_env("GROQ_API_KEY"),
        model=_env("GROQ_MODEL", "llama-3.3-70b-versatile"),
    )


@lru_cache
def get_stt_provider() -> SpeechToTextProvider:
    if _active_ai_provider() == "gemini":
        return GeminiSpeechToTextProvider(
            api_key=_env("GEMINI_API_KEY"),
            model=_env("STT_MODEL", "gemini-3.5-transcribe"),
        )
    return GroqSpeechToTextProvider(
        api_key=_env("GROQ_API_KEY"),
        model=_env("GROQ_STT_MODEL", "whisper-large-v3-turbo"),
    )


@lru_cache
def get_tts_provider() -> TextToSpeechProvider:
    if _active_ai_provider() == "gemini":
        return GeminiTextToSpeechProvider(
            api_key=_env("GEMINI_API_KEY"),
            model=_env("TTS_MODEL", "gemini-3.1-flash-tts-preview"),
        )
    return GroqTextToSpeechProvider(
        api_key=_env("GROQ_API_KEY"),
        model=_env("GROQ_TTS_MODEL", "canopylabs/orpheus-v1-english"),
    )


@app.post("/extract/correct", response_model=CorrectExtractionResult)
def extract_correct_language_features(payload: ExtractionRequest):
    return CorrectExtractor(get_correct_extraction_provider()).extract(payload)


@app.post("/extract/incorrect", response_model=IncorrectExtractionResult)
def extract_incorrect_language_features(payload: ExtractionRequest):
    return IncorrectExtractor(get_incorrect_extraction_provider()).extract(payload)


@app.post("/correct", response_model=CorrectionResult)
def correct_language(payload: CorrectionInput):
    return get_correction_module().correct(payload)


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
        correction = get_correction_module().correct(
            CorrectionInput(
                utterance=payload.user_text,
                dialogue_history=history,
            )
        )
        return EvaluateResponse(
            accepted=False,
            correction=correction.corrected_utterance,
            npc_response=correction.coach_response,
            response_speaker="coach",
            updated_scenario_state=payload.scenario_state,
            probability_percent=evaluation.probability_percent,
            evaluation_reason=evaluation.brief_reason,
        )

    profile = NPC_PROFILES.get(
        (payload.location, payload.npc_role),
        {
            "name": payload.npc_role.replace("_", " ").title(),
            "personality": "Friendly, patient, and concise",
        },
    )
    identity = NPCIdentity(
        id=f"{payload.location}_{payload.npc_role}",
        name=profile["name"],
        role=payload.npc_role,
        user_role="player",
        location=payload.location,
        personality=profile["personality"],
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
        response_speaker="npc",
        updated_scenario_state=payload.scenario_state,
        probability_percent=evaluation.probability_percent,
        evaluation_reason=evaluation.brief_reason,
    )


@app.post("/stt", response_model=STTResponse)
async def speech_to_text(
    audio: UploadFile,
    language_code: str | None = "en-US",
    custom_vocabulary: str | None = None,
):
    audio_bytes = await audio.read()
    max_bytes = int(os.getenv("STT_MAX_AUDIO_BYTES", str(10 * 1024 * 1024)))
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio file is empty")
    if len(audio_bytes) > max_bytes:
        raise HTTPException(status_code=413, detail="Audio file is too large")

    vocabulary = (
        [term.strip() for term in custom_vocabulary.split(",") if term.strip()]
        if custom_vocabulary
        else []
    )
    try:
        result = await run_in_threadpool(
            get_stt_provider().transcribe,
            audio_bytes,
            mime_type=audio.content_type or "application/octet-stream",
            language_codes=[language_code] if language_code else [],
            custom_vocabulary=vocabulary,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Speech transcription failed") from exc

    return STTResponse(
        text=result.text,
        language_code=result.language_code,
        mode="verbatim",
        model=result.model,
        latency_ms=result.latency_ms,
    )


@app.post(
    "/tts",
    response_class=Response,
    responses={200: {"content": {"audio/wav": {}}}},
)
def text_to_speech(payload: TTSRequest):
    try:
        result = get_tts_provider().synthesize(
            payload.text,
            voice=payload.voice,
            style=payload.style,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Speech synthesis failed") from exc

    return Response(
        content=result.audio,
        media_type=result.mime_type,
        headers={
            "Content-Disposition": 'inline; filename="speech.wav"',
            "X-Speech-Model": result.model,
            "X-Speech-Voice": result.voice,
            "X-Speech-Latency-Ms": str(result.latency_ms),
        },
    )
