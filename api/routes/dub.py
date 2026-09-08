"""
"Sahneyi Seslendir" (Dub the Scene) - TEK KISILIK Listen & Repeat modu.

TOEFL'in 2026 formatina eklenen "Listen and Repeat" gorevinden ilham alir:
oyuncu bir cumleyi (repligi) bir kez dinler, hemen ardindan birebir tekrar
eder ve bir yapay zeka bunu degerlendirir. Bu ozellik ONCE COK OYUNCULU
olarak yapildi (oda kur/katil, WebSocket ile sira yonetimi, ngrok ile
farkli aglardan katilim) - proje kararlastirdi ki su an icin uygulama TEK
KISILIK ilerlesin, coklu oyuncu ileride ayrica eklenecek. Bu yuzden bu
dosyada ROOM/WebSocket/oda-kodu YOK; sadece script tanimlari + tek satirlik
skorlama var. (Coklu oyuncu suruumu git gecmisindeki "listenandrepeat"
dalinin ilk halinde duruyor, referans gerekirse oradan bakilabilir.)

Mimari kararlar:
- KALICI VERITABANI / SUNUCU DURUMU YOK. Script'ler asagida SCRIPTS
  dict'inde sabit tanimli; skorlama tek bir istek/cevap uzerinden gecici -
  sunucu STT sonucunu donduruyor, hicbir yerde saklamiyor.
- VARSAYILAN OLARAK GERCEK VIDEO/DIZI KLIBI KULLANILMIYOR (telif riski -
  bkz. SCRIPTS["sample-cafe"]): repligin sesi mevcut /api/speech/tts ucuyla
  O AN sentezleniyor. ISTISNA: bir script GERCEKTEN dogrulanmis kamu mali
  bir kaynaga dayaniyorsa (bkz. SCRIPTS["charade-44"] - Charade, 1963,
  ABD'de bildirim eksikligi nedeniyle kamu mali), DubScript.audio_url ile
  o kaynaktan cikarilmis SADECE SES dosyasina (video degil - TOEFL
  Listen&Repeat formati zaten sadece ses) isaret edilebilir. Repliklerin
  start_seconds/end_seconds'i bu tek ses dosyasi icindeki araligi verir;
  FRONTEND bu araligi <audio>.currentTime ile secip calar - SUNUCU HICBIR
  SEKILDE KLIP KESMIYOR/DONUSTURMUYOR (ffmpeg yok), sadece Vite'in static
  dosya sunumuyla oldugu gibi servis ediliyor.
- OYUNCU BIR KARAKTER SECER (bkz. game/src/scenes/DubScene.ts): secilen
  karakterin repliklerinde "dinle -> tekrar et -> kaydet -> puanla" akisi
  calisir; SECILMEYEN diger karakter(ler)in repliklerinde orijinal ses
  (klip varsa klipten, yoksa TTS ile) oldugu gibi, tam ses seviyesinde
  calinir - boylece sahnenin butunlugu bozulmadan tek oyuncu "bos kalan"
  role'u seslendirir. Butun script (tum repliklerin metni) tek seferde
  /scripts ucuyla frontend'e gonderiliyor - artik gizlenecek bir "sirasi
  gelmeyen oyuncu" olmadigi icin (tek kisilik akis) bunun bir sakincasi
  yok, aksine oyuncunun sahnenin tamamini onceden/sirayla takip etmesini
  kolaylastiriyor.
"""

import difflib
import logging

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from services.ai_client import transcribe_audio

router = APIRouter()
logger = logging.getLogger(__name__)

# api/routes/speech.py'deki MAX_AUDIO_BYTES ile ayni sinir.
MAX_RECORDING_BYTES = 10 * 1024 * 1024


# ---------------------------------------------------------------------------
# Script tanimlari
# ---------------------------------------------------------------------------


class ScriptLine(BaseModel):
    id: int
    speaker: str
    text: str
    # Gemini TTS'in "prebuilt voice" adlari - NPC tarafinda "Kore" zaten
    # kullaniliyordu (bkz. ai/modules/speech.py). Farkli karakterlere farkli
    # ses vermek icin ikinci bir ornek olarak "Puck" eklendi; gercek
    # kullanimdan once Gemini TTS voice listesiyle teyit edin. Script'in
    # audio_url'i VARSA bu alan hic kullanilmiyor (bkz. DubScript.audio_url).
    voice: str = "Kore"
    # Script bir ses klibine bagliysa (bkz. DubScript.audio_url), bu
    # repligin o TEK ses dosyasi icindeki baslangic/bitis saniyesi -
    # boylece frontend repligi TTS yerine GERCEK klipten oynatir. None ise
    # (ornegin "sample-cafe" gibi TTS-tabanli scriptlerde) yok sayilir.
    start_seconds: float | None = None
    end_seconds: float | None = None


class DubScript(BaseModel):
    id: str
    title: str
    characters: list[str]
    lines: list[ScriptLine]
    # Gercek (dogrulanmis kamu mali) bir kaynaktan cikarilmis SADECE SES
    # dosyasina (video degil) - oyunun kendi statik dosya sunumundan
    # (game/public/... -> Vite) servis edilen GORECELI yol - orn.
    # "/assets/dub/charade-44.m4a". ONEMLI: bu yol API'nin degil, OYUNUN
    # (game) origin'inden servis edilir; API_BASE_URL ile birlestirilmemeli.
    # None ise (ornegin "sample-cafe") repliklerin sesi TTS ile o an
    # sentezlenir (bkz. dosya basi mimari notu).
    audio_url: str | None = None


SCRIPTS: dict[str, DubScript] = {
    "sample-cafe": DubScript(
        id="sample-cafe",
        title="At the Cafe (sample)",
        characters=["A", "B"],
        lines=[
            ScriptLine(id=1, speaker="A", text="Good morning! What can I get you today?", voice="Kore"),
            ScriptLine(id=2, speaker="B", text="I'd like a large coffee, please.", voice="Puck"),
            ScriptLine(id=3, speaker="A", text="Anything else with that?", voice="Kore"),
            ScriptLine(id=4, speaker="B", text="No, thank you. That's all.", voice="Puck"),
        ],
    ),
    # Charade (1963) - ABD'de kamu mali oldugu bu sohbette ayrica arastirilip
    # dogrulanmis bir film (bkz. proje notlari: bildirim eksikligi nedeniyle
    # PD). Kullanicinin filmin ~44. dakikasindan aldigi ~53 saniyelik klipten
    # SADECE SES DOSYASI cikarildi (ffmpeg ile "-vn -acodec copy", yeniden
    # kodlama yapilmadi - orijinal ses kalitesi korunuyor, 1.2MB) ve
    # game/public/assets/dub/charade-44.m4a olarak eklendi; video izlenmiyor,
    # sadece dinleniyor (TOEFL formati zaten sadece ses). Kullanicinin
    # cikardigi transkript kullaniliyor. UYARI: transkriptte kimin hangi
    # repligi soyledigi acikca belirtilmemisti - konusma akisindan
    # (isimler/hitaplar: "Mr. Bartholomew", "Mrs. Lampert", "Carson Dyle")
    # yola cikarak REGGIE ve BARTHOLOMEW olarak paylastirdik. Bu bir TAHMIN -
    # klibi dinleyip yanlis atanan bir replik gorursen sadece o satirin
    # `speaker` degerini degistirmen yeterli, baska hicbir yeri etkilemez.
    "charade-44": DubScript(
        id="charade-44",
        title="Charade (1963) - meat locker scene",
        characters=["Reggie", "Bartholomew"],
        audio_url="/assets/dub/charade-44.m4a",
        lines=[
            ScriptLine(id=1, speaker="Reggie", text="Follow that taxi.", start_seconds=1, end_seconds=8),
            ScriptLine(id=2, speaker="Bartholomew", text="Well, you followed?", start_seconds=8, end_seconds=9),
            ScriptLine(
                id=3,
                speaker="Reggie",
                text="Yes, by Dyle, but I lost him.",
                start_seconds=9,
                end_seconds=12,
            ),
            ScriptLine(
                id=4,
                speaker="Bartholomew",
                text="I'm beginning to think women make the best spies.",
                start_seconds=12,
                end_seconds=14,
            ),
            ScriptLine(id=5, speaker="Bartholomew", text="Agents.", start_seconds=14, end_seconds=16),
            ScriptLine(
                id=6,
                speaker="Reggie",
                text="He has a gun, Mr. Bartholomew.",
                start_seconds=16,
                end_seconds=18,
            ),
            ScriptLine(id=7, speaker="Bartholomew", text="No.", start_seconds=18, end_seconds=19),
            ScriptLine(id=8, speaker="Reggie", text="But I saw it.", start_seconds=19, end_seconds=20),
            ScriptLine(
                id=9,
                speaker="Bartholomew",
                text="No, that's not Carson Dyle.",
                start_seconds=20,
                end_seconds=23,
            ),
            ScriptLine(id=10, speaker="Reggie", text="Carson?", start_seconds=23, end_seconds=24),
            ScriptLine(
                id=11,
                speaker="Bartholomew",
                text="There's only one Dyle connected with this affair, Mrs. Lampert, that's Carson Dyle.",
                start_seconds=24,
                end_seconds=28,
            ),
            ScriptLine(
                id=12,
                speaker="Reggie",
                text="You mean you've known about him all along?",
                start_seconds=28,
                end_seconds=32,
            ),
            ScriptLine(
                id=13,
                speaker="Bartholomew",
                text="It's enough to make you a vegetarian, isn't it?",
                start_seconds=32,
                end_seconds=36,
            ),
            ScriptLine(
                id=14,
                speaker="Reggie",
                text="It's just lucky that I'm not hanging next to one of those things right now.",
                start_seconds=36,
                end_seconds=41,
            ),
            ScriptLine(
                id=15,
                speaker="Reggie",
                text="Why didn't you tell me you knew about Dyle?",
                start_seconds=41,
                end_seconds=43,
            ),
            ScriptLine(
                id=16,
                speaker="Bartholomew",
                text="I didn't see any point. Dyle's dead.",
                start_seconds=43,
                end_seconds=48,
            ),
            ScriptLine(
                id=17,
                speaker="Reggie",
                text="Mr. Bartholomew, what is all this about?",
                start_seconds=48,
                end_seconds=None,  # klip burada bitiyor (~53sn) - dogal sonuna kadar oynasin
            ),
        ],
    ),
}


@router.get("/scripts", response_model=list[DubScript])
def list_scripts() -> list[DubScript]:
    return list(SCRIPTS.values())


# ---------------------------------------------------------------------------
# Replik kaydini degerlendirme (STT + kelime kelime karsilastirma)
# ---------------------------------------------------------------------------


class WordVerdict(BaseModel):
    word: str
    correct: bool


class ScoreLineResponse(BaseModel):
    transcript: str
    expected: str
    words: list[WordVerdict]
    accuracy_percent: float


def _normalize_word(word: str) -> str:
    return "".join(ch for ch in word.lower() if ch.isalnum())


def _score_transcript(*, expected: str, actual: str) -> tuple[list[WordVerdict], float]:
    """
    Beklenen replik ile kullanicinin soyledigi (STT'den gelen) metni kelime
    kelime karsilastirir. difflib.SequenceMatcher iki kelime dizisi
    arasindaki en uzun ortak alt diziyi buldugu icin, kullanici bir kelime
    atlarsa/eklerse geri kalan kelimelerin hizasi index kaymasiyla
    bozulmaz - basit bir `expected[i] == actual[i]` karsilastirmasindan
    daha dogru sonuc verir. Noktalama/buyuk-kucuk harf farklari (STT bunlari
    tutarli vermeyebilir) _normalize_word ile yok sayilir.
    """
    expected_words = expected.split()
    actual_norm = [_normalize_word(w) for w in actual.split()]
    expected_norm = [_normalize_word(w) for w in expected_words]

    matcher = difflib.SequenceMatcher(None, expected_norm, actual_norm, autojunk=False)
    verdicts = [WordVerdict(word=w, correct=False) for w in expected_words]
    for tag, i1, i2, _j1, _j2 in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(i2 - i1):
                verdicts[i1 + offset] = WordVerdict(word=expected_words[i1 + offset], correct=True)

    correct_count = sum(1 for v in verdicts if v.correct)
    accuracy = round(100 * correct_count / len(verdicts), 1) if verdicts else 0.0
    return verdicts, accuracy


@router.post("/scripts/{script_id}/lines/{line_id}/score", response_model=ScoreLineResponse)
async def score_line(
    script_id: str,
    line_id: int,
    audio: UploadFile = File(...),
) -> ScoreLineResponse:
    script = SCRIPTS.get(script_id)
    if script is None:
        raise HTTPException(status_code=404, detail=f"Unknown script_id: {script_id}")
    line = next((l for l in script.lines if l.id == line_id), None)
    if line is None:
        raise HTTPException(status_code=404, detail="Line not found")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio recording is empty.")
    if len(audio_bytes) > MAX_RECORDING_BYTES:
        raise HTTPException(status_code=413, detail="Audio recording is too long.")

    # api/routes/speech.py'deki /stt ucuyla ayni hata donusumu (bkz. orada):
    # ai servisi cokerse/yavas cevap verirse burada da CORS'u maskeleyen
    # genel 500 yerine temiz bir 502/503 dondurulsun.
    try:
        stt_result = await transcribe_audio(
            audio_bytes,
            content_type=audio.content_type or "audio/webm",
            language_code="en-US",
        )
    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=502, detail=f"Speech-to-text service error: {error}"
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=503, detail="Speech-to-text service is unavailable."
        ) from error

    words, accuracy = _score_transcript(expected=line.text, actual=stt_result.text)

    return ScoreLineResponse(
        transcript=stt_result.text,
        expected=line.text,
        words=words,
        accuracy_percent=accuracy,
    )
