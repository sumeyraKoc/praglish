import os
from functools import lru_cache

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from dotenv import load_dotenv

from modules import (
    CorrectionModule,
    CorrectExtractor,
    GeminiCorrectionProvider,
    GeminiCorrectExtractionProvider,
    GeminiIncorrectExtractionProvider,
    GeminiPlausibilityEstimator,
    GeminiSpeechToTextProvider,
    GeminiTextToSpeechProvider,
    GeminiTextGenerator,
    IncorrectExtractor,
    LanguageEvaluator,
    NpcModule,
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
    return {"status": "ok", "service": "ai"}


@lru_cache
def get_correct_extraction_provider() -> GeminiCorrectExtractionProvider:
    return GeminiCorrectExtractionProvider(
        api_key=os.getenv("GEMINI_API_KEY", ""),
        model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
    )


@lru_cache
def get_incorrect_extraction_provider() -> GeminiIncorrectExtractionProvider:
    return GeminiIncorrectExtractionProvider(
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
def get_correction_module() -> CorrectionModule:
    return CorrectionModule(
        GeminiCorrectionProvider(
            api_key=os.getenv("GEMINI_API_KEY", ""),
            model=os.getenv(
                "CORRECTION_MODEL",
                os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
            ),
        )
    )


@lru_cache
def get_npc_generator() -> GeminiTextGenerator:
    return GeminiTextGenerator(
        api_key=os.getenv("GEMINI_API_KEY", ""),
        model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
    )


@lru_cache
def get_stt_provider() -> GeminiSpeechToTextProvider:
    return GeminiSpeechToTextProvider(
        api_key=os.getenv("GEMINI_API_KEY", ""),
        model=os.getenv("STT_MODEL", "gemini-3.5-transcribe"),
    )


@lru_cache
def get_tts_provider() -> GeminiTextToSpeechProvider:
    return GeminiTextToSpeechProvider(
        api_key=os.getenv("GEMINI_API_KEY", ""),
        model=os.getenv("TTS_MODEL", "gemini-3.1-flash-tts-preview"),
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
