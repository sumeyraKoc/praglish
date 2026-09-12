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
    if USE_MOCK_AI:
        template = MOCK_RESPONSES.get(payload.location)
        if template is None:



            return EvaluateResponse(
                accepted=False,
                correction=None,
                npc_response=(
                    f"[mock] No response is defined for '{payload.location}' yet. "
                    "Add one to MOCK_RESPONSES in api/services/ai_client.py."
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

    async with httpx.AsyncClient(timeout=AI_SPEECH_TIMEOUT_SECONDS) as client:
        files = {"audio": ("recording", audio_bytes, content_type)}
        params: dict[str, str] = {}
        if language_code:
            params["language_code"] = language_code
        response = await client.post(f"{AI_SERVICE_URL}/stt", files=files, params=params)
        response.raise_for_status()
        return STTResponse(**response.json())


async def synthesize_speech(payload: TTSRequest) -> tuple[bytes, dict[str, str]]:

    async with httpx.AsyncClient(timeout=AI_SPEECH_TIMEOUT_SECONDS) as client:
        response = await client.post(f"{AI_SERVICE_URL}/tts", json=payload.model_dump())
        response.raise_for_status()
        speech_headers = {
            key: value
            for key, value in response.headers.items()
            if key.lower().startswith("x-speech-")
        }
        return response.content, speech_headers
