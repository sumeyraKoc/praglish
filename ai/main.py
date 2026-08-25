from fastapi import FastAPI, UploadFile

from shared.schemas import (
    EvaluateRequest,
    EvaluateResponse,
    STTResponse,
    TTSRequest,
    TTSResponse,
)

app = FastAPI(title="English World - AI Service")


@app.get("/health")
def health():
    return {"status": "ok", "service": "ai"}


@app.post("/evaluate-and-respond", response_model=EvaluateResponse)
def evaluate_and_respond(payload: EvaluateRequest):
    """
    TODO(Sumeyra):
    - cli.py icindeki moduler speech -> evaluator -> correction/NPC akisini bu
      endpoint'e bagla
    - NPCIdentity ve yalnizca kabul edilmis dialogue history ile NpcModule'u olustur
    - cikti EvaluateResponse semasina birebir uymali
    """
    return EvaluateResponse(
        accepted=False,
        correction="Could I get a coffee, please?",
        npc_response="Sure... do you mean 'Could I get a coffee, please?'",
        updated_scenario_state=payload.scenario_state,
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
