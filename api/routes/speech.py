"""
Oyunun konusma pratigi ozelligi icin STT/TTS proxy uclari.

Gercek transkripsiyon/sentezi ai servisi (Gemini) yapiyor - burada sadece
oyunun tek konustugu servis olan api'yi (port 8000) tek base URL olarak
tutmak icin ai_client.py uzerinden ai servisine (port 8001) yonlendiriyoruz.
Boylece ai/main.py'a ayrica CORS eklemeye gerek kalmiyor ve oyun tarafi
(PraglishApiClient.ts) ikinci bir servis adresi bilmek zorunda kalmiyor.
"""

import httpx
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import Response

from services.ai_client import synthesize_speech, transcribe_audio
from shared.schemas import STTResponse, TTSRequest

router = APIRouter()

# ai servisindeki varsayilan STT_MAX_AUDIO_BYTES ile ayni - buyuk bir kaydi ai
# servisine hic gondermeden burada reddediyoruz.
MAX_AUDIO_BYTES = 10 * 1024 * 1024


@router.post("/stt", response_model=STTResponse)
async def speech_to_text(
    audio: UploadFile = File(...),
    language_code: str | None = Query(default="en-US"),
) -> STTResponse:
    """
    Oyuncunun mikrofon kaydini (tarayicinin MediaRecorder'i genelde
    audio/webm uretir) yazili metne cevirir. Gemini "verbatim" modda
    calisir, yani dilbilgisi hatalarini DUZELTMEZ - projenin dil
    degerlendirme mekanigi bir sonraki adimda (/api/session/{id}/turn)
    gercek/hatali metin uzerinden calismali.
    """

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
    """
    NPC'nin metin cevabini sesli soylemesi icin ai servisine proxy. Ham
    24kHz mono WAV bayt dizisini oldugu gibi donduruyoruz; oyun tarafinda
    ek bir donusum gerekmiyor (tarayicinin Audio API'si dogrudan calar).
    """

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
