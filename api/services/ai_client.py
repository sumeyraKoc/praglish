import os
from typing import Literal

import httpx

from shared.schemas import (
    CorrectExtractionResult,
    EvaluateRequest,
    EvaluateResponse,
    ExtractionRequest,
    ExtractionResult,
    IncorrectExtractionResult,
    STTResponse,
    TTSRequest,
)

AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai:8001")
USE_MOCK_AI = os.getenv("USE_MOCK_AI", "true").lower() == "true"
AI_EVALUATION_TIMEOUT_SECONDS = float(
    os.getenv("AI_EVALUATION_TIMEOUT_SECONDS", "120")
)
AI_EXTRACTION_TIMEOUT_SECONDS = float(
    os.getenv("AI_EXTRACTION_TIMEOUT_SECONDS", "120")
)
AI_SPEECH_TIMEOUT_SECONDS = float(os.getenv("AI_SPEECH_TIMEOUT_SECONDS", "45"))

# USE_MOCK_AI=true iken gercek Gemini'ye gitmeden sabit bir cevap donuyoruz.
# Oyunda gercekten var olan (asset+scene'i olan) odalar icin dogru bir mock
# tanimli olmali - aksi halde her lokasyon icin ayni "kahve" cevabi donerdi,
# bu da bakery/library testlerini yanlis yonlendirirdi.
MOCK_RESPONSES: dict[str, EvaluateResponse] = {
    "bakery": EvaluateResponse(
        accepted=False,
        correction="Could I get a croissant, please?",
        npc_response="Sure... do you mean 'Could I get a croissant, please?'",
        response_speaker="coach",
        updated_scenario_state={},
    ),
    "library": EvaluateResponse(
        accepted=False,
        correction="Could you help me find a mystery novel, please?",
        npc_response=(
            "Of course. Try saying, "
            "'Could you help me find a mystery novel, please?'"
        ),
        response_speaker="coach",
        updated_scenario_state={},
    ),
}


async def evaluate_and_respond(payload: EvaluateRequest) -> EvaluateResponse:
    """
    USE_MOCK_AI=true iken Sumeyra'nin ai servisini beklemeden
    Zehra sabit/sahte bir cevapla api tarafini gelistirebilir.
    Sumeyra ai servisini gercek Gemini entegrasyonuyla doldurdukca
    USE_MOCK_AI=false yapip gercek servise gecilir.
    """
    if USE_MOCK_AI:
        template = MOCK_RESPONSES.get(payload.location)
        if template is None:
            # Henuz oyunda karsiligi olmayan bir lokasyon (orn. cafe/hospital/school -
            # bkz. api/game_data/scenarios, "status": "planned_no_assets_yet").
            # Yanlis/alakasiz bir mock cevap donmek yerine bunu acikca soyluyoruz.
            return EvaluateResponse(
                accepted=False,
                correction=None,
                npc_response=(
                    f"[mock] '{payload.location}' icin henuz bir mock cevap "
                    "tanimlanmadi - api/services/ai_client.py > MOCK_RESPONSES'a ekleyin."
                ),
                response_speaker="coach",
                updated_scenario_state=payload.scenario_state,
            )
        return template.model_copy(update={"updated_scenario_state": payload.scenario_state})

    async with httpx.AsyncClient(timeout=AI_EVALUATION_TIMEOUT_SECONDS) as client:
        response = await client.post(
            f"{AI_SERVICE_URL}/evaluate-and-respond",
            json=payload.model_dump(),
        )
        response.raise_for_status()
        return EvaluateResponse(**response.json())


async def extract_utterance(
    payload: ExtractionRequest,
    outcome: Literal["correct", "incorrect"],
) -> ExtractionResult | None:
    """Return None in mock mode so fake evaluations do not pollute analytics."""

    if USE_MOCK_AI:
        return None

    async with httpx.AsyncClient(timeout=AI_EXTRACTION_TIMEOUT_SECONDS) as client:
        response = await client.post(
            f"{AI_SERVICE_URL}/extract/{outcome}",
            json=payload.model_dump(),
        )
        response.raise_for_status()
        result_type = (
            CorrectExtractionResult
            if outcome == "correct"
            else IncorrectExtractionResult
        )
        return result_type(**response.json())


async def transcribe_audio(
    audio_bytes: bytes,
    content_type: str,
    language_code: str | None = None,
) -> STTResponse:
    """
    Oyuncunun mikrofon kaydini ai servisindeki gercek Gemini STT saglayicisina
    iletir. Diger iki fonksiyondan farkli olarak burada USE_MOCK_AI kisayolu
    YOK: "sahte bir transkript" konusma pratiginde hicbir sey ogretmez, bu
    yuzden ses -> metin donusumu her zaman gercek ai servisine gider (ai
    container ayakta degilse asagidaki httpx hatasi routes/speech.py'de
    503'e cevriliyor).
    """

    async with httpx.AsyncClient(timeout=AI_SPEECH_TIMEOUT_SECONDS) as client:
        files = {"audio": ("recording", audio_bytes, content_type)}
        params: dict[str, str] = {}
        if language_code:
            params["language_code"] = language_code
        response = await client.post(f"{AI_SERVICE_URL}/stt", files=files, params=params)
        response.raise_for_status()
        return STTResponse(**response.json())


async def synthesize_speech(payload: TTSRequest) -> tuple[bytes, dict[str, str]]:
    """
    NPC'nin metin cevabini sesli soylemesi icin ai servisindeki gercek Gemini
    TTS saglayicisina proxy yapar. Ham WAV bayt dizisini ve birkac bilgi
    header'ini (X-Speech-Model/Voice/Latency-Ms) oldugu gibi geri donduruyoruz
    ki api katmani bunlari degistirmeden oyuna aktarabilsin.
    """

    async with httpx.AsyncClient(timeout=AI_SPEECH_TIMEOUT_SECONDS) as client:
        response = await client.post(f"{AI_SERVICE_URL}/tts", json=payload.model_dump())
        response.raise_for_status()
        speech_headers = {
            key: value
            for key, value in response.headers.items()
            if key.lower().startswith("x-speech-")
        }
        return response.content, speech_headers
