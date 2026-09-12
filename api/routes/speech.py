
import httpx
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import Response

from services.ai_client import synthesize_speech, transcribe_audio
from shared.schemas import STTResponse, TTSRequest

router = APIRouter()



MAX_AUDIO_BYTES = 10 * 1024 * 1024


@router.post("/stt", response_model=STTResponse)
async def speech_to_text(
    audio: UploadFile = File(...),
    language_code: str | None = Query(default="en-US"),
) -> STTResponse:

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio recording is empty.")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio recording is too long.")

    try:
        return await transcribe_audio(
            audio_bytes,
            content_type=audio.content_type or "audio/webm",
            language_code=language_code,
        )
    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=502, detail=f"Speech-to-text service error: {error}"
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=503, detail="Speech-to-text service is unavailable."
        ) from error


@router.post("/tts")
async def text_to_speech(payload: TTSRequest) -> Response:

    try:
        audio_bytes, extra_headers = await synthesize_speech(payload)
    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=502, detail=f"Text-to-speech service error: {error}"
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=503, detail="Text-to-speech service is unavailable."
        ) from error

    return Response(content=audio_bytes, media_type="audio/wav", headers=extra_headers)
