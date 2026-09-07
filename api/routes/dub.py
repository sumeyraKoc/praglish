"""
"Sahneyi Seslendir" (Dub the Scene) - cok oyunculu Listen & Repeat modu.

TOEFL'in 2026 formatina eklenen "Listen and Repeat" gorevinden ilham alir:
oyuncu bir cumleyi (repligi) bir kez dinler, hemen ardindan birebir tekrar
eder ve bir yapay zeka bunu degerlendirir. Burada bunu, birden fazla
oyuncunun ayni kisa sahnede farkli karakterleri seslendirdigi bir oda
oyununa donusturduk.

Mimari kararlar (sohbette tartisildi, ozetle):
- KALICI VERITABANI YOK. Odalar sadece bu process'in bellegindeki ROOMS
  dict'inde tutulur; oda bosalinca ya da sunucu yeniden baslayinca
  kaybolur. Bilincli bir tercih - "arkadaslarla 5 dakikalik oyun" kullanim
  senaryosu icin DB agirligi/karmasikligi gereksiz. UYARI: bu yuzden
  birden fazla worker/replica ile calistirmayin (`uvicorn --workers N`,
  N>1) - her worker'in kendi ROOMS'u olur, oyuncular ayni odada bulusamaz.
  Ayni nedenle api/main.py `--reload` ile calisirken kod dosyasina
  dokunmak (otomatik reload'i tetiklemek) o an acik olan tum odalari
  sifirlar.
- VARSAYILAN OLARAK GERCEK VIDEO/DIZI KLIBI KULLANILMIYOR (telif riski -
  bkz. sohbet: pek cok "kamu mali" zannedilen liste dogrulanamadi). Bunun
  yerine repligin sesi, zaten var olan /api/speech/tts ucuyla
  (services/ai_client.py -> synthesize_speech) O AN sentezleniyor - yani
  "sahne", TTS + oyunun kendi (Phaser) karakterleriyle FRONTEND'TE
  canlandiriliyor (bkz. SCRIPTS["sample-cafe"]).
  ISTISNA: bir script GERCEKTEN dogrulanmis kamu mali bir kaynaga
  dayaniyorsa (bkz. SCRIPTS["charade-44"] - Charade, 1963, ABD'de bildirim
  eksikligi nedeniyle kamu mali), DubScript.audio_url ile o kaynaktan
  cikarilmis SADECE SES dosyasina (video degil - gorsel hic kullanilmiyor,
  TOEFL Listen&Repeat formati zaten sadece ses) isaret edilebilir.
  Repliklerin start_seconds/end_seconds'i bu tek ses dosyasi icindeki
  araligi verir; FRONTEND bu araligi <audio>.currentTime ile secip calar -
  SUNUCU HICBIR SEKILDE KLIP KESMIYOR/DONUSTURMUYOR (ffmpeg yok), sadece
  Vite'in static dosya sunumuyla oldugu gibi servis ediliyor. Bu, "sunucuda
  video/ses render etme" ilkesini (asagida) gercek klip icin de korur.
  Bu dosya hangi replikin ne zaman/kime gosterilecegini yonetiyor;
  TTS/STT'nin kendisi zaten var olan /api/speech uclari uzerinden yapiliyor.
- "SADECE O KARAKTERI SECEN KISI DUYAR": sunucu sirasi gelen replikin
  METNINI SADECE o an sirasi olan oyuncuya yolluyor (bkz. _broadcast_turn).
  Diger oyunculara sadece "hangi karakterin sirasi geldi" bilgisi gidiyor,
  repligin metni bile gitmiyor - boylece o oyuncular TTS'i hic cagirmiyor,
  sesi indirmiyor bile. Bu, "herkese gonder ama frontend'te sessize al"
  yontemine gore hem daha basit hem daha sizdirmaz.
- SUNUCUDA VIDEO/SES RENDER/BIRLESTIRME YOK (bkz. sohbet: bu bir demoyu
  kolayca kilitler). Kaydedilen ses dosyalari da oda kapaninca silinecek
  sekilde SADECE BELLEKTE tutuluyor; "sahneyi izle" asamasinda her
  istemci, ilgili replik icin /rooms/{code}/lines/{id}/audio'dan o klibi
  cekip KENDI TARAYICISINDA, sessiz oynayan orijinal sahnenin uzerine
  zamanlayarak calar - sunucu hicbir zaman video/ses birlestirmiyor.

Ornek script (SCRIPTS["sample-cafe"]) mekanizmayi uctan uca test edebilmeniz
icin yazdigimiz KISA VE OZGUN (telif riski olmayan) bir diyalog - gercek
icerik (dogrulanmis kamu mali bir klipten alinti ya da kendi yazdiginiz
baska bir sahne) hazir oldugunda SCRIPTS dict'ine yeni bir girdi eklemeniz
yeterli, geri kalan mekanizma degismeden calisir.
"""

import difflib
import logging
import random
import string
import time
from dataclasses import dataclass, field
from typing import Literal

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from pydantic import BaseModel

from services.ai_client import transcribe_audio

router = APIRouter()
logger = logging.getLogger(__name__)

ROOM_CODE_LENGTH = 4
ROOM_CODE_ALPHABET = string.ascii_uppercase + string.digits
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
    # boylece "sirasi gelen oyuncu" repligi TTS yerine GERCEK klipten
    # dinler. None ise (ornegin "sample-cafe" gibi TTS-tabanli
    # scriptlerde) yok sayilir.
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
    # (game) origin'inden servis edilir; DubApiClient.lineAudioUrl gibi
    # API_BASE_URL ile birlestirilmemeli. None ise (ornegin "sample-cafe")
    # repliklerin sesi TTS ile o an sentezlenir (bkz. dosya basi mimari notu).
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
# Oda durumu (bellekte, veritabani yok - bkz. dosya basi aciklama)
# ---------------------------------------------------------------------------


@dataclass
class Player:
    websocket: WebSocket
    name: str
    character: str


@dataclass
class RecordedLine:
    line_id: int
    speaker: str
    player_name: str
    transcript: str
    expected: str
    accuracy_percent: float
    words: list[dict]
    audio_bytes: bytes
    content_type: str


@dataclass
class Room:
    code: str
    script: DubScript
    host_name: str
    players: dict[str, Player] = field(default_factory=dict)  # key: oyuncu adi
    state: Literal["lobby", "playing", "finished"] = "lobby"
    current_line_index: int = -1
    recordings: dict[int, RecordedLine] = field(default_factory=dict)  # key: line_id
    created_at: float = field(default_factory=time.time)


ROOMS: dict[str, Room] = {}


def _generate_unique_room_code() -> str:
    for _ in range(50):
        code = "".join(random.choices(ROOM_CODE_ALPHABET, k=ROOM_CODE_LENGTH))
        if code not in ROOMS:
            return code
    raise HTTPException(status_code=503, detail="Could not allocate a room code, please try again.")


class CreateRoomRequest(BaseModel):
    host_name: str
    script_id: str = "sample-cafe"


class CreateRoomResponse(BaseModel):
    room_code: str
    script: DubScript


@router.post("/rooms", response_model=CreateRoomResponse)
def create_room(payload: CreateRoomRequest) -> CreateRoomResponse:
    host_name = payload.host_name.strip()[:24]
    if not host_name:
        raise HTTPException(status_code=400, detail="host_name is required")

    script = SCRIPTS.get(payload.script_id)
    if script is None:
        raise HTTPException(status_code=404, detail=f"Unknown script_id: {payload.script_id}")

    code = _generate_unique_room_code()
    ROOMS[code] = Room(code=code, script=script, host_name=host_name)
    logger.info("Dub room %s created by %s (script=%s)", code, host_name, script.id)
    return CreateRoomResponse(room_code=code, script=script)


class RoomInfoResponse(BaseModel):
    room_code: str
    script_id: str
    script_title: str
    characters: list[str]
    taken_characters: list[str]
    state: Literal["lobby", "playing", "finished"]
    host_name: str


@router.get("/rooms/{room_code}", response_model=RoomInfoResponse)
def get_room_info(room_code: str) -> RoomInfoResponse:
    """
    Host'un ODA KURARKEN aldigi script bilgisini (bkz. create_room), sonradan
    KOD ILE KATILAN oyuncular icin de saglar. Bu ucun eklenme sebebi gercek
    bir hata: frontend eskiden "hangi karakterler var" sorusuna cevabi
    /api/dub/scripts listesinin ILK elemanindan tahmin ediyordu - birden
    fazla script eklenince (SCRIPTS["charade-44"]) bu tahmin yanlis
    cikiyordu (host "Charade" scriptiyle oda acsa bile katilan oyuncuya hep
    ilk scriptin - "sample-cafe" - "A"/"B" karakterleri gosteriliyordu, secim
    yapinca da "invalid character" hatasi aliniyordu). Repliklerin metnini
    (lines) BILEREK DONDURMUYORUZ - katilan oyuncu sahneyi sirasi gelmeden
    once gormemeli (bkz. dosya basi "sadece sirasi gelen duyar/gorur"
    ilkesi); sadece hangi karakterlerin ve hangilerinin zaten dolu oldugunu
    bilmesi yeterli.
    """
    room = ROOMS.get(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return RoomInfoResponse(
        room_code=room.code,
        script_id=room.script.id,
        script_title=room.script.title,
        characters=room.script.characters,
        taken_characters=[p.character for p in room.players.values()],
        state=room.state,
        host_name=room.host_name,
    )


# ---------------------------------------------------------------------------
# WebSocket - oda ici gerçek zamanlı durum/sıra yönetimi
# ---------------------------------------------------------------------------


async def _send_safe(websocket: WebSocket, payload: dict) -> None:
    try:
        await websocket.send_json(payload)
    except Exception:  # zaten kopmus bir socket'e yazmis olabiliriz
        logger.debug("Could not deliver a dub-room message, socket likely closed.")


async def _broadcast(room: Room, payload: dict) -> None:
    for p in list(room.players.values()):
        await _send_safe(p.websocket, payload)


async def _broadcast_room_state(room: Room) -> None:
    await _broadcast(
        room,
        {
            "type": "room_state",
            "state": room.state,
            "host_name": room.host_name,
            "characters": room.script.characters,
            "players": [{"name": p.name, "character": p.character} for p in room.players.values()],
        },
    )


async def _broadcast_turn(room: Room) -> None:
    line = room.script.lines[room.current_line_index]
    base = {
        "type": "turn",
        "line_index": room.current_line_index,
        "total_lines": len(room.script.lines),
        "line_id": line.id,
        "speaker": line.speaker,
    }
    for p in room.players.values():
        payload = dict(base)
        payload["for_you"] = p.character == line.speaker
        if payload["for_you"]:
            # Repligin METNI (ve TTS sesi/klip zaman araligi icin) SADECE
            # sirasi gelen oyuncuya gidiyor - digerleri bu alanlari hic
            # gormuyor.
            payload["text"] = line.text
            payload["voice"] = line.voice
            if room.script.audio_url is not None:
                # Gercek klibe dayanan script (bkz. SCRIPTS["charade-44"]):
                # frontend TTS yerine bu ses dosyasinin ilgili saniye
                # araligini calacak.
                payload["audio_url"] = room.script.audio_url
                payload["start_seconds"] = line.start_seconds
                payload["end_seconds"] = line.end_seconds
        await _send_safe(p.websocket, payload)


async def _broadcast_finished(room: Room) -> None:
    summary = [
        {
            "line_id": rec.line_id,
            "speaker": rec.speaker,
            "player_name": rec.player_name,
            "expected": rec.expected,
            "transcript": rec.transcript,
            "accuracy_percent": rec.accuracy_percent,
            "words": rec.words,
        }
        for rec in sorted(room.recordings.values(), key=lambda r: r.line_id)
    ]
    await _broadcast(room, {"type": "finished", "summary": summary})


@router.websocket("/rooms/{room_code}/ws")
async def room_socket(websocket: WebSocket, room_code: str) -> None:
    room = ROOMS.get(room_code)
    if room is None:
        await websocket.close(code=4404, reason="Room not found")
        return

    await websocket.accept()
    player: Player | None = None

    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")

            if msg_type == "join":
                name = str(message.get("name") or "").strip()[:24]
                character = message.get("character")
                if not name:
                    await _send_safe(websocket, {"type": "error", "detail": "name is required"})
                    continue
                if character not in room.script.characters:
                    await _send_safe(websocket, {"type": "error", "detail": "invalid character"})
                    continue
                taken_by = next(
                    (p for p in room.players.values() if p.character == character and p.name != name),
                    None,
                )
                if taken_by is not None:
                    await _send_safe(
                        websocket, {"type": "error", "detail": f"'{character}' is already taken"}
                    )
                    continue
                player = Player(websocket=websocket, name=name, character=character)
                room.players[name] = player
                await _broadcast_room_state(room)

            elif msg_type == "start":
                if player is None or player.name != room.host_name:
                    await _send_safe(websocket, {"type": "error", "detail": "only the host can start"})
                    continue
                if room.state != "lobby":
                    continue
                missing = [
                    c
                    for c in room.script.characters
                    if not any(p.character == c for p in room.players.values())
                ]
                if missing:
                    await _send_safe(
                        websocket,
                        {"type": "error", "detail": f"unassigned characters: {', '.join(missing)}"},
                    )
                    continue
                room.state = "playing"
                room.current_line_index = 0
                await _broadcast_room_state(room)
                await _broadcast_turn(room)

            elif msg_type == "line_done":
                if room.state != "playing" or player is None:
                    continue
                current_line = room.script.lines[room.current_line_index]
                if player.character != current_line.speaker:
                    continue  # sirasi olmayan biri bildirmis - yoksay
                room.current_line_index += 1
                if room.current_line_index >= len(room.script.lines):
                    room.state = "finished"
                    await _broadcast_finished(room)
                else:
                    await _broadcast_turn(room)

            elif msg_type == "leave":
                break

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Unexpected error in dub room %s", room_code)
    finally:
        if player is not None and room.players.get(player.name) is player:
            room.players.pop(player.name, None)
            if not room.players:
                # Oda bos kaldi - hemen sil (kalici depolama yok; bir demo
                # gunu boyunca terk edilmis odalarin bellekte birikmesini
                # onluyoruz).
                ROOMS.pop(room.code, None)
            else:
                await _broadcast_room_state(room)


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


@router.post("/rooms/{room_code}/lines/{line_id}/score", response_model=ScoreLineResponse)
async def score_line(
    room_code: str,
    line_id: int,
    player_name: str,
    audio: UploadFile = File(...),
) -> ScoreLineResponse:
    room = ROOMS.get(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    line = next((l for l in room.script.lines if l.id == line_id), None)
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

    room.recordings[line.id] = RecordedLine(
        line_id=line.id,
        speaker=line.speaker,
        player_name=player_name.strip()[:24] or "?",
        transcript=stt_result.text,
        expected=line.text,
        accuracy_percent=accuracy,
        words=[w.model_dump() for w in words],
        audio_bytes=audio_bytes,
        content_type=audio.content_type or "audio/webm",
    )

    return ScoreLineResponse(
        transcript=stt_result.text,
        expected=line.text,
        words=words,
        accuracy_percent=accuracy,
    )


@router.get("/rooms/{room_code}/lines/{line_id}/audio")
def get_line_audio(room_code: str, line_id: int) -> Response:
    """
    Bir oyuncunun kaydettigi replik sesini DIGER oyunculara sunar - "sahneyi
    izle" asamasinda her istemci, kendi kaydetmedigi repliklerin sesini
    buradan cekip kendi tarayicisinda calar (bkz. dosya basi not: sunucu
    video/ses birlestirmez, sadece ham klipleri saklar/servis eder).
    """
    room = ROOMS.get(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    recording = room.recordings.get(line_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="This line has not been recorded yet.")
    return Response(content=recording.audio_bytes, media_type=recording.content_type)
